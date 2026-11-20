import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSessionRecordings, uploadSessionRecordingChunked, deleteSessionRecording, fetchRecordingAudioUrl,
  transcribeSessionRecording, updateRecordingTranscript,
} from '../../lib/api';
import {
  RECORDING_MAX_BYTES, RECORDING_ACCEPT, RECORDING_MIME_CANDIDATES, RECORDING_LABELS as L,
  RECORDING_CHUNK_BYTES, RECORDING_BITRATE, RECORDING_TIMESLICE_MS,
} from '../../constants/recordings';
import {
  newRecordingId, startBackup, saveChunk, updateBackup, listBackups, backupBlob, deleteBackup,
  downloadBlob, requestPersistentStorage,
} from '../../lib/recordingBackup';

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

// ─── Transcript (status, expandable editable text, copy, re-run) ─────────────

const smallBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-md)', border: '1px solid var(--line)',
  cursor: 'pointer', padding: '5px 10px', fontSize: 12, background: 'var(--surface-2)', color: 'var(--ink-1)',
};

function TranscriptPanel({ recording, sessionId }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(recording.transcript || '');
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [confirmRedo, setConfirmRedo] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] });

  // server text changed (transcription finished / saved elsewhere) → follow it unless mid-edit
  const serverText = recording.transcript || '';
  const dirty = text !== serverText;
  const lastServer = useRef(serverText);
  useEffect(() => {
    if (lastServer.current !== serverText) {
      if (!dirty || text === lastServer.current) setText(serverText);
      lastServer.current = serverText;
    }
  }, [serverText]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useMutation({
    mutationFn: (force) => transcribeSessionRecording(sessionId, recording.id, { force }),
    onSuccess: () => { setConfirmRedo(false); setError(''); refresh(); },
    onError: (err) => setError(err.message),
  });
  const save = useMutation({
    mutationFn: () => updateRecordingTranscript(sessionId, recording.id, text),
    onSuccess: () => { setFlash(L.transcriptSaved); setTimeout(() => setFlash(''), 1800); refresh(); },
    onError: (err) => setError(err.message),
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(L.transcriptCopied);
      setTimeout(() => setFlash(''), 1800);
    } catch { setError('ההעתקה נכשלה'); }
  }

  const status = recording.transcript_status;
  const line = { margin: 0, fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

  if (status === 'queued' || status === 'processing') {
    return (
      <p style={line}>
        <span className="animate-pulse motion-reduce:animate-none" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)' }} />
        {status === 'queued' ? L.transcriptQueued
          : recording.transcript_parts === 0 ? L.transcriptPreparing
          : recording.transcript_parts > 1 ? L.transcriptPart(recording.transcript_part || 1, recording.transcript_parts)
          : L.transcriptProcessing}
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{ ...line, color: 'var(--red-ink)' }}>
          {L.transcriptFailed}
          <button type="button" style={smallBtn} disabled={run.isPending} onClick={() => run.mutate(false)}>{L.transcriptRetry}</button>
        </p>
        {recording.transcript_error && <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>{recording.transcript_error}</p>}
        {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--red-ink)' }}>{error}</p>}
      </div>
    );
  }
  if (status !== 'done') {
    // not queued: no provider key, or never started
    return (
      <p style={line}>
        {recording.transcription_enabled ? L.transcriptNotStarted : L.transcriptNotConfigured}
        {recording.transcription_enabled && (
          <button type="button" style={smallBtn} disabled={run.isPending} onClick={() => run.mutate(false)}>{L.transcriptStart}</button>
        )}
        {error && <span style={{ color: 'var(--red-ink)' }}>{error}</span>}
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', fontSize: 13 }}>
          {open ? `${L.transcriptHide} ▲` : `${L.transcriptShow} ▼`}
        </button>
        {recording.transcript_edited && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{L.transcriptEdited}</span>}
        {flash && <span style={{ fontSize: 12, color: 'var(--green-ink)' }}>{flash}</span>}
      </div>
      {open && (
        <>
          <textarea
            dir="rtl"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(14, Math.max(5, Math.ceil(text.length / 90)))}
            placeholder={L.transcriptEmpty}
            style={{
              width: '100%', resize: 'vertical', borderRadius: 'var(--r-md)', border: '1px solid var(--line)',
              background: 'var(--surface-2)', color: 'var(--ink-1)', padding: '10px 12px', fontSize: 13,
              lineHeight: 1.7, fontFamily: 'inherit', whiteSpace: 'pre-wrap',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={smallBtn} onClick={copy} disabled={!text}>{L.transcriptCopy}</button>
            <button type="button" style={{ ...smallBtn, ...(dirty ? { background: 'var(--blue)', color: 'var(--on-accent)', borderColor: 'var(--blue)' } : {}) }}
              disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? L.transcriptSaving : L.transcriptSave}
            </button>
            {!confirmRedo ? (
              <button type="button" style={{ ...smallBtn, color: 'var(--ink-3)' }} disabled={run.isPending}
                onClick={() => (recording.transcript_edited ? setConfirmRedo(true) : run.mutate(false))}>
                {L.transcriptRedo}
              </button>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--red-ink)' }}>
                {L.transcriptRedoConfirm}
                <button type="button" style={{ ...smallBtn, background: 'var(--red-soft)', color: 'var(--red-ink)', borderColor: 'var(--red)' }} onClick={() => run.mutate(true)}>{L.transcriptRedoYes}</button>
                <button type="button" style={smallBtn} onClick={() => setConfirmRedo(false)}>{L.cancel}</button>
              </span>
            )}
          </div>
          {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--red-ink)' }}>{error}</p>}
        </>
      )}
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
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        <TranscriptPanel recording={recording} sessionId={sessionId} />
      </div>
    </li>
  );
}

// ─── Unsent recordings kept in this browser (crash / refresh / failed upload) ─

function BackupItem({ backup, onUpload, onDiscard, disabled }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const started = new Date(backup.startedAt).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
  });

  async function download() {
    setWorking(true);
    const blob = await backupBlob(backup.id);
    setWorking(false);
    if (blob) downloadBlob(blob, `הקלטת פגישה ${started.replace(/[/:,\s]+/g, '-')}`);
  }

  return (
    <li style={{ listStyle: 'none', border: '1px solid var(--amber, var(--line))', borderRadius: 'var(--r-md)', padding: 12, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>{L.recoveredTitle}</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
        <bdi>{started}</bdi>{backup.durationSeconds > 0 && <> · <bdi>{formatDuration(backup.durationSeconds)}</bdi></>}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {!confirming ? (
          <>
            <button type="button" disabled={disabled} onClick={() => onUpload(backup)} style={{ ...btn.base, ...btn.primary, padding: '5px 12px', fontSize: 12, opacity: disabled ? 0.5 : 1 }}>
              {L.recoveredUpload}
            </button>
            <button type="button" disabled={working} onClick={download} style={{ ...btn.base, padding: '5px 12px', fontSize: 12 }}>
              {L.downloadBackup}
            </button>
            <button type="button" disabled={disabled} onClick={() => setConfirming(true)} style={{ ...btn.base, padding: '5px 12px', fontSize: 12, color: 'var(--ink-3)' }}>
              {L.recoveredDiscard}
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: 'var(--red-ink)' }}>{L.recoveredDiscardConfirm}</span>
            <button type="button" onClick={() => onDiscard(backup)} style={{ ...btn.base, ...btn.danger, padding: '5px 10px', fontSize: 12 }}>{L.deleteYes}</button>
            <button type="button" onClick={() => setConfirming(false)} style={{ ...btn.base, padding: '5px 10px', fontSize: 12 }}>{L.cancel}</button>
          </>
        )}
      </div>
    </li>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

/**
 * Record a consultation in the browser or upload an existing audio file,
 * then play back / delete saved recordings of the session.
 * Live recordings are mono speech-quality audio, backed up slice by slice in
 * IndexedDB, and uploaded in chunks; the backup is removed only after the
 * server confirmed the upload. Closing the view while recording saves what was
 * recorded so far; a refresh or crash leaves a backup offered on next visit.
 */
export default function SessionRecordingCard({ sessionId }) {
  const queryClient = useQueryClient();
  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ['recordings', String(sessionId)],
    queryFn: () => fetchSessionRecordings(sessionId),
    enabled: !!sessionId,
    // poll while a transcription is running (live events also refresh it)
    refetchInterval: (query) => (query.state.data || []).some((r) => ['queued', 'processing'].includes(r.transcript_status)) ? 4000 : false,
  });

  const [state, setState] = useState('idle'); // idle | connecting | recording | paused | saving
  const [elapsed, setElapsed] = useState(0);  // seconds
  const [stream, setStream] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  // last failed upload: { blob, fileName, durationSeconds, backupId? } → retry / download
  const [failedUpload, setFailedUpload] = useState(null);
  const [backups, setBackups] = useState([]);
  const fileRef = useRef(null);

  const rec = useRef({ recorder: null, chunks: [], startedAt: 0, accumulated: 0, mime: '', id: null, index: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && pickMimeType() !== null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] });

  // Backups in this browser that never reached the server (not the one being recorded now)
  const loadBackups = async () => {
    const list = await listBackups(sessionId);
    setBackups(list.filter((b) => b.id !== rec.current.id));
  };
  useEffect(() => { loadBackups(); }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Upload in chunks. On success the IndexedDB backup (if any) is removed. */
  async function upload(blob, { fileName, durationSeconds, backupId = null }) {
    setProgress(0);
    setError('');
    setFailedUpload(null);
    try {
      await uploadSessionRecordingChunked(sessionId, blob, {
        fileName, durationSeconds, chunkBytes: RECORDING_CHUNK_BYTES, onProgress: setProgress,
      });
      if (backupId) await deleteBackup(backupId);
      refresh();
      return true;
    } catch (err) {
      setError(err.status === 413 ? L.tooLarge : (err.message || L.uploadFailed));
      setFailedUpload({ blob, fileName, durationSeconds, backupId });
      return false;
    } finally {
      setProgress(null);
      loadBackups();
    }
  }

  // Timer (+ the duration kept on the backup, so a recovered recording shows its length)
  useEffect(() => {
    if (state !== 'recording') return undefined;
    let lastSaved = 0;
    const t = setInterval(() => {
      const r = rec.current;
      const secs = (r.accumulated + (Date.now() - r.startedAt)) / 1000;
      setElapsed(secs);
      if (r.id && secs - lastSaved >= 5) { lastSaved = secs; updateBackup(r.id, { durationSeconds: Math.round(secs) }); }
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
    setFailedUpload(null);
    setState('connecting');
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? L.micDenied : L.micUnavailable);
      setState('idle');
      return;
    }
    const mime = pickMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(media, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: RECORDING_BITRATE });
    } catch {
      recorder = new MediaRecorder(media, mime ? { mimeType: mime } : undefined); // bitrate option refused
    }
    const id = newRecordingId();
    const recMime = recorder.mimeType || mime || 'audio/webm';
    rec.current = { recorder, chunks: [], startedAt: Date.now(), accumulated: 0, mime: recMime, id, index: 0 };
    requestPersistentStorage();
    startBackup({ id, sessionId, mime: recMime });
    recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      const r = rec.current;
      if (r.id !== id) return;
      r.chunks.push(e.data);
      saveChunk(id, r.index++, e.data); // crash-safe copy; failures leave the in-memory copy
    };
    recorder.start(RECORDING_TIMESLICE_MS);
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
      updateBackup(r.id, { durationSeconds: Math.round(r.accumulated / 1000) });
      setState('paused');
    } else if (state === 'paused') {
      r.recorder.resume();
      r.startedAt = Date.now();
      setState('recording');
    }
  }

  const emptyRec = () => ({ recorder: null, chunks: [], startedAt: 0, accumulated: 0, mime: '', id: null, index: 0 });

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
        const backupId = r.id;
        rec.current = emptyRec();
        await updateBackup(backupId, { status: 'stopped', durationSeconds: Math.round(total) });
        setState('idle');
        setElapsed(0);
        if (blob.size) await upload(blob, { fileName: 'blob', durationSeconds: total, backupId });
        else await deleteBackup(backupId);
        resolve();
      };
      r.recorder.stop();
    });
  }

  // Leaving the view mid-recording: stop and save what was recorded (upload continues in background).
  // If that upload fails, the IndexedDB backup stays and is offered on the next visit.
  useEffect(() => () => {
    const r = rec.current;
    if (!r.recorder || r.recorder.state === 'inactive') return;
    const total = (r.accumulated + (r.recorder.state === 'recording' ? Date.now() - r.startedAt : 0)) / 1000;
    const { chunks, mime, id } = r;
    const mediaStream = r.recorder.stream;
    r.recorder.onstop = async () => {
      mediaStream.getTracks().forEach((t) => t.stop());
      await updateBackup(id, { status: 'stopped', durationSeconds: Math.round(total) });
      const type = mime.split(';')[0] || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (!blob.size) { deleteBackup(id); return; }
      uploadSessionRecordingChunked(sessionId, blob, { fileName: 'blob', durationSeconds: total, chunkBytes: RECORDING_CHUNK_BYTES })
        .then(() => deleteBackup(id))
        .then(() => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] }))
        .catch(() => {});
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

  async function uploadBackup(backup) {
    const blob = await backupBlob(backup.id);
    if (!blob) { await deleteBackup(backup.id); loadBackups(); return; }
    await upload(blob, { fileName: 'blob', durationSeconds: backup.durationSeconds, backupId: backup.id });
  }

  async function discardBackup(backup) {
    await deleteBackup(backup.id);
    if (failedUpload?.backupId === backup.id) { setFailedUpload(null); setError(''); }
    loadBackups();
  }

  function retryFailed() {
    const f = failedUpload;
    if (f) upload(f.blob, { fileName: f.fileName, durationSeconds: f.durationSeconds, backupId: f.backupId });
  }

  const busy = state === 'saving' || state === 'connecting' || progress !== null;
  const live = state === 'recording' || state === 'paused';
  // a failed live recording is listed with the backups below; show it there only once
  const visibleBackups = backups.filter((b) => b.id !== failedUpload?.backupId);

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
          {state === 'saving' && progress === null && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{L.saving}</span>}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2, var(--ink-1))', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{L.uploading}</span>
            <bdi style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}>{Math.round(progress * 100)}%</bdi>
          </p>
          <div role="progressbar" aria-label={L.uploading} aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}
            style={{ height: 4, borderRadius: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--blue)', transition: 'width 120ms linear' }} />
          </div>
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--red-ink)' }}>{error}</p>
          {failedUpload && progress === null && (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={retryFailed} style={{ ...btn.base, ...btn.primary, padding: '5px 12px', fontSize: 12 }}>{L.uploadRetry}</button>
                {failedUpload.backupId && (
                  <button type="button" onClick={() => downloadBlob(failedUpload.blob, 'הקלטת פגישה')} style={{ ...btn.base, padding: '5px 12px', fontSize: 12 }}>
                    {L.downloadBackup}
                  </button>
                )}
              </div>
              {failedUpload.backupId && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)' }}>{L.backupNote}</p>}
            </>
          )}
        </div>
      )}

      {visibleBackups.length > 0 && !live && (
        <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibleBackups.map((b) => (
            <BackupItem key={b.id} backup={b} disabled={busy} onUpload={uploadBackup} onDiscard={discardBackup} />
          ))}
        </ul>
      )}

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
