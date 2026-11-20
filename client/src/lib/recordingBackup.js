// Crash-safe backup of live session recordings in IndexedDB.
// Every MediaRecorder slice is written as it arrives, so a refresh, a closed
// tab, a crash or a failed upload never loses the session. A backup is deleted
// only after the server confirmed the upload.
//
//   recordings  { id, sessionId, mime, startedAt, durationSeconds, status: 'recording' | 'stopped' }
//   chunks      { recId, index, data: Blob }   key [recId, index]
//
// Every call is best effort: without IndexedDB (private mode, blocked storage)
// recording still works, only without the backup.

const DB_NAME = 'session-recordings';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['recId', 'index'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const chunkRange = (recId) => IDBKeyRange.bound([recId, 0], [recId, Number.MAX_SAFE_INTEGER]);

/** Ask the browser not to evict our storage under pressure (granted silently or not at all). */
export function requestPersistentStorage() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* unsupported */ }
}

export function newRecordingId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export async function startBackup({ id, sessionId, mime }) {
  try {
    await tx(['recordings'], 'readwrite', (t) => {
      t.objectStore('recordings').put({ id, sessionId: String(sessionId), mime, startedAt: Date.now(), durationSeconds: 0, status: 'recording' });
    });
    return true;
  } catch { return false; }
}

export async function saveChunk(recId, index, data) {
  try {
    await tx(['chunks'], 'readwrite', (t) => { t.objectStore('chunks').put({ recId, index, data }); });
    return true;
  } catch { return false; }
}

/** Update duration / status of a backup (e.g. every few seconds, and on stop). */
export async function updateBackup(id, fields) {
  try {
    await tx(['recordings'], 'readwrite', async (t) => {
      const store = t.objectStore('recordings');
      const row = await reqP(store.get(id));
      if (row) store.put({ ...row, ...fields });
    });
  } catch { /* best effort */ }
}

/** Backups of one session that were never confirmed uploaded, newest first. */
export async function listBackups(sessionId) {
  try {
    const rows = await tx(['recordings'], 'readonly', (t) => reqP(t.objectStore('recordings').getAll()));
    return rows.filter((r) => r.sessionId === String(sessionId)).sort((a, b) => b.startedAt - a.startedAt);
  } catch { return []; }
}

/** The full recording as one Blob (null when nothing was stored). */
export async function backupBlob(id) {
  try {
    const [row, chunks] = await tx(['recordings', 'chunks'], 'readonly', (t) => Promise.all([
      reqP(t.objectStore('recordings').get(id)),
      reqP(t.objectStore('chunks').getAll(chunkRange(id))),
    ]));
    if (!row || !chunks.length) return null;
    chunks.sort((a, b) => a.index - b.index);
    return new Blob(chunks.map((c) => c.data), { type: (row.mime || 'audio/webm').split(';')[0] });
  } catch { return null; }
}

export async function deleteBackup(id) {
  try {
    await tx(['recordings', 'chunks'], 'readwrite', (t) => {
      t.objectStore('recordings').delete(id);
      t.objectStore('chunks').delete(chunkRange(id));
    });
  } catch { /* best effort */ }
}

/** Save a Blob to the device (the "download backup" button). */
export function downloadBlob(blob, baseName) {
  const ext = /mp4|m4a|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : /mpeg|mp3/.test(blob.type) ? 'mp3' : 'webm';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
