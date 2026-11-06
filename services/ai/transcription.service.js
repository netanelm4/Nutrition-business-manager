const fs = require('fs');
const { nowUtcISO } = require('../../utils/dates');

// ─── Session transcription (ElevenLabs Scribe) ───────────────────────────────
// POST https://api.elevenlabs.io/v1/speech-to-text (multipart), header xi-api-key.
// Hebrew, speaker diarization (dietitian + client). Files up to 5GB are accepted,
// so our ≤50MB recordings go in one request — no splitting.
// AI_MOCK=1 (or TRANSCRIPTION_MOCK=1) returns a deterministic transcript for tests.

const ENDPOINT = process.env.ELEVENLABS_STT_URL || 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
const LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || 'he';
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // an hour of audio can take a while

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
async function transcribeFile(absPath, { mimeType, fileName }) {
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
    form.append('file', new Blob([fs.readFileSync(absPath)], { type: mimeType }), fileName);

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

  // multichannel responses wrap several transcripts; we send mono audio, but be tolerant
  const chunk = Array.isArray(body.transcripts) ? body.transcripts[0] : body;
  const segments = buildSegments(chunk.words);
  return {
    text: formatTranscript(segments, chunk.text),
    segments,
    language: chunk.language_code || null,
    durationSecs: body.audio_duration_secs ?? chunk.audio_duration_secs ?? null,
  };
}

/**
 * Transcribe a stored recording and save the result. Never throws: the outcome
 * is recorded on the row (transcript_status / transcript_error).
 * One in-process retry for transient failures; the UI offers a manual retry.
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
  set({ transcript_status: 'processing', transcript_error: null });

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await transcribeFile(absolutePath(row.file_path), { mimeType: row.mime_type, fileName: row.file_name });
      set({
        transcript: result.text,
        transcript_segments: JSON.stringify(result.segments),
        transcript_language: result.language,
        transcript_status: 'done',
        transcript_error: null,
        transcript_edited: 0,
        transcribed_at: nowUtcISO(),
        // the browser's duration is an estimate; the provider measured the audio
        ...(result.durationSecs && !row.duration_seconds ? { duration_seconds: Math.round(result.durationSecs) } : {}),
      });
      publish?.(db, 'session.recording_transcribed', { entityType: 'session', entityId: row.session_id, payload: { recordingId } });
      return { done: true, chars: result.text.length };
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
  isConfigured, transcribeFile, transcribeRecording, buildSegments, formatTranscript, TranscriptionError,
};
