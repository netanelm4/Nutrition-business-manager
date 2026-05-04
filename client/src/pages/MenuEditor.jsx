import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMenu, updateMenu,
  generateMenu, finalizeMenu,
  addMeal, updateMeal, deleteMeal,
  addMenuItem, updateMenuItem, deleteMenuItem,
} from '../lib/api';
import Modal from '../components/ui/Modal';

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_TYPE_CONFIG = {
  protein:      { label: 'חלבון',   color: 'bg-blue-100 text-blue-700' },
  carb:         { label: 'פחמימה',  color: 'bg-green-100 text-green-700' },
  fat:          { label: 'שומן',    color: 'bg-yellow-100 text-yellow-700' },
  vegetable:    { label: 'ירק',     color: 'bg-lime-100 text-lime-700' },
  fruit:        { label: 'פרי',     color: 'bg-orange-100 text-orange-700' },
  daily_basket: { label: 'סל יומי', color: 'bg-purple-100 text-purple-700' },
};

const ITEM_TYPE_OPTIONS = Object.entries(ITEM_TYPE_CONFIG).map(([value, { label }]) => ({ value, label }));

const EMPTY_ITEM_FORM = { item_type: 'protein', portions: 1, custom_text: '', notes: '' };

// ─── ItemModal ────────────────────────────────────────────────────────────────

function ItemModal({ menuId, mealId, existingItem, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    existingItem
      ? {
          item_type:   existingItem.item_type   ?? 'protein',
          portions:    existingItem.portions    ?? 1,
          custom_text: existingItem.custom_text ?? '',
          notes:       existingItem.notes       ?? '',
        }
      : { ...EMPTY_ITEM_FORM }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.custom_text.trim()) { setError('נדרש שם פריט'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        custom_text: form.custom_text.trim(),
        item_type:   form.item_type,
        portions:    form.portions,
        notes:       form.notes.trim() || null,
      };
      if (existingItem) {
        await updateMenuItem(menuId, mealId, existingItem.id, payload);
      } else {
        await addMenuItem(menuId, mealId, payload);
      }
      queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={existingItem ? 'עריכת פריט' : 'הוספת פריט'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>סוג</label>
          <select
            className="crm-input"
            value={form.item_type}
            onChange={(e) => set('item_type', e.target.value)}
          >
            {ITEM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>שם המזון</label>
          <input
            type="text"
            className="crm-input"
            value={form.custom_text}
            onChange={(e) => set('custom_text', e.target.value)}
            placeholder="לדוגמה: ביצים, לחם מלא"
            autoFocus
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>מנות</label>
          <input
            type="number"
            className="crm-input"
            value={form.portions}
            onChange={(e) => set('portions', parseFloat(e.target.value) || 1)}
            step={0.5}
            min={0.5}
            max={10}
            style={{ width: 100 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>הערות</label>
          <input
            type="text"
            className="crm-input"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="אופציונלי"
          />
        </div>

        {error && <p style={{ fontSize: 12, color: 'var(--red-ink)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="crm-btn" onClick={onClose}>ביטול</button>
          <button type="button" className="crm-btn crm-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── MealCard ─────────────────────────────────────────────────────────────────

function MealCard({ menu, meal, allMeals, onAddItem, onEditItem }) {
  const queryClient = useQueryClient();
  const menuId = menu.id;

  const deleteMealMut = useMutation({
    mutationFn: () => deleteMeal(menuId, meal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] }),
  });

  const deleteItemMut = useMutation({
    mutationFn: (itemId) => deleteMenuItem(menuId, meal.id, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] }),
  });

  const moveMut = useMutation({
    mutationFn: ({ id, meal_order }) => updateMeal(menuId, id, { meal_order }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] }),
  });

  const sortedMeals = [...allMeals].sort((a, b) => a.meal_order - b.meal_order || a.id - b.id);
  const myIdx = sortedMeals.findIndex((m) => m.id === meal.id);

  function moveUp() {
    if (myIdx <= 0) return;
    const prev = sortedMeals[myIdx - 1];
    moveMut.mutate({ id: meal.id, meal_order: prev.meal_order });
    moveMut.mutate({ id: prev.id, meal_order: meal.meal_order });
  }
  function moveDown() {
    if (myIdx >= sortedMeals.length - 1) return;
    const next = sortedMeals[myIdx + 1];
    moveMut.mutate({ id: meal.id, meal_order: next.meal_order });
    moveMut.mutate({ id: next.id, meal_order: meal.meal_order });
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Meal header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" onClick={moveUp} disabled={myIdx === 0 || moveMut.isPending} style={{ fontSize: 10, padding: '1px 4px', lineHeight: 1, cursor: myIdx === 0 ? 'default' : 'pointer', opacity: myIdx === 0 ? 0.3 : 1, background: 'none', border: 'none', color: 'var(--ink-3)' }}>▲</button>
            <button type="button" onClick={moveDown} disabled={myIdx >= sortedMeals.length - 1 || moveMut.isPending} style={{ fontSize: 10, padding: '1px 4px', lineHeight: 1, cursor: myIdx >= sortedMeals.length - 1 ? 'default' : 'pointer', opacity: myIdx >= sortedMeals.length - 1 ? 0.3 : 1, background: 'none', border: 'none', color: 'var(--ink-3)' }}>▼</button>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-1)' }}>{meal.meal_name}</span>
          {meal.time_label && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>({meal.time_label})</span>}
        </div>
        <button
          type="button"
          onClick={() => { if (window.confirm('למחוק את הארוחה ואת כל הפריטים שלה?')) deleteMealMut.mutate(); }}
          disabled={deleteMealMut.isPending}
          style={{ fontSize: 11, color: 'var(--red-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
        >
          מחק
        </button>
      </div>

      {/* Items */}
      <div style={{ padding: '8px 16px' }}>
        {meal.items.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--ink-4)', padding: '8px 0' }}>אין פריטים בארוחה זו</p>
        )}
        {meal.items.map((item) => {
          const cfg = ITEM_TYPE_CONFIG[item.item_type] ?? ITEM_TYPE_CONFIG.protein;
          return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>{item.custom_text}</span>
                {item.portions != null && (
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{item.portions} מנות</span>
                )}
                {item.notes && (
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>{item.notes}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => onEditItem(meal.id, item)} style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>עריכה</button>
                <button
                  type="button"
                  onClick={() => deleteItemMut.mutate(item.id)}
                  disabled={deleteItemMut.isPending}
                  style={{ fontSize: 11, color: 'var(--red-ink)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  מחק
                </button>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onAddItem(meal.id)}
          style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', fontWeight: 500 }}
        >
          + הוסף פריט
        </button>
      </div>
    </div>
  );
}

// ─── InlineTitle ──────────────────────────────────────────────────────────────

function InlineTitle({ menuId, initialValue }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => { setValue(initialValue); }, [initialValue]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const saveMut = useMutation({
    mutationFn: (title) => updateMenu(menuId, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] }),
  });

  function handleBlur() {
    setEditing(false);
    if (value.trim() && value.trim() !== initialValue) {
      saveMut.mutate(value.trim());
    } else {
      setValue(initialValue);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current.blur(); if (e.key === 'Escape') { setValue(initialValue); setEditing(false); } }}
        style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)', border: 'none', borderBottom: '2px solid var(--blue)', background: 'transparent', outline: 'none', width: '100%' }}
      />
    );
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      title="לחץ לעריכה"
      style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)', cursor: 'text', margin: 0 }}
    >
      {value}
    </h1>
  );
}

// ─── AddMealForm ──────────────────────────────────────────────────────────────

function AddMealForm({ menuId, nextOrder, onDone }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [timeLabel, setTimeLabel] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addMeal(menuId, { name: name.trim(), time_label: timeLabel.trim() || null, meal_order: nextOrder });
      queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] });
      onDone();
    } catch (err) {
      console.error('[AddMealForm]', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <input type="text" className="crm-input" placeholder="שם הארוחה" value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ flex: '1 1 140px' }} />
      <input type="text" className="crm-input" placeholder="שעה (אופציונלי)" value={timeLabel} onChange={(e) => setTimeLabel(e.target.value)} style={{ flex: '1 1 120px' }} />
      <button type="submit" className="crm-btn crm-btn--primary" disabled={saving}>{saving ? 'מוסיף...' : 'הוסף'}</button>
      <button type="button" className="crm-btn" onClick={onDone}>ביטול</button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MenuEditor() {
  const { clientId, menuId } = useParams();
  const queryClient = useQueryClient();

  const [itemModal, setItemModal]     = useState(null); // null | { mealId, item? }
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['menu', String(menuId)],
    queryFn:  () => fetchMenu(menuId),
  });

  const menu  = data?.menu;
  const meals = data?.meals ?? [];

  const generateMut = useMutation({
    mutationFn: () => generateMenu(menuId),
    onSuccess: () => {
      setGenerateError('');
      queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] });
    },
    onError: (err) => setGenerateError(err.message),
  });

  const finalizeMut = useMutation({
    mutationFn: () => finalizeMenu(menuId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu', String(menuId)] }),
  });

  // ── Loading / error states ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="crm-page" dir="rtl" style={{ maxWidth: 800 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl" style={{ height: 100, background: 'var(--surface-3)', marginBottom: 14 }} />
        ))}
      </div>
    );
  }

  if (isError || !menu) {
    return (
      <div className="crm-page" dir="rtl" style={{ maxWidth: 800 }}>
        <p style={{ color: 'var(--red-ink)', fontSize: 13 }}>שגיאה בטעינת התפריט.</p>
        <Link to={`/clients/${clientId}`} className="back" style={{ marginTop: 8 }}>חזרה ללקוח</Link>
      </div>
    );
  }

  const isDraft   = menu.status === 'draft';
  const nextOrder = meals.length > 0 ? Math.max(...meals.map((m) => m.meal_order)) + 1 : 0;

  return (
    <div className="crm-page" dir="rtl" style={{ maxWidth: 800 }}>

      {/* Back link */}
      <Link to={`/clients/${clientId}`} className="back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
          <path d="M9 18l6-6-6-6"/>
        </svg>
        חזרה ללקוח
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, margin: '16px 0 8px' }}>
        <div style={{ flex: 1 }}>
          <InlineTitle menuId={menuId} initialValue={menu.title} />
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            יעד קלורי: <strong>{menu.calorie_target}</strong> קק&quot;ל
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, flexShrink: 0, marginTop: 4 }}
          className={isDraft ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}>
          {isDraft ? 'טיוטה' : 'סופי'}
        </span>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, padding: '12px 0', borderBottom: '1px solid var(--hairline)' }}>
        <button
          type="button"
          className="crm-btn crm-btn--primary"
          onClick={() => { setGenerateError(''); generateMut.mutate(); }}
          disabled={generateMut.isPending}
        >
          {generateMut.isPending ? (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>
              מייצר תפריט...
            </>
          ) : '🤖 צור תפריט אוטומטי'}
        </button>

        {isDraft && (
          <button
            type="button"
            className="crm-btn"
            onClick={() => finalizeMut.mutate()}
            disabled={finalizeMut.isPending}
            style={{ color: 'var(--green)' }}
          >
            {finalizeMut.isPending ? 'מאשר...' : '✓ אשר תפריט'}
          </button>
        )}

        <button type="button" className="crm-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
          ייצא PDF
        </button>
      </div>

      {generateError && (
        <p style={{ fontSize: 12, color: 'var(--red-ink)', marginBottom: 12, padding: '8px 12px', background: '#fff5f5', borderRadius: 8, border: '1px solid #fecaca' }}>
          שגיאה: {generateError}
        </p>
      )}

      {/* Meals list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {meals.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '32px 0' }}>
            אין ארוחות בתפריט. לחץ &ldquo;צור תפריט אוטומטי&rdquo; או הוסף ארוחה ידנית.
          </p>
        )}

        {[...meals]
          .sort((a, b) => a.meal_order - b.meal_order || a.id - b.id)
          .map((meal) => (
            <MealCard
              key={meal.id}
              menu={menu}
              meal={meal}
              allMeals={meals}
              onAddItem={(mealId) => setItemModal({ mealId })}
              onEditItem={(mealId, item) => setItemModal({ mealId, item })}
            />
          ))}

        {showAddMeal ? (
          <AddMealForm menuId={menuId} nextOrder={nextOrder} onDone={() => setShowAddMeal(false)} />
        ) : (
          <button
            type="button"
            className="crm-btn"
            onClick={() => setShowAddMeal(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            + הוסף ארוחה
          </button>
        )}
      </div>

      {/* Item modal */}
      {itemModal && (
        <ItemModal
          menuId={menuId}
          mealId={itemModal.mealId}
          existingItem={itemModal.item ?? null}
          onClose={() => setItemModal(null)}
        />
      )}
    </div>
  );
}
