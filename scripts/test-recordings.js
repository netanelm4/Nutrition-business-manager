/**
 * Phase 8: session recording endpoints (upload / list / stream / delete).
 * Runs against a live server on a scratch database:
 *
 *   DB_PATH=/tmp/copy.db RECORDINGS_DIR=/tmp/rec PORT=3099 node server.js
 *   RECORDINGS_DIR=/tmp/rec node scripts/test-recordings.js
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE || 'http://localhost:3099/api';
const RECORDINGS_DIR = process.env.RECORDINGS_DIR;
let AUTH = '';
let passed = 0;
let failed = 0;

function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function req(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: AUTH }, body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, ...json };
}

async function uploadAudio(sessionId, bytes, { type, name, duration, auth = AUTH } = {}) {
  const form = new FormData();
  if (duration !== undefined) form.append('duration_seconds', String(duration));
  form.append('audio', new Blob([bytes], { type }), name);
  const res = await fetch(`${BASE}/sessions/${sessionId}/recording`, { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: form });
  let json = {};
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, ...json };
}

const fileOnDisk = (rel) => RECORDINGS_DIR && fs.existsSync(path.join(RECORDINGS_DIR, rel));

async function run() {
  console.log('\n══ Phase 8: session recordings ══\n');
  if (!RECORDINGS_DIR) console.log('  (RECORDINGS_DIR not set: on-disk checks skipped)');
  const login = await req('POST', '/auth/login', { name: process.env.TEST_USER || 'test-runner', password: process.env.TEST_PASSWORD || 'test' });
  AUTH = `Bearer ${login.data?.token}`;
  assert('Logged in', !!login.data?.token);

  const client = (await req('POST', '/clients', { full_name: 'מטופלת הקלטות', phone: '0527200001', start_date: '2026-10-01' })).data;
  const session = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-10-01', weight: 70 })).data;
  const audio = Buffer.alloc(64 * 1024, 7); // content is not decoded server-side

  // ── Upload ──
  console.log('── upload ──');
  const up = await uploadAudio(session.id, audio, { type: 'audio/webm;codecs=opus', name: 'blob', duration: 125.6 });
  const rec = up.data;
  assert('Browser recording (webm;codecs=opus) → 201', up.status === 201 && !!rec?.id, JSON.stringify(up));
  assert('Metadata: ids, size, rounded duration, mime, name', rec?.session_id === session.id && rec?.client_id === client.id
    && rec?.file_size_bytes === audio.length && rec?.duration_seconds === 126 && rec?.mime_type === 'audio/webm'
    && rec?.file_name === `הקלטת פגישה ${session.session_number}` && rec?.transcript === null && rec?.summary_insights === null, JSON.stringify(rec));
  assert('Relative path <clientId>/<uuid>.webm', rec?.file_path === `${client.id}/${rec?.id}.webm`, rec?.file_path);
  if (RECORDINGS_DIR) assert('File written to RECORDINGS_DIR', fileOnDisk(rec.file_path));

  const formats = [
    ['audio/mpeg', 'consult.mp3', 'audio/mpeg'],
    ['audio/wav', 'consult.wav', 'audio/wav'],
    ['audio/x-m4a', 'consult.m4a', 'audio/mp4'],
    ['audio/mp4', 'safari.mp4', 'audio/mp4'],
    ['audio/ogg', 'consult.ogg', 'audio/ogg'],
    ['application/octet-stream', 'phone.m4a', 'audio/mp4'],
  ];
  for (const [type, name, stored] of formats) {
    const r = await uploadAudio(session.id, audio, { type, name });
    assert(`Upload ${type} (${name}) → ${stored}`, r.status === 201 && r.data?.mime_type === stored && r.data?.file_name === name, JSON.stringify(r));
  }

  const txt = await uploadAudio(session.id, Buffer.from('hello'), { type: 'text/plain', name: 'notes.txt' });
  assert('Non-audio rejected (400)', txt.status === 400 && /פורמט/.test(txt.error || ''), JSON.stringify(txt));
  const exe = await uploadAudio(session.id, audio, { type: 'application/octet-stream', name: 'x.exe' });
  assert('Unknown extension rejected (400)', exe.status === 400);
  const big = await req('POST', `/sessions/${session.id}/recording/uploads`, {
    fileName: 'big.mp3', mimeType: 'audio/mpeg', totalBytes: 500 * 1024 * 1024 + 1, totalChunks: 50,
  });
  assert('Declared over 500MB rejected (413) before any bytes are sent', big.status === 413 && /500MB/.test(big.error || ''), JSON.stringify(big));
  const empty = await uploadAudio(session.id, Buffer.alloc(0), { type: 'audio/mpeg', name: 'empty.mp3' });
  assert('Empty file rejected (400)', empty.status === 400);
  const missing = await uploadAudio(999999, audio, { type: 'audio/mpeg', name: 'a.mp3' });
  assert('Unknown session → 404', missing.status === 404);
  const noAuth = await uploadAudio(session.id, audio, { type: 'audio/mpeg', name: 'a.mp3', auth: '' });
  assert('Upload without login → 401', noAuth.status === 401);
  const noFile = await fetch(`${BASE}/sessions/${session.id}/recording`, { method: 'POST', headers: { Authorization: AUTH }, body: new FormData() });
  assert('No file field → 400', noFile.status === 400);
  if (RECORDINGS_DIR) {
    const tmp = fs.existsSync(path.join(RECORDINGS_DIR, 'tmp')) ? fs.readdirSync(path.join(RECORDINGS_DIR, 'tmp')).filter((f) => f !== 'uploads') : [];
    assert('Rejected uploads leave no temp files', tmp.length === 0, tmp.join(','));
  }

  // ── Chunked upload (long sessions, up to 500MB) ──
  console.log('── chunked upload ──');
  {
    const CHUNK = 12 * 1024 * 1024;
    const total = 2 * CHUNK + 777; // 3 chunks, larger than the old 50MB-era single body test
    const bytes = Buffer.alloc(total);
    for (let i = 0; i < total; i += 4096) bytes[i] = (i / 4096) % 251;
    const putChunk = (uploadId, index, buf, sid = session.id) => fetch(`${BASE}/sessions/${sid}/recording/uploads/${uploadId}/${index}`, {
      method: 'PUT', headers: { Authorization: AUTH, 'Content-Type': 'application/octet-stream' }, body: buf,
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));

    const bad = await req('POST', `/sessions/${session.id}/recording/uploads`, { fileName: 'x.txt', mimeType: 'text/plain', totalBytes: 10, totalChunks: 1 });
    assert('Chunked init: non-audio → 400', bad.status === 400, JSON.stringify(bad));
    const tooFew = await req('POST', `/sessions/${session.id}/recording/uploads`, { fileName: 'blob', mimeType: 'audio/webm', totalBytes: total, totalChunks: 1 });
    assert('Chunked init: chunk count too small for the size → 400', tooFew.status === 400);
    assert('Chunked init: unknown session → 404', (await req('POST', '/sessions/999999/recording/uploads', { fileName: 'blob', mimeType: 'audio/webm', totalBytes: 10, totalChunks: 1 })).status === 404);

    const init = await req('POST', `/sessions/${session.id}/recording/uploads`, {
      fileName: 'blob', mimeType: 'audio/webm;codecs=opus', totalBytes: total, totalChunks: 3, durationSeconds: 7200,
    });
    const uploadId = init.data?.uploadId;
    assert('Chunked init → 201 with uploadId and chunk size', init.status === 201 && !!uploadId && init.data.chunkBytes === CHUNK, JSON.stringify(init));

    const p0 = await putChunk(uploadId, 0, bytes.subarray(0, CHUNK));
    assert('Chunk 0 stored', p0.success && p0.data.received === 1, JSON.stringify(p0));
    const again = await putChunk(uploadId, 0, bytes.subarray(0, CHUNK));
    assert('Re-sending the same chunk is idempotent', again.success && again.data.received === 1);
    assert('Chunk index out of range → 400', (await putChunk(uploadId, 3, Buffer.alloc(10))).status === 400);
    assert('Chunk via another session → 404', (await putChunk(uploadId, 1, Buffer.alloc(10), 999999)).status === 404);
    assert('Unknown upload id → 404', (await putChunk('00000000-0000-0000-0000-000000000000', 0, Buffer.alloc(10))).status === 404);

    const early = await req('POST', `/sessions/${session.id}/recording/uploads/${uploadId}/complete`);
    assert('Complete with missing chunks → 409 listing them', early.status === 409 && JSON.stringify(early.missing) === '[1,2]', JSON.stringify(early));
    const status = await req('GET', `/sessions/${session.id}/recording/uploads/${uploadId}`);
    assert('Upload status lists received chunks (resume)', JSON.stringify(status.data?.received) === '[0]', JSON.stringify(status));

    await putChunk(uploadId, 2, bytes.subarray(2 * CHUNK));
    await putChunk(uploadId, 1, bytes.subarray(CHUNK, 2 * CHUNK)); // out of order is fine
    const done = await req('POST', `/sessions/${session.id}/recording/uploads/${uploadId}/complete`);
    const big2 = done.data;
    assert('Complete → 201 recording, size + duration + Hebrew name', done.status === 201 && big2?.file_size_bytes === total
      && big2?.duration_seconds === 7200 && big2?.mime_type === 'audio/webm' && big2?.file_name === `הקלטת פגישה ${session.session_number}`, JSON.stringify(done).slice(0, 300));
    if (big2) {
      const got = Buffer.from(await (await fetch(`${BASE.replace(/\/api$/, '')}${big2.audio_url}`, { headers: { Authorization: AUTH } })).arrayBuffer());
      assert('Assembled file is byte-identical to the original', got.equals(bytes));
      assert('Completed upload cannot be completed twice (404)', (await req('POST', `/sessions/${session.id}/recording/uploads/${uploadId}/complete`)).status === 404);
      await req('DELETE', `/sessions/${session.id}/recording/${big2.id}`);
    }

    const ab = await req('POST', `/sessions/${session.id}/recording/uploads`, { fileName: 'a.mp3', mimeType: 'audio/mpeg', totalBytes: 100, totalChunks: 1 });
    await putChunk(ab.data.uploadId, 0, Buffer.alloc(100, 1));
    const abort = await req('DELETE', `/sessions/${session.id}/recording/uploads/${ab.data.uploadId}`);
    assert('Abandon an upload → parts removed', abort.success && (await req('GET', `/sessions/${session.id}/recording/uploads/${ab.data.uploadId}`)).status === 404);
    if (RECORDINGS_DIR) {
      const left = fs.readdirSync(path.join(RECORDINGS_DIR, 'tmp', 'uploads'));
      assert('No chunk folders left behind', left.length === 0, left.join(','));
    }
  }

  // ── List + stream ──
  console.log('── list and playback ──');
  const list = await req('GET', `/sessions/${session.id}/recording`);
  assert('GET lists the session recordings with audio_url', list.success && list.data.length === 1 + formats.length
    && list.data.every((r) => r.audio_url === `/api/recordings/${r.id}/audio`), JSON.stringify(list).slice(0, 300));
  assert('Unknown session list → 404', (await req('GET', '/sessions/999999/recording')).status === 404);

  const streamUrl = `${BASE.replace(/\/api$/, '')}${rec.audio_url}`;
  const full = await fetch(streamUrl, { headers: { Authorization: AUTH } });
  const body = Buffer.from(await full.arrayBuffer());
  assert('Audio streams with the right type and bytes', full.status === 200 && full.headers.get('content-type')?.startsWith('audio/webm') && body.equals(audio));
  const range = await fetch(streamUrl, { headers: { Authorization: AUTH, Range: 'bytes=100-199' } });
  assert('Range request → 206 partial content (seeking)', range.status === 206 && (await range.arrayBuffer()).byteLength === 100);
  const anon = await fetch(streamUrl);
  assert('Audio without login → 401', anon.status === 401);

  // ── Transcription (AI_MOCK → deterministic Scribe-shaped result) ──
  console.log('── transcription ──');
  {
    const waitFor = async (id, statuses, ms = 15000) => {
      const end = Date.now() + ms;
      for (;;) {
        const r = (await req('GET', `/sessions/${session.id}/recording`)).data.find((x) => x.id === id);
        if (statuses.includes(r?.transcript_status) || Date.now() > end) return r;
        await new Promise((res) => setTimeout(res, 300));
      }
    };
    assert('Upload response reports transcription enabled + queued', rec.transcription_enabled === true && ['queued', 'processing', 'done'].includes(rec.transcript_status), JSON.stringify({ s: rec.transcript_status, e: rec.transcription_enabled }));
    let t = await waitFor(rec.id, ['done', 'failed']);
    assert('Transcribed automatically after upload', t?.transcript_status === 'done', JSON.stringify(t));
    assert('Speaker turns: "דובר 1:" / "דובר 2:" paragraphs', /^דובר 1: /.test(t?.transcript || '') && t.transcript.includes('\n\nדובר 2: '), t?.transcript);
    assert('Segments stored with timestamps', Array.isArray(t?.transcript_segments) && t.transcript_segments.length === 3 && t.transcript_segments[0].start === 0);
    assert('Language + transcribed_at recorded', t?.transcript_language === 'heb' && !!t?.transcribed_at && t?.transcript_edited === false);

    const edited = `${t.transcript}\n\nהערה: נבדק ידנית.`;
    const put = await req('PUT', `/sessions/${session.id}/recording/${rec.id}/transcript`, { transcript: edited });
    assert('Edit transcript → saved, marked edited', put.success && put.data.transcript === edited && put.data.transcript_edited === true, JSON.stringify(put).slice(0, 200));
    assert('Edit validation: missing text → 400', (await req('PUT', `/sessions/${session.id}/recording/${rec.id}/transcript`, {})).status === 400);
    assert('Edit via another session → 404', (await req('PUT', `/sessions/999999/recording/${rec.id}/transcript`, { transcript: 'x' })).status === 404);

    const blocked = await req('POST', `/sessions/${session.id}/recording/${rec.id}/transcribe`, {});
    assert('Re-transcribe an edited transcript without force → 409', blocked.status === 409, JSON.stringify(blocked));
    const forced = await req('POST', `/sessions/${session.id}/recording/${rec.id}/transcribe`, { force: true });
    assert('Re-transcribe with force → 202 queued', forced.status === 202, JSON.stringify(forced));
    t = await waitFor(rec.id, ['done', 'failed']);
    assert('Re-run replaces the manual edit', t?.transcript_status === 'done' && t.transcript_edited === false && !t.transcript.includes('נבדק ידנית'));
    assert('Transcription attempts counted', t?.transcript_attempt === 2, String(t?.transcript_attempt));
  }

  // ── Delete ──
  console.log('── delete ──');
  const wrong = await req('DELETE', `/sessions/999999/recording/${rec.id}`);
  assert('Delete via another session id → 404', wrong.status === 404);
  const del = await req('DELETE', `/sessions/${session.id}/recording/${rec.id}`);
  assert('Delete → success', del.success && del.data.deleted === true);
  if (RECORDINGS_DIR) assert('File removed from disk', !fileOnDisk(rec.file_path));
  assert('Row gone (list shrinks, audio 404)', (await req('GET', `/sessions/${session.id}/recording`)).data.length === formats.length
    && (await fetch(streamUrl, { headers: { Authorization: AUTH } })).status === 404);
  assert('Second delete → 404', (await req('DELETE', `/sessions/${session.id}/recording/${rec.id}`)).status === 404);

  // ── Cascades: deleting a session / client removes rows and files ──
  console.log('── cascades ──');
  const remaining = (await req('GET', `/sessions/${session.id}/recording`)).data;
  await req('DELETE', `/sessions/${session.id}`);
  if (RECORDINGS_DIR) assert('Deleting the session removes its files', remaining.every((r) => !fileOnDisk(r.file_path)));
  const s2 = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-10-15', weight: 69 })).data;
  const r2 = (await uploadAudio(s2.id, audio, { type: 'audio/mpeg', name: 'last.mp3' })).data;
  const delClient = await req('DELETE', `/clients/${client.id}`);
  assert('Client delete succeeds with recordings attached', delClient.success, JSON.stringify(delClient));
  if (RECORDINGS_DIR) assert('Deleting the client removes its files', !fileOnDisk(r2.file_path));

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
