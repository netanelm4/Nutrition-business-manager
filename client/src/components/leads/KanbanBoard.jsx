import { useState } from 'react';
import LeadCard from './LeadCard';

const COLUMN_DEFS = [
  { status: 'new',               label: 'חדש' },
  { status: 'contacted',         label: 'נוצר קשר' },
  { status: 'meeting_scheduled', label: 'פגישה נקבעה' },
  { status: 'became_client',     label: 'הפך ללקוח' },
];

export default function KanbanBoard({ leads, onStatusChange, onEdit, onStatusAdvance }) {
  const [draggingId, setDraggingId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  // Filter out not_relevant leads — they are not shown in the kanban board
  const visibleLeads = leads.filter((lead) => lead.status !== 'not_relevant');

  const leadsByStatus = (status) =>
    visibleLeads.filter((lead) => lead.status === status);

  const handleDragStart = (leadId) => {
    setDraggingId(leadId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setOverColumn(null);
  };

  const handleDragOver = (e, status) => {
    e.preventDefault();
    setOverColumn(status);
  };

  const handleDragLeave = (e) => {
    // Only clear if leaving to outside the column (not to a child element)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setOverColumn(null);
    }
  };

  const handleDrop = (e, columnStatus) => {
    e.preventDefault();
    if (draggingId) {
      const draggedLead = visibleLeads.find((l) => l.id === draggingId);
      if (draggedLead && draggedLead.status !== columnStatus) {
        onStatusChange(draggingId, columnStatus);
      }
    }
    setDraggingId(null);
    setOverColumn(null);
  };

  return (
    <div className="flex flex-row-reverse gap-4 overflow-x-auto pb-4">
      {COLUMN_DEFS.map((col) => {
        const columnLeads = leadsByStatus(col.status);
        const isOver = overColumn === col.status;

        return (
          <div
            key={col.status}
            className={`flex flex-col min-w-[240px] flex-1 rounded-xl p-3 transition-colors ${
              isOver
                ? 'ring-2 ring-indigo-400 bg-indigo-50'
                : 'bg-gray-50'
            }`}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 mb-3">
              <span className="font-semibold text-gray-700 text-sm">{col.label}</span>
              <span className="bg-gray-200 rounded-full px-2 text-xs text-gray-600">
                {columnLeads.length}
              </span>
            </div>

            {/* Column body */}
            <div className="flex flex-col space-y-2 flex-1 overflow-y-auto">
              {columnLeads.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm py-6">
                  ריק
                </div>
              ) : (
                columnLeads.map((lead) => (
                  <div
                    key={lead.id}
                    draggable={true}
                    onDragStart={() => handleDragStart(lead.id)}
                    onDragEnd={handleDragEnd}
                    className={`transition-opacity ${
                      lead.id === draggingId ? 'opacity-50' : 'opacity-100'
                    }`}
                  >
                    <LeadCard
                      lead={lead}
                      onEdit={onEdit}
                      onStatusAdvance={onStatusAdvance}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
