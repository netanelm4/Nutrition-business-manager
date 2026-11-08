import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLeads, updateLead, convertLead } from '../lib/api';
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

  // Dropping a lead on "הפך למטופל" runs the full transactional conversion
  // (client, session 1, 6 windows, engagement, intake) — never a bare status flip.
  const convertMutation = useMutation({
    mutationFn: (leadId) => convertLead(leadId),
    onSuccess: () => {
      setStatusError(null);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setStatusError(err.message || 'אירעה שגיאה בהמרת הליד. נסו שוב.'),
  });

  function handleStatusChange(leadId, newStatus) {
    if (newStatus === LEAD_STATUS.BECAME_CLIENT) {
      convertMutation.mutate(leadId);
      return;
    }
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
    l.status !== LEAD_STATUS.NOT_RELEVANT && l.status !== LEAD_STATUS.BECAME_CLIENT && l.status !== LEAD_STATUS.BACKED_OUT
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

        {/* ── Kanban (phone): stages stacked as collapsible groups ── */}
        {!isLoading && !isError && filtered.length > 0 && viewMode === 'kanban' && (
          <div className="md:hidden">
            <MobileKanban
              leads={filtered}
              onEdit={(lead) => setEditLead(lead)}
              onStatusAdvance={handleStatusChange}
            />
          </div>
        )}

        {/* ── List: one flat list, every lead ── */}
        {!isLoading && !isError && filtered.length > 0 && viewMode === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

// ─── Kanban on a phone ────────────────────────────────────────────────────────
// The desktop board's columns, stacked: one collapsible group per stage.
// Converted leads start collapsed; closed leads (backed out / not relevant /
// meeting held) are grouped at the bottom, like the board hides them.

const MOBILE_STAGES = [
  { key: 'new',               statuses: ['new'],                                      dot: 'var(--ink-4)' },
  { key: 'contacted',         statuses: ['contacted'],                                dot: 'var(--blue)' },
  { key: 'meeting_scheduled', statuses: ['meeting_scheduled'],                        dot: 'var(--amber-ink)' },
  { key: 'became_client',     statuses: ['became_client'],                            dot: 'var(--green)', collapsed: true },
  { key: 'closed',            statuses: ['meeting_held', 'backed_out', 'not_relevant'], dot: 'var(--red-ink)', collapsed: true, label: 'נסגרו ללא המרה' },
];

function MobileKanban({ leads, onEdit, onStatusAdvance }) {
  const [open, setOpen] = useState(() => Object.fromEntries(MOBILE_STAGES.map((s) => [s.key, !s.collapsed])));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {MOBILE_STAGES.map((stage) => {
        const items = leads.filter((l) => stage.statuses.includes(l.status));
        const isOpen = open[stage.key];
        return (
          <section key={stage.key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [stage.key]: !o[stage.key] }))}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-1)' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 99, background: stage.dot, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{stage.label || LEAD_STATUS_LABEL[stage.key]}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 99, padding: '1px 8px' }}>{items.length}</span>
              <span style={{ marginInlineStart: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 10px 10px' }}>
                {items.length === 0
                  ? <p style={{ fontSize: 12.5, color: 'var(--ink-4)', textAlign: 'center', padding: '6px 0 4px' }}>אין לידים בשלב הזה</p>
                  : items.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} onEdit={onEdit} onStatusAdvance={onStatusAdvance} />
                  ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
