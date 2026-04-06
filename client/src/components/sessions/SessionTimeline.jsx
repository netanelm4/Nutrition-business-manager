import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateWindow } from '../../lib/api';
import { formatDateHebrew } from '../../lib/dates';
import AlertBadge from '../ui/AlertBadge';
import Modal from '../ui/Modal';
import SessionModal from './SessionModal';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';

/**
 * Inline override form for a single session window.
 */
function OverrideForm({ window, clientId, onClose }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(window.expected_date ?? '');
  const [note, setNote] = useState(window.override_note ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => updateWindow(window.id, { expected_date: date, override_note: note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', String(clientId)] });
      onClose();
    },
    onError: (err) => setError(err.message || 'שגיאה בעדכון'),
  });

  return (
    <div className="mt-2 space-y-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
      <p className="text-xs font-medium text-orange-700">שנה תאריך חלון</p>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={inputClass}
        dir="ltr"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="סיבה לשינוי (חובה)"
        className={inputClass}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!date || !note.trim() || mutation.isPending}
          className="flex-1 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-medium hover:bg-orange-700 transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'שומר...' : 'עדכן'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-1.5 rounded-lg bg-white border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

/**
 * Single slot in the timeline.
 */
function TimelineSlot({ window, session, clientId }) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);

  const hasSession = !!session;

  return (
    <>
      <div className="flex flex-col gap-2 bg-white rounded-xl border border-gray-200 p-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-gray-700">פגישה {window.session_number}</span>
          <AlertBadge state={window.alert_state ?? 'none'} />
        </div>

        {/* Expected date */}
        <div>
          <p className="text-xs text-gray-400">תאריך צפוי</p>
          <p className="text-sm font-medium text-gray-800">{formatDateHebrew(window.expected_date)}</p>
          {window.manually_overridden === 1 && (
            <p className="text-xs text-orange-600 flex items-center gap-1 mt-0.5">
              <span>✎</span>
              <span>הוזז ידנית</span>
              {window.override_note && (
                <span className="text-gray-400">· {window.override_note}</span>
              )}
            </p>
          )}
        </div>

        {/* Session status */}
        {hasSession ? (
          <div>
            <p className="text-xs text-gray-400">התקיימה</p>
            <p className="text-sm text-gray-700">{formatDateHebrew(session.session_date)}</p>
            {session.weight && (
              <p className="text-xs text-gray-500">{session.weight} ק״ג</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSessionModalOpen(true)}
            className="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-colors text-center"
          >
            קביעת פגישה
          </button>
        )}

        {/* Override button */}
        <button
          type="button"
          onClick={() => setOverrideOpen((v) => !v)}
          className="text-xs text-gray-400 hover:text-orange-600 transition-colors self-start"
        >
          שנה תאריך חלון
        </button>

        {overrideOpen && (
          <OverrideForm
            window={window}
            clientId={clientId}
            onClose={() => setOverrideOpen(false)}
          />
        )}
      </div>

      {sessionModalOpen && (
        <Modal
          title={`פגישה ${window.session_number} — קביעה`}
          onClose={() => setSessionModalOpen(false)}
        >
          <SessionModal
            clientId={clientId}
            session={null}
            sessionNumber={window.session_number}
            onSuccess={() => setSessionModalOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}

/**
 * Six-slot session timeline for the client detail page.
 *
 * @param {object}   client   - Client row (with session_windows + alerts)
 * @param {Array}    sessions - All sessions for this client
 */
export default function SessionTimeline({ client, sessions }) {
  const windows = client.session_windows ?? [];

  if (windows.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        חלונות הפגישות ייווצרו לאחר הגדרת תאריך פגישה ראשונה.
      </p>
    );
  }

  // Map sessions by session_number for fast lookup
  const sessionByNumber = {};
  for (const s of sessions) sessionByNumber[s.session_number] = s;

  // Merge alert state from client.alerts.windowAlerts into each window
  const alertByNumber = {};
  for (const wa of client.alerts?.windowAlerts ?? []) {
    alertByNumber[wa.session_number] = wa.state;
  }

  // Reverse so session 1 appears rightmost (RTL reading order: 1 → right, 6 → left)
  const enrichedWindows = [...windows]
    .sort((a, b) => a.session_number - b.session_number)
    .reverse()
    .map((w) => ({
      ...w,
      alert_state: alertByNumber[w.session_number] ?? 'none',
    }));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {enrichedWindows.map((w) => (
        <TimelineSlot
          key={w.id}
          window={w}
          session={sessionByNumber[w.session_number] ?? null}
          clientId={client.id}
        />
      ))}
    </div>
  );
}
