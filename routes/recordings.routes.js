const express = require('express');
const fs = require('fs');
const multer = require('multer');
const db = require('../database/db');
const {
  TMP_DIR, MAX_RECORDING_BYTES, ensureDirs, extensionFor, absolutePath,
  saveRecording, listForSession, getRecording, deleteRecording, updateTranscript,
} = require('../services/recordings.service');
const { queueTranscription } = require('../services/jobs.service');
const { isConfigured: transcriptionConfigured } = require('../services/ai/transcription.service');

const MAX_TRANSCRIPT_CHARS = 200_000;
const { publish } = require('../services/event-bus.service');

// ─── Session recordings ─── mounted at /api, after requireAuth ───────────────
//   POST   /api/sessions/:id/recording                 multipart "audio" (+ duration_seconds)
//   GET    /api/sessions/:id/recording                 recordings of the session, newest first
//   DELETE /api/sessions/:id/recording/:recordingId    row + file
//   GET    /api/recordings/:recordingId/audio          the audio (Range supported, auth required)
//   POST   /api/sessions/:id/recording/:recordingId/transcribe   (re)queue transcription
//   PUT    /api/sessions/:id/recording/:recordingId/transcript   save an edited transcript

const router = express.Router();
ensureDirs();

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_RECORDING_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (extensionFor(file.mimetype, file.originalname)) cb(null, true);
    else cb(Object.assign(new Error('UNSUPPORTED_TYPE'), { code: 'UNSUPPORTED_TYPE' }));
  },
});

/** multer with errors translated to clean 4xx responses. */
function receiveAudio(req, res, next) {
  upload.single('audio')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'הקובץ גדול מדי (עד 50MB).');
    if (err.code === 'UNSUPPORTED_TYPE') return fail(res, 400, 'פורמט לא נתמך. אפשר להעלות WebM, WAV, MP3, M4A או OGG.');
    console.error('[recording upload]', err);
    return fail(res, 400, 'העלאת הקובץ נכשלה.');
  });
}

const findSession = (id) => db.prepare('SELECT id, client_id, session_number FROM sessions WHERE id = ?').get(id);

// POST /api/sessions/:id/recording
router.post('/sessions/:id/recording', (req, res, next) => {
  // Reject unknown sessions before reading a large body
  if (!findSession(req.params.id)) return fail(res, 404, 'Session not found.');
  return next();
}, receiveAudio, (req, res) => {
  const cleanupTmp = () => { if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {}); };
  try {
    if (!req.file) return fail(res, 400, 'audio file is required (field "audio").');
    if (!req.file.size) { cleanupTmp(); return fail(res, 400, 'הקובץ ריק.'); }
    const session = findSession(req.params.id);
    if (!session) { cleanupTmp(); return fail(res, 404, 'Session not found.'); }
    const saved = saveRecording(db, { session, file: req.file, durationSeconds: req.body?.duration_seconds });
    publish(db, 'session.recording_added', { entityType: 'session', entityId: session.id, payload: { recordingId: saved.id } });
    // Automatic transcription in the background (no-op when no provider key is configured)
    queueTranscription(db, saved.id);
    const recording = listForSession(db, session.id).find((r) => r.id === saved.id) || saved;
    return res.status(201).json({ success: true, data: recording });
  } catch (err) {
    cleanupTmp();
    console.error('[POST /sessions/:id/recording]', err);
    return fail(res, err.status || 500, err.status ? err.message : 'Failed to save recording.');
  }
});

// GET /api/sessions/:id/recording
router.get('/sessions/:id/recording', (req, res) => {
  try {
    if (!findSession(req.params.id)) return fail(res, 404, 'Session not found.');
    return ok(res, listForSession(db, req.params.id));
  } catch (err) {
    console.error('[GET /sessions/:id/recording]', err);
    return fail(res, 500, 'Failed to fetch recordings.');
  }
});

// DELETE /api/sessions/:id/recording/:recordingId
router.delete('/sessions/:id/recording/:recordingId', (req, res) => {
  try {
    const row = getRecording(db, req.params.recordingId);
    if (!row || String(row.session_id) !== String(req.params.id)) return fail(res, 404, 'Recording not found.');
    deleteRecording(db, row);
    publish(db, 'session.recording_deleted', { entityType: 'session', entityId: row.session_id, payload: { recordingId: row.id } });
    return ok(res, { id: row.id, deleted: true });
  } catch (err) {
    console.error('[DELETE /sessions/:id/recording/:recordingId]', err);
    return fail(res, 500, 'Failed to delete recording.');
  }
});

const findOwnRecording = (req) => {
  const row = getRecording(db, req.params.recordingId);
  return row && String(row.session_id) === String(req.params.id) ? row : null;
};

// POST /api/sessions/:id/recording/:recordingId/transcribe — retry / transcribe again
router.post('/sessions/:id/recording/:recordingId/transcribe', (req, res) => {
  try {
    const row = findOwnRecording(req);
    if (!row) return fail(res, 404, 'Recording not found.');
    if (!transcriptionConfigured()) return fail(res, 503, 'התמלול לא מוגדר (חסר ELEVENLABS_API_KEY).');
    if (['queued', 'processing'].includes(row.transcript_status)) return fail(res, 409, 'התמלול כבר בתהליך.');
    if (row.transcript_status === 'done' && row.transcript_edited === 1 && req.body?.force !== true) {
      return fail(res, 409, 'התמלול נערך ידנית. יש לאשר דריסה.');
    }
    if (row.transcript_status === 'done') {
      db.prepare("UPDATE session_recordings SET transcript_status = NULL WHERE id = ?").run(row.id); // allow re-run
    }
    queueTranscription(db, row.id);
    return res.status(202).json({ success: true, data: listForSession(db, row.session_id).find((r) => r.id === row.id) });
  } catch (err) {
    console.error('[POST /sessions/:id/recording/:recordingId/transcribe]', err);
    return fail(res, 500, 'Failed to queue transcription.');
  }
});

// PUT /api/sessions/:id/recording/:recordingId/transcript — { transcript }
router.put('/sessions/:id/recording/:recordingId/transcript', (req, res) => {
  try {
    const row = findOwnRecording(req);
    if (!row) return fail(res, 404, 'Recording not found.');
    const text = req.body?.transcript;
    if (typeof text !== 'string') return fail(res, 400, 'transcript (string) is required.');
    if (text.length > MAX_TRANSCRIPT_CHARS) return fail(res, 400, 'התמלול ארוך מדי.');
    const updated = updateTranscript(db, row, text.trim());
    publish(db, 'session.recording_transcript_edited', { entityType: 'session', entityId: row.session_id, payload: { recordingId: row.id } });
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /sessions/:id/recording/:recordingId/transcript]', err);
    return fail(res, 500, 'Failed to save transcript.');
  }
});

// GET /api/recordings/:recordingId/audio — express handles Range requests (seeking)
router.get('/recordings/:recordingId/audio', (req, res) => {
  try {
    const row = getRecording(db, req.params.recordingId);
    if (!row) return fail(res, 404, 'Recording not found.');
    const abs = absolutePath(row.file_path);
    if (!fs.existsSync(abs)) return fail(res, 404, 'Recording file is missing.');
    res.set('Cache-Control', 'private, no-store');
    return res.sendFile(abs, { headers: { 'Content-Type': row.mime_type } });
  } catch (err) {
    console.error('[GET /recordings/:recordingId/audio]', err);
    return fail(res, 500, 'Failed to stream recording.');
  }
});

module.exports = router;
