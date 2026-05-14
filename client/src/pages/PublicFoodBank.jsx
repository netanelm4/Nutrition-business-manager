import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
const MACRO_COLORS = {
  protein:   { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
  carb:      { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  fat:       { bg: '#fefce8', border: '#fde047', text: '#854d0e' },
  vegetable: { bg: '#f0fdf4', border: '#6ee7b7', text: '#047857' },
  fruit:     { bg: '#fdf4ff', border: '#d8b4fe', text: '#7e22ce' },
};

const EMPTY_FOOD = {
  name:    '',
  kcal100: '',
  protein100: '',
  fat100:  '',
  carb100: '',
  portion_grams: '',
  category_id: '',
  notes: '',
};

const EMPTY_RECIPE = {
  name: '',
  description: '',
  servings: 1,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function MacroBadge({ type }) {
  if (!type) return null;
  const c = MACRO_COLORS[type] || { bg: '#f5f5f5', border: '#e5e5e5', text: '#555' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>
      {MACRO_LABELS[type] ?? type}
    </span>
  );
}

// ─── Food Search section ───────────────────────────────────────────────────────

function FoodSearchSection({ token }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const timerRef = useRef(null);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setResults(null); return; }
    timerRef.current = setTimeout(() => doSearch(val.trim()), 500);
  }

  async function doSearch(q) {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(`/public/foods/search?q=${encodeURIComponent(q)}&token=${token}`);
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

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

      {results !== null && (
        <div style={{ marginTop: 12 }}>
          {results.length === 0 ? (
            <p style={{ fontSize: 13, color: '#888' }}>לא נמצאו תוצאות</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 10, flexWrap: 'wrap', gap: 8,
                  background: item.in_menu ? '#f0fdf4' : '#fafafa',
                  border: `1px solid ${item.in_menu ? '#86efac' : '#e5e7eb'}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{item.name_he}</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{item.category_name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <MacroBadge type={item.macro_type} />
                    <span style={{ fontSize: 12, color: '#555' }}>
                      {item.calories_per_half_portion} קק״ל / מנה
                    </span>
                    {item.protein_grams != null && (
                      <span style={{ fontSize: 12, color: '#555' }}>
                        {item.protein_grams}ג׳ חלבון
                      </span>
                    )}
                    {item.in_menu && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>✓ בתפריט</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Submit Food section ───────────────────────────────────────────────────────

function SubmitFoodSection({ token }) {
  const [form,     setForm]     = useState(EMPTY_FOOD);
  const [success,  setSuccess]  = useState(false);
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  // categories for the dropdown
  const { data: categories = [] } = useQuery({
    queryKey: ['public-food-categories', token],
    queryFn:  () => apiGet(`/food-bank/categories`),
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
            <input
              type="number" min="0" value={form.kcal100}
              onChange={(e) => setField('kcal100', e.target.value)}
              placeholder="קק״ל"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>חלבון ל-100 גרם (ג׳)</label>
            <input
              type="number" min="0" step="0.1" value={form.protein100}
              onChange={(e) => setField('protein100', e.target.value)}
              placeholder="גרם"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>שומן ל-100 גרם (ג׳)</label>
            <input
              type="number" min="0" step="0.1" value={form.fat100}
              onChange={(e) => setField('fat100', e.target.value)}
              placeholder="גרם"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>פחמימות ל-100 גרם (ג׳)</label>
            <input
              type="number" min="0" step="0.1" value={form.carb100}
              onChange={(e) => setField('carb100', e.target.value)}
              placeholder="גרם"
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label style={labelStyle}>כמות מנה רגילה (גרם)</label>
          <input
            type="number" min="0" value={form.portion_grams}
            onChange={(e) => setField('portion_grams', e.target.value)}
            placeholder="למשל: 30"
            style={{ ...inputStyle, maxWidth: 140 }}
          />
        </div>

        <div>
          <label style={labelStyle}>קטגוריה (אופציונלי)</label>
          <select
            value={form.category_id}
            onChange={(e) => setField('category_id', e.target.value)}
            style={inputStyle}
          >
            <option value="">בחר קטגוריה...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name_he}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>הערות</label>
          <input
            type="text" value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="פרטים נוספים..."
            style={inputStyle} dir="auto"
          />
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

// ─── Recipe Bank section ───────────────────────────────────────────────────────

function RecipeBankSection({ token }) {
  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['public-recipes', token],
    queryFn:  () => apiGet(`/public/recipes?token=${token}`),
  });

  const [openId, setOpenId] = useState(null);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['public-recipe-detail', openId],
    queryFn:  () => apiGet(`/public/recipes/${openId}?token=${token}`),
    enabled:  !!openId,
  });

  if (!isLoading && recipes.length === 0) return null;

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={sectionTitle}>מאגר מתכונים</h2>

      {isLoading ? (
        <div style={{ fontSize: 13, color: '#888' }}>טוען מתכונים...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recipes.map((r) => (
            <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '12px 16px', border: 'none', background: openId === r.id ? '#f0f9ff' : 'white',
                  cursor: 'pointer', textAlign: 'right',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{r.name}</div>
                  {r.description && (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{r.description}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginInlineStart: 12 }}>
                  {r.servings > 1 && (
                    <span style={{ fontSize: 12, color: '#888' }}>{r.servings} מנות</span>
                  )}
                  <span style={{ fontSize: 12, color: '#567DBF' }}>{openId === r.id ? '▲' : '▼'}</span>
                </div>
              </button>

              {openId === r.id && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f0f0f0' }}>
                  {detailLoading ? (
                    <p style={{ fontSize: 13, color: '#888', paddingTop: 12 }}>טוען...</p>
                  ) : detail ? (
                    <div>
                      {detail.total_kcal != null && (
                        <div style={{ display: 'flex', gap: 16, marginTop: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#555' }}>סה״כ: <strong>{detail.total_kcal} קק״ל</strong></span>
                          {detail.total_protein != null && (
                            <span style={{ fontSize: 13, color: '#555' }}>חלבון: <strong>{detail.total_protein}ג׳</strong></span>
                          )}
                        </div>
                      )}
                      {(detail.ingredients || []).length > 0 && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6 }}>רכיבים:</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {detail.ingredients.map((ing, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}>
                                <span>{ing.custom_food_name || ing.food_name || '—'}</span>
                                <span style={{ color: '#888' }}>{ing.amount_grams}ג׳{ing.notes ? ` (${ing.notes})` : ''}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Submit Recipe section ─────────────────────────────────────────────────────

function SubmitRecipeSection({ token }) {
  const queryClient = useQueryClient();
  const [form,    setForm]    = useState(EMPTY_RECIPE);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);

  function setField(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost('/public/recipes', { ...form, token });
      setSuccess(true);
      setForm(EMPTY_RECIPE);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['public-recipes', token] });
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={sectionTitle}>שיתוף מתכון</h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        יש לכם מתכון שאתם אוהבים? שתפו אותו ונוסיף למאגר.
      </p>

      {success && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 13, color: '#15803d', marginBottom: 12 }}>
          תודה! המתכון נשלח לבדיקה.
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: '10px 20px', borderRadius: 8, border: '1px solid #567DBF',
            background: 'white', color: '#567DBF', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}
        >
          + שתפו מתכון
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
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
            <label style={labelStyle}>תיאור קצר</label>
            <input
              type="text" value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="מה מיוחד במתכון?"
              style={inputStyle} dir="auto"
            />
          </div>
          <div>
            <label style={labelStyle}>מספר מנות</label>
            <input
              type="number" min="1" value={form.servings}
              onChange={(e) => setField('servings', Number(e.target.value))}
              style={{ ...inputStyle, maxWidth: 100 }}
            />
          </div>

          {error && <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="submit"
              disabled={loading || !form.name.trim()}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#567DBF', color: 'white', fontWeight: 600, fontSize: 14,
                opacity: (loading || !form.name.trim()) ? 0.6 : 1,
              }}
            >
              {loading ? 'שולח...' : 'שלח מתכון'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setForm(EMPTY_RECIPE); setError(null); }}
              style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid #e5e7eb',
                background: 'white', color: '#555', cursor: 'pointer', fontSize: 14,
              }}
            >
              ביטול
            </button>
          </div>
        </form>
      )}
    </section>
  );
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
      {/* Header */}
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

      {/* Content */}
      <main style={{ maxWidth: 700, margin: '0 auto', padding: '28px 20px 60px' }}>
        <FoodSearchSection token={token} />
        <SubmitFoodSection token={token} />
        <RecipeBankSection token={token} />
        <SubmitRecipeSection token={token} />
      </main>
    </div>
  );
}
