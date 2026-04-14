import { useState } from 'react';
import { formatDateHebrew } from '../../lib/dates';
import { ALERT_STATE } from '../../constants/statuses';
import AlertBadge from '../ui/AlertBadge';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import SessionModal from './SessionModal';
import AIInsightsPanel from './AIInsightsPanel';
import { ReadonlyTaskList } from './TaskList';
import SessionIntakeForm from './SessionIntakeForm';

/**
 * Compute the session alert state by comparing session_date to expected window.
 * We get this from the client's windowAlerts.
 */
function getSessionAlertState(sessionNumber, windowAlerts = []) {
  const w = windowAlerts.find((wa) => wa.session_number === sessionNumber);
  return w?.state ?? ALERT_STATE.NONE;
}

function SessionItem({ session, client, windowAlerts }) {
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
              <SessionIntakeForm
                sessionId={session.id}
                clientId={client.id}
              />
            )}

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
            onSuccess={() => setEditOpen(false)}
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
export default function SessionHistory({ client, sessions }) {
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
            onSuccess={() => setAddOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
