import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LEAD_STATUS_LABEL, LEAD_SOURCE_LABEL } from '../../constants/statuses';
import { formatDateHebrew } from '../../lib/dates';

const COLUMN_DEFS = [
  { status: 'new',               label: 'חדש',          dot: 'var(--ink-4)' },
  { status: 'contacted',         label: 'נוצר קשר',      dot: 'var(--blue)' },
  { status: 'meeting_scheduled', label: 'פגישה נקבעה',   dot: 'var(--amber-ink)' },
  { status: 'became_client',     label: 'הפך למטופל',    dot: 'var(--green)' },
];

const SOURCE_CHIP_CLASS = {
  referral: 'is-ref',
  instagram: 'is-insta',
  ads: 'is-ads',
};

const STATUS_ADVANCE = {
  new:               'contacted',
  contacted:         'meeting_scheduled',
  meeting_scheduled: 'became_client',
};

export default function KanbanBoard({ leads, onStatusChange, onEdit, onStatusAdvance }) {
  const [draggingId, setDraggingId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  const visibleLeads = leads.filter((l) => l.status !== 'not_relevant');
  const leadsByStatus = (status) => visibleLeads.filter((l) => l.status === status);

  function handleDragStart(leadId) { setDraggingId(leadId); }
  function handleDragEnd()         { setDraggingId(null); setOverColumn(null); }

  function handleDragOver(e, status) {
    e.preventDefault();
    setOverColumn(status);
  }
  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setOverColumn(null);
  }
  function handleDrop(e, colStatus) {
    e.preventDefault();
    if (draggingId) {
      const lead = visibleLeads.find((l) => l.id === draggingId);
      if (lead && lead.status !== colStatus) onStatusChange(draggingId, colStatus);
    }
    setDraggingId(null);
    setOverColumn(null);
  }

  return (
    <div className="kanban">
      {COLUMN_DEFS.map((col) => {
        const colLeads = leadsByStatus(col.status);
        const isOver = overColumn === col.status;

        return (
          <div
            key={col.status}
            className={`k-col${isOver ? ' is-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            {/* Column header */}
            <div className="k-col__head">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot, display: 'inline-block', flexShrink: 0 }} />
              {col.label}
              <span className="k-col__ct">{colLeads.length}</span>
            </div>

            {/* Column body */}
            <div className="k-col__body">
              {colLeads.length === 0 ? (
                <div className="k-col__empty">גרור ליד לכאן</div>
              ) : (
                colLeads.map((lead) => {
                  const srcClass = SOURCE_CHIP_CLASS[lead.source] ?? '';
                  const nextStatus = STATUS_ADVANCE[lead.status];

                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => handleDragStart(lead.id)}
                      onDragEnd={handleDragEnd}
                      className={`k-card${draggingId === lead.id ? ' is-dragging' : ''}`}
                    >
                      <div className="k-card__top">
                        <div className="av" style={{ width: 22, height: 22, fontSize: 10, background: 'var(--surface-3)', color: 'var(--ink-2)', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 600 }}>
                          {lead.full_name.slice(0, 2)}
                        </div>
                        <Link
                          to={`/leads/${lead.id}`}
                          className="k-card__name"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.full_name}
                        </Link>
                        {lead.frozen && <span style={{ fontSize: 12, flexShrink: 0 }} title="ליד קפוא">🧊</span>}
                      </div>

                      {(lead.notes || lead.goal) && (
                        <div className="k-card__goal">
                          {lead.goal || (lead.notes && lead.notes.slice(0, 60))}
                        </div>
                      )}

                      <div className="k-card__foot">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {lead.source && (
                            <span className={`src-chip ${srcClass}`}>
                              {LEAD_SOURCE_LABEL?.[lead.source] ?? lead.source}
                            </span>
                          )}
                          {lead.follow_up_date && (
                            <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                              {formatDateHebrew(lead.follow_up_date)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onEdit(lead); }}
                          className="crm-btn crm-btn--ghost crm-btn--sm crm-btn--icon"
                          title="עריכה"
                          style={{ width: 24, height: 24 }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                      </div>

                      {/* Quick advance */}
                      {nextStatus && (
                        <div className="k-card__actions">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onStatusAdvance(lead.id, nextStatus); }}
                            className="crm-btn crm-btn--sm"
                            style={{ fontSize: 11.5, flex: 1, justifyContent: 'center' }}
                          >
                            קדם ← {LEAD_STATUS_LABEL[nextStatus]}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
