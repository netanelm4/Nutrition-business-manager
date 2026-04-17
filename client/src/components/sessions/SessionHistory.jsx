import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { formatDateHebrew } from '../../lib/dates';
import { ALERT_STATE } from '../../constants/statuses';
import AlertBadge from '../ui/AlertBadge';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import SessionModal from './SessionModal';
import AIInsightsPanel from './AIInsightsPanel';
import { ReadonlyTaskList } from './TaskList';
import SessionIntakeForm from './SessionIntakeForm';
import { fetchSession, fetchCheckinMessage, generateCheckinMessage } from '../../lib/api';

// ─── AI Initial Assessment (session 1 only) ───────────────────────────────────

function AIInitialAssessment({ session }) {
  const initialAssessment = Array.isArray(session.ai_insights)
    ? session.ai_insights.find((i) => i.type === 'initial_assessment')
    : null;

  const [assessment, setAssessment] = useState(initialAssessment || null);
  const [intakeExists, setIntakeExists] = useState(false);
  const pollRef = useRef(null);

  // Detect whether intake was saved (intake form renders → assume intake may exist)
  // We poll only after intake is saved, signalled by a custom event or always-on for session 1
  useEffect(() => {
    if (assessment) return; // already have it — no need to poll

    function startPolling() {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        try {
          const updated = await fetchSession(session.id);
          const found = Array.isArray(updated.ai_insights)
            ? updated.ai_insights.find((i) => i.type === 'initial_assessment')
            : null;
          if (found) {
            setAssessment(found);
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch { /* silent */ }
      }, 3000);
    }

    // Listen for the intake-saved event dispatched by SessionIntakeForm
    function handleIntakeSaved() {
      setIntakeExists(true);
      startPolling();
    }

    window.addEventListener(`intake-saved-session-${session.id}`, handleIntakeSaved);
    return () => {
      window.removeEventListener(`intake-saved-session-${session.id}`, handleIntakeSaved);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [session.id, assessment]);

  if (!assessment && !intakeExists) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        הערכה ראשונית — AI
      </p>
      {assessment ? (
        <div className="border-r-4 border-blue-400 pr-3 bg-blue-50 rounded-lg p-3">
          <p className="text-xs text-blue-600 font-medium mb-1">
            הערכה ראשונית מבוססת נתוני הפגישה הראשונה
          </p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {assessment.text}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-indigo-500 animate-pulse">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          מייצר הערכה ראשונית...
        </div>
      )}
    </div>
  );
}

// ─── Check-in message panel ───────────────────────────────────────────────────

function CheckinMessagePanel({ session, clientPhone }) {
  const [draft, setDraft] = useState(session.checkin_message || '');
  const [generated, setGenerated] = useState(false);

  const { data: stored, isLoading: loadingStored } = useQuery({
    queryKey: ['checkin-message', session.id],
    queryFn:  () => fetchCheckinMessage(session.id),
    enabled:  !session.checkin_message,  // skip if already in session object
    staleTime: Infinity,
  });

  // Sync stored value once loaded
  useEffect(() => {
    if (stored?.message && !draft) setDraft(stored.message);
  }, [stored]);

  const genMutation = useMutation({
    mutationFn: () => generateCheckinMessage(session.id),
    onSuccess: (data) => {
      setDraft(data.message || '');
      setGenerated(true);
    },
  });

  const phone = clientPhone?.replace(/\D/g, '');
  const waLink = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(draft)}`
    : null;

  if (loadingStored) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        הודעת צ׳ק-אין
      </p>
      {draft ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            dir="rtl"
          />
          <div className="flex gap-2 flex-wrap">
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                שלח בווטסאפ
              </a>
            )}
            <button
              type="button"
              onClick={() => genMutation.mutate()}
              disabled={genMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {genMutation.isPending ? 'מייצר...' : 'צור מחדש'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {genMutation.isPending ? (
            <div className="flex items-center gap-2 text-indigo-500 text-sm animate-pulse">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              מייצר הודעה...
            </div>
          ) : (
            <button
              type="button"
              onClick={() => genMutation.mutate()}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              צור הודעת צ׳ק-אין
            </button>
          )}
          {genMutation.isError && (
            <p className="text-xs text-red-500">{genMutation.error?.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compute the session alert state by comparing session_date to expected window.
 * We get this from the client's windowAlerts.
 */
function getSessionAlertState(sessionNumber, windowAlerts = []) {
  const w = windowAlerts.find((wa) => wa.session_number === sessionNumber);
  return w?.state ?? ALERT_STATE.NONE;
}

function SessionItem({ session, client, windowAlerts, onSessionSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen]  = useState(false);

  const alertState = getSessionAlertState(session.session_number, windowAlerts);

  return (
    <>
      {/* Collapsed header — always visible */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-right"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
              פגישה {session.session_number}
            </span>
            {session.session_date && (
              <span className="text-sm text-gray-500">
                {formatDateHebrew(session.session_date)}
              </span>
            )}
            {session.weight && (
              <span className="text-sm text-gray-400">{session.weight} ק״ג</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <AlertBadge state={alertState} />
            <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* Expanded body */}
        {expanded && (
          <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-4">
            {/* Highlights */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                דגשים מהפגישה
              </p>
              {session.highlights ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {session.highlights}
                </p>
              ) : (
                <p className="text-sm text-gray-400 italic">לא תועדו דגשים לפגישה זו.</p>
              )}
            </div>

            {/* SOAP notes */}
            {session.soap_notes && (() => {
              const fields = [
                { key: 'subjective', label: 'S — סובייקטיבי' },
                { key: 'objective',  label: 'O — אובייקטיבי'  },
                { key: 'assessment', label: 'A — הערכה'        },
                { key: 'plan',       label: 'P — תוכנית'       },
              ].filter(({ key }) => session.soap_notes[key]?.trim());
              if (fields.length === 0) return null;
              return (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    תיעוד SOAP
                  </p>
                  <div className="space-y-2">
                    {fields.map(({ key, label }) => (
                      <div key={key}>
                        <p className="text-xs font-medium text-gray-500">{label}</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {session.soap_notes[key].trim()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* AI insights */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                תובנות AI
              </p>
              <AIInsightsPanel session={session} clientId={client.id} />
            </div>

            {/* Tasks */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                משימות
              </p>
              <ReadonlyTaskList tasks={session.tasks} />
            </div>

            {/* First session intake form */}
            {session.session_number === 1 && (
              <>
                <SessionIntakeForm
                  sessionId={session.id}
                  clientId={client.id}
                />
                <AIInitialAssessment session={session} />
              </>
            )}

            {/* Check-in message */}
            <CheckinMessagePanel session={session} clientPhone={client.phone} />

            {/* Edit button */}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              עריכת פגישה
            </button>
          </div>
        )}
      </div>

      {editOpen && (
        <Modal
          title={`עריכת פגישה ${session.session_number}`}
          onClose={() => setEditOpen(false)}
          size="lg"
        >
          <SessionModal
            clientId={client.id}
            session={session}
            onSuccess={() => { setEditOpen(false); onSessionSaved?.(); }}
          />
        </Modal>
      )}
    </>
  );
}

/**
 * Full session history accordion for the client detail page.
 *
 * @param {object}  client    - Client object (with alerts.windowAlerts)
 * @param {Array}   sessions  - All sessions for this client (parsed)
 */
export default function SessionHistory({ client, sessions, onSessionSaved }) {
  const [addOpen, setAddOpen] = useState(false);

  const windowAlerts = client.alerts?.windowAlerts ?? [];
  const nextSessionNumber = sessions.length > 0
    ? sessions[sessions.length - 1].session_number + 1
    : 1;
  const canAddMore = nextSessionNumber <= 6;

  return (
    <div>
      {sessions.length === 0 ? (
        <EmptyState
          message="לא קיימות פגישות עדיין"
          sub="לחץ על 'הוסף פגישה' כדי להתחיל את ציר הזמן"
        />
      ) : (
        <div className="space-y-3">
          {[...sessions]
            .sort((a, b) => b.session_number - a.session_number)
            .map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                client={client}
                windowAlerts={windowAlerts}
                onSessionSaved={onSessionSaved}
              />
            ))}
        </div>
      )}

      {canAddMore && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="mt-4 w-full py-2.5 rounded-xl border-2 border-dashed border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-colors"
        >
          + הוסף פגישה {nextSessionNumber}
        </button>
      )}

      {!canAddMore && sessions.length === 6 && (
        <p className="mt-4 text-sm text-gray-400 text-center">
          כל 6 הפגישות תועדו — התהליך הושלם.
        </p>
      )}

      {addOpen && (
        <Modal
          title={`פגישה ${nextSessionNumber} — חדשה`}
          onClose={() => setAddOpen(false)}
          size="lg"
        >
          <SessionModal
            clientId={client.id}
            session={null}
            sessionNumber={nextSessionNumber}
            onSuccess={() => { setAddOpen(false); onSessionSaved?.(); }}
          />
        </Modal>
      )}
    </div>
  );
}
