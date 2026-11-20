const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { nowUtcISO } = require('../../utils/dates');

// ─── Session transcription (ElevenLabs Scribe) ───────────────────────────────
// POST https://api.elevenlabs.io/v1/speech-to-text (multipart), header xi-api-key.
// Hebrew, speaker diarization (dietitian + client). AI_MOCK=1 (or
// TRANSCRIPTION_MOCK=1) returns a deterministic transcript for tests.
//
// Long sessions (up to 500MB uploads):
//   1. ffmpeg compresses to speech-quality mono Opus (2h ≈ 30MB), so the request
//      is small and the file is streamed from disk, never read into memory.
//   2. Scribe accepts up to 5GB per request, so by default the whole session goes
//      in ONE request: speaker ids (speaker_0/1) stay consistent for the whole
//      session, which speaker_map and the clinical analysis rely on.
//   3. Above SPLIT_THRESHOLD_SECS, or when the single request fails transiently,
//      the audio is split into SEGMENT_SECS parts with SEGMENT_OVERLAP_SECS of
//      overlap, transcribed in order, and merged at the word level: speakers of
//      each part are matched to the previous part through the overlap window.
// Without ffmpeg (not installed) the original file is sent as is.

const ENDPOINT = process.env.ELEVENLABS_STT_URL || 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
const LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || 'he';
const REQUEST_TIMEOUT_MS = 40 * 60 * 1000; // two hours of audio in one request can take a while
const PART_TIMEOUT_MS = 15 * 60 * 1000;
const SEGMENT_SECS = 15 * 60;
const SEGMENT_OVERLAP_SECS = 5;
const SPLIT_THRESHOLD_SECS = Number(process.env.TRANSCRIPTION_SPLIT_THRESHOLD_SECS) || 150 * 60;
const MIN_LAST_SEGMENT_SECS = 60;  // a shorter tail is folded into the previous part
const COMPRESS_BITRATE = '32k';
const COMPRESSED_MIME = 'audio/ogg';

class TranscriptionError extends Error {
  constructor(message, { permanent = false, status = null } = {}) {
    super(message);
    this.name = 'TranscriptionError';
    this.permanent = permanent;
    this.status = status;
  }
}

function isMock() {
  return process.env.TRANSCRIPTION_MOCK === '1' || process.env.AI_MOCK === '1';
}

function isConfigured() {
  return isMock() || !!process.env.ELEVENLABS_API_KEY;
}

/** "speaker_0" → "דובר 1" (who is who is left to the dietitian / Phase 10). */
function speakerLabel(id, order) {
  if (!order.has(id)) order.set(id, order.size + 1);
  return `דובר ${order.get(id)}`;
}

/**
 * Words → speaker turns. Each turn: { speaker, start, end, text }.
 * "spacing" items keep the original whitespace; audio events are dropped.
 */
function buildSegments(words = []) {
  const order = new Map();
  const segments = [];
  let cur = null;
  for (const w of words) {
    if (w.type === 'audio_event') continue;
    const speaker = w.speaker_id ? speakerLabel(w.speaker_id, order) : (cur?.speaker || 'דובר 1');
    if (w.type === 'word' && (!cur || cur.speaker !== speaker)) {
      if (cur) segments.push(cur);
      cur = { speaker, start: w.start ?? null, end: w.end ?? null, text: '' };
    }
    if (!cur) continue;
    cur.text += w.text;
    if (w.type === 'word' && w.end != null) cur.end = w.end;
  }
  if (cur) segments.push(cur);
  return segments.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })).filter((s) => s.text);
}

/** Readable transcript: one paragraph per speaker turn. */
function formatTranscript(segments, fallbackText) {
  if (!segments.length) return (fallbackText || '').trim();
  const distinct = new Set(segments.map((s) => s.speaker)).size;
  return segments.map((s) => (distinct > 1 ? `${s.speaker}: ${s.text}` : s.text)).join('\n\n');
}

function mockResult() {
  const words = [];
  const say = (speaker, text, t) => {
    for (const [i, word] of text.split(' ').entries()) {
      if (i) words.push({ text: ' ', type: 'spacing', speaker_id: speaker });
      words.push({ text: word, type: 'word', start: t + i * 0.4, end: t + i * 0.4 + 0.35, speaker_id: speaker, logprob: -0.1 });
    }
    words.push({ text: ' ', type: 'spacing', speaker_id: speaker });
  };
  say('speaker_0', 'איך עבר השבוע מאז הפגישה הקודמת?', 0);
  say('speaker_1', 'היה טוב, הקפדתי על ארוחת בוקר עם חלבון וירדתי חצי קילו.', 4);
  say('speaker_0', 'מצוין, נמשיך עם אותו מבנה ונוסיף מנת ירק בצהריים.', 10);
  return { language_code: 'heb', language_probability: 0.99, text: 'mock', words, audio_duration_secs: 15 };
}

/**
 * Transcribe one audio file.
 * @returns {{ text, segments, language, durationSecs }}
 */
async function transcribeFile(absPath, opts) {
  return toResult(rawResult(await providerRequest(absPath, opts)));
}

/** One provider request → the raw JSON body (mock: a fixed body). */
async function providerRequest(absPath, { mimeType, fileName, timeoutMs = REQUEST_TIMEOUT_MS }) {
  let body;
  if (isMock()) {
    body = mockResult();
  } else {
    if (!process.env.ELEVENLABS_API_KEY) throw new TranscriptionError('ELEVENLABS_API_KEY is not set.', { permanent: true });
    const form = new FormData();
    form.append('model_id', MODEL_ID);
    form.append('language_code', LANGUAGE);
    form.append('diarize', 'true');
    form.append('num_speakers', '2');
    form.append('tag_audio_events', 'false');
    form.append('timestamps_granularity', 'word');
    // openAsBlob streams from disk: a large recording never lands on the heap
    form.append('file', await fs.openAsBlob(absPath, { type: mimeType }), fileName);

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TranscriptionError(`Network error: ${err.message}`); // transient
    }
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify((await res.json()).detail ?? '').slice(0, 300); } catch { /* not JSON */ }
      // 4xx (auth, validation, unsupported file) will not succeed on retry; 429 / 5xx may
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw new TranscriptionError(`ElevenLabs ${res.status} ${detail}`.trim(), { permanent, status: res.status });
    }
    body = await res.json();
  }
  return body;
}

/** Provider body → { words, text, language, durationSecs } (multichannel tolerant). */
function rawResult(body) {
  // multichannel responses wrap several transcripts; we send mono audio, but be tolerant
  const chunk = Array.isArray(body.transcripts) ? body.transcripts[0] : body;
  return {
    words: chunk.words || [],
    text: chunk.text || '',
    language: chunk.language_code || null,
    durationSecs: body.audio_duration_secs ?? chunk.audio_duration_secs ?? null,
  };
}

function toResult({ words, text, language, durationSecs }) {
  const segments = buildSegments(words);
  return { text: formatTranscript(segments, text), segments, language, durationSecs };
}

// ─── ffmpeg ──────────────────────────────────────────────────────────────────

let ffmpegAvailable = null;
function hasFfmpeg() {
  if (ffmpegAvailable === null) {
    const probe = (bin) => { try { return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
    ffmpegAvailable = probe('ffmpeg') && probe('ffprobe');
    if (!ffmpegAvailable) console.warn('[transcription] ffmpeg/ffprobe not found: sending original files without compression or splitting');
  }
  return ffmpegAvailable;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.trim().split('\n').pop()}`))));
  });
}

async function probeDuration(absPath) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', absPath]);
  const secs = Number.parseFloat(out);
  return Number.isFinite(secs) ? secs : 0;
}

/** Any input → mono 16kHz Opus at speech bitrate. Returns { path, durationSecs }. */
async function prepareAudio(absPath, workDir) {
  const out = path.join(workDir, 'audio.ogg');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', absPath,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', COMPRESS_BITRATE, '-application', 'voip', out]);
  return { path: out, durationSecs: await probeDuration(out) };
}

/** Part boundaries: [{ offset, length }] (length null = to the end). */
function planSegments(durationSecs, { segment = SEGMENT_SECS, overlap = SEGMENT_OVERLAP_SECS } = {}) {
  const count = Math.max(1, Math.ceil(durationSecs / segment));
  const plan = [];
  for (let i = 0; i < count; i++) plan.push({ offset: i * segment, length: segment + overlap });
  // fold a very short tail into the previous part
  if (plan.length > 1 && durationSecs - plan[plan.length - 1].offset < MIN_LAST_SEGMENT_SECS) plan.pop();
  plan[plan.length - 1].length = null;
  return plan;
}

/** Cut the compressed file into parts (stream copy: fast, no re-encode). */
async function splitAudio(compressedPath, durationSecs, workDir) {
  const parts = [];
  for (const [i, p] of planSegments(durationSecs).entries()) {
    const out = path.join(workDir, `part-${String(i).padStart(3, '0')}.ogg`);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(p.offset),
      ...(p.length ? ['-t', String(p.length)] : []), '-i', compressedPath, '-c', 'copy', out]);
    parts.push({ path: out, offset: p.offset });
  }
  return parts;
}

// ─── Merging parts ───────────────────────────────────────────────────────────

/**
 * Join per-part word lists into one list on the session timeline.
 * @param {Array<{ offset: number, words: object[] }>} parts  word times relative to the part
 * Speaker ids are per request, so part N's ids are mapped onto the merged ids by
 * the words both parts heard in the overlap window (majority vote; with two
 * speakers a single match also fixes the other id). The cut is the middle of
 * the overlap: earlier words come from the previous part, later from the next.
 */
function mergeParts(parts, { overlap = SEGMENT_OVERLAP_SECS } = {}) {
  const shift = (w, offset) => ({
    ...w, ...(w.start != null ? { start: w.start + offset } : {}), ...(w.end != null ? { end: w.end + offset } : {}),
  });
  let merged = [];
  for (const [k, part] of parts.entries()) {
    const words = (part.words || []).filter((w) => w.type !== 'audio_event').map((w) => shift(w, part.offset));
    if (k === 0) { merged = words; continue; }

    const winStart = part.offset;
    const winEnd = part.offset + overlap;
    const inWindow = (w) => w.type === 'word' && w.start != null && w.start < winEnd && (w.end ?? w.start) > winStart;
    const prevWords = merged.filter(inWindow);

    // votes[nextId][prevId] = count of time-overlapping word pairs
    const votes = {};
    for (const w of words.filter(inWindow)) {
      const match = prevWords.find((p) => p.start < (w.end ?? w.start) + 0.15 && (p.end ?? p.start) > w.start - 0.15);
      if (!match?.speaker_id || !w.speaker_id) continue;
      votes[w.speaker_id] ??= {};
      votes[w.speaker_id][match.speaker_id] = (votes[w.speaker_id][match.speaker_id] || 0) + 1;
    }
    if (!Object.keys(votes).length) {
      // silence or no speaker ids in the overlap: speaker labels after this cut are a best guess
      console.warn(`[transcription] part ${k + 1}: no shared words in the overlap, speaker labels may swap at ${Math.round(part.offset)}s`);
    }
    const map = {};
    const used = new Set();
    for (const [nextId, counts] of Object.entries(votes)) {
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      if (!used.has(best)) { map[nextId] = best; used.add(best); }
    }
    const nextIds = [...new Set(words.map((w) => w.speaker_id).filter(Boolean))];
    const knownIds = [...new Set(merged.map((w) => w.speaker_id).filter(Boolean))];
    for (const id of nextIds) {
      if (map[id]) continue;
      // the one remaining speaker of a two-person session; otherwise keep the id if it is free
      const free = knownIds.filter((x) => !used.has(x));
      const target = free.length === 1 && nextIds.length <= 2 ? free[0] : (!used.has(id) ? id : `${id}_p${k}`);
      map[id] = target;
      used.add(target);
    }

    const cut = part.offset + overlap / 2;
    // spacing items carry times too; untimed items follow the previous word's decision
    const keepBefore = [];
    let keep = true;
    for (const w of merged) {
      if (w.start != null) keep = w.start < cut;
      if (keep) keepBefore.push(w);
    }
    const after = [];
    keep = false;
    for (const w of words) {
      if (w.start != null) keep = w.start >= cut;
      if (keep) after.push(w.speaker_id ? { ...w, speaker_id: map[w.speaker_id] } : w);
    }
    merged = [...keepBefore, { text: ' ', type: 'spacing', speaker_id: keepBefore[keepBefore.length - 1]?.speaker_id }, ...after];
  }
  return merged;
}

/**
 * Transcribe a recording file end to end: compress, then one request or parts.
 * @param {(part: number, parts: number) => void} onProgress  part 0 = preparing
 * @returns {{ text, segments, language, durationSecs, parts }}
 */
async function transcribeLong(absPath, { mimeType, fileName, forceSplit = false, onProgress = () => {} }) {
  if (isMock() || !hasFfmpeg()) {
    onProgress(1, 1);
    return { ...(await transcribeFile(absPath, { mimeType, fileName })), parts: 1 };
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
  try {
    onProgress(0, 0);
    const compressed = await prepareAudio(absPath, workDir);
    const split = forceSplit ? compressed.durationSecs > SEGMENT_SECS + MIN_LAST_SEGMENT_SECS : compressed.durationSecs > SPLIT_THRESHOLD_SECS;
    const name = `${path.parse(fileName || 'recording').name || 'recording'}.ogg`;
    if (!split) {
      onProgress(1, 1);
      const result = await transcribeFile(compressed.path, { mimeType: COMPRESSED_MIME, fileName: name });
      return { ...result, durationSecs: result.durationSecs || compressed.durationSecs, parts: 1 };
    }

    const files = await splitAudio(compressed.path, compressed.durationSecs, workDir);
    const raw = [];
    for (const [i, f] of files.entries()) {
      onProgress(i + 1, files.length);
      let result = null;
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
          result = rawResult(await providerRequest(f.path, { mimeType: COMPRESSED_MIME, fileName: name, timeoutMs: PART_TIMEOUT_MS }));
        } catch (err) {
          if (err.permanent || attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      raw.push({ offset: f.offset, ...result });
      fs.rmSync(f.path, { force: true }); // free disk as we go
    }
    return {
      ...toResult({
        words: mergeParts(raw),
        text: raw.map((r) => r.text).join(' '),
        language: raw.find((r) => r.language)?.language || null,
        durationSecs: compressed.durationSecs,
      }),
      parts: files.length,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Transcribe a stored recording and save the result. Never throws: the outcome
 * is recorded on the row (transcript_status / transcript_error, and the
 * transcript_part / transcript_parts progress for long recordings).
 * One in-process retry for transient failures (split into parts on the retry);
 * the UI offers a manual retry.
 */
async function transcribeRecording(db, recordingId, { absolutePath, publish } = {}) {
  const row = db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(recordingId);
  if (!row) return { skipped: 'missing' };
  if (row.transcript_status === 'done') return { skipped: 'done' };

  const set = (fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE session_recordings SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`)
      .run({ ...fields, id: recordingId });
  };
  set({ transcript_status: 'processing', transcript_error: null, transcript_part: 0, transcript_parts: 0 });
  const onProgress = (part, parts) => {
    set({ transcript_part: part, transcript_parts: parts });
    publish?.(db, 'session.recording_progress', { entityType: 'session', entityId: row.session_id, payload: { recordingId, part, parts } });
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await transcribeLong(absolutePath(row.file_path), {
        mimeType: row.mime_type, fileName: row.file_name, forceSplit: attempt === 2, onProgress,
      });
      set({
        transcript: result.text,
        transcript_segments: JSON.stringify(result.segments),
        transcript_language: result.language,
        transcript_status: 'done',
        transcript_error: null,
        transcript_edited: 0,
        transcript_part: result.parts,
        transcript_parts: result.parts,
        transcribed_at: nowUtcISO(),
        // the browser's duration is an estimate; the provider measured the audio
        ...(result.durationSecs && !row.duration_seconds ? { duration_seconds: Math.round(result.durationSecs) } : {}),
      });
      if (result.parts > 1) console.log(`[transcription] ${recordingId} done in ${result.parts} parts`);
      publish?.(db, 'session.recording_transcribed', { entityType: 'session', entityId: row.session_id, payload: { recordingId } });
      return { done: true, chars: result.text.length, parts: result.parts };
    } catch (err) {
      lastErr = err;
      if (err.permanent || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  set({ transcript_status: 'failed', transcript_error: String(lastErr?.message || lastErr).slice(0, 500) });
  console.error(`[transcription] ${recordingId} failed: ${lastErr?.message}`);
  publish?.(db, 'session.recording_transcribed', { entityType: 'session', entityId: row.session_id, payload: { recordingId, failed: true } });
  return { failed: true, error: lastErr?.message };
}

module.exports = {
  isConfigured, transcribeFile, transcribeRecording, transcribeLong, prepareAudio, splitAudio, planSegments, mergeParts, hasFfmpeg,
  SEGMENT_SECS, SEGMENT_OVERLAP_SECS, buildSegments, formatTranscript, TranscriptionError,
};
