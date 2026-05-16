import { useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClient, fetchSessions, fetchWindows, updateClient, deleteClient, fetchWhatsAppLog, fetchProtocols, personalizeProtocol, addProtocolTasks, generateClientAISummary, fetchClientAISummary, generateProcessSummary, fetchProcessSummary, updateSession, createSession, fetchEngagements, createEngagement, closeEngagement, fetchClientMeetings, completeCalendlyEvent, fetchClientMenus, createMenu, fetchWeightLog, addWeight, deleteWeight, fetchWeightLink } from '../lib/api';
import PaymentsSection from '../components/payments/PaymentsSection';
import { formatDateHebrew, daysUntil } from '../lib/dates';
import { CLIENT_STATUS_LABEL, GENDER_LABEL } from '../constants/statuses';
import Modal from '../components/ui/Modal';
import ClientForm from '../components/clients/ClientForm';
import SessionTimeline from '../components/sessions/SessionTimeline';
import SessionHistory from '../components/sessions/SessionHistory';
import WhatsAppDropdown from '../components/whatsapp/WhatsAppDropdown';

// ─── Process Summary section (shown when status = 'ended') ───────────────────

function ProcessSummarySection({ clientId, clientPhone }) {
  const queryClient = useQueryClient();

  const { data: stored, isLoading } = useQuery({
    queryKey: ['process-summary', String(clientId)],
    queryFn:  () => fetchProcessSummary(clientId),
    staleTime: Infinity,
  });

  const genMutation = useMutation({
    mutationFn: () => generateProcessSummary(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process-summary', String(clientId)] });
    },
  });

  if (isLoading) return null;

  const summary = genMutation.data ?? stored;

  const phone   = clientPhone?.replace(/\D/g, '');
  const waText  = summary
    ? [summary.headline, summary.journey, summary.achievements, summary.closing]
        .filter(Boolean).join('\n\n')
    : '';
  const waLink  = phone && waText
    ? `https://wa.me/${phone}?text=${encodeURIComponent(waText)}`
    : null;

  if (genMutation.isPending) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-700 mb-3">סיכום תהליך</h2>
        <div className="flex items-center gap-3 text-indigo-600">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-sm">מייצר סיכום תהליך...</span>
        </div>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-700 mb-1">סיכום תהליך</h2>
        <p className="text-sm text-gray-400 mb-3">התהליך הסתיים. ניתן להפיק סיכום כולל.</p>
        <button
          type="button"
          onClick={() => genMutation.mutate()}
          className="text-sm px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          צור סיכום תהליך
        </button>
        {genMutation.isError && (
          <p className="text-xs text-red-500 mt-2">{genMutation.error?.message}</p>
        )}
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-700">סיכום תהליך</h2>
        <button
          type="button"
          onClick={() => genMutation.mutate()}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          רענן
        </button>
      </div>

      {summary.headline && (
        <p className="text-base font-bold text-gray-900 mb-4">{summary.headline}</p>
      )}

      <div className="space-y-3">
        {[
          { key: 'journey',         label: 'המסע הטיפולי',        color: 'bg-blue-50 border-blue-200 text-blue-900' },
          { key: 'achievements',    label: 'הישגים עיקריים',       color: 'bg-green-50 border-green-200 text-green-900' },
          { key: 'recommendations', label: 'המלצות להמשך',         color: 'bg-amber-50 border-amber-200 text-amber-900' },
          { key: 'closing',         label: 'סיכום',                color: 'bg-gray-50 border-gray-200 text-gray-800' },
        ].map(({ key, label, color }) => {
          if (!summary[key]) return null;
          return (
            <div key={key} className={`rounded-lg border p-3 ${color}`}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1.5 opacity-60">{label}</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary[key]}</p>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        <button
          type="button"
          disabled
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 cursor-not-allowed"
          title="בקרוב"
        >
          הפק PDF
        </button>
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            שלח ללקוח בווטסאפ
          </a>
        )}
      </div>
    </section>
  );
}

// ─── AI Summary section ───────────────────────────────────────────────────────

const SUMMARY_CARD_CONFIG = [
  { key: 'clinical_summary', label: 'סיכום קליני',                  color: 'bg-blue-50 border-blue-200 text-blue-900' },
  { key: 'focus_points',     label: 'נקודות מיקוד לפגישה הבאה',     color: 'bg-indigo-50 border-indigo-200 text-indigo-900' },
  { key: 'flags',            label: 'דגלים לתשומת לב',               color: 'bg-amber-50 border-amber-200 text-amber-900' },
  { key: 'recommendations',  label: 'המלצות טיפוליות',               color: 'bg-green-50 border-green-200 text-green-900' },
];

const PRIORITY_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const PRIORITY_COLOR = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-600',
};

// ─── Session picker for adding tasks ─────────────────────────────────────────

function TaskSessionPicker({ clientId, sessions, tasksToAdd, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [successNum, setSuccessNum] = useState(null);

  const { data: windows = [], isLoading } = useQuery({
    queryKey: ['windows', String(clientId)],
    queryFn:  () => fetchWindows(clientId),
    staleTime: 60_000,
  });

  const recordedNums = new Set(sessions.map((s) => s.session_number));

  async function handleSelect(window) {
    setAdding(true);
    try {
      const existingSession = sessions.find((s) => s.session_number === window.session_number);
      const newTasks = tasksToAdd.map((t) => ({
        id: crypto.randomUUID(),
        text: typeof t === 'string' ? t : t.text,
        status: 'pending',
      }));

      if (existingSession) {
        const currentTasks = Array.isArray(existingSession.tasks) ? existingSession.tasks : [];
        await updateSession(existingSession.id, { tasks: [...currentTasks, ...newTasks] });
      } else {
        await createSession(clientId, {
          session_number: window.session_number,
          session_date:   window.expected_date,
          tasks:          newTasks,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['sessions', String(clientId)] });
      setSuccessNum(window.session_number);
      setTimeout(() => { onSuccess(window.session_number); onClose(); }, 1500);
    } catch (err) {
      console.error('[TaskSessionPicker]', err);
    } finally {
      setAdding(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-indigo-500 animate-pulse mt-3 px-1">טוען פגישות...</p>;
  }

  if (successNum) {
    return (
      <p className="text-sm text-green-600 font-medium mt-3 px-1">
        המשימות נוספו לפגישה {successNum}
      </p>
    );
  }

  return (
    <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
      <p className="px-4 py-2 text-xs font-medium text-gray-400 bg-gray-50 border-b border-gray-100">
        בחר פגישה לשיוך המשימות
      </p>
      {windows.map((w) => {
        const isDone = recordedNums.has(w.session_number);
        return (
          <button
            key={w.session_number}
            type="button"
            onClick={() => !adding && handleSelect(w)}
            disabled={adding}
            className={[
              'w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-0 text-sm transition-colors text-right',
              isDone
                ? 'bg-white hover:bg-gray-50 text-gray-700'
                : 'bg-white hover:bg-indigo-50 text-gray-800',
              adding ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className="font-medium">פגישה {w.session_number}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {new Date(w.expected_date).toLocaleDateString('he-IL', {
                  day: 'numeric', month: 'long',
                })}
              </span>
              <span className={[
                'text-xs px-2 py-0.5 rounded-full font-medium',
                isDone ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700',
              ].join(' ')}>
                {isDone ? 'בוצעה - ניתן להוסיף' : 'פתוחה'}
              </span>
            </div>
          </button>
        );
      })}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

function AISummarySection({ clientId, sessions }) {
  const queryClient = useQueryClient();
  // picker: null | { mode: 'single', task } | { mode: 'all' }
  const [picker, setPicker] = useState(null);
  const [toast, setToast] = useState(null);

  const { data: stored, isLoading: loadingStored } = useQuery({
    queryKey: ['ai-summary', String(clientId)],
    queryFn:  () => fetchClientAISummary(clientId),
    staleTime: Infinity,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateClientAISummary(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-summary', String(clientId)] });
    },
  });

  function showToast(num) {
    setToast(`המשימות נוספו לפגישה ${num}`);
    setTimeout(() => setToast(null), 3000);
  }

  const isGenerating = generateMutation.isPending;
  const summary = generateMutation.data ?? stored;

  if (loadingStored) return null;

  // Empty state
  if (!summary && !isGenerating) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-700">סיכום AI</h2>
        </div>
        <p className="text-sm text-gray-400 mb-3">
          ניתוח מקיף של כלל נתוני הלקוח — אנמנזה, פגישות, מעבדה ופרוטוקול.
        </p>
        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          className="text-sm px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          צור סיכום AI
        </button>
        {generateMutation.isError && (
          <p className="text-xs text-red-500 mt-2">{generateMutation.error?.message}</p>
        )}
      </section>
    );
  }

  // Loading state
  if (isGenerating) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-700 mb-3">סיכום AI</h2>
        <div className="flex items-center gap-3 text-indigo-600">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-sm">מנתח את כל נתוני הלקוח...</span>
        </div>
      </section>
    );
  }

  const hasTasks = Array.isArray(summary?.tasks) && summary.tasks.length > 0;

  // Summary display
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-700">סיכום AI</h2>
          {summary?.updated_at && (
            <p className="text-xs text-gray-400 mt-0.5">
              עודכן {new Date(summary.updated_at).toLocaleDateString('he-IL', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          disabled={isGenerating}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          רענן
        </button>
      </div>

      {/* 4 subsection cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {SUMMARY_CARD_CONFIG.map(({ key, label, color }) => {
          const text = summary?.summary?.[key];
          if (!text) return null;
          return (
            <div key={key} className={`rounded-lg border p-3 ${color}`}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1.5 opacity-70">{label}</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
            </div>
          );
        })}
      </div>

      {/* Recommended tasks */}
      {hasTasks && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">משימות מומלצות</p>
            <button
              type="button"
              onClick={() => setPicker({ mode: 'all' })}
              className="text-xs px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              הוסף את כל המשימות
            </button>
          </div>
          <ul className="space-y-2">
            {summary.tasks.map((task, i) => (
              <li key={i} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  {task.priority && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${PRIORITY_COLOR[task.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {PRIORITY_LABEL[task.priority] ?? task.priority}
                    </span>
                  )}
                  <span className="text-sm text-gray-800 truncate">{task.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'single', task })}
                  className="text-xs flex-shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  בחר פגישה
                </button>
              </li>
            ))}
          </ul>

          {/* Session picker — shown inline below tasks */}
          {picker && (
            <TaskSessionPicker
              clientId={clientId}
              sessions={sessions}
              tasksToAdd={
                picker.mode === 'all'
                  ? summary.tasks
                  : [picker.task]
              }
              onClose={() => setPicker(null)}
              onSuccess={(num) => { setPicker(null); showToast(num); }}
            />
          )}

          {toast && (
            <p className="text-sm text-green-600 font-medium mt-2 px-1">{toast}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Client profile section ───────────────────────────────────────────────────

function WeightDelta({ initial, last }) {
  if (!initial || !last) return null;
  const delta = (last - initial).toFixed(1);
  const isLoss = delta < 0;
  return (
    <span className={`text-sm font-semibold ${isLoss ? 'text-green-600' : 'text-red-500'}`}>
      {isLoss ? '' : '+'}{delta} ק״ג
    </span>
  );
}

function ProcessEndLabel({ processEndDate }) {
  if (!processEndDate) return null;
  const days = daysUntil(processEndDate);
  if (days === null) return null;

  if (days < 0) {
    return (
      <span className="text-xs text-red-500">
        התהליך הסתיים לפני {Math.abs(days)} ימים
      </span>
    );
  }
  if (days === 0) return <span className="text-xs text-orange-500">התהליך מסתיים היום</span>;
  return <span className="text-xs text-gray-500">{days} ימים נותרו</span>;
}

function MenuSentStatus({ client }) {
  const queryClient = useQueryClient();
  const [menuError, setMenuError] = useState(null);

  const mutation = useMutation({
    mutationFn: () =>
      updateClient(client.id, {
        menu_sent: 1,
        menu_sent_date: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      setMenuError(null);
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => setMenuError(err.message || 'אירעה שגיאה. נסה שוב.'),
  });

  if (client.menu_sent) {
    return (
      <span className="text-xs text-green-600 flex items-center gap-1">
        ✓ תפריט נשלח {client.menu_sent_date ? `ב-${formatDateHebrew(client.menu_sent_date)}` : ''}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-2 py-0.5 rounded-full">
          תפריט לא נשלח
        </span>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'שומר...' : 'סמן כנשלח'}
        </button>
      </div>
      {menuError && (
        <p className="text-xs text-red-600">{menuError}</p>
      )}
    </div>
  );
}

function ProfileField({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

// ─── Protocol assignment ──────────────────────────────────────────────────────

function ProtocolAssignment({ client }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [toast, setToast] = useState(null);
  const [personalizationModal, setPersonalizationModal] = useState(null);
  // session picker state: null | 'loading' | { windows, recordedNums }
  const [sessionPicker, setSessionPicker] = useState(null);
  const [sessionPickerSuccess, setSessionPickerSuccess] = useState(null);

  const { data: protocols = [] } = useQuery({
    queryKey: ['protocols'],
    queryFn: fetchProtocols,
  });

  async function runPersonalization(protocolId, updatedClient) {
    const protocol = protocols.find((p) => p.id === protocolId) || updatedClient?.protocol;
    setToast('מתאים פרוטוקול ללקוח...');
    try {
      const data = await personalizeProtocol(protocolId, client.id);
      setPersonalizationModal({ protocol, data });
    } catch {
      // Non-fatal — personalization failed silently
    } finally {
      setToast(null);
    }
  }

  const assignMutation = useMutation({
    mutationFn: (protocolId) => updateClient(client.id, { protocol_id: protocolId }),
    onSuccess: async (updatedClient) => {
      setReplacing(false);
      setSelectedId('');
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
      if (updatedClient?.protocol_id) {
        await runPersonalization(updatedClient.protocol_id, updatedClient);
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => updateClient(client.id, { protocol_id: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
    },
  });

  async function openSessionPicker() {
    setSessionPicker('loading');
    try {
      const [windows, sessions] = await Promise.all([
        fetchWindows(client.id),
        fetchSessions(client.id),
      ]);
      const recordedNums = new Set(sessions.map((s) => s.session_number));
      setSessionPicker({ windows, recordedNums });
    } catch {
      setSessionPicker(null);
    }
  }

  async function handleAssignToSession(sessionNumber, tasks) {
    try {
      await addProtocolTasks(client.id, tasks, sessionNumber);
      queryClient.invalidateQueries({ queryKey: ['sessions', String(client.id)] });
      setSessionPickerSuccess(sessionNumber);
      setTimeout(() => {
        setPersonalizationModal(null);
        setSessionPicker(null);
        setSessionPickerSuccess(null);
      }, 1800);
    } catch { /* best-effort */ }
  }

  const assignedProtocol = client.protocol;
  const showDropdown = !assignedProtocol || replacing;

  return (
    <div className="mb-3">
      <p className="text-xs text-gray-400 mb-1.5">פרוטוקול טיפול</p>

      {assignedProtocol && !replacing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium">
            {assignedProtocol.name}
          </span>
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            החלף
          </button>
          <button
            type="button"
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            הסר
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="text-sm rounded-lg border border-gray-300 px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">בחר פרוטוקול...</option>
            {protocols.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => selectedId && assignMutation.mutate(Number(selectedId))}
            disabled={!selectedId || assignMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {assignMutation.isPending ? 'שומר...' : 'שייך פרוטוקול'}
          </button>
          {replacing && (
            <button
              type="button"
              onClick={() => setReplacing(false)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              ביטול
            </button>
          )}
        </div>
      )}

      {toast && (
        <p className="text-xs text-indigo-500 mt-1.5 animate-pulse">{toast}</p>
      )}

      {personalizationModal && (
        <Modal
          title={`פרוטוקול מותאם — ${personalizationModal.protocol?.name ?? ''}`}
          onClose={() => setPersonalizationModal(null)}
          size="lg"
        >
          {personalizationModal.data.clinical_notes && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              {personalizationModal.data.clinical_notes}
            </div>
          )}
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">דגשים מותאמים</p>
            <ul className="space-y-1.5">
              {personalizationModal.data.personalized_highlights.map((h, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-blue-500 flex-shrink-0 mt-0.5">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">משימות מומלצות</p>
            <ul className="space-y-1.5">
              {personalizationModal.data.personalized_tasks.map((t, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-indigo-500 flex-shrink-0 mt-0.5">•</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="pt-4 border-t border-gray-100">
            {/* Success message */}
            {sessionPickerSuccess && (
              <p className="text-sm text-green-600 font-medium text-center py-2">
                המשימות והדגשים שויכו לפגישה {sessionPickerSuccess}
              </p>
            )}

            {/* Session picker */}
            {sessionPicker && sessionPicker !== 'loading' && !sessionPickerSuccess && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  בחר פגישה לשיוך הדגשים והמשימות
                </p>
                <div className="space-y-2">
                  {sessionPicker.windows.map((w) => {
                    const isDone = sessionPicker.recordedNums.has(w.session_number);
                    return (
                      <button
                        key={w.session_number}
                        type="button"
                        onClick={() => handleAssignToSession(
                          w.session_number,
                          personalizationModal.data.personalized_tasks
                        )}
                        className={[
                          'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-colors cursor-pointer',
                          isDone
                            ? 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                            : 'border-indigo-200 bg-white hover:bg-indigo-50 text-gray-800',
                        ].join(' ')}
                      >
                        <span className="font-medium">פגישה {w.session_number}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {new Date(w.expected_date).toLocaleDateString('he-IL', {
                              day: 'numeric', month: 'long', year: 'numeric',
                            })}
                          </span>
                          <span className={[
                            'text-xs px-2 py-0.5 rounded-full font-medium',
                            isDone
                              ? 'bg-gray-100 text-gray-500'
                              : 'bg-green-100 text-green-700',
                          ].join(' ')}>
                            {isDone ? 'בוצעה - ניתן להוסיף' : 'פתוחה'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Loading state */}
            {sessionPicker === 'loading' && (
              <p className="text-sm text-indigo-500 animate-pulse text-center py-2">טוען פגישות...</p>
            )}

            {/* Footer buttons */}
            {!sessionPickerSuccess && (
              <div className="flex gap-2">
                {!sessionPicker ? (
                  <button
                    type="button"
                    onClick={openSessionPicker}
                    className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    שייך לפגישה
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSessionPicker(null)}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    ביטול
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setPersonalizationModal(null); setSessionPicker(null); }}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  סגור
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ClientProfile({ client, sessions }) {
  const lastSession = sessions.length > 0
    ? sessions.reduce((a, b) => (a.session_number > b.session_number ? a : b))
    : null;
  const lastWeight = lastSession?.weight ?? null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
        {/* Profile fields grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          <ProfileField label="גיל" value={client.age} />
          <ProfileField label="מין" value={client.gender ? GENDER_LABEL[client.gender] : null} />
          <ProfileField
            label="סיום תהליך"
            value={
              client.process_end_date ? (
                <span>
                  {formatDateHebrew(client.process_end_date)}
                  {' · '}
                  <ProcessEndLabel processEndDate={client.process_end_date} />
                </span>
              ) : null
            }
          />
        </div>

        {/* Weight tracking */}
        {(client.initial_weight || lastWeight) && (
          <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
            {client.initial_weight && (
              <div className="text-center">
                <p className="text-xs text-gray-400">משקל התחלתי</p>
                <p className="text-base font-semibold text-gray-800">{client.initial_weight} ק״ג</p>
              </div>
            )}
            {lastWeight && (
              <div className="text-center">
                <p className="text-xs text-gray-400">משקל אחרון</p>
                <p className="text-base font-semibold text-gray-800">{lastWeight} ק״ג</p>
              </div>
            )}
            {client.initial_weight && lastWeight && (
              <div className="text-center">
                <p className="text-xs text-gray-400">שינוי</p>
                <WeightDelta initial={client.initial_weight} last={lastWeight} />
              </div>
            )}
          </div>
        )}

        {/* Goal */}
        {client.goal && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">מטרה</p>
            <p className="text-sm text-gray-700 mt-0.5">{client.goal}</p>
          </div>
        )}

        {/* Medical notes */}
        {client.medical_notes && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">הערות רפואיות</p>
            <p className="text-sm text-gray-700 mt-0.5">{client.medical_notes}</p>
          </div>
        )}

        {/* Protocol assignment */}
        <ProtocolAssignment client={client} />

        {/* Menu status */}
        <MenuSentStatus client={client} />
    </div>
  );
}

// ─── Engagement selector ──────────────────────────────────────────────────────

function EngagementSelector({ engagements, selectedId, onSelect, onNew }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--hairline)', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>תהליך:</span>
      {engagements.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onSelect(e.id)}
          className={`crm-btn crm-btn--sm${e.id === selectedId ? ' crm-btn--primary' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          תהליך {e.number}
          {e.status === 'completed' && (
            <span style={{ fontSize: 10, background: 'rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px', fontWeight: 500 }}>
              הסתיים
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        onClick={onNew}
        className="crm-btn crm-btn--sm"
        style={{ color: 'var(--blue)', borderStyle: 'dashed' }}
      >
        + תהליך חדש
      </button>
    </div>
  );
}

// ─── New engagement modal ─────────────────────────────────────────────────────

function NewEngagementModal({ clientId, activeEngagement, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    goals: '', package_name: '', price: '', started_at: new Date().toISOString().slice(0, 10),
  });
  const [closeActive, setCloseActive] = useState(false);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const newEng = await createEngagement(clientId, {
        goals:        form.goals.trim()        || null,
        package_name: form.package_name.trim() || null,
        price:        form.price               ? Number(form.price) : null,
        started_at:   form.started_at          || null,
      });
      if (closeActive && activeEngagement) {
        await closeEngagement(activeEngagement.id);
      }
      return newEng;
    },
    onSuccess: (newEng) => {
      queryClient.invalidateQueries({ queryKey: ['engagements', String(clientId)] });
      onClose(newEng.id);
    },
    onError: (err) => setError(err.message || 'שגיאה ביצירת תהליך'),
  });

  const inputStyle = {
    width: '100%', fontSize: 13, borderRadius: 8,
    border: '1px solid var(--hairline)', padding: '7px 10px',
    outline: 'none', background: 'var(--surface-1)',
  };

  return (
    <Modal title="תהליך טיפול חדש" onClose={() => onClose(null)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>יעדים</label>
          <textarea
            value={form.goals}
            onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="מה הלקוח רוצה להשיג בתהליך זה?"
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>שם חבילה</label>
            <input
              type="text"
              value={form.package_name}
              onChange={(e) => setForm((f) => ({ ...f, package_name: e.target.value }))}
              style={inputStyle}
              placeholder="חבילה בסיסית..."
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>מחיר (₪)</label>
            <input
              type="number"
              min="0"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              style={inputStyle}
              placeholder="0"
            />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>תאריך התחלה</label>
          <input
            type="date"
            value={form.started_at}
            onChange={(e) => setForm((f) => ({ ...f, started_at: e.target.value }))}
            style={{ ...inputStyle, width: 'auto' }}
            dir="ltr"
          />
        </div>

        {activeEngagement && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={closeActive}
              onChange={(e) => setCloseActive(e.target.checked)}
            />
            סגור את תהליך {activeEngagement.number} הנוכחי
          </label>
        )}

        {error && <p style={{ fontSize: 12, color: 'var(--red-ink)', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="crm-btn crm-btn--primary"
            style={{ flex: 1 }}
          >
            {mutation.isPending ? 'יוצר...' : 'צור תהליך'}
          </button>
          <button
            type="button"
            onClick={() => onClose(null)}
            className="crm-btn"
            style={{ flex: 1 }}
          >
            ביטול
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Menus tab ────────────────────────────────────────────────────────────────

function MenusTab({ clientId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCalories, setNewCalories] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['menus', String(clientId)],
    queryFn: () => fetchClientMenus(clientId),
  });

  const menus = data?.menus ?? [];

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim() || !newCalories) return;
    setCreating(true);
    try {
      const res = await createMenu(clientId, { title: newTitle.trim(), calorie_target: Number(newCalories) });
      queryClient.invalidateQueries({ queryKey: ['menus', String(clientId)] });
      navigate(`/clients/${clientId}/menus/${res.menu.id}`);
    } catch (err) {
      console.error('[MenusTab] create failed', err);
    } finally {
      setCreating(false);
    }
  }

  if (isLoading) {
    return <div className="animate-pulse rounded-xl" style={{ height: 80, background: 'var(--surface-3)' }} />;
  }

  const STATUS_LABEL = { draft: 'טיוטה', final: 'סופי' };
  const STATUS_COLOR = { draft: 'bg-gray-100 text-gray-500', final: 'bg-green-100 text-green-700' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {menus.length === 0 && !showNew && (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '24px 0' }}>
          אין תפריטים עדיין
        </p>
      )}

      {menus.map((m) => (
        <div
          key={m.id}
          onClick={() => navigate(`/clients/${clientId}/menus/${m.id}`)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer' }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{m.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{m.calorie_target} קק&quot;ל</div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[m.status] ?? STATUS_COLOR.draft}`}>
            {STATUS_LABEL[m.status] ?? m.status}
          </span>
        </div>
      ))}

      {showNew ? (
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <input
            type="text"
            placeholder="שם התפריט"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="crm-input"
            autoFocus
          />
          <input
            type="number"
            placeholder="יעד קלורי (קק&quot;ל)"
            value={newCalories}
            onChange={(e) => setNewCalories(e.target.value)}
            className="crm-input"
            min={800}
            max={4000}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="crm-btn crm-btn--primary" disabled={creating}>
              {creating ? 'יוצר...' : 'צור תפריט'}
            </button>
            <button type="button" className="crm-btn" onClick={() => { setShowNew(false); setNewTitle(''); setNewCalories(''); }}>
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="crm-btn"
          onClick={() => setShowNew(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          + תפריט חדש
        </button>
      )}
    </div>
  );
}

// ─── Weights tab ──────────────────────────────────────────────────────────────

function WeightCell({ weight, weightId, date, clientId, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit() {
    const w = parseFloat(val);
    if (!val.trim() || isNaN(w)) { setEditing(false); return; }
    setSaving(true);
    setErr(null);
    try {
      await addWeight(clientId, { date, weight: w });
      onSaved();
      setEditing(false);
      setVal('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e) {
    e.stopPropagation();
    try { await deleteWeight(clientId, weightId); onDeleted(); }
    catch { /* non-fatal */ }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          autoFocus
          type="number"
          step="0.1"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') { setEditing(false); setVal(''); } }}
          onBlur={handleSubmit}
          style={{ width: 68, height: 28, padding: '0 6px', fontSize: 13, border: '1px solid var(--blue)', borderRadius: 'var(--r-sm)', background: 'var(--surface-1)', outline: 'none', textAlign: 'center' }}
          placeholder="ק״ג"
        />
        {saving && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>שומר...</span>}
        {err && <span style={{ fontSize: 11, color: 'var(--red-ink)' }}>{err}</span>}
      </div>
    );
  }

  if (weight !== null && weight !== undefined) {
    return (
      <div
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
        title="לחץ לעריכה"
        onClick={() => { setVal(String(weight)); setEditing(true); }}
      >
        <span style={{ fontSize: 13, fontWeight: 500 }}>{weight}</span>
        <button
          type="button"
          onClick={handleDelete}
          style={{ fontSize: 13, lineHeight: 1, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: 0.5 }}
          title="מחק"
        >×</button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setVal(''); setEditing(true); }}
      style={{ fontSize: 18, lineHeight: 1, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
      title="הוסף שקילה"
    >+</button>
  );
}

function WeightsTab({ clientId }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weightVal, setWeightVal] = useState('');
  const [addErr, setAddErr] = useState(null);
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['weight-log', String(clientId)],
    queryFn: () => fetchWeightLog(clientId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['weight-log', String(clientId)] });
  }

  async function handleAdd(e) {
    e.preventDefault();
    setAddErr(null);
    const w = parseFloat(weightVal);
    if (isNaN(w)) { setAddErr('הזן משקל תקין'); return; }
    setAdding(true);
    try {
      await addWeight(clientId, { date, weight: w });
      invalidate();
      setWeightVal('');
    } catch (err) {
      setAddErr(err.message);
    } finally {
      setAdding(false);
    }
  }

  if (isLoading) {
    return <div className="animate-pulse rounded-xl" style={{ height: 80, background: 'var(--surface-3)' }} />;
  }

  const { weeks = [], first_weight, latest_weight, total_change } = data ?? {};

  const changeColor = total_change === null
    ? 'var(--ink-3)'
    : total_change <= 0 ? 'var(--green-ink, #1a7a4a)' : 'oklch(0.55 0.18 25)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} dir="rtl">

      {/* Quick add */}
      <form
        onSubmit={handleAdd}
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)' }}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="crm-input"
          style={{ width: 148, height: 34 }}
        />
        <input
          type="number"
          step="0.1"
          min="20"
          max="300"
          placeholder="משקל (ק״ג)"
          value={weightVal}
          onChange={(e) => setWeightVal(e.target.value)}
          className="crm-input"
          style={{ width: 130, height: 34 }}
        />
        <button type="submit" className="crm-btn crm-btn--primary" style={{ height: 34 }} disabled={adding}>
          {adding ? 'שומר...' : 'הוסף שקילה'}
        </button>
        {addErr && <span style={{ fontSize: 12, color: 'var(--red-ink)' }}>{addErr}</span>}
      </form>

      {/* Summary bar */}
      {first_weight !== null && (
        <div style={{ display: 'flex', gap: 20, padding: '10px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            משקל התחלתי: <strong>{first_weight} ק״ג</strong>
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            משקל נוכחי: <strong>{latest_weight} ק״ג</strong>
          </span>
          {total_change !== null && (
            <span style={{ fontSize: 13, color: changeColor, fontWeight: 600 }}>
              שינוי כולל: {total_change > 0 ? '+' : ''}{total_change} ק״ג
            </span>
          )}
        </div>
      )}

      {/* Table */}
      {weeks.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '24px 0' }}>
          אין שקילות עדיין — הוסף את הראשונה למעלה
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--line)' }}>
                {['שבוע', 'שקילת שני', 'שקילת חמישי', 'ממוצע'].map((h) => (
                  <th key={h} style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--ink-2)', textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const thursdayDate = addThreeDays(w.week_start);
                return (
                  <tr key={w.week_start} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 14px', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                      {formatWeekDate(w.week_start)}
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <WeightCell
                        weight={w.monday_weight}
                        weightId={w.monday_id}
                        date={w.week_start}
                        clientId={clientId}
                        onSaved={invalidate}
                        onDeleted={invalidate}
                      />
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <WeightCell
                        weight={w.thursday_weight}
                        weightId={w.thursday_id}
                        date={thursdayDate}
                        clientId={clientId}
                        onSaved={invalidate}
                        onDeleted={invalidate}
                      />
                    </td>
                    <td style={{ padding: '8px 14px', fontWeight: 500, color: 'var(--ink-1)' }}>
                      {w.average !== null
                        ? <>{w.average}{w.average_approximate && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginRight: 2 }}>*</span>}</>
                        : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function addThreeDays(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

function formatWeekDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${String(d.getUTCFullYear()).slice(2)}`;
}

// ─── Weight link button — shows modal with URL ────────────────────────────────

function FoodBankLinkButton({ clientId }) {
  const [url,     setUrl]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  async function handleOpen() {
    if (loading) return;
    setLoading(true);
    try {
      const { url: weightUrl } = await fetchWeightLink(clientId);
      setUrl(weightUrl.replace('/w/', '/food/'));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement('textarea');
        el.value = url;
        el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(el);
        el.focus(); el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* user can still copy manually */ }
  }

  function handleClose() { setUrl(null); setCopied(false); }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        className="crm-btn crm-btn--sm"
      >
        {loading ? '...' : 'מאגר מזון 🍎'}
      </button>

      {url && (
        <Modal title="קישור מאגר מזון ללקוח" onClose={handleClose}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>
              שלח קישור זה ללקוח כדי שיוכל לגשת למאגר המזון האישי שלו.
            </p>
            <input
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.target.select()}
              style={{
                width: '100%', fontSize: 12, padding: '8px 12px',
                border: '1px solid var(--hairline)', borderRadius: 8,
                background: 'var(--surface-2)', color: 'var(--ink-1)',
                direction: 'ltr', textAlign: 'left', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleCopy}
                className="crm-btn crm-btn--primary"
                style={{ flex: 1, ...(copied ? { background: 'var(--green)', borderColor: 'var(--green)' } : {}) }}
              >
                {copied ? 'הועתק! ✓' : 'העתק'}
              </button>
              <button type="button" onClick={handleClose} className="crm-btn" style={{ flex: 1 }}>
                סגור
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function WeightLinkButton({ clientId }) {
  const [url,     setUrl]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  async function handleOpen() {
    if (loading) return;
    setLoading(true);
    try {
      const { url: fetched } = await fetchWeightLink(clientId);
      setUrl(fetched);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement('textarea');
        el.value = url;
        el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(el);
        el.focus(); el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* user can still copy manually */ }
  }

  function handleClose() { setUrl(null); setCopied(false); }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        className="crm-btn crm-btn--sm"
      >
        {loading ? '...' : 'קישור שקילה'}
      </button>

      {url && (
        <Modal title="קישור שקילה ללקוח" onClose={handleClose}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>
              שלח קישור זה ללקוח כדי שיוכל לרשום שקילות עצמאית.
            </p>
            <input
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.target.select()}
              style={{
                width: '100%', fontSize: 12, padding: '8px 12px',
                border: '1px solid var(--hairline)', borderRadius: 8,
                background: 'var(--surface-2)', color: 'var(--ink-1)',
                direction: 'ltr', textAlign: 'left', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleCopy}
                className="crm-btn crm-btn--primary"
                style={{ flex: 1, ...(copied ? { background: 'var(--green)', borderColor: 'var(--green)' } : {}) }}
              >
                {copied ? 'הועתק! ✓' : 'העתק'}
              </button>
              <button type="button" onClick={handleClose} className="crm-btn" style={{ flex: 1 }}>
                סגור
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('timeline');
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedEngagementId, setSelectedEngagementId] = useState(null);
  const [newEngagementOpen, setNewEngagementOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      navigate('/clients');
    },
  });

  const aiSummaryMutation = useMutation({
    mutationFn: () => generateClientAISummary(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-summary', id] });
    },
  });

  // Auto-trigger AI summary regeneration 2s after a session is saved
  const handleSessionSaved = useCallback(() => {
    setTimeout(() => aiSummaryMutation.mutate(), 2000);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: client, isLoading: clientLoading, isError: clientError } = useQuery({
    queryKey: ['client', id],
    queryFn: () => fetchClient(id),
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => fetchSessions(id),
    enabled: !!client,
  });

  const { data: engagements = [] } = useQuery({
    queryKey: ['engagements', id],
    queryFn: () => fetchEngagements(id),
    enabled: !!client,
  });

  const { data: whatsappLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['whatsapp-log', id],
    queryFn: () => fetchWhatsAppLog(id),
    enabled: activeTab === 'messages',
  });

  const { data: upcomingMeetings = [] } = useQuery({
    queryKey: ['client-meetings', id],
    queryFn: () => fetchClientMeetings(id),
    enabled: !!client,
  });

  const completeMeetingMutation = useMutation({
    mutationFn: (eventId) => completeCalendlyEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-meetings', id] });
    },
  });

  const isLoading = clientLoading || sessionsLoading;

  const effectiveEngagementId = selectedEngagementId ?? engagements[0]?.id ?? null;
  const filteredSessions = sessions.filter(
    (s) => s.engagement_id === effectiveEngagementId || s.engagement_id == null
  );
  const activeEngagement = engagements.find((e) => e.status === 'active') ?? null;

  if (isLoading) {
    return (
      <div className="crm-page" style={{ maxWidth: 1000 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl" style={{ height: 140, background: 'var(--surface-3)', marginBottom: 14 }} />
        ))}
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="crm-page" style={{ maxWidth: 1000 }}>
        <p style={{ color: 'var(--red-ink)', fontSize: 13 }}>שגיאה בטעינת פרטי הלקוח.</p>
        <Link to="/clients" className="back" style={{ marginTop: 8 }}>חזרה לרשימת המטופלים</Link>
      </div>
    );
  }

  return (
    <div className="crm-page" style={{ maxWidth: 1100 }}>
      {/* Back */}
      <Link to="/clients" className="back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
          <path d="M9 18l6-6-6-6"/>
        </svg>
        חזרה לכל המטופלים
      </Link>

      {/* Page head */}
      <div className="page-head">
        <div>
          <div className="page-title">{client.full_name}</div>
          <div className="page-sub">
            {client.goal && <>{client.goal} · </>}
            מטופל מאז {client.start_date ? new Date(client.start_date).toLocaleDateString('he-IL') : '—'}
          </div>
        </div>
      </div>

      {/* Two-column detail grid */}
      <div className="detail">
        {/* Left rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ClientProfile client={client} sessions={sessions} />

          {/* AI Summary compact */}
          <AISummarySection clientId={id} sessions={sessions} />

          {/* Process summary for ended clients */}
          {client.status === 'ended' && (
            <ProcessSummarySection clientId={id} clientPhone={client.phone} />
          )}
        </div>

        {/* Main content with tabs */}
        <section className="card" style={{ padding: 0 }}>
          {/* Card header: name, date, status, actions */}
          <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-1)', lineHeight: 1.2 }}>{client.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                מטופל מאז {client.start_date ? new Date(client.start_date).toLocaleDateString('he-IL') : '—'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
              <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                {CLIENT_STATUS_LABEL[client.status] ?? client.status}
              </span>
              {client.phone && (
                <a
                  href={`https://wa.me/${client.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="crm-btn crm-btn--sm"
                >
                  וואטסאפ
                </a>
              )}
              <WhatsAppDropdown clientId={client.id} phone={client.phone} />
              <WeightLinkButton clientId={client.id} />
              <FoodBankLinkButton clientId={client.id} />
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="crm-btn crm-btn--sm"
              >
                עריכה
              </button>
            </div>
          </div>

          {/* Engagement selector */}
          <EngagementSelector
            engagements={engagements}
            selectedId={effectiveEngagementId}
            onSelect={setSelectedEngagementId}
            onNew={() => setNewEngagementOpen(true)}
          />
          {newEngagementOpen && (
            <NewEngagementModal
              clientId={id}
              activeEngagement={activeEngagement}
              onClose={(newId) => {
                setNewEngagementOpen(false);
                if (newId) setSelectedEngagementId(newId);
              }}
            />
          )}

          {editOpen && (
            <Modal title="עריכת לקוח" onClose={() => { setEditOpen(false); setConfirmDelete(false); }}>
              <ClientForm client={client} onSuccess={() => setEditOpen(false)} />
              <div className="mt-6 pt-4 border-t border-gray-100">
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-sm text-red-500 hover:text-red-700 transition-colors"
                  >
                    מחק לקוח
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700">
                      האם למחוק את <strong>{client.full_name}</strong>? פעולה זו תמחק את כל הפגישות
                      וההיסטוריה שלו ולא ניתן לשחזרה.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate()}
                        className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
                      >
                        מחק לצמיתות
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Modal>
          )}

          <div className="detail-tabs">
            {[
              { id: 'timeline',  label: 'ציר זמן' },
              { id: 'sessions',  label: 'פגישות', count: filteredSessions.length },
              { id: 'payments',  label: 'תשלומים' },
              { id: 'messages',  label: 'הודעות' },
              { id: 'menus',     label: 'תפריטים' },
              { id: 'weights',   label: 'שקילות' },
            ].map((t) => (
              <button
                key={t.id}
                className={activeTab === t.id ? 'is-active' : ''}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                {t.count !== undefined && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>

          <div style={{ padding: '18px 20px' }}>
            {activeTab === 'timeline' && (
              <SessionTimeline client={client} sessions={filteredSessions} />
            )}

            {activeTab === 'sessions' && (
              <>
                {upcomingMeetings.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div className="t-eyebrow" style={{ marginBottom: 10 }}>פגישות קרובות</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {upcomingMeetings.map((meeting) => {
                        const dt = new Date(meeting.start_time);
                        const dateStr = dt.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
                        const timeStr = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                        const typeLabel = meeting.event_type === 'follow_up' ? 'מעקב' : meeting.event_type === 'first_meeting' ? 'פגישה ראשונה' : meeting.event_type;
                        const isPending = completeMeetingMutation.isPending && completeMeetingMutation.variables === meeting.id;
                        return (
                          <div key={meeting.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{typeLabel}</span>
                              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{dateStr} • {timeStr}</span>
                            </div>
                            <button
                              onClick={() => completeMeetingMutation.mutate(meeting.id)}
                              disabled={isPending}
                              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--green)', background: 'transparent', color: 'var(--green)', cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.6 : 1 }}
                            >
                              {isPending ? 'מעדכן...' : '✓ פגישה בוצעה'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {sessions.length === 0 && !sessionsLoading && (
                  <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '24px 0' }}>
                    עדיין לא נרשמו פגישות
                  </p>
                )}
                <SessionHistory client={client} sessions={filteredSessions} onSessionSaved={handleSessionSaved} />
              </>
            )}

            {activeTab === 'payments' && (
              <PaymentsSection client={client} engagementId={effectiveEngagementId} />
            )}

            {activeTab === 'messages' && (
              <>
                <div className="t-eyebrow" style={{ marginBottom: 10 }}>היסטוריית הודעות WhatsApp</div>
                {logLoading ? (
                  <div className="animate-pulse rounded" style={{ height: 40, background: 'var(--surface-3)' }} />
                ) : whatsappLog.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>אין הודעות שנשלחו עדיין.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {whatsappLog.map((entry) => (
                      <li key={entry.id} style={{ borderBottom: '1px solid var(--hairline)', padding: '10px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                            {entry.template_name ?? 'שליחה ישירה'}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--ink-4)', flexShrink: 0 }}>
                            {formatDateHebrew(entry.sent_at)}
                          </span>
                        </div>
                        {entry.rendered_message && (
                          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                            {entry.rendered_message.length > 100
                              ? entry.rendered_message.slice(0, 100) + '…'
                              : entry.rendered_message}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {activeTab === 'menus' && (
              <MenusTab clientId={id} />
            )}

            {activeTab === 'weights' && (
              <WeightsTab clientId={id} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
