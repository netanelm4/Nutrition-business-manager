import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSessionRecordings, uploadSessionRecording, deleteSessionRecording, fetchRecordingAudioUrl,
} from '../../lib/api';
import {
  RECORDING_MAX_BYTES, RECORDING_ACCEPT, RECORDING_MIME_CANDIDATES, RECORDING_LABELS as L,
} from '../../constants/recordings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDING_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

/** Duration of a chosen file from its metadata (0 when the browser cannot tell). */
function readFileDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value) => { URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? value : 0); };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 5000);
    audio.src = url;
  });
}

const btn = {
  base: {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 'var(--r-md)',
    fontSize: 13, fontWeight: 500, border: '1px solid var(--line)', cursor: 'pointer',
    background: 'var(--surface-2)', color: 'var(--ink-1)',
  },
  danger: { background: 'var(--red-soft)', color: 'var(--red-ink)', borderColor: 'var(--red)' },
  primary: { background: 'var(--blue)', color: 'var(--on-accent)', borderColor: 'var(--blue)' },
};

// ─── Live microphone level (Web Audio, DOM updated through refs) ──────────────

function LevelMeter({ stream, active }) {
  const barsRef = useRef([]);
  useEffect(() => {
    if (!stream) return undefined;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / barsRef.current.length) || 1;
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
        const level = active ? Math.min(1, sum / step / 160) : 0;
        bar.style.transform = `scaleY(${0.12 + level * 0.88})`;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); };
  }, [stream, active]);

  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 3, height: 22 }}>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          style={{
            width: 3, height: 22, borderRadius: 2, background: active ? 'var(--red)' : 'var(--ink-4)',
            transform: 'scaleY(0.12)', transformOrigin: 'center', transition: 'transform 80ms linear',
          }}
        />
      ))}
    </div>
  );
}

// ─── One saved recording ──────────────────────────────────────────────────────

function RecordingItem({ recording, sessionId }) {
  const queryClient = useQueryClient();
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const remove = useMutation({
    mutationFn: () => deleteSessionRecording(sessionId, recording.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] }),
    onError: (err) => setError(err.message || L.deleteFailed),
  });

  async function load() {
    setLoading(true);
    setError('');
    try { setSrc(await fetchRecordingAudioUrl(recording.audio_url)); }
    catch { setError(L.loadFailed); }
    finally { setLoading(false); }
  }

  // Chrome's MediaRecorder WebM has no duration in its header → force the browser to compute it
  function fixDuration(e) {
    const audio = e.currentTarget;
    if (audio.duration !== Infinity) return;
    const reset = () => { audio.removeEventListener('timeupdate', reset); audio.currentTime = 0; };
    audio.addEventListener('timeupdate', reset);
    audio.currentTime = 1e101;
  }

  const created = new Date(recording.created_at).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
  });

  return (
    <li style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 12, background: 'var(--surface-1)', listStyle: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-1)', overflowWrap: 'anywhere' }}>{recording.file_name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* <bdi> keeps numbers readable inside the RTL line */}
            {[recording.duration_seconds ? formatDuration(recording.duration_seconds) : null, formatSize(recording.file_size_bytes), created]
              .filter(Boolean)
              .map((part, i) => (
                <span key={i}>{i > 0 && '· '}<bdi>{part}</bdi></span>
              ))}
          </p>
        </div>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} style={{ ...btn.base, padding: '5px 10px', fontSize: 12, color: 'var(--ink-3)' }}>
            {L.delete}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--red-ink)' }}>{L.deleteConfirm}</span>
            <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} style={{ ...btn.base, ...btn.danger, padding: '5px 10px', fontSize: 12 }}>
              {remove.isPending ? L.deleting : L.deleteYes}
            </button>
            <button type="button" onClick={() => setConfirming(false)} style={{ ...btn.base, padding: '5px 10px', fontSize: 12 }}>
              {L.cancel}
            </button>
          </div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        {src ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio controls autoPlay src={src} onLoadedMetadata={fixDuration} style={{ width: '100%', colorScheme: 'dark' }} />
        ) : (
          <button type="button" onClick={load} disabled={loading} style={btn.base}>
            {loading ? L.loading : L.play}
          </button>
        )}
      </div>
      {error && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--red-ink)' }}>{error}</p>}
    </li>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

/**
 * Record a consultation in the browser or upload an existing audio file,
 * then play back / delete saved recordings of the session.
 * Closing the view while recording saves what was recorded so far.
 */
export default function SessionRecordingCard({ sessionId }) {
  const queryClient = useQueryClient();
  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ['recordings', String(sessionId)],
    queryFn: () => fetchSessionRecordings(sessionId),
    enabled: !!sessionId,
  });

  const [state, setState] = useState('idle'); // idle | connecting | recording | paused | saving
  const [elapsed, setElapsed] = useState(0);  // seconds
  const [stream, setStream] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const rec = useRef({ recorder: null, chunks: [], startedAt: 0, accumulated: 0, mime: '' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && pickMimeType() !== null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] });

  async function upload(file, { fileName, durationSeconds }) {
    setProgress(0);
    setError('');
    try {
      await uploadSessionRecording(sessionId, file, { fileName, durationSeconds, onProgress: setProgress });
      refresh();
    } catch (err) {
      setError(err.message || L.uploadFailed);
    } finally {
      setProgress(null);
    }
  }

  // Timer
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const t = setInterval(() => {
      const r = rec.current;
      setElapsed((r.accumulated + (Date.now() - r.startedAt)) / 1000);
    }, 250);
    return () => clearInterval(t);
  }, [state]);

  // Warn before leaving the page mid-recording
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  function releaseMic(s) {
    s?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  async function start() {
    if (stateRef.current !== 'idle') return; // no double start while the mic is connecting
    setError('');
    setState('connecting');
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? L.micDenied : L.micUnavailable);
      setState('idle');
      return;
    }
    const mime = pickMimeType();
    const recorder = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
    rec.current = { recorder, chunks: [], startedAt: Date.now(), accumulated: 0, mime: recorder.mimeType || mime || 'audio/webm' };
    recorder.ondataavailable = (e) => { if (e.data?.size) rec.current.chunks.push(e.data); };
    recorder.start(1000); // a chunk every second → nothing is lost if the view closes
    setStream(media);
    setElapsed(0);
    setState('recording');
  }

  function togglePause() {
    const r = rec.current;
    if (!r.recorder) return;
    if (state === 'recording') {
      r.recorder.pause();
      r.accumulated += Date.now() - r.startedAt;
      setElapsed(r.accumulated / 1000);
      setState('paused');
    } else if (state === 'paused') {
      r.recorder.resume();
      r.startedAt = Date.now();
      setState('recording');
    }
  }

  /** Stop and upload. Returns a promise that resolves after the upload. */
  function stopAndSave() {
    const r = rec.current;
    if (!r.recorder || r.recorder.state === 'inactive') return Promise.resolve();
    const total = (r.accumulated + (stateRef.current === 'recording' ? Date.now() - r.startedAt : 0)) / 1000;
    const mediaStream = r.recorder.stream;
    setState('saving');
    return new Promise((resolve) => {
      r.recorder.onstop = async () => {
        releaseMic(mediaStream);
        const type = r.mime.split(';')[0] || 'audio/webm';
        const blob = new Blob(r.chunks, { type });
        rec.current = { recorder: null, chunks: [], startedAt: 0, accumulated: 0, mime: '' };
        if (blob.size) {
          await upload(blob, { fileName: 'blob', durationSeconds: total });
        }
        setState('idle');
        setElapsed(0);
        resolve();
      };
      r.recorder.stop();
    });
  }

  // Leaving the view mid-recording: stop and save what was recorded (upload continues in background)
  useEffect(() => () => {
    const r = rec.current;
    if (!r.recorder || r.recorder.state === 'inactive') return;
    const total = (r.accumulated + (r.recorder.state === 'recording' ? Date.now() - r.startedAt : 0)) / 1000;
    const { chunks, mime } = r;
    const mediaStream = r.recorder.stream;
    r.recorder.onstop = () => {
      mediaStream.getTracks().forEach((t) => t.stop());
      const type = mime.split(';')[0] || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size) {
        uploadSessionRecording(sessionId, blob, { fileName: 'blob', durationSeconds: total })
          .then(() => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] }))
          .catch(() => {});
      }
    };
    r.recorder.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > RECORDING_MAX_BYTES) { setError(L.tooLarge); return; }
    const durationSeconds = await readFileDuration(file);
    await upload(file, { fileName: file.name, durationSeconds });
  }

  const busy = state === 'saving' || state === 'connecting' || progress !== null;
  const live = state === 'recording' || state === 'paused';

  return (
    <section
      dir="rtl"
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface-1)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{L.title}</h3>
        {recordings.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{L.count(recordings.length)}</span>
        )}
      </div>

      {/* Recorder */}
      {supported ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {!live ? (
            <button type="button" onClick={start} disabled={busy} style={{ ...btn.base, ...btn.danger, opacity: busy ? 0.5 : 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)' }} />
              {state === 'connecting' ? L.connecting : L.start}
            </button>
          ) : (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontVariantNumeric: 'tabular-nums', fontSize: 15, color: 'var(--ink-1)', minWidth: 72 }}>
                <span
                  className={state === 'recording' ? 'animate-pulse motion-reduce:animate-none' : ''}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: state === 'recording' ? 'var(--red)' : 'var(--ink-4)' }}
                />
                {formatDuration(elapsed)}
              </span>
              <LevelMeter stream={stream} active={state === 'recording'} />
              <button type="button" onClick={togglePause} style={btn.base}>
                {state === 'recording' ? L.pause : L.resume}
              </button>
              <button type="button" onClick={stopAndSave} style={{ ...btn.base, ...btn.primary }}>
                {L.stop}
              </button>
            </>
          )}
          {state === 'saving' && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{L.saving}</span>}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{L.unsupported}</p>
      )}

      {/* Upload alternative */}
      {!live && (
        <div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', opacity: busy ? 0.5 : 1 }}>
            {L.uploadExisting}
          </button>
          <input ref={fileRef} type="file" accept={RECORDING_ACCEPT} onChange={onFileChosen} style={{ display: 'none' }} />
        </div>
      )}

      {progress !== null && (
        <div role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}
          style={{ height: 4, borderRadius: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--blue)', transition: 'width 120ms linear' }} />
        </div>
      )}

      {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--red-ink)' }}>{error}</p>}

      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4)' }}>{L.consent}</p>

      {/* Saved recordings */}
      {isLoading ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{L.loadingList}</p>
      ) : recordings.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recordings.map((r) => <RecordingItem key={r.id} recording={r} sessionId={sessionId} />)}
        </ul>
      )}
    </section>
  );
}
