import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const BASE = '/api';

async function apiGet(path) {
  const res  = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'שגיאה');
  return json.data;
}

async function apiPost(path, body) {
  const res  = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'שגיאה');
  return json.data;
}

async function apiDelete(path) {
  const res  = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'שגיאה');
  return json.data;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MACRO_LABELS = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירקות', fruit: 'פירות' };

const MACRO_PORTION_LABELS = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירק', fruit: 'פרי' };

const MACRO_COLORS = {
  protein:   { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
  carb:      { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  fat:       { bg: '#fefce8', border: '#fde047', text: '#854d0e' },
  vegetable: { bg: '#f0fdf4', border: '#6ee7b7', text: '#047857' },
  fruit:     { bg: '#fdf4ff', border: '#d8b4fe', text: '#7e22ce' },
};

const EMPTY_FOOD   = { name: '', kcal100: '', protein100: '', fat100: '', carb100: '' };
const EMPTY_RECIPE = { name: '', servings: 1, description: '' };

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid #e5e7eb', fontSize: 14, outline: 'none',
  background: 'white', boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function MacroBadge({ type }) {
  if (!type) return null;
  const c = MACRO_COLORS[type] || { bg: '#f5f5f5', border: '#e5e5e5', text: '#555' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, flexShrink: 0,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>
      {MACRO_LABELS[type] ?? type}
    </span>
  );
}

// ─── Star button ──────────────────────────────────────────────────────────────

function StarBtn({ favorited, onClick, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={favorited || loading}
      title={favorited ? 'נשמר במועדפים' : 'הוסף למועדפים'}
      style={{
        background: 'none', border: 'none', cursor: favorited ? 'default' : 'pointer',
        fontSize: 18, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
        opacity: loading ? 0.5 : 1,
      }}
    >
      {favorited ? '⭐' : '☆'}
    </button>
  );
}

// ─── Food result card (shared between search + favorites) ─────────────────────

function FoodCard({ item, favorited, onStar, onRemove }) {
  const isOfa      = !!item.ofa_product_name || item.source === 'ofa';
  const name       = isOfa ? (item.ofa_product_name || item.name) : item.name_he;
  const macro      = isOfa ? (item.ofa_macro_type || item.macro_type) : item.macro_type;
  const kcal       = isOfa ? (item.ofa_kcal_100g    ?? item.kcal100)    : item.calories;
  const protein    = isOfa ? (item.ofa_protein_100g ?? item.protein100) : item.protein_grams;
  const portionG   = isOfa ? item.portionGrams     : item.portion_grams;
  const categoryN  = isOfa ? null                  : item.category_name;
  const kcalLabel  = isOfa ? `${kcal} קק״ל/100ג׳`  : (kcal != null ? `${kcal} קק״ל למנה` : null);
  const portionLine = portionG && macro
    ? `${portionG} גרם = מנת ${MACRO_PORTION_LABELS[macro] ?? macro} 1`
    : null;

  return (
    <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fafafa', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }} dir="auto">{name}</div>
          {categoryN && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{categoryN}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <MacroBadge type={macro} />
          {onStar   && <StarBtn favorited={favorited} onClick={onStar} />}
          {onRemove && (
            <button
              type="button" onClick={onRemove}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 18, padding: '2px 4px' }}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {portionLine && (
        <div style={{ marginTop: 6, fontSize: 13, color: '#567DBF', fontWeight: 500 }}>{portionLine}</div>
      )}
      <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kcalLabel  && <span style={{ fontSize: 12, color: '#555' }}>{kcalLabel}</span>}
        {protein != null && protein > 0 && (
          <span style={{ fontSize: 12, color: '#555' }}>{protein}ג׳ חלבון{isOfa ? '/100ג׳' : ''}</span>
        )}
      </div>
    </div>
  );
}

// ─── Section 1 — Food Search ──────────────────────────────────────────────────

function FoodSearchSection({ token, favorites, onStar }) {
  const [query,      setQuery]      = useState('');
  const [dbResults,  setDbResults]  = useState(null);
  const [ofaResults, setOfaResults] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const timerRef = useRef(null);

  const favDbIds   = new Set((favorites || []).filter((f) => f.food_item_id).map((f) => f.food_item_id));
  const favOfaNames = new Set((favorites || []).filter((f) => f.ofa_product_name).map((f) => f.ofa_product_name));

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setDbResults(null); setOfaResults(null); return; }
    timerRef.current = setTimeout(() => doSearch(val.trim()), 300);
  }

  async function doSearch(q) {
    setLoading(true);
    setError(null);
    setOfaResults(null);
    try {
      const result = await apiGet(`/public/foods/search?q=${encodeURIComponent(q)}&token=${token}`);
      const items  = result?.items ?? [];
      const ofa    = result?.ofaResults ?? [];
      setDbResults(items);
      setOfaResults(ofa.length > 0 ? ofa : null);
    } catch (err) {
      setError(err.message || 'שגיאה בחיפוש');
      setDbResults([]);
    }
    setLoading(false);
  }

  const noResults = dbResults !== null && dbResults.length === 0 && !ofaResults;

  return (
    <section>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        חפשו מזון לפי שם — תראו אם הוא מתאים לתפריט שלכם
      </p>
      <div style={{ position: 'relative', maxWidth: 480 }}>
        <input
          type="text" value={query} onChange={handleChange}
          placeholder="שם המזון..." style={inputStyle} dir="auto" autoFocus
        />
        {loading && (
          <span style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#999' }}>
            מחפש...
          </span>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>{error}</p>}

      {dbResults !== null && (
        <div style={{ marginTop: 12 }}>
          {noResults ? (
            <p style={{ fontSize: 13, color: '#888' }}>לא נמצאו תוצאות</p>
          ) : (
            <>
              {dbResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: ofaResults ? 16 : 0 }}>
                  {dbResults.map((item) => (
                    <FoodCard
                      key={item.id}
                      item={item}
                      favorited={favDbIds.has(item.id)}
                      onStar={() => onStar({ food_item_id: item.id })}
                    />
                  ))}
                </div>
              )}

              {ofaResults && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8, display: 'flex', gap: 8 }}>
                    <span>מהמאגר הבינלאומי</span>
                    <span style={{ fontWeight: 400, color: '#aaa' }}>Open Food Facts</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ofaResults.map((item, i) => (
                      <FoodCard
                        key={i}
                        item={item}
                        favorited={favOfaNames.has(item.name)}
                        onStar={() => onStar({
                          ofa_product_name: item.name,
                          ofa_kcal_100g:    item.kcal100,
                          ofa_protein_100g: item.protein100,
                          ofa_macro_type:   item.macro_type,
                        })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Section 2 — Add New Food ─────────────────────────────────────────────────

function AddFoodSection({ token }) {
  const [form,    setForm]    = useState(EMPTY_FOOD);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  function setField(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost('/public/foods/submit', {
        token,
        name_he:           form.name.trim(),
        calories_per_100g: form.kcal100    || null,
        protein_per_100g:  form.protein100 || null,
        fat_per_100g:      form.fat100     || null,
        carb_per_100g:     form.carb100    || null,
      });
      setSuccess(true);
      setForm(EMPTY_FOOD);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        מצאתם מזון שאתם אוכלים ולא קיים בתפריט? שלחו לנו ונבדוק האם להוסיף אותו.
      </p>

      {success && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 14, color: '#15803d', marginBottom: 12 }}>
          תודה! המזון נשלח לאישור הדיאטן 🙏🏽
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <div>
          <label style={labelStyle}>שם המזון *</label>
          <input
            type="text" required value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="למשל: גבינה צהובה 28%"
            style={inputStyle} dir="auto"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>קלוריות ל-100 גרם</label>
            <input type="number" min="0" value={form.kcal100}
              onChange={(e) => setField('kcal100', e.target.value)}
              placeholder="קק״ל" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>חלבון ל-100 גרם (ג׳)</label>
            <input type="number" min="0" step="0.1" value={form.protein100}
              onChange={(e) => setField('protein100', e.target.value)}
              placeholder="גרם" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>שומן ל-100 גרם (ג׳)</label>
            <input type="number" min="0" step="0.1" value={form.fat100}
              onChange={(e) => setField('fat100', e.target.value)}
              placeholder="גרם" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>פחמימות ל-100 גרם (ג׳)</label>
            <input type="number" min="0" step="0.1" value={form.carb100}
              onChange={(e) => setField('carb100', e.target.value)}
              placeholder="גרם" style={inputStyle} />
          </div>
        </div>

        {error && <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p>}

        <button
          type="submit"
          disabled={loading || !form.name.trim()}
          style={{
            padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#567DBF', color: 'white', fontWeight: 600, fontSize: 14,
            opacity: (loading || !form.name.trim()) ? 0.6 : 1,
            alignSelf: 'flex-start',
          }}
        >
          {loading ? 'שולח...' : 'שלח הצעה'}
        </button>
      </form>
    </section>
  );
}

// ─── Section 3 — Recipe Bank ──────────────────────────────────────────────────

function RecipeBankSection({ token }) {
  const [openId, setOpenId] = useState(null);

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['public-recipes', token],
    queryFn:  () => apiGet(`/public/recipes?token=${token}`),
  });

  if (isLoading) return <p style={{ fontSize: 13, color: '#888' }}>טוען מתכונים...</p>;
  if (recipes.length === 0) return <p style={{ fontSize: 13, color: '#888' }}>עדיין אין מתכונים במאגר.</p>;

  return (
    <section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recipes.map((r) => {
          const isOpen = openId === r.id;
          return (
            <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : r.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer',
                  background: isOpen ? '#f0f9ff' : 'white', textAlign: 'right', gap: 12,
                  borderBottom: isOpen ? '1px solid #e0f2fe' : 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#111', marginBottom: 2 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: '#888', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {r.servings > 1 && <span>{r.servings} מנות</span>}
                    {r.calories_per_serving != null && <span>{r.calories_per_serving} קק״ל / מנה</span>}
                    {r.protein_per_serving  != null && <span>{r.protein_per_serving}ג׳ חלבון / מנה</span>}
                  </div>
                </div>
                <span style={{ fontSize: 13, color: '#567DBF', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {r.ingredients?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#aaa', marginBottom: 6 }}>רכיבים</div>
                      {r.ingredients.map((ing, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f5f5f5', color: '#333' }}>
                          <span>{ing.custom_food_name || ing.name_he || '—'}</span>
                          <span style={{ color: '#888' }}>{ing.amount_grams}ג׳</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {r.description && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#aaa', marginBottom: 6 }}>אופן הכנה</div>
                      <p style={{ fontSize: 13, color: '#333', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{r.description}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Section 5 — Favorites ────────────────────────────────────────────────────

function FavoritesSection({ token, favorites, isLoading, onRemove }) {
  if (isLoading) return <p style={{ fontSize: 13, color: '#888' }}>טוען מועדפים...</p>;
  if (!favorites || favorites.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>☆</div>
        <p style={{ fontSize: 14, color: '#888' }}>עדיין לא הוספת מזונות מועדפים</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>לחצו על ☆ ליד כל מזון בחיפוש כדי לשמור אותו כאן</p>
      </div>
    );
  }

  return (
    <section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {favorites.map((fav) => (
          <FoodCard
            key={fav.id}
            item={fav}
            onRemove={() => onRemove(fav.id)}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Ingredient search autocomplete (DB + OFA fallback) ───────────────────────

function IngredientSearch({ token, onSelect }) {
  const [q,          setQ]          = useState('');
  const [dbResults,  setDbResults]  = useState([]);
  const [ofaResults, setOfaResults] = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [open,       setOpen]       = useState(false);
  const timerRef = useRef(null);
  const wrapRef  = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQ(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setDbResults([]); setOfaResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result   = await apiGet(`/public/foods/search?q=${encodeURIComponent(val.trim())}&token=${token}`);
        const dbSliced = (result?.items ?? []).slice(0, 8);
        setDbResults(dbSliced);
        setOfaResults(result?.ofaResults ?? []);
        setOpen(true);
      } catch {}
      setLoading(false);
    }, 300);
  }

  function select(item) {
    onSelect(item);
    setQ('');
    setDbResults([]);
    setOfaResults([]);
    setOpen(false);
  }

  const hasResults = dbResults.length > 0 || ofaResults.length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text" value={q} onChange={handleChange}
        placeholder="הקלידו שם רכיב לחיפוש..." style={inputStyle} dir="auto"
      />
      {loading && (
        <span style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#aaa' }}>
          מחפש...
        </span>
      )}
      {open && hasResults && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', insetInlineStart: 0, insetInlineEnd: 0,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginTop: 4, overflow: 'hidden', maxHeight: 320, overflowY: 'auto',
        }}>
          {dbResults.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select({ source: 'db', ...item })}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '9px 12px', border: 'none', background: 'transparent',
                cursor: 'pointer', textAlign: 'right', borderBottom: '1px solid #f5f5f5', gap: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f0f9ff'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: '#111', flex: 1, minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {item.name_he}
              </span>
              <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>
                {item.calories != null ? `${item.calories} קק״ל/מנה` : ''}
              </span>
            </button>
          ))}

          {ofaResults.length > 0 && (
            <>
              <div style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#aaa', background: '#f9fafb', borderBottom: '1px solid #f0f0f0' }}>
                מהמאגר הבינלאומי
              </div>
              {ofaResults.map((item, i) => (
                <button
                  key={`ofa-${i}`}
                  type="button"
                  onClick={() => select(item)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '9px 12px', border: 'none', background: 'transparent',
                    cursor: 'pointer', textAlign: 'right', borderBottom: '1px solid #f5f5f5', gap: 8,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f9ff'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#444', flex: 1, minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} dir="auto">
                    {item.name}
                  </span>
                  <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>
                    {item.kcal100} קק״ל/100ג׳
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section 4 — Add Recipe ───────────────────────────────────────────────────

const EMPTY_MANUAL_ING = { name: '', kcal100: '', protein100: '', grams: 100 };

function AddRecipeSection({ token, onSuccess }) {
  const queryClient = useQueryClient();
  const [form,        setForm]        = useState(EMPTY_RECIPE);
  const [ingredients, setIngredients] = useState([]);
  const [ingMode,     setIngMode]     = useState('db');
  const [manualIng,   setManualIng]   = useState(EMPTY_MANUAL_ING);
  const [error,       setError]       = useState(null);
  const [loading,     setLoading]     = useState(false);

  function setField(key, val)       { setForm((f) => ({ ...f, [key]: val })); }
  function setManualField(key, val) { setManualIng((f) => ({ ...f, [key]: val })); }

  function addIngredient(item) {
    if (item.source === 'ofa') {
      setIngredients((prev) => [...prev, {
        type: 'manual', food_item_id: null,
        name_he: item.name,
        amount_grams: 100,
        kcal100:    item.kcal100    ?? 0,
        protein100: item.protein100 ?? 0,
        calories_per_portion: 0, protein_per_portion: 0, portion_grams: 0,
      }]);
    } else {
      setIngredients((prev) => [...prev, {
        type: 'db', food_item_id: item.id,
        name_he: item.name_he,
        amount_grams: 100,
        calories_per_portion: item.calories      ?? 0,
        protein_per_portion:  item.protein_grams ?? 0,
        portion_grams:        item.portion_grams ?? 100,
        kcal100: 0, protein100: 0,
      }]);
    }
  }

  function addManual() {
    if (!manualIng.name.trim()) return;
    setIngredients((prev) => [...prev, {
      type: 'manual', food_item_id: null,
      name_he:      manualIng.name.trim(),
      amount_grams: Number(manualIng.grams) || 100,
      kcal100:      Number(manualIng.kcal100)    || 0,
      protein100:   Number(manualIng.protein100) || 0,
      calories_per_portion: 0, protein_per_portion: 0, portion_grams: 0,
    }]);
    setManualIng(EMPTY_MANUAL_ING);
  }

  function updateAmount(idx, val) {
    setIngredients((prev) => prev.map((ing, i) => i === idx ? { ...ing, amount_grams: Number(val) || 0 } : ing));
  }

  function removeIngredient(idx) {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  function ingKcal(ing) {
    if (ing.type === 'db') {
      return ing.portion_grams > 0 ? Math.round((ing.amount_grams / ing.portion_grams) * ing.calories_per_portion) : 0;
    }
    return Math.round((ing.amount_grams / 100) * ing.kcal100);
  }

  function ingProtein(ing) {
    if (ing.type === 'db') {
      return ing.portion_grams > 0 ? Math.round((ing.amount_grams / ing.portion_grams) * ing.protein_per_portion * 10) / 10 : 0;
    }
    return Math.round((ing.amount_grams / 100) * ing.protein100 * 10) / 10;
  }

  const totalKcal    = ingredients.reduce((s, ing) => s + ingKcal(ing), 0);
  const totalProtein = ingredients.reduce((s, ing) => s + ingProtein(ing), 0);
  const servings     = Number(form.servings) || 1;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost('/public/recipes', {
        token,
        name:        form.name.trim(),
        description: form.description.trim() || null,
        servings:    Number(form.servings) || 1,
        ingredients: ingredients.map((ing) => ({
          food_item_id:     ing.type === 'db' ? ing.food_item_id : null,
          custom_food_name: ing.name_he,
          amount_grams:     ing.amount_grams,
        })),
      });
      setForm(EMPTY_RECIPE);
      setIngredients([]);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['public-recipes', token] });
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
          <div>
            <label style={labelStyle}>שם המתכון *</label>
            <input
              type="text" required value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="למשל: סלט חומוס ביתי"
              style={inputStyle} dir="auto"
            />
          </div>
          <div>
            <label style={labelStyle}>מנות</label>
            <input
              type="number" min="1" value={form.servings}
              onChange={(e) => setField('servings', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label style={labelStyle}>אופן הכנה (אופציונלי)</label>
          <textarea
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder="תארו את שלבי ההכנה..."
            rows={3} dir="auto"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={labelStyle}>רכיבים</label>
            <button
              type="button"
              onClick={() => setIngMode((m) => m === 'db' ? 'manual' : 'db')}
              style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid #567DBF', background: 'white', color: '#567DBF', fontWeight: 600,
              }}
            >
              {ingMode === 'db' ? 'הוסף מזון ידנית' : 'הוסף מהמאגר'}
            </button>
          </div>

          {ingMode === 'db' ? (
            <IngredientSearch token={token} onSelect={addIngredient} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
              <div>
                <label style={labelStyle}>שם המזון</label>
                <input type="text" value={manualIng.name}
                  onChange={(e) => setManualField('name', e.target.value)}
                  placeholder="למשל: שמן זית" style={inputStyle} dir="auto" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>קק״ל/100ג׳</label>
                  <input type="number" min="0" value={manualIng.kcal100}
                    onChange={(e) => setManualField('kcal100', e.target.value)}
                    placeholder="קק״ל" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>חלבון/100ג׳</label>
                  <input type="number" min="0" step="0.1" value={manualIng.protein100}
                    onChange={(e) => setManualField('protein100', e.target.value)}
                    placeholder="גרם" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>כמות (גרם)</label>
                  <input type="number" min="1" value={manualIng.grams}
                    onChange={(e) => setManualField('grams', e.target.value)}
                    style={inputStyle} />
                </div>
              </div>
              <button
                type="button" onClick={addManual} disabled={!manualIng.name.trim()}
                style={{
                  alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 6, border: 'none',
                  background: '#567DBF', color: 'white', fontWeight: 600, fontSize: 13,
                  cursor: manualIng.name.trim() ? 'pointer' : 'not-allowed',
                  opacity: manualIng.name.trim() ? 1 : 0.5,
                }}
              >
                הוסף
              </button>
            </div>
          )}
        </div>

        {ingredients.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6 }}>רכיבים שנוספו</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ingredients.map((ing, idx) => {
                const kcal = ingKcal(ing);
                return (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '7px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb',
                  }}>
                    <span style={{ flex: 1, minWidth: 80, fontSize: 13, fontWeight: 500, color: '#111' }}>
                      {ing.name_he}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <input
                        type="number" min="1" value={ing.amount_grams}
                        onChange={(e) => updateAmount(idx, e.target.value)}
                        style={{ width: 64, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, textAlign: 'center' }}
                      />
                      <span style={{ fontSize: 12, color: '#888' }}>ג׳</span>
                    </div>
                    {kcal > 0 && <span style={{ fontSize: 11, color: '#888', minWidth: 54 }}>{kcal} קק״ל</span>}
                    <button
                      type="button" onClick={() => removeIngredient(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{
              marginTop: 10, padding: '10px 14px', borderRadius: 8,
              background: '#eff6ff', border: '1px solid #bfdbfe',
              fontSize: 13, color: '#1e40af', display: 'flex', gap: 16, flexWrap: 'wrap',
            }}>
              <span>סה״כ: <strong>{Math.round(totalKcal)} קק״ל</strong></span>
              <span><strong>{Math.round(totalProtein * 10) / 10}ג׳</strong> חלבון</span>
              {servings > 1 && (
                <>
                  <span style={{ color: '#93c5fd' }}>|</span>
                  <span>למנה: <strong>{Math.round(totalKcal / servings)} קק״ל</strong></span>
                  <span><strong>{Math.round(totalProtein / servings * 10) / 10}ג׳</strong> חלבון</span>
                </>
              )}
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p>}

        <button
          type="submit" disabled={loading || !form.name.trim()}
          style={{
            padding: '11px 28px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#567DBF', color: 'white', fontWeight: 600, fontSize: 14,
            opacity: (loading || !form.name.trim()) ? 0.6 : 1, alignSelf: 'flex-start',
          }}
        >
          {loading ? 'שולח...' : 'שלח מתכון'}
        </button>
      </form>
    </section>
  );
}

// ─── Nav button ───────────────────────────────────────────────────────────────

function NavBtn({ label, active, onClick, badge }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        flex: '1 1 0', padding: '9px 6px', borderRadius: 8, border: '1.5px solid #567DBF',
        cursor: 'pointer', fontWeight: active ? 700 : 500, fontSize: 12,
        background: active ? '#567DBF' : 'white',
        color:      active ? 'white'   : '#567DBF',
        transition: 'background 0.12s, color 0.12s',
        whiteSpace: 'nowrap', position: 'relative',
      }}
    >
      {label}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: -6, insetInlineStart: -4,
          fontSize: 10, fontWeight: 700, minWidth: 16, height: 16,
          borderRadius: 99, background: '#f59e0b', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { key: 'search',     label: '🔍 חיפוש מזון' },
  { key: 'add-food',   label: '+ הוסף מזון'   },
  { key: 'recipes',    label: '📖 מתכונים'     },
  { key: 'add-recipe', label: '+ הוסף מתכון'  },
  { key: 'favorites',  label: '⭐ המזונות שלי' },
];

const SECTION_TITLES = {
  'search':     'חיפוש מזון',
  'add-food':   'הצעת מזון חדש',
  'recipes':    'מאגר מתכונים',
  'add-recipe': 'הוספת מתכון',
  'favorites':  'המזונות שלי',
};

export default function PublicFoodBank() {
  const { token } = useParams();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState('search');
  const [recipeSuccess, setRecipeSuccess] = useState(false);
  const [starLoading,   setStarLoading]   = useState(false);

  const { data: client, isLoading: clientLoading, isError } = useQuery({
    queryKey: ['public-food-client', token],
    queryFn:  () => apiGet(`/public/weight/${token}`),
    retry: 1,
  });

  const { data: favorites = [], isLoading: favsLoading } = useQuery({
    queryKey: ['public-favorites', token],
    queryFn:  () => apiGet(`/public/favorites/${token}`),
    enabled:  !!client,
  });

  async function handleStar(payload) {
    if (starLoading) return;
    setStarLoading(true);
    try {
      await apiPost(`/public/favorites/${token}`, payload);
      queryClient.invalidateQueries({ queryKey: ['public-favorites', token] });
    } catch {}
    setStarLoading(false);
  }

  async function handleRemoveFavorite(favId) {
    try {
      await apiDelete(`/public/favorites/${token}/${favId}`);
      queryClient.invalidateQueries({ queryKey: ['public-favorites', token] });
    } catch {}
  }

  function handleRecipeSuccess() {
    setRecipeSuccess(true);
    setActiveSection('recipes');
    setTimeout(() => setRecipeSuccess(false), 5000);
  }

  if (clientLoading) {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fcf4f9' }}>
        <p style={{ color: '#888', fontSize: 14 }}>טוען...</p>
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fcf4f9' }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/logo-color.png" alt="לוגו" style={{ height: 80, marginBottom: 16 }} />
          <p style={{ color: '#888', fontSize: 14 }}>הקישור אינו תקין</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#fcf4f9', fontFamily: 'Heebo, sans-serif' }}>

      <header style={{
        background: 'white', borderBottom: '1px solid #F5DBEA',
        padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <img src="/logo-color.png" alt="לוגו" style={{ height: 52, objectFit: 'contain' }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>מאגר המזון שלי</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 1 }}>שלום, {client.full_name}</div>
        </div>
      </header>

      <div style={{ background: 'white', borderBottom: '1px solid #f0f0f0', padding: '12px 20px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8 }}>
          {SECTIONS.map((s) => (
            <NavBtn
              key={s.key}
              label={s.label}
              active={activeSection === s.key}
              onClick={() => setActiveSection(s.key)}
              badge={s.key === 'favorites' ? favorites.length : 0}
            />
          ))}
        </div>
      </div>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '24px 20px 60px' }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 16, paddingBottom: 10, borderBottom: '2px solid #F5DBEA' }}>
          {SECTION_TITLES[activeSection]}
        </h2>

        {recipeSuccess && activeSection === 'recipes' && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 14, color: '#15803d', marginBottom: 16 }}>
            תודה! המתכון נשלח לבדיקה 🙏🏽
          </div>
        )}

        {activeSection === 'search'     && <FoodSearchSection token={token} favorites={favorites} onStar={handleStar} />}
        {activeSection === 'add-food'   && <AddFoodSection    token={token} />}
        {activeSection === 'recipes'    && <RecipeBankSection token={token} />}
        {activeSection === 'add-recipe' && <AddRecipeSection  token={token} onSuccess={handleRecipeSuccess} />}
        {activeSection === 'favorites'  && (
          <FavoritesSection
            token={token}
            favorites={favorites}
            isLoading={favsLoading}
            onRemove={handleRemoveFavorite}
          />
        )}
      </main>
    </div>
  );
}
