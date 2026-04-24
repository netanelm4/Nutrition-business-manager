import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLeads, updateLead } from '../lib/api';
import { LEAD_STATUS, LEAD_STATUS_LABEL } from '../constants/statuses';
import KanbanBoard from '../components/leads/KanbanBoard';
import LeadCard from '../components/leads/LeadCard';
import LeadForm from '../components/leads/LeadForm';
import MeetingScheduleModal from '../components/leads/MeetingScheduleModal';
import Modal from '../components/ui/Modal';

// ── Inline icons ──────────────────────────────────────────────────────────────

function IcPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}
function IcSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
    </svg>
  );
}
function IcGrid() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  );
}
function IcList() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M7 7h10M7 11h7M7 15h5"/>
    </svg>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skel() {
  return (
    <div className="animate-pulse rounded-xl" style={{ height: 120, background: 'var(--surface-3)' }} />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Leads() {
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' | 'list'
  const [statusError, setStatusError] = useState(null);
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
        statusMutation.mutate({ leadId, newStatus });
        setMeetingModal({ lead, newStatus });
        return;
      }
    }
    statusMutation.mutate({ leadId, newStatus });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => l.full_name.toLowerCase().includes(q));
  }, [leads, search]);

  const activeLeads = leads.filter((l) =>
    l.status !== LEAD_STATUS.NOT_RELEVANT && l.status !== LEAD_STATUS.BECAME_CLIENT
  );

  return (
    <>
      <div className="crm-page">
        {/* ── Subhead ── */}
        <div className="subhead">
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              <b style={{ color: 'var(--ink-1)', fontSize: 14 }}>{activeLeads.length} לידים פעילים</b>
              {leads.filter((l) => l.status === LEAD_STATUS.BECAME_CLIENT).length > 0 && (
                <> · {leads.filter((l) => l.status === LEAD_STATUS.BECAME_CLIENT).length} הומרו</>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="search-box">
              <IcSearch />
              <input
                placeholder="חיפוש ליד..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="seg">
              <button className={viewMode === 'kanban' ? 'is-active' : ''} onClick={() => setViewMode('kanban')}>
                <IcGrid /> קנבן
              </button>
              <button className={viewMode === 'list' ? 'is-active' : ''} onClick={() => setViewMode('list')}>
                <IcList /> רשימה
              </button>
            </div>
            <button
              type="button"
              className="crm-btn crm-btn--primary"
              onClick={() => setAddOpen(true)}
            >
              <IcPlus /> ליד חדש
            </button>
          </div>
        </div>

        {/* ── Errors ── */}
        {isError && <p style={{ color: 'var(--red-ink)', fontSize: 13, marginBottom: 12 }}>שגיאה בטעינת הלידים.</p>}
        {statusError && <p style={{ color: 'var(--red-ink)', fontSize: 13, marginBottom: 12 }}>{statusError}</p>}

        {/* ── Loading ── */}
        {isLoading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[1, 2, 3, 4].map((i) => <Skel key={i} />)}
          </div>
        )}

        {/* ── Kanban (desktop) ── */}
        {!isLoading && !isError && filtered.length > 0 && viewMode === 'kanban' && (
          <div className="hidden md:block">
            <KanbanBoard
              leads={filtered}
              onStatusChange={handleStatusChange}
              onStatusAdvance={handleStatusChange}
              onEdit={(lead) => setEditLead(lead)}
            />
          </div>
        )}

        {/* ── List (mobile / list mode) ── */}
        {!isLoading && !isError && filtered.length > 0 && (viewMode === 'list' || true) && (
          <div className={viewMode === 'list' ? 'block' : 'md:hidden'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {viewMode === 'list' && filtered.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onEdit={(lead) => setEditLead(lead)}
                onStatusAdvance={handleStatusChange}
              />
            ))}
          </div>
        )}

        {/* ── Mobile fallback ── */}
        {!isLoading && !isError && viewMode === 'kanban' && (
          <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
              {search ? 'לא נמצאו לידים' : 'אין לידים עדיין'}
            </p>
            {!search && (
              <button
                type="button"
                className="crm-btn crm-btn--primary"
                style={{ marginTop: 12 }}
                onClick={() => setAddOpen(true)}
              >
                <IcPlus /> ליד חדש
              </button>
            )}
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title="ליד חדש" onClose={() => setAddOpen(false)}>
          <LeadForm onSuccess={() => setAddOpen(false)} />
        </Modal>
      )}

      {editLead && (
        <Modal title="עריכת ליד" onClose={() => setEditLead(null)}>
          <LeadForm lead={editLead} onSuccess={() => setEditLead(null)} />
        </Modal>
      )}

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
