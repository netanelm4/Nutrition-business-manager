import { Link } from 'react-router-dom';
import { useState } from 'react';
import AlertBadge from '../ui/AlertBadge';
import WhatsAppDropdown from '../whatsapp/WhatsAppDropdown';
import Modal from '../ui/Modal';
import ClientForm from './ClientForm';
import { formatDateHebrew } from '../../lib/dates';
import { ALERT_STATE, CLIENT_STATUS, CLIENT_STATUS_LABEL } from '../../constants/statuses';

const TOTAL_SESSIONS = 6;

const STATUS_PILL = {
  active:       'bg-blue-100 text-blue-700',
  ending_soon:  'bg-yellow-100 text-yellow-700',
  ended:        'bg-gray-100 text-gray-500',
  paused:       'bg-gray-100 text-gray-500',
};

/**
 * Compute the worst alert state across all session windows for summary display.
 */
function worstAlertState(windowAlerts = []) {
  if (windowAlerts.some((w) => w.state === ALERT_STATE.RED))    return ALERT_STATE.RED;
  if (windowAlerts.some((w) => w.state === ALERT_STATE.YELLOW)) return ALERT_STATE.YELLOW;
  if (windowAlerts.some((w) => w.state === ALERT_STATE.GREEN))  return ALERT_STATE.GREEN;
  return ALERT_STATE.NONE;
}

/**
 * Six-dot progress bar. Filled = session recorded, empty = pending.
 */
function ProgressDots({ sessionsRecorded = [] }) {
  const recorded = new Set(sessionsRecorded);
  return (
    <div className="flex items-center gap-1.5" aria-label={`${sessionsRecorded.length} מתוך ${TOTAL_SESSIONS} פגישות`}>
      {Array.from({ length: TOTAL_SESSIONS }, (_, i) => (
        <span
          key={i}
          className={`w-3 h-3 rounded-full border-2 ${
            recorded.has(i + 1)
              ? 'bg-indigo-500 border-indigo-500'
              : 'bg-white border-gray-300'
          }`}
        />
      ))}
    </div>
  );
}

export default function ClientCard({ client }) {
  const [editOpen, setEditOpen] = useState(false);

  const alertState = worstAlertState(client.alerts?.windowAlerts);
  const sessionCount = client.sessions_recorded?.length ?? 0;
  const statusClass = STATUS_PILL[client.status] ?? STATUS_PILL.active;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
        {/* Top row: name + status + alert */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/clients/${client.id}`}
                className="font-semibold text-gray-900 hover:text-indigo-600 transition-colors truncate"
              >
                {client.full_name}
              </Link>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
                {CLIENT_STATUS_LABEL[client.status] ?? client.status}
              </span>
            </div>
            {client.phone && (
              <a
                href={`https://wa.me/${client.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-500 hover:text-green-600 transition-colors mt-0.5 block"
                dir="ltr"
              >
                {client.phone}
              </a>
            )}
          </div>
          <AlertBadge state={alertState} />
        </div>

        {/* Progress */}
        <div className="mt-3 flex items-center gap-3">
          <ProgressDots sessionsRecorded={client.sessions_recorded} />
          <span className="text-xs text-gray-500">
            פגישה {sessionCount} מתוך {TOTAL_SESSIONS}
          </span>
        </div>

        {/* Process end date */}
        {client.process_end_date && (
          <p className="text-xs text-gray-400 mt-1.5">
            סיום תהליך: {formatDateHebrew(client.process_end_date)}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Link
            to={`/clients/${client.id}`}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            פרטים מלאים
          </Link>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            עריכה
          </button>
          <WhatsAppDropdown clientId={client.id} phone={client.phone} />
        </div>
      </div>

      {editOpen && (
        <Modal title="עריכת לקוח" onClose={() => setEditOpen(false)}>
          <ClientForm client={client} onSuccess={() => setEditOpen(false)} />
        </Modal>
      )}
    </>
  );
}
