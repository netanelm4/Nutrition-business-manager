import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProtocols, createProtocol, updateProtocol, deleteProtocol } from '../lib/api';
import Modal from '../components/ui/Modal';

// ─── helpers ──────────────────────────────────────────────────────────────────

function moveItem(arr, index, dir) {
  const next = index + dir;
  if (next < 0 || next >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[next]] = [copy[next], copy[index]];
  return copy;
}

const inputClass = 'field-input w-full';

// ─── Dynamic item list (highlights or tasks) ──────────────────────────────────

function ItemList({ items, onChange, placeholder }) {
  function set(i, value) {
    const next = [...items];
    next[i] = value;
    onChange(next);
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, '']);
  }
  function move(i, dir) {
    onChange(moveItem(items, i, dir));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              style={{ fontSize: 10, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, opacity: i === 0 ? 0.3 : 1 }}
              title="העלה"
            >▲</button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              style={{ fontSize: 10, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, opacity: i === items.length - 1 ? 0.3 : 1 }}
              title="הורד"
            >▼</button>
          </div>
          <input
            type="text"
            value={item}
            onChange={(e) => set(i, e.target.value)}
            placeholder={placeholder}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            style={{ color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{ fontSize: 13, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'right' }}
      >
        + הוסף פריט
      </button>
    </div>
  );
}

// ─── Protocol form (create / edit) ───────────────────────────────────────────

function ProtocolForm({ protocol, onSuccess }) {
  const queryClient = useQueryClient();
  const isEdit = !!protocol?.id;

  const [name, setName] = useState(protocol?.name ?? '');
  const [description, setDescription] = useState(protocol?.description ?? '');
  const [highlights, setHighlights] = useState(
    protocol?.highlights ?? ['']
  );
  const [tasks, setTasks] = useState(
    protocol?.default_tasks?.map((t) => (typeof t === 'object' ? t.text : t)) ?? ['']
  );
  const [isActive, setIsActive] = useState(protocol?.is_active !== 0);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit ? updateProtocol(protocol.id, data) : createProtocol(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['protocols'] });
      onSuccess();
    },
    onError: (err) => setError(err.message || 'שגיאה בשמירה.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProtocol(protocol.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['protocols'] });
      onSuccess();
    },
    onError: (err) => setError(err.message || 'שגיאה במחיקה.'),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('שם הפרוטוקול הוא שדה חובה.'); return; }
    setError('');
    const highlightsFilled = highlights.filter((h) => h.trim());
    const tasksFilled = tasks
      .filter((t) => t.trim())
      .map((t) => ({ text: t.trim(), status: 'pending' }));

    saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || null,
      highlights: highlightsFilled,
      default_tasks: tasksFilled,
      is_active: isActive ? 1 : 0,
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>שם הפרוטוקול *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הפרוטוקול" className={inputClass} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>תיאור</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="תיאור קצר של הפרוטוקול..." className={inputClass} style={{ resize: 'none' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>דגשים קליניים</label>
        <ItemList items={highlights} onChange={setHighlights} placeholder="דגש קליני..." />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>משימות ברירת מחדל</label>
        <ItemList items={tasks} onChange={setTasks} placeholder="משימה..." />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="proto-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ accentColor: 'var(--blue)', width: 15, height: 15 }} />
        <label htmlFor="proto-active" style={{ fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>פרוטוקול פעיל</label>
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--red-ink)', background: 'var(--red-soft)', padding: '8px 12px', borderRadius: 8 }}>{error}</p>}

      <button type="submit" disabled={saveMutation.isPending} className="crm-btn crm-btn--primary" style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
        {saveMutation.isPending ? 'שומר...' : isEdit ? 'שמור שינויים' : 'צור פרוטוקול'}
      </button>

      {isEdit && protocol.is_custom === 1 && (
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ fontSize: 13, color: 'var(--red-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              מחק פרוטוקול
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>האם למחוק את <strong>{protocol.name}</strong>? פעולה זו אינה הפיכה.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="crm-btn" style={{ flex: 1, justifyContent: 'center', background: 'var(--red-soft)', color: 'var(--red-ink)', border: 'none' }}>
                  {deleteMutation.isPending ? 'מוחק...' : 'מחק לצמיתות'}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="crm-btn" style={{ flex: 1, justifyContent: 'center' }}>ביטול</button>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

// ─── Protocol card ────────────────────────────────────────────────────────────

function ProtocolCard({ protocol, onEdit }) {
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <h3 style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink-1)', margin: 0 }}>{protocol.name}</h3>
            {protocol.is_custom === 0 ? (
              <span className="chip" style={{ fontSize: 11 }}>ברירת מחדל</span>
            ) : (
              <span className="chip chip--blue" style={{ fontSize: 11 }}>מותאם אישית</span>
            )}
            {protocol.is_active === 0 && (
              <span className="chip chip--red" style={{ fontSize: 11 }}>לא פעיל</span>
            )}
          </div>
          {protocol.description && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>{protocol.description}</p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip" style={{ fontSize: 11 }}>{protocol.highlights.length} דגשים</span>
            <span className="chip" style={{ fontSize: 11 }}>{protocol.default_tasks.length} משימות</span>
          </div>
        </div>
        <button type="button" onClick={() => onEdit(protocol)} className="crm-btn crm-btn--sm" style={{ flexShrink: 0 }}>
          עריכה
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Protocols() {
  const [modalProtocol, setModalProtocol] = useState(null); // null = closed, {} = create, obj = edit
  const [modalOpen, setModalOpen] = useState(false);

  const { data: protocols = [], isLoading, isError } = useQuery({
    queryKey: ['protocols'],
    queryFn: fetchProtocols,
  });

  function openCreate() {
    setModalProtocol(null);
    setModalOpen(true);
  }

  function openEdit(protocol) {
    setModalProtocol(protocol);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalProtocol(null);
  }

  return (
    <div className="crm-page">
      {/* Subhead */}
      <div className="subhead">
        <div>
          <b style={{ fontSize: 14, color: 'var(--ink-1)' }}>ספריית פרוטוקולים</b>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>פרוטוקולים קליניים לטעינה בפגישה הראשונה</div>
        </div>
        <button type="button" onClick={openCreate} className="crm-btn crm-btn--primary">
          + פרוטוקול חדש
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 80, background: 'var(--surface-3)', borderRadius: 12 }} />
          ))}
        </div>
      ) : isError ? (
        <p style={{ fontSize: 13, color: 'var(--red-ink)' }}>שגיאה בטעינת הפרוטוקולים.</p>
      ) : protocols.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '48px 0' }}>אין פרוטוקולים עדיין.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {protocols.map((p) => (
            <ProtocolCard key={p.id} protocol={p} onEdit={openEdit} />
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal
          title={modalProtocol ? `עריכת פרוטוקול — ${modalProtocol.name}` : 'פרוטוקול חדש'}
          onClose={closeModal}
          size="lg"
        >
          <ProtocolForm protocol={modalProtocol} onSuccess={closeModal} />
        </Modal>
      )}
    </div>
  );
}
