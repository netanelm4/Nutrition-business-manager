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

// ─── Constants ─────────────────────────────────────────────────────────────────

const MACRO_LABELS = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירקות', fruit: 'פירות' };

// Singular form used in portion line: "מנת ירק 1", "מנת פרי 1"
const MACRO_PORTION_LABELS = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירק', fruit: 'פרי' };

const MACRO_COLORS = {
  protein:   { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
  carb:      { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  fat:       { bg: '#fefce8', border: '#fde047', text: '#854d0e' },
  vegetable: { bg: '#f0fdf4', border: '#6ee7b7', text: '#047857' },
  fruit:     { bg: '#fdf4ff', border: '#d8b4fe', text: '#7e22ce' },
};

const EMPTY_FOOD = {
  name: '', kcal100: '', protein100: '', fat100: '', carb100: '',
  portion_grams: '', category_id: '', notes: '',
};

const EMPTY_RECIPE = { name: '', servings: 1 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function MacroBadge({ type }) {
  if (!type) return null;
  const c = MACRO_COLORS[type] || { bg: '#f5f5f5', border: '#e5e5e5', text: '#555' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      flexShrink: 0,
    }}>
      {MACRO_LABELS[type] ?? type}
    </span>
  );
}

function detectMacroFromNutriments(n) {
  if (!n) return null;
  const kcal = n['energy-kcal_100g'] ?? 0;
  const prot = n['proteins_100g']    ?? 0;
  const fat  = n['fat_100g']         ?? 0;
  const carb = n['carbohydrates_100g'] ?? 0;
  if (kcal <= 40)   return 'vegetable';
  if (prot >= 15)   return 'protein';
  if (fat  >= 30)   return 'fat';
  if (carb >= 30)   return 'carb';
  return 'fruit';
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const sectionTitle = {
  fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 8,
  paddingBottom: 8, borderBottom: '2px solid #F5DBEA',
};

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid #e5e7eb', fontSize: 14, outline: 'none',
  background: 'white', boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4,
};

// ─── Food Search section ───────────────────────────────────────────────────────

function FoodSearchSection({ token }) {
  const [query,      setQuery]      = useState('');
  const [dbResults,  setDbResults]  = useState(null);
  const [ofaResults, setOfaResults] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const timerRef = useRef(null);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setDbResults(null); setOfaResults(null); return; }
    timerRef.current = setTimeout(() => doSearch(val.trim()), 500);
  }

  async function doSearch(q) {
    setLoading(true);
    setError(null);
    setOfaResults(null);

    const dbPromise = apiGet(`/public/foods/search?q=${encodeURIComponent(q)}&token=${token}`);
    const ofaPromise = fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
      `&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments&lc=he,en`
    ).then((r) => r.json()).catch(() => null);

    const [dbSettled, ofaSettled] = await Promise.allSettled([dbPromise, ofaPromise]);

    let db = [];
    if (dbSettled.status === 'fulfilled') {
      db = dbSettled.value ?? [];
    } else {
      setError(dbSettled.reason?.message || 'שגיאה בחיפוש');
    }
    setDbResults(db);

    if (db.length < 3 && ofaSettled.status === 'fulfilled' && ofaSettled.value) {
      const products = (ofaSettled.value.products || [])
        .filter((p) => p.product_name && (p.nutriments?.['energy-kcal_100g'] ?? 0) > 0)
        .slice(0, 5)
        .map((p) => ({
          name:       p.product_name,
          kcal100:    Math.round(p.nutriments['energy-kcal_100g']),
          protein100: Math.round((p.nutriments['proteins_100g'] || 0) * 10) / 10,
          macro_type: detectMacroFromNutriments(p.nutriments),
        }));
      setOfaResults(products.length > 0 ? products : null);
    }

    setLoading(false);
  }

  const noResults = dbResults !== null && dbResults.length === 0 && !ofaResults;

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={sectionTitle}>חיפוש מזון</h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        חפשו מזון לפי שם — תראו אם הוא מתאים לתפריט שלכם
      </p>
      <div style={{ position: 'relative', maxWidth: 480 }}>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="שם המזון..."
          style={inputStyle}
          dir="auto"
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
                  {dbResults.map((item) => {
                    const portionLine = item.portion_description && item.macro_type
                      ? `${item.portion_description} = מנת ${MACRO_PORTION_LABELS[item.macro_type] ?? item.macro_type} 1`
                      : null;
                    return (
                      <div key={item.id} style={{
                        padding: '10px 14px', borderRadius: 10,
                        background: '#fafafa', border: '1px solid #e5e7eb',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{item.name_he}</div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{item.category_name}</div>
                          </div>
                          <MacroBadge type={item.macro_type} />
                        </div>
                        {portionLine && (
                          <div style={{ marginTop: 6, fontSize: 13, color: '#567DBF', fontWeight: 500 }}>
                            {portionLine}
                          </div>
                        )}
                        <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {item.calories != null && (
                            <span style={{ fontSize: 12, color: '#555' }}>{item.calories} קק״ל למנה</span>
                          )}
                          {item.protein_grams != null && (
                            <span style={{ fontSize: 12, color: '#555' }}>{item.protein_grams}ג׳ חלבון</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {ofaResults && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>מהמאגר הבינלאומי</span>
                    <span style={{ fontWeight: 400, color: '#aaa' }}>Open Food Facts</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ofaResults.map((item, i) => (
                      <div key={i} style={{
                        padding: '9px 14px', borderRadius: 10,
                        background: '#f9fafb', border: '1px solid #e5e7eb',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        flexWrap: 'wrap', gap: 8,
                      }}>
                        <span style={{ fontWeight: 500, fontSize: 13, color: '#222', flex: 1, minWidth: 0 }} dir="auto">
                          {item.name}
                        </span>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <MacroBadge type={item.macro_type} />
                          <span style={{ fontSize: 12, color: '#555' }}>{item.kcal100} קק״ל/100ג׳</span>
                          {item.protein100 > 0 && (
                            <span style={{ fontSize: 12, color: '#555' }}>{item.protein100}ג׳ חלבון/100ג׳</span>
                          )}
                        </div>
                      </div>
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

// ─── Submit Food section ───────────────────────────────────────────────────────

function SubmitFoodSection({ token }) {
  const [form,    setForm]    = useState(EMPTY_FOOD);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['public-food-categories'],
    queryFn:  () => apiGet('/food-bank/categories'),
    staleTime: 5 * 60_000,
  });

  function setField(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost('/public/foods/submit', { ...form, token });
      setSuccess(true);
      setForm(EMPTY_FOOD);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={sectionTitle}>הצעת מזון חדש</h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        מצאתם מזון שאתם אוכלים ולא קיים בתפריט? שלחו לנו ונבדוק האם להוסיף אותו.
      </p>

      {success && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 13, color: '#15803d', marginBottom: 12 }}>
          תודה! ההצעה נשלחה לבדיקה.
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
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

        <div>
          <label style={labelStyle}>כמות מנה רגילה (גרם)</label>
          <input type="number" min="0" value={form.portion_grams}
            onChange={(e) => setField('portion_grams', e.target.value)}
            placeholder="למשל: 30"
            style={{ ...inputStyle, maxWidth: 140 }} />
        </div>

        <div>
          <label style={labelStyle}>קטגוריה (אופציונלי)</label>
          <select value={form.category_id}
            onChange={(e) => setField('category_id', e.target.value)}
            style={inputStyle}>
            <option value="">בחר קטגוריה...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name_he}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>הערות</label>
          <input type="text" value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="פרטים נוספים..." style={inputStyle} dir="auto" />
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

// ─── Ingredient search autocomplete ───────────────────────────────────────────

function IngredientSearch({ token, onSelect }) {
  const [q,       setQ]       = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const timerRef  = useRef(null);
  const wrapRef   = useRef(null);

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
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiGet(`/public/foods/search?q=${encodeURIComponent(val.trim())}&token=${token}`);
        setResults(data.slice(0, 8));
        setOpen(true);
      } catch {}
      setLoading(false);
    }, 350);
  }

  function select(item) {
    onSelect(item);
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={q}
        onChange={handleChange}
        placeholder="הקלידו שם רכיב לחיפוש..."
        style={inputStyle}
        dir="auto"
      />
      {loading && (
        <span style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#aaa' }}>
          מחפש...
        </span>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', insetInlineStart: 0, insetInlineEnd: 0,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginTop: 4, overflow: 'hidden',
        }}>
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(item)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '9px 12px', border: 'none', background: 'transparent',
                cursor: 'pointer', textAlign: 'right', borderBottom: '1px solid #f5f5f5',
                gap: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f0f9ff'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: '#111', flex: 1, minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {item.name_he}
              </span>
              <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>
                {item.calories != null ? `${item.calories} קק״ל / מנה` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recipe section (view + add, accordion) ────────────────────────────────────

function RecipeSection({ token }) {
  const queryClient = useQueryClient();
  const [openCard,  setOpenCard]  = useState(null); // 'view' | 'add'
  const [openRecipeId, setOpenRecipeId] = useState(null);

  // ── Recipe list ──
  const { data: recipes = [], isLoading: recipesLoading } = useQuery({
    queryKey: ['public-recipes', token],
    queryFn:  () => apiGet(`/public/recipes?token=${token}`),
  });

  // ── Add form state ──
  const [form,        setForm]        = useState(EMPTY_RECIPE);
  const [ingredients, setIngredients] = useState([]);
  const [addError,    setAddError]    = useState(null);
  const [addSuccess,  setAddSuccess]  = useState(false);
  const [addLoading,  setAddLoading]  = useState(false);

  function toggle(card) {
    setOpenCard((c) => c === card ? null : card);
  }

  function addIngredient(item) {
    setIngredients((prev) => [
      ...prev,
      {
        food_item_id:            item.id,
        name_he:                 item.name_he,
        amount_grams:            100,
        calories_per_portion:    item.calories ?? 0,
        protein_per_portion:     item.protein_grams ?? 0,
        portion_grams:           item.portion_grams ?? 100,
      },
    ]);
  }

  function updateAmount(idx, val) {
    setIngredients((prev) => prev.map((ing, i) => i === idx ? { ...ing, amount_grams: Number(val) || 0 } : ing));
  }

  function removeIngredient(idx) {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  // Live totals
  const totalKcal = ingredients.reduce((sum, ing) => {
    if (!ing.portion_grams || !ing.calories_per_portion) return sum;
    return sum + (ing.amount_grams / ing.portion_grams) * ing.calories_per_portion;
  }, 0);

  const totalProtein = ingredients.reduce((sum, ing) => {
    if (!ing.portion_grams || !ing.protein_per_portion) return sum;
    return sum + (ing.amount_grams / ing.portion_grams) * ing.protein_per_portion;
  }, 0);

  const servings   = Number(form.servings) || 1;
  const perServing = { kcal: Math.round(totalKcal / servings), protein: Math.round(totalProtein / servings * 10) / 10 };

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setAddLoading(true);
    setAddError(null);
    try {
      await apiPost('/public/recipes', {
        token,
        name:        form.name.trim(),
        servings:    Number(form.servings) || 1,
        ingredients: ingredients.map((ing) => ({
          food_item_id:    ing.food_item_id,
          custom_food_name: ing.name_he,
          amount_grams:    ing.amount_grams,
        })),
      });
      setAddSuccess(true);
      setForm(EMPTY_RECIPE);
      setIngredients([]);
      setOpenCard('view');
      queryClient.invalidateQueries({ queryKey: ['public-recipes', token] });
      setTimeout(() => setAddSuccess(false), 4000);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  }

  const cardBase = (isOpen) => ({
    border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden',
    background: isOpen ? '#fafeff' : 'white',
    display: 'flex', flexDirection: 'column',
  });

  const cardHeader = (isOpen) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px', cursor: 'pointer', border: 'none',
    background: isOpen ? '#f0f9ff' : 'white', width: '100%', textAlign: 'right',
    borderBottom: isOpen ? '1px solid #e0f2fe' : 'none',
  });

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={sectionTitle}>מתכונים</h2>

      {addSuccess && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 13, color: '#15803d', marginBottom: 12 }}>
          תודה! המתכון נשלח לבדיקה.
        </div>
      )}

      <style>{`
        .recipe-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 599px) {
          .recipe-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="recipe-grid">

        {/* ── View card ── */}
        <div style={cardBase(openCard === 'view')}>
          <button type="button" style={cardHeader(openCard === 'view')} onClick={() => toggle('view')}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>📖 מתכונים משותפים</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {recipes.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: '#e0f2fe', color: '#0369a1' }}>
                  {recipes.length}
                </span>
              )}
              <span style={{ fontSize: 12, color: '#567DBF' }}>{openCard === 'view' ? '▲' : '▼'}</span>
            </div>
          </button>

          {openCard === 'view' && (
            <div style={{ padding: '12px 0' }}>
              {recipesLoading ? (
                <p style={{ fontSize: 13, color: '#888', padding: '0 16px' }}>טוען...</p>
              ) : recipes.length === 0 ? (
                <p style={{ fontSize: 13, color: '#888', padding: '0 16px' }}>עדיין אין מתכונים</p>
              ) : (
                recipes.map((r) => (
                  <div key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <button
                      type="button"
                      onClick={() => setOpenRecipeId(openRecipeId === r.id ? null : r.id)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '10px 16px', border: 'none', background: 'transparent',
                        cursor: 'pointer', textAlign: 'right', gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#111', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                          {r.servings > 1 ? `${r.servings} מנות · ` : ''}
                          {r.calories_per_serving != null ? `${r.calories_per_serving} קק״ל / מנה` : ''}
                          {r.protein_per_serving  != null ? ` · ${r.protein_per_serving}ג׳ חלבון` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>
                        {openRecipeId === r.id ? '▲' : '▼'}
                      </span>
                    </button>

                    {openRecipeId === r.id && r.ingredients?.length > 0 && (
                      <div style={{ padding: '0 16px 12px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', marginBottom: 4 }}>רכיבים:</div>
                        {r.ingredients.map((ing, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f5f5f5', color: '#444' }}>
                            <span>{ing.custom_food_name || ing.name_he || '—'}</span>
                            <span style={{ color: '#888' }}>{ing.amount_grams}ג׳</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Add card ── */}
        <div style={cardBase(openCard === 'add')}>
          <button type="button" style={cardHeader(openCard === 'add')} onClick={() => toggle('add')}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>+ הוסף מתכון חדש</span>
            <span style={{ fontSize: 12, color: '#567DBF' }}>{openCard === 'add' ? '▲' : '▼'}</span>
          </button>

          {openCard === 'add' && (
            <form onSubmit={handleSubmit} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              <div>
                <label style={labelStyle}>שם המתכון *</label>
                <input
                  type="text" required value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="למשל: סלט חומוס ביתי"
                  style={inputStyle} dir="auto"
                />
              </div>

              <div>
                <label style={labelStyle}>מספר מנות</label>
                <input
                  type="number" min="1" value={form.servings}
                  onChange={(e) => setForm((f) => ({ ...f, servings: e.target.value }))}
                  style={{ ...inputStyle, maxWidth: 100 }}
                />
              </div>

              <div>
                <label style={labelStyle}>חפשו רכיב להוספה</label>
                <IngredientSearch token={token} onSelect={addIngredient} />
              </div>

              {ingredients.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6 }}>רכיבים שנוספו:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ingredients.map((ing, idx) => {
                      const factor  = ing.portion_grams > 0 ? ing.amount_grams / ing.portion_grams : 0;
                      const ingKcal = Math.round(factor * ing.calories_per_portion);
                      return (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb',
                          flexWrap: 'wrap',
                        }}>
                          <span style={{ flex: 1, minWidth: 80, fontSize: 13, fontWeight: 500, color: '#111' }}>
                            {ing.name_he}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="number" min="1" value={ing.amount_grams}
                              onChange={(e) => updateAmount(idx, e.target.value)}
                              style={{ width: 68, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, textAlign: 'center' }}
                            />
                            <span style={{ fontSize: 12, color: '#888' }}>ג׳</span>
                          </div>
                          {ingKcal > 0 && (
                            <span style={{ fontSize: 11, color: '#888', minWidth: 60 }}>{ingKcal} קק״ל</span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeIngredient(idx)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 16, padding: '0 2px' }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{
                    marginTop: 10, padding: '8px 12px', borderRadius: 8,
                    background: '#eff6ff', border: '1px solid #bfdbfe',
                    fontSize: 13, color: '#1e40af', display: 'flex', gap: 16, flexWrap: 'wrap',
                  }}>
                    <span>סה״כ: <strong>{Math.round(totalKcal)} קק״ל</strong></span>
                    <span>חלבון: <strong>{Math.round(totalProtein * 10) / 10}ג׳</strong></span>
                    {servings > 1 && (
                      <span>למנה: <strong>{perServing.kcal} קק״ל / {perServing.protein}ג׳ חלבון</strong></span>
                    )}
                  </div>
                </div>
              )}

              {addError && <p style={{ fontSize: 13, color: '#dc2626' }}>{addError}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="submit"
                  disabled={addLoading || !form.name.trim()}
                  style={{
                    padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: '#567DBF', color: 'white', fontWeight: 600, fontSize: 14,
                    opacity: (addLoading || !form.name.trim()) ? 0.6 : 1,
                  }}
                >
                  {addLoading ? 'שולח...' : 'שלח מתכון'}
                </button>
                <button
                  type="button"
                  onClick={() => { setForm(EMPTY_RECIPE); setIngredients([]); setAddError(null); toggle('add'); }}
                  style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'white', color: '#555', cursor: 'pointer', fontSize: 14 }}
                >
                  ביטול
                </button>
              </div>
            </form>
          )}
        </div>

      </div>
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PublicFoodBank() {
  const { token } = useParams();

  const { data: client, isLoading, isError } = useQuery({
    queryKey: ['public-food-client', token],
    queryFn:  () => apiGet(`/public/weight/${token}`),
    retry: 1,
  });

  if (isLoading) {
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
        padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <img src="/logo-color.png" alt="לוגו" style={{ height: 56, objectFit: 'contain' }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>מאגר המזון שלי</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>שלום, {client.full_name}</div>
        </div>
      </header>

      <main style={{ maxWidth: 700, margin: '0 auto', padding: '28px 20px 60px' }}>
        <FoodSearchSection token={token} />
        <SubmitFoodSection token={token} />
        <RecipeSection token={token} />
      </main>
    </div>
  );
}
