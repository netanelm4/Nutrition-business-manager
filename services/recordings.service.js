const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nowUtcISO } = require('../utils/dates');
const { isConfigured: transcriptionConfigured } = require('./ai/transcription.service');

// ─── Session recordings: storage + metadata ──────────────────────────────────
// Files live next to the database by default (path.dirname(DB_PATH)/recordings)
// so they persist wherever the database persists (the Railway volume), not in
// the ephemeral app directory. Override with RECORDINGS_DIR.
// file_path in the DB is relative to RECORDINGS_DIR: "<clientId>/<uuid>.<ext>".

const DB_DIR = path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nutrition.db'));
const RECORDINGS_DIR = path.resolve(process.env.RECORDINGS_DIR || path.join(DB_DIR, 'recordings'));
const TMP_DIR = path.join(RECORDINGS_DIR, 'tmp');

const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

// Accepted containers. Browsers report several MIME spellings; Safari's
// MediaRecorder produces audio/mp4.
const EXT_BY_MIME = Object.freeze({
  'audio/webm': 'webm',
  'video/webm': 'webm',        // some browsers label audio-only webm as video
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
});
const ALLOWED_EXTS = new Set(['webm', 'wav', 'mp3', 'm4a', 'ogg']);
// Served Content-Type per stored extension
const MIME_BY_EXT = Object.freeze({ webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' });

function ensureDirs() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

/** Extension for an upload, from its MIME type (codec parameters ignored) or file name. */
function extensionFor(mimetype, originalName) {
  const base = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  const ext = path.extname(originalName || '').slice(1).toLowerCase();
  // application/octet-stream uploads are accepted by extension only
  if (ALLOWED_EXTS.has(ext) && (base === '' || base === 'application/octet-stream')) return ext;
  return null;
}

/** Absolute path of a stored recording; refuses paths that escape RECORDINGS_DIR. */
function absolutePath(relPath) {
  const abs = path.resolve(RECORDINGS_DIR, relPath);
  if (!abs.startsWith(RECORDINGS_DIR + path.sep)) throw new Error('Invalid recording path');
  return abs;
}

function removeFile(relPath) {
  try { fs.unlinkSync(absolutePath(relPath)); return true; } catch { return false; }
}

function serialize(row) {
  let segments = null;
  try { segments = row.transcript_segments ? JSON.parse(row.transcript_segments) : null; } catch { /* corrupt → none */ }
  return {
    ...row,
    transcript_segments: segments,
    transcript_edited: row.transcript_edited === 1,
    dietitian_speaker: (() => { try { return JSON.parse(row.speaker_map || '{}').dietitian || 'דובר 1'; } catch { return 'דובר 1'; } })(),
    transcription_enabled: transcriptionConfigured(),
    audio_url: `/api/recordings/${row.id}/audio`,
  };
}

/**
 * Move an uploaded temp file into place and record it.
 * @param {object} file  multer file ({ path, originalname, mimetype, size })
 */
function saveRecording(db, { session, file, durationSeconds }) {
  const ext = extensionFor(file.mimetype, file.originalname);
  if (!ext) throw Object.assign(new Error('Unsupported audio format.'), { status: 400 });
  const id = crypto.randomUUID();
  const relPath = path.posix.join(String(session.client_id), `${id}.${ext}`);
  const abs = absolutePath(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.renameSync(file.path, abs);

  const duration = Math.max(0, Math.round(Number(durationSeconds) || 0));
  // Browser recordings arrive as "blob" → a Hebrew display name (format is in mime_type;
  // no ".webm" suffix, which renders scrambled inside RTL text)
  const fileName = (file.originalname && file.originalname !== 'blob')
    ? file.originalname
    : `הקלטת פגישה ${session.session_number}`;
  try {
    db.prepare(`
      INSERT INTO session_recordings
        (id, session_id, client_id, file_path, file_name, mime_type, duration_seconds, file_size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, session.id, session.client_id, relPath, fileName, MIME_BY_EXT[ext], duration, file.size || 0, nowUtcISO());
  } catch (err) {
    removeFile(relPath); // never leave an orphan file behind a failed insert
    throw err;
  }
  return serialize(db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(id));
}

function listForSession(db, sessionId) {
  return db.prepare('SELECT * FROM session_recordings WHERE session_id = ? ORDER BY created_at DESC')
    .all(sessionId).map(serialize);
}

function getRecording(db, id) {
  return db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(id) || null;
}

/** Delete one recording: row first (source of truth), then the file. */
function deleteRecording(db, row) {
  db.prepare('DELETE FROM session_recordings WHERE id = ?').run(row.id);
  removeFile(row.file_path);
}

/**
 * File paths of recordings that will disappear with these sessions/clients.
 * Call BEFORE the delete (rows cascade away), then removeFiles() after commit.
 */
function filesForSessions(db, sessionIds) {
  if (!sessionIds.length) return [];
  return db.prepare(`SELECT file_path FROM session_recordings WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`)
    .all(...sessionIds).map((r) => r.file_path);
}
function filesForClient(db, clientId) {
  return db.prepare('SELECT file_path FROM session_recordings WHERE client_id = ?').all(clientId).map((r) => r.file_path);
}
function removeFiles(relPaths) {
  for (const p of relPaths) removeFile(p);
}

/** Manual correction of a transcript (segments kept for reference). */
function updateTranscript(db, row, text) {
  db.prepare(`
    UPDATE session_recordings
    SET transcript = ?, transcript_edited = 1, transcript_status = 'done', transcript_error = NULL,
        transcribed_at = COALESCE(transcribed_at, ?)
    WHERE id = ?
  `).run(text, nowUtcISO(), row.id);
  return serialize(db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(row.id));
}

module.exports = {
  updateTranscript,
  RECORDINGS_DIR, TMP_DIR, MAX_RECORDING_BYTES, MIME_BY_EXT,
  ensureDirs, extensionFor, absolutePath, saveRecording, listForSession, getRecording, deleteRecording,
  filesForSessions, filesForClient, removeFiles,
};
