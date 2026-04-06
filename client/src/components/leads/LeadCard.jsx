import { Link } from 'react-router-dom';
import { LEAD_STATUS_LABEL, LEAD_SOURCE_LABEL } from '../../constants/statuses';
import { formatDateHebrew, daysUntil } from '../../lib/dates';

// Advance chain — not_relevant is a dead-end and excluded
const LEAD_STATUS_ORDER = ['new', 'contacted', 'meeting_scheduled', 'became_client'];

const STATUS_BADGE = {
  new:               'bg-gray-100 text-gray-600',
  contacted:         'bg-blue-100 text-blue-700',
  meeting_scheduled: 'bg-yellow-100 text-yellow-700',
  became_client:     'bg-green-100 text-green-700',
  not_relevant:      'bg-red-100 text-red-600',
};

function getNextStatus(currentStatus) {
  const idx = LEAD_STATUS_ORDER.indexOf(currentStatus);
  if (idx === -1 || idx === LEAD_STATUS_ORDER.length - 1) return null;
  return LEAD_STATUS_ORDER[idx + 1];
}

/**
 * Displays one lead in both kanban and list contexts.
 *
 * Props:
 *   lead             — lead object from API
 *   onEdit           — called with (lead) when edit button is clicked
 *   onStatusAdvance  — called with (leadId, newStatus) when quick-advance is clicked
 */
export default function LeadCard({ lead, onEdit, onStatusAdvance }) {
  const nextStatus = getNextStatus(lead.status);
  const canAdvance = nextStatus !== null;

  const followUpDays = lead.follow_up_date ? daysUntil(lead.follow_up_date) : null;
  const followUpOverdue = followUpDays !== null && followUpDays <= 0;

  const truncatedNotes =
    lead.notes && lead.notes.length > 60
      ? lead.notes.slice(0, 60) + '...'
      : lead.notes;

  function handleEdit(e) {
    e.preventDefault();
    e.stopPropagation();
    onEdit(lead);
  }

  function handleAdvance(e) {
    e.preventDefault();
    e.stopPropagation();
    if (canAdvance) {
      onStatusAdvance(lead.id, nextStatus);
    }
  }

  return (
    <Link
      to={`/leads/${lead.id}`}
      className={`block bg-white rounded-xl shadow-sm border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow ${lead.frozen ? 'border-r-4 border-r-orange-400' : ''}`}
    >
      {/* Row 1: full_name + status badge */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-gray-900 truncate">{lead.full_name}</span>
          {lead.frozen && (
            <span className="shrink-0 text-xs bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full font-medium">
              🧊 קפוא
            </span>
          )}
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[lead.status] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
        </span>
      </div>

      {/* Row 2: source + follow_up_date */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-gray-400">
          {lead.source ? (LEAD_SOURCE_LABEL[lead.source] ?? lead.source) : ''}
        </span>
        {lead.follow_up_date && (
          <span
            className={`text-xs font-medium ${followUpOverdue ? 'text-red-500' : 'text-gray-500'}`}
          >
            מעקב: {formatDateHebrew(lead.follow_up_date)}
          </span>
        )}
      </div>

      {/* Row 3: truncated notes (conditional) */}
      {truncatedNotes && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">{truncatedNotes}</p>
      )}

      {/* Row 4: action buttons */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        {/* Quick-advance chevron — hidden for terminal statuses */}
        {canAdvance ? (
          <button
            onClick={handleAdvance}
            title={`קדם ל-${LEAD_STATUS_LABEL[nextStatus]}`}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            <span className="text-base leading-none">❯</span>
            <span>{LEAD_STATUS_LABEL[nextStatus]}</span>
          </button>
        ) : (
          <span />
        )}

        {/* Edit button */}
        <button
          onClick={handleEdit}
          title="עריכה"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
          </svg>
        </button>
      </div>
    </Link>
  );
}
