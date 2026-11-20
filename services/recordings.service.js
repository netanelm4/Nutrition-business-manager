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

const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

// Chunked uploads: the browser sends ≤ MAX_CHUNK_BYTES parts, each its own short
// request, so a 500MB file never depends on one long request (Node's 5 minute
// requestTimeout, proxy limits, flaky networks). Parts live in
// TMP_DIR/uploads/<uploadId>/ with a manifest.json, which survives restarts.
const MAX_CHUNK_BYTES = 12 * 1024 * 1024;
const UPLOADS_DIR = path.join(TMP_DIR, 'uploads');
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const UPLOAD_ID_RE = /^[0-9a-f-]{36}$/;

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
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  sweepStaleUploads();
}

/** Remove abandoned chunked uploads and multer temp files older than a day. */
function sweepStaleUploads() {
  const cutoff = Date.now() - STALE_UPLOAD_MS;
  for (const dir of [UPLOADS_DIR, TMP_DIR]) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (dir === TMP_DIR && e.name === 'uploads') continue;
      const abs = path.join(dir, e.name);
      try {
        if (fs.statSync(abs).mtimeMs < cutoff) {
          fs.rmSync(abs, { recursive: true, force: true });
          console.log(`[recordings] removed stale temp upload ${e.name}`);
        }
      } catch { /* raced with another cleanup */ }
    }
  }
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

// ─── Chunked uploads ─────────────────────────────────────────────────────────

const uploadErr = (status, message) => Object.assign(new Error(message), { status });

function uploadDir(uploadId) {
  if (!UPLOAD_ID_RE.test(String(uploadId))) throw uploadErr(404, 'Upload not found.');
  return path.join(UPLOADS_DIR, uploadId);
}

function readManifest(uploadId, sessionId) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(uploadDir(uploadId), 'manifest.json'), 'utf8')); }
  catch { throw uploadErr(404, 'Upload not found.'); }
  if (String(manifest.sessionId) !== String(sessionId)) throw uploadErr(404, 'Upload not found.');
  return manifest;
}

/** Indexes already stored (lets the browser resume after a failure). */
function receivedParts(uploadId, manifest) {
  const dir = uploadDir(uploadId);
  const received = [];
  for (let i = 0; i < manifest.totalChunks; i++) {
    if (fs.existsSync(path.join(dir, `${i}.part`))) received.push(i);
  }
  return received;
}

/**
 * Declare an upload before sending bytes, so an oversize or unsupported file is
 * refused without transferring anything.
 */
function initUpload(session, { fileName, mimeType, totalBytes, totalChunks, durationSeconds }) {
  const size = Number(totalBytes);
  const chunks = Number(totalChunks);
  if (!Number.isInteger(size) || size <= 0) throw uploadErr(400, 'הקובץ ריק.');
  if (size > MAX_RECORDING_BYTES) throw uploadErr(413, 'TOO_LARGE');
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > 1000 || Math.ceil(size / MAX_CHUNK_BYTES) > chunks) {
    throw uploadErr(400, 'Invalid chunk count.');
  }
  const ext = extensionFor(mimeType, fileName);
  if (!ext) throw uploadErr(400, 'UNSUPPORTED_TYPE');
  const uploadId = crypto.randomUUID();
  const dir = uploadDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    sessionId: session.id, fileName: String(fileName || 'blob').slice(0, 200), mimeType: String(mimeType || ''),
    totalBytes: size, totalChunks: chunks, durationSeconds: Number(durationSeconds) || 0, createdAt: nowUtcISO(),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { uploadId, chunkBytes: MAX_CHUNK_BYTES, received: [] };
}

/** Store one part. Re-sending the same index overwrites it (safe retries). */
function writeUploadPart(sessionId, uploadId, index, buffer) {
  const manifest = readManifest(uploadId, sessionId);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= manifest.totalChunks) throw uploadErr(400, 'Invalid chunk index.');
  if (!buffer?.length) throw uploadErr(400, 'Empty chunk.');
  if (buffer.length > MAX_CHUNK_BYTES) throw uploadErr(413, 'Chunk too large.');
  const dir = uploadDir(uploadId);
  const tmp = path.join(dir, `${i}.part.tmp`);
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, path.join(dir, `${i}.part`)); // a half-written part is never counted
  return { index: i, received: receivedParts(uploadId, manifest).length, totalChunks: manifest.totalChunks };
}

/** Concatenate the parts (streamed, never fully in memory) and save the recording. */
async function completeUpload(db, session, uploadId) {
  const manifest = readManifest(uploadId, session.id);
  const dir = uploadDir(uploadId);
  const missing = [];
  let size = 0;
  for (let i = 0; i < manifest.totalChunks; i++) {
    try { size += fs.statSync(path.join(dir, `${i}.part`)).size; } catch { missing.push(i); }
  }
  if (missing.length) throw Object.assign(uploadErr(409, 'Missing chunks.'), { missing });
  if (size !== manifest.totalBytes) throw uploadErr(400, 'Upload size mismatch.');

  const assembled = path.join(dir, 'assembled');
  const out = fs.createWriteStream(assembled);
  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      await new Promise((resolve, reject) => {
        const input = fs.createReadStream(path.join(dir, `${i}.part`));
        input.on('error', reject);
        input.on('end', resolve);
        input.pipe(out, { end: false });
      });
    }
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
    const saved = saveRecording(db, {
      session,
      file: { path: assembled, originalname: manifest.fileName, mimetype: manifest.mimeType, size },
      durationSeconds: manifest.durationSeconds,
    });
    return saved;
  } finally {
    out.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function abortUpload(sessionId, uploadId) {
  readManifest(uploadId, sessionId);
  fs.rmSync(uploadDir(uploadId), { recursive: true, force: true });
}

function uploadStatus(sessionId, uploadId) {
  const manifest = readManifest(uploadId, sessionId);
  return { uploadId, totalChunks: manifest.totalChunks, received: receivedParts(uploadId, manifest) };
}

module.exports = {
  updateTranscript,
  MAX_CHUNK_BYTES, initUpload, writeUploadPart, completeUpload, abortUpload, uploadStatus,
  RECORDINGS_DIR, TMP_DIR, MAX_RECORDING_BYTES, MIME_BY_EXT,
  ensureDirs, extensionFor, absolutePath, saveRecording, listForSession, getRecording, deleteRecording,
  filesForSessions, filesForClient, removeFiles,
};
