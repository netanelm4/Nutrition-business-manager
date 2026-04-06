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
  session_reminder: 'bg-blue-100 text-blue-700',
  welcome: 'bg-green-100 text-green-700',
  weekly_checkin: 'bg-purple-100 text-purple-700',
  menu_sent: 'bg-orange-100 text-orange-700',
  process_ending: 'bg-red-100 text-red-700',
  custom: 'bg-gray-100 text-gray-600',
};

const TRIGGER_OPTIONS = Object.keys(TRIGGER_LABELS);

function highlightVars(text) {
  if (!text) return '';
  return text.split(/(\{\{[^}]+\}\})/).map((part, i) =>
    /^\{\{/.test(part)
      ? <span key={i} className="font-bold text-blue-600">{part}</span>
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

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 ${
        checked ? 'bg-indigo-600' : 'bg-gray-300'
      }`}
      aria-pressed={checked}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-1' : 'translate-x-6'
        }`}
      />
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

  const badgeClass = TRIGGER_COLORS[template.trigger_event] ?? 'bg-gray-100 text-gray-600';
  const triggerLabel = TRIGGER_LABELS[template.trigger_event] ?? template.trigger_event;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {/* Top row */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-gray-900 flex-1">{template.name}</span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeClass}`}>
          {triggerLabel}
        </span>
      </div>

      {/* Body text with variable highlighting */}
      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
        {highlightVars(template.body_template)}
      </p>

      {/* Bottom row */}
      <div className="flex items-center gap-3 pt-1">
        {/* Active toggle */}
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={template.is_active === 1}
            onChange={() => onToggle(template)}
          />
          <span className="text-xs text-gray-500">
            {template.is_active === 1 ? 'פעיל' : 'לא פעיל'}
          </span>
        </div>

        <div className="flex-1" />

        {/* Edit button */}
        <button
          type="button"
          onClick={() => onEdit(template)}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          עריכה
        </button>

        {/* Delete button — only for custom templates */}
        {template.is_custom === 1 && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">האם למחוק את התבנית?</span>
              <button
                type="button"
                onClick={handleDeleteClick}
                className="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                אישור
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                ביטול
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
            >
              מחיקה
            </button>
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
    <Modal
      title={isAdd ? 'תבנית חדשה' : 'עריכת תבנית'}
      onClose={onClose}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">שם התבנית</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="שם התבנית"
          />
        </div>

        {/* Trigger event */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">אירוע</label>
          {triggerLocked ? (
            <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              {TRIGGER_LABELS[template.trigger_event] ?? template.trigger_event}
              <span className="text-xs text-gray-400 mr-2">(לא ניתן לשינוי)</span>
            </div>
          ) : (
            <select
              value={triggerEvent}
              onChange={(e) => setTriggerEvent(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{TRIGGER_LABELS[opt]}</option>
              ))}
            </select>
          )}
        </div>

        {/* Body + Live preview side by side on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Textarea */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תוכן ההודעה</label>
            <textarea
              rows={6}
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              placeholder="כתוב את תוכן ההודעה כאן... השתמש ב-{{client_name}}, {{date}}, {{time}} לפרטים דינאמיים"
            />
          </div>

          {/* Live preview */}
          <div>
            <p className="block text-sm font-medium text-gray-700 mb-1">תצוגה מקדימה</p>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap min-h-[9rem]">
              {previewText || <span className="text-gray-400 italic">הכנס תוכן כדי לראות תצוגה מקדימה</span>}
            </div>
          </div>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={isActive}
            onChange={() => setIsActive((v) => !v)}
          />
          <span className="text-sm text-gray-700">{isActive ? 'תבנית פעילה' : 'תבנית לא פעילה'}</span>
        </div>

        {/* Error */}
        {saveMutation.isError && (
          <p className="text-sm text-red-600">שגיאה בשמירה: {saveMutation.error?.message}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {saveMutation.isPending ? 'שומר...' : isAdd ? 'יצירת תבנית' : 'שמירת שינויים'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors"
          >
            ביטול
          </button>
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
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">תבניות הודעה</h1>
          <button
            type="button"
            onClick={() => setEditTemplate(null)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors flex-shrink-0"
          >
            תבנית חדשה +
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
          </div>
        )}

        {/* Error */}
        {isError && (
          <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            שגיאה בטעינת התבניות. אנא נסה שנית.
          </p>
        )}

        {toggleError && (
          <p className="text-red-500 text-sm">{toggleError}</p>
        )}

        {deleteError && (
          <p className="text-red-500 text-sm">{deleteError}</p>
        )}

        {/* Template list */}
        {!isLoading && !isError && (
          <div className="space-y-4">
            {templates.length === 0 ? (
              <p className="text-center text-gray-400 py-12">אין תבניות עדיין. לחץ על "תבנית חדשה +" להתחיל.</p>
            ) : (
              templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onEdit={(tpl) => setEditTemplate(tpl)}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
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
