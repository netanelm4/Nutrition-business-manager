import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchFoodCategories, fetchFoodItems, fetchFoodMacro,
  createFoodItem, updateFoodItem, deleteFoodItem,
} from '../lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const MACRO_ORDER  = ['protein', 'carb', 'fat', 'vegetable', 'fruit'];
const MACRO_LABELS = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירקות', fruit: 'פירות' };

const EMPTY_FORM = {
  name_he: '', portion_description: '', portion_grams: '',
  calories_per_half_portion: '', protein_grams: '', notes: '',
};

const inputCls = 'w-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';

// ── Inline form row (add or edit) ─────────────────────────────────────────────

function FormRow({ form, onChange, onSave, onCancel, isPending }) {
  return (
    <tr style={{ background: 'var(--blue-soft, #eff6ff)' }}>
      <td style={{ padding: '6px 8px' }}>
        <input
          className={inputCls}
          placeholder="שם המזון *"
          value={form.name_he}
          onChange={(e) => onChange('name_he', e.target.value)}
          autoFocus
        />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <input
          className={inputCls}
          placeholder="כמות"
          value={form.portion_description}
          onChange={(e) => onChange('portion_description', e.target.value)}
        />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <input
          className={inputCls}
          type="number" min="0" placeholder="גרם"
          value={form.portion_grams}
          onChange={(e) => onChange('portion_grams', e.target.value)}
          style={{ width: 72 }}
        />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <input
          className={inputCls}
          type="number" min="0" placeholder="קק״ל"
          value={form.calories_per_half_portion}
          onChange={(e) => onChange('calories_per_half_portion', e.target.value)}
          style={{ width: 72 }}
        />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <input
          className={inputCls}
          type="number" min="0" step="0.1" placeholder="חלבון"
          value={form.protein_grams}
          onChange={(e) => onChange('protein_grams', e.target.value)}
          style={{ width: 72 }}
        />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <input
          className={inputCls}
          placeholder="הערה"
          value={form.notes}
          onChange={(e) => onChange('notes', e.target.value)}
        />
      </td>
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || !form.name_he.trim()}
          className="crm-btn crm-btn--primary crm-btn--sm"
          style={{ marginInlineEnd: 6 }}
        >
          {isPending ? '...' : 'שמור'}
        </button>
        <button type="button" onClick={onCancel} className="crm-btn crm-btn--sm">
          ביטול
        </button>
      </td>
    </tr>
  );
}

// ── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onEdit, onDelete, confirmDeleteId, onConfirmDelete, onCancelDelete }) {
  const isConfirming = confirmDeleteId === item.id;

  return (
    <tr style={{ borderBottom: '1px solid var(--hairline, #f0f0f0)' }}>
      <td style={{ padding: '8px 10px', fontWeight: 500, fontSize: 14 }}>{item.name_he}</td>
      <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink-2, #444)' }}>{item.portion_description || '—'}</td>
      <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'center' }}>{item.portion_grams ?? '—'}</td>
      <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'center', fontWeight: 600 }}>{item.calories_per_half_portion ?? '—'}</td>
      <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'center' }}>{item.protein_grams ?? '—'}</td>
      <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--ink-3, #888)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.notes || ''}
      </td>
      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
        {isConfirming ? (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={() => onConfirmDelete(item.id)} className="crm-btn crm-btn--sm" style={{ color: 'var(--red-ink, #b91c1c)' }}>
              אשר מחיקה
            </button>
            <button type="button" onClick={onCancelDelete} className="crm-btn crm-btn--sm">ביטול</button>
          </span>
        ) : (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={() => onEdit(item)} className="crm-btn crm-btn--sm">עריכה</button>
            <button type="button" onClick={() => onDelete(item.id)} className="crm-btn crm-btn--sm" style={{ color: 'var(--ink-3, #888)' }}>
              מחק
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function FoodBank() {
  const queryClient = useQueryClient();

  const [selectedId,      setSelectedId]      = useState(null);
  const [selectedMacro,   setSelectedMacro]   = useState(null);
  const [addOpen,         setAddOpen]         = useState(false);
  const [editingId,       setEditingId]       = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [addForm,         setAddForm]         = useState(EMPTY_FORM);
  const [editForm,        setEditForm]        = useState(EMPTY_FORM);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: categories = [], isLoading: catsLoading } = useQuery({
    queryKey: ['food-categories'],
    queryFn: fetchFoodCategories,
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['food-items', selectedId],
    queryFn: () => fetchFoodItems(selectedId),
    enabled: !!selectedId,
  });

  const { data: macroData, isLoading: macroLoading } = useQuery({
    queryKey: ['food-macro', selectedMacro],
    queryFn: () => fetchFoodMacro(selectedMacro),
    enabled: !!selectedMacro,
  });

  // ── Derived: grouped categories ──────────────────────────────────────────────

  const grouped = MACRO_ORDER.reduce((acc, type) => {
    acc[type] = categories.filter((c) => c.nutrient_type === type);
    return acc;
  }, {});

  const selectedCategory = categories.find((c) => c.id === selectedId);

  // ── Mutations ────────────────────────────────────────────────────────────────

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['food-items', selectedId] });
    queryClient.invalidateQueries({ queryKey: ['food-categories'] });
  }

  function toPayload(form) {
    return {
      category_id:               selectedId,
      name_he:                   form.name_he.trim(),
      portion_description:       form.portion_description.trim() || null,
      portion_grams:             form.portion_grams !== '' ? Number(form.portion_grams) : null,
      calories_per_half_portion: form.calories_per_half_portion !== '' ? Number(form.calories_per_half_portion) : null,
      protein_grams:             form.protein_grams !== '' ? Number(form.protein_grams) : null,
      notes:                     form.notes.trim() || null,
    };
  }

  const createMutation = useMutation({
    mutationFn: (data) => createFoodItem(data),
    onSuccess: () => { invalidate(); setAddOpen(false); setAddForm(EMPTY_FORM); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateFoodItem(id, data),
    onSuccess: () => { invalidate(); setEditingId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteFoodItem(id),
    onSuccess: () => { invalidate(); setConfirmDeleteId(null); },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function startEdit(item) {
    setAddOpen(false);
    setEditingId(item.id);
    setEditForm({
      name_he:                   item.name_he ?? '',
      portion_description:       item.portion_description ?? '',
      portion_grams:             item.portion_grams ?? '',
      calories_per_half_portion: item.calories_per_half_portion ?? '',
      protein_grams:             item.protein_grams ?? '',
      notes:                     item.notes ?? '',
    });
  }

  function cancelEdit() { setEditingId(null); }

  function handleAddField(key, val)  { setAddForm((f) => ({ ...f, [key]: val })); }
  function handleEditField(key, val) { setEditForm((f) => ({ ...f, [key]: val })); }

  function selectCategory(id) {
    setSelectedId(id);
    setSelectedMacro(null);
    setAddOpen(false);
    setEditingId(null);
    setConfirmDeleteId(null);
  }

  function selectMacro(type) {
    setSelectedMacro(type);
    setSelectedId(null);
    setAddOpen(false);
    setEditingId(null);
    setConfirmDeleteId(null);
  }

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError,   setPdfError]   = useState(null);

  async function handleExportPdf() {
    if ((!selectedId && !selectedMacro) || pdfLoading) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const url = selectedMacro
        ? `/api/food-bank/pdf/macro/${selectedMacro}`
        : `/api/food-bank/pdf/${selectedId}`;
      const filename = selectedMacro
        ? `מאגר ${MACRO_LABELS[selectedMacro]}.pdf`
        : `${selectedCategory?.name_he ?? 'מאגר-מזון'}.pdf`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_password') || ''}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `שגיאה ${res.status}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error('[exportPdf]', err);
      setPdfError(err.message);
    } finally {
      setPdfLoading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="crm-page" style={{ display: 'flex', flexDirection: 'row', gap: 0, height: '100%', minHeight: 0 }}>

      {/* ── Main content ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 20px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>מאגר מזון</h1>
            {selectedCategory && (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{selectedCategory.name_he}</p>
            )}
            {selectedMacro && (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
                {`מאגר ${MACRO_LABELS[selectedMacro]} — כל הקטגוריות`}
              </p>
            )}
          </div>
          {(selectedId || selectedMacro) && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="crm-btn"
                  onClick={handleExportPdf}
                  disabled={pdfLoading}
                >
                  {pdfLoading ? 'מייצא...' : 'ייצא PDF'}
                </button>
                {selectedId && !addOpen && (
                  <button
                    type="button"
                    className="crm-btn crm-btn--primary"
                    onClick={() => { setAddOpen(true); setEditingId(null); setAddForm(EMPTY_FORM); }}
                  >
                    + הוסף פריט
                  </button>
                )}
              </div>
              {pdfError && (
                <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{pdfError}</span>
              )}
            </div>
          )}
        </div>

        {/* No selection */}
        {!selectedId && !selectedMacro && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>
            בחר קטגוריה מהרשימה בצד ימין
          </div>
        )}

        {/* Macro view — all sub-categories grouped */}
        {selectedMacro && (
          <div>
            {macroLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse" style={{ height: 36, background: 'var(--surface-2, #f5f5f5)', borderRadius: 6 }} />
                ))}
              </div>
            ) : (macroData?.categories ?? []).map((cat) => (
              <div key={cat.id} style={{ marginBottom: 28 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--blue, #567DBF)',
                  padding: '8px 12px', background: 'var(--blue-soft, #eff6ff)',
                  borderRadius: '8px 8px 0 0', border: '1px solid var(--hairline, #f0f0f0)',
                  borderBottom: 'none',
                }}>
                  {cat.name_he}
                </div>
                <div style={{ background: 'white', borderRadius: '0 0 12px 12px', border: '1px solid var(--hairline, #f0f0f0)', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2, #f8f8f8)', borderBottom: '1px solid var(--hairline, #f0f0f0)' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>שם</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>כמות (חצי מנה)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>גרמים</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>קק״ל</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>חלבון (ג׳)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>הערות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.items.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                            אין פריטים
                          </td>
                        </tr>
                      ) : cat.items.map((item) => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--hairline, #f0f0f0)' }}>
                          <td style={{ padding: '8px 10px' }}>{item.name_he}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--ink-2)' }}>{item.portion_description ?? '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--ink-2)' }}>{item.portion_grams ?? '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>{item.calories_per_half_portion ?? '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--ink-2)' }}>{item.protein_grams ?? '—'}</td>
                          <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--ink-3)' }}>{item.notes ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Items table */}
        {selectedId && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--hairline, #f0f0f0)', overflow: 'hidden' }}>
            {itemsLoading ? (
              <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse" style={{ height: 36, background: 'var(--surface-2, #f5f5f5)', borderRadius: 6 }} />
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2, #f8f8f8)', borderBottom: '1px solid var(--hairline, #f0f0f0)' }}>
                      <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>שם</th>
                      <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>כמות (חצי מנה)</th>
                      <th style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>גרמים</th>
                      <th style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>קק״ל</th>
                      <th style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>חלבון (ג׳)</th>
                      <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--ink-2)' }}>הערות</th>
                      <th style={{ padding: '10px 10px', width: 140 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Add row */}
                    {addOpen && (
                      <FormRow
                        form={addForm}
                        onChange={handleAddField}
                        onSave={() => createMutation.mutate(toPayload(addForm))}
                        onCancel={() => { setAddOpen(false); setAddForm(EMPTY_FORM); }}
                        isPending={createMutation.isPending}
                      />
                    )}

                    {/* Empty state */}
                    {!addOpen && items.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                          אין פריטים בקטגוריה זו
                        </td>
                      </tr>
                    )}

                    {/* Item rows */}
                    {items.map((item) =>
                      editingId === item.id ? (
                        <FormRow
                          key={item.id}
                          form={editForm}
                          onChange={handleEditField}
                          onSave={() => updateMutation.mutate({ id: item.id, data: toPayload(editForm) })}
                          onCancel={cancelEdit}
                          isPending={updateMutation.isPending}
                        />
                      ) : (
                        <ItemRow
                          key={item.id}
                          item={item}
                          onEdit={startEdit}
                          onDelete={(id) => { setConfirmDeleteId(id); setEditingId(null); }}
                          confirmDeleteId={confirmDeleteId}
                          onConfirmDelete={(id) => deleteMutation.mutate(id)}
                          onCancelDelete={() => setConfirmDeleteId(null)}
                        />
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right sidebar: categories ─────────────────────────────────────────── */}
      <aside style={{
        width: 232, flexShrink: 0, borderInlineStart: '1px solid var(--hairline, #f0f0f0)',
        overflowY: 'auto', padding: '20px 0',
        background: 'var(--surface-1, #fafafa)',
      }}>
        {catsLoading ? (
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse" style={{ height: 32, background: 'var(--surface-2)', borderRadius: 6 }} />
            ))}
          </div>
        ) : (
          MACRO_ORDER.map((type) => {
            const cats = grouped[type];
            if (!cats?.length) return null;
            const isMacroActive = selectedMacro === type;
            return (
              <div key={type} style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => selectMacro(type)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'right',
                    padding: '4px 16px 6px', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: isMacroActive ? 'var(--blue, #567DBF)' : 'var(--ink-3)',
                    background: isMacroActive ? 'var(--blue-soft, #eff6ff)' : 'transparent',
                    borderInlineStart: isMacroActive ? '3px solid var(--blue, #567DBF)' : '3px solid transparent',
                    transition: 'background 0.12s',
                  }}
                >
                  {MACRO_LABELS[type]}
                </button>
                {cats.map((cat) => {
                  const isActive = cat.id === selectedId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => selectCategory(cat.id)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '7px 16px', border: 'none', cursor: 'pointer',
                        textAlign: 'right', fontSize: 13, fontWeight: isActive ? 600 : 400,
                        background: isActive ? 'var(--blue-soft, #eff6ff)' : 'transparent',
                        color: isActive ? 'var(--blue-ink, #1d4ed8)' : 'var(--ink-1)',
                        borderInlineStart: isActive ? '3px solid var(--blue, #567DBF)' : '3px solid transparent',
                        transition: 'background 0.12s',
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat.name_he}
                      </span>
                      <span style={{
                        flexShrink: 0, marginInlineStart: 6,
                        fontSize: 11, fontWeight: 600, padding: '1px 7px',
                        borderRadius: 99, background: isActive ? 'var(--blue, #567DBF)' : 'var(--surface-3, #e8e8e8)',
                        color: isActive ? 'white' : 'var(--ink-3)',
                      }}>
                        {cat.item_count}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </aside>
    </div>
  );
}
