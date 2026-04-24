import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTemplates, updateTemplate, createTemplate, deleteTemplate } from '../lib/api';
import Modal from '../components/ui/Modal';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIGGER_LABELS = {
  session_reminder: 'תזכורת פגישה',
  welcome: 'ברוכים הבאים',
  weekly_checkin: "צ'ק-אין שבועי",
  menu_sent: 'תפריט נשלח',
  process_ending: 'סיום תהליך',
  custom: 'אחר',
};

const TRIGGER_COLORS = {
  session_reminder: 'chip--blue',
  welcome: 'chip--green',
  weekly_checkin: 'chip--blue',
  menu_sent: 'chip--amber',
  process_ending: 'chip--red',
  custom: '',
};

const TRIGGER_OPTIONS = Object.keys(TRIGGER_LABELS);

function highlightVars(text) {
  if (!text) return '';
  return text.split(/(\{\{[^}]+\}\})/).map((part, i) =>
    /^\{\{/.test(part)
      ? <span key={i} className="var-chip">{part}</span>
      : part
  );
}

function previewRender(body) {
  return body
    .replace(/\{\{client_name\}\}/g, 'ישראל ישראלי')
    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('he-IL'))
    .replace(/\{\{time\}\}/g, '10:00')
    .replace(/\{\{(\w+)\}\}/g, '[$1]');
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return <div className="animate-pulse" style={{ height: 120, borderRadius: 12, background: 'var(--surface-3)' }} />;
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        position: 'relative', display: 'inline-flex', height: 22, width: 40,
        alignItems: 'center', borderRadius: 11, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--blue)' : 'var(--line)', transition: 'background 0.2s',
        flexShrink: 0,
      }}
      aria-pressed={checked}
    >
      <span style={{
        display: 'inline-block', height: 16, width: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transform: checked ? 'translateX(4px)' : 'translateX(20px)',
        transition: 'transform 0.2s',
      }} />
    </button>
  );
}

// ── Template Card ─────────────────────────────────────────────────────────────

function TemplateCard({ template, onEdit, onToggle, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDeleteClick() {
    if (!confirmDelete) {
      setConfirmDelete(true);
    } else {
      onDelete(template.id);
      setConfirmDelete(false);
    }
  }

  const chipClass = TRIGGER_COLORS[template.trigger_event] ?? '';
  const triggerLabel = TRIGGER_LABELS[template.trigger_event] ?? template.trigger_event;

  return (
    <div className="card" style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-1)', flex: 1 }}>{template.name}</span>
        <span className={`chip ${chipClass}`}>{triggerLabel}</span>
      </div>

      {/* Body text */}
      <p style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
        {highlightVars(template.body_template)}
      </p>

      {/* Bottom row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
        <ToggleSwitch checked={template.is_active === 1} onChange={() => onToggle(template)} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{template.is_active === 1 ? 'פעיל' : 'לא פעיל'}</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => onEdit(template)} className="crm-btn crm-btn--sm">עריכה</button>
        {template.is_custom === 1 && (
          confirmDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--red-ink)' }}>האם למחוק את התבנית?</span>
              <button type="button" onClick={handleDeleteClick} className="crm-btn crm-btn--sm" style={{ background: 'var(--red-soft)', color: 'var(--red-ink)', border: 'none' }}>אישור</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="crm-btn crm-btn--sm">ביטול</button>
            </div>
          ) : (
            <button type="button" onClick={handleDeleteClick} className="crm-btn crm-btn--sm" style={{ color: 'var(--red-ink)', borderColor: 'var(--red-soft)' }}>מחיקה</button>
          )
        )}
      </div>
    </div>
  );
}

// ── Edit / Add Modal ──────────────────────────────────────────────────────────

function TemplateModal({ template, onClose, onSaved }) {
  const isAdd = template === null;

  const [name, setName] = useState(template?.name ?? '');
  const [triggerEvent, setTriggerEvent] = useState(template?.trigger_event ?? 'custom');
  const [bodyTemplate, setBodyTemplate] = useState(template?.body_template ?? '');
  const [isActive, setIsActive] = useState(template ? template.is_active === 1 : true);

  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isAdd
        ? createTemplate(data)
        : updateTemplate(template.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      onSaved();
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    const payload = isAdd
      ? { name, trigger_event: triggerEvent, body_template: bodyTemplate, is_active: 1 }
      : { name, body_template: bodyTemplate, is_active: isActive ? 1 : 0 };
    saveMutation.mutate(payload);
  }

  // Seeded (non-custom) templates cannot change their trigger_event
  const triggerLocked = !isAdd && template?.is_custom === 0;

  const previewText = previewRender(bodyTemplate);

  return (
    <Modal title={isAdd ? 'תבנית חדשה' : 'עריכת תבנית'} onClose={onClose} size="xl">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>שם התבנית</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="field-input" style={{ width: '100%' }} placeholder="שם התבנית" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>אירוע</label>
          {triggerLocked ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px', border: '1px solid var(--line)' }}>
              {TRIGGER_LABELS[template.trigger_event] ?? template.trigger_event}
              <span style={{ fontSize: 11.5, color: 'var(--ink-4)', marginRight: 8 }}>(לא ניתן לשינוי)</span>
            </div>
          ) : (
            <select value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} className="field-input" style={{ width: '100%' }}>
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{TRIGGER_LABELS[opt]}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>תוכן ההודעה</label>
            <textarea rows={6} value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} className="field-input" style={{ width: '100%', resize: 'none' }} placeholder="כתוב את תוכן ההודעה... {{client_name}}, {{date}}, {{time}}" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>תצוגה מקדימה</label>
            <div className="msg-bubble" style={{ minHeight: 140, fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {previewText || <span style={{ color: 'var(--ink-4)', fontStyle: 'italic' }}>הכנס תוכן לתצוגה מקדימה</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ToggleSwitch checked={isActive} onChange={() => setIsActive((v) => !v)} />
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{isActive ? 'תבנית פעילה' : 'תבנית לא פעילה'}</span>
        </div>

        {saveMutation.isError && (
          <p style={{ fontSize: 13, color: 'var(--red-ink)' }}>שגיאה בשמירה: {saveMutation.error?.message}</p>
        )}

        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <button type="submit" disabled={saveMutation.isPending} className="crm-btn crm-btn--primary" style={{ flex: 1, justifyContent: 'center' }}>
            {saveMutation.isPending ? 'שומר...' : isAdd ? 'יצירת תבנית' : 'שמירת שינויים'}
          </button>
          <button type="button" onClick={onClose} className="crm-btn">ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Templates() {
  const [editTemplate, setEditTemplate] = useState(undefined); // undefined = closed, null = add, object = edit
  const [toggleError, setToggleError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading, isError } = useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, data }) => updateTemplate(id, data),
    onSuccess: () => {
      setToggleError(null);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err) => setToggleError(err.message || 'אירעה שגיאה בעדכון התבנית. נסה שוב.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteTemplate(id),
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err) => setDeleteError(err.message || 'אירעה שגיאה במחיקת התבנית. נסה שוב.'),
  });

  function handleToggle(t) {
    toggleMutation.mutate({ id: t.id, data: { is_active: t.is_active === 1 ? 0 : 1 } });
  }

  function handleDelete(id) {
    deleteMutation.mutate(id);
  }

  const modalOpen = editTemplate !== undefined;

  return (
    <>
      <div className="crm-page">
        {/* Subhead */}
        <div className="subhead">
          <b style={{ fontSize: 14, color: 'var(--ink-1)' }}>תבניות הודעה</b>
          <button type="button" onClick={() => setEditTemplate(null)} className="crm-btn crm-btn--primary">
            + תבנית חדשה
          </button>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} />)}
          </div>
        )}

        {isError && <p style={{ fontSize: 13, color: 'var(--red-ink)', background: 'var(--red-soft)', borderRadius: 8, padding: '10px 14px' }}>שגיאה בטעינת התבניות. אנא נסה שנית.</p>}
        {toggleError && <p style={{ fontSize: 13, color: 'var(--red-ink)' }}>{toggleError}</p>}
        {deleteError && <p style={{ fontSize: 13, color: 'var(--red-ink)' }}>{deleteError}</p>}

        {!isLoading && !isError && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {templates.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '48px 0' }}>אין תבניות עדיין.</p>
            ) : (
              templates.map((t) => (
                <TemplateCard key={t.id} template={t} onEdit={(tpl) => setEditTemplate(tpl)} onToggle={handleToggle} onDelete={handleDelete} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <TemplateModal
          template={editTemplate}
          onClose={() => setEditTemplate(undefined)}
          onSaved={() => setEditTemplate(undefined)}
        />
      )}
    </>
  );
}
