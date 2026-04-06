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

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';

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
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
              title="העלה"
            >▲</button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
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
            className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 text-lg leading-none"
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
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
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">שם הפרוטוקול *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם הפרוטוקול"
          className={inputClass}
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">תיאור</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="תיאור קצר של הפרוטוקול..."
          className={inputClass}
        />
      </div>

      {/* Highlights */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">דגשים קליניים</label>
        <ItemList
          items={highlights}
          onChange={setHighlights}
          placeholder="דגש קליני..."
        />
      </div>

      {/* Tasks */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">משימות ברירת מחדל</label>
        <ItemList
          items={tasks}
          onChange={setTasks}
          placeholder="משימה..."
        />
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="proto-active"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
        />
        <label htmlFor="proto-active" className="text-sm text-gray-700">פרוטוקול פעיל</label>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      <button
        type="submit"
        disabled={saveMutation.isPending}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-60"
      >
        {saveMutation.isPending ? 'שומר...' : isEdit ? 'שמור שינויים' : 'צור פרוטוקול'}
      </button>

      {/* Delete — only for custom protocols */}
      {isEdit && protocol.is_custom === 1 && (
        <div className="pt-4 border-t border-gray-100">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-500 hover:text-red-700 transition-colors"
            >
              מחק פרוטוקול
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                האם למחוק את <strong>{protocol.name}</strong>? פעולה זו אינה הפיכה.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {deleteMutation.isPending ? 'מוחק...' : 'מחק לצמיתות'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  ביטול
                </button>
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
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-gray-900">{protocol.name}</h3>
            {protocol.is_custom === 0 ? (
              <span className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">
                ברירת מחדל
              </span>
            ) : (
              <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                מותאם אישית
              </span>
            )}
            {protocol.is_active === 0 && (
              <span className="text-xs bg-red-50 text-red-500 border border-red-200 px-2 py-0.5 rounded-full">
                לא פעיל
              </span>
            )}
          </div>
          {protocol.description && (
            <p className="text-sm text-gray-500 mb-3">{protocol.description}</p>
          )}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
              {protocol.highlights.length} דגשים
            </span>
            <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
              {protocol.default_tasks.length} משימות
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onEdit(protocol)}
          className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
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
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ספריית פרוטוקולים</h1>
          <p className="text-sm text-gray-400 mt-0.5">פרוטוקולים קליניים לטעינה בפגישה הראשונה</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
        >
          + פרוטוקול חדש
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-gray-200 rounded-xl h-24" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-red-500 text-sm">שגיאה בטעינת הפרוטוקולים.</p>
      ) : protocols.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">אין פרוטוקולים עדיין.</p>
      ) : (
        <div className="space-y-3">
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
