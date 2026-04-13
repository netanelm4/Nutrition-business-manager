import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLeads, updateLead } from '../lib/api';
import { LEAD_STATUS, LEAD_STATUS_LABEL } from '../constants/statuses';
import KanbanBoard from '../components/leads/KanbanBoard';
import LeadCard from '../components/leads/LeadCard';
import LeadForm from '../components/leads/LeadForm';
import MeetingScheduleModal from '../components/leads/MeetingScheduleModal';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

export default function Leads() {
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [statusError, setStatusError] = useState(null);
  // Meeting modal state: { lead, newStatus } when intercepted
  const [meetingModal, setMeetingModal] = useState(null);

  const { data: leads = [], isLoading, isError } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
  });

  const statusMutation = useMutation({
    mutationFn: ({ leadId, newStatus }) => updateLead(leadId, { status: newStatus }),
    onSuccess: () => {
      setStatusError(null);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => setStatusError(err.message || 'אירעה שגיאה בעדכון הסטטוס. נסה שוב.'),
  });

  function handleStatusChange(leadId, newStatus) {
    if (newStatus === LEAD_STATUS.MEETING_SCHEDULED) {
      const lead = leads.find((l) => l.id === leadId);
      if (lead) {
        // Update status immediately, then show meeting modal
        statusMutation.mutate({ leadId, newStatus });
        setMeetingModal({ lead, newStatus });
        return;
      }
    }
    statusMutation.mutate({ leadId, newStatus });
  }

  const filtered = useMemo(() => {
    let result = leads;

    if (statusFilter) {
      result = result.filter((l) => l.status === statusFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((l) => l.full_name.toLowerCase().includes(q));
    }

    return result;
  }, [leads, statusFilter, search]);

  const filtersActive = statusFilter || search.trim();

  return (
    <>
      <div className="p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">לידים</h1>
            {!isLoading && (
              <p className="text-sm text-gray-400 mt-0.5">{leads.length} לידים</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors flex-shrink-0"
          >
            <span>ליד חדש</span>
            <span>+</span>
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 sm:w-44"
          >
            <option value="">כל הסטטוסים</option>
            {Object.entries(LEAD_STATUS).map(([, val]) => (
              <option key={val} value={val}>{LEAD_STATUS_LABEL[val]}</option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        {/* Loading skeletons */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
          </div>
        )}

        {/* Error */}
        {isError && (
          <p className="text-red-500 text-sm">שגיאה בטעינת רשימת הלידים.</p>
        )}

        {statusError && (
          <p className="text-red-500 text-sm">{statusError}</p>
        )}

        {/* Empty state */}
        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState
            message={filtersActive ? 'לא נמצאו לידים' : 'אין לידים עדיין'}
            sub={!filtersActive ? 'לחץ על "ליד חדש" כדי להתחיל' : undefined}
          />
        )}

        {/* Desktop: Kanban board */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="hidden md:block">
            <KanbanBoard
              leads={filtered}
              onStatusChange={handleStatusChange}
              onStatusAdvance={handleStatusChange}
              onEdit={(lead) => setEditLead(lead)}
            />
          </div>
        )}

        {/* Mobile: stacked list */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="md:hidden space-y-3">
            {filtered.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onEdit={(lead) => setEditLead(lead)}
                onStatusAdvance={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add lead modal */}
      {addOpen && (
        <Modal title="ליד חדש" onClose={() => setAddOpen(false)}>
          <LeadForm onSuccess={() => setAddOpen(false)} />
        </Modal>
      )}

      {/* Edit lead modal */}
      {editLead && (
        <Modal title="עריכת ליד" onClose={() => setEditLead(null)}>
          <LeadForm lead={editLead} onSuccess={() => setEditLead(null)} />
        </Modal>
      )}

      {/* Meeting schedule modal */}
      {meetingModal && (
        <MeetingScheduleModal
          lead={meetingModal.lead}
          onSave={() => {
            setMeetingModal(null);
            queryClient.invalidateQueries({ queryKey: ['leads'] });
          }}
          onSkip={() => setMeetingModal(null)}
          onClose={() => setMeetingModal(null)}
        />
      )}
    </>
  );
}
