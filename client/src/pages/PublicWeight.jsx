import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const BASE = '/api';

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'שגיאה');
  return json.data;
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'שגיאה');
  return json.data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addThreeDays(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${String(d.getUTCFullYear()).slice(2)}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BRAND = {
  blue:  '#567DBF',
  pink:  '#F5DBEA',
  green: '#31B996',
  bg:    '#fcf4f9',
};

const S = {
  page: {
    minHeight: '100dvh',
    background: BRAND.bg,
    fontFamily: "'Heebo', sans-serif",
    direction: 'rtl',
    padding: '0 0 40px',
  },
  header: {
    background: BRAND.blue,
    color: '#fff',
    padding: '28px 20px 22px',
    textAlign: 'center',
  },
  greeting: { fontSize: 26, fontWeight: 700, margin: 0 },
  subtitle:  { fontSize: 13, opacity: 0.8, marginTop: 4 },
  body:      { maxWidth: 480, margin: '0 auto', padding: '0 16px' },
  card: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
    padding: '18px 20px',
    marginTop: 16,
  },
  statRow: { display: 'flex', gap: 12, marginTop: 16 },
  stat: {
    flex: 1,
    background: BRAND.pink,
    borderRadius: 12,
    padding: '14px 12px',
    textAlign: 'center',
  },
  statLabel: { fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  statValue: { fontSize: 22, fontWeight: 700, color: '#333', marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#333', marginBottom: 12 },
  input: {
    width: '100%',
    height: 44,
    border: '1.5px solid #ddd',
    borderRadius: 10,
    padding: '0 12px',
    fontSize: 16,
    background: '#fafafa',
    outline: 'none',
    boxSizing: 'border-box',
    direction: 'rtl',
  },
  inputFocus: { border: `1.5px solid ${BRAND.blue}` },
  btn: {
    width: '100%',
    height: 48,
    background: BRAND.blue,
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 10,
    fontFamily: "'Heebo', sans-serif",
  },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  success: {
    background: '#e8f9f4',
    border: `1px solid ${BRAND.green}`,
    color: '#1a7a4a',
    borderRadius: 10,
    padding: '12px 16px',
    fontSize: 14,
    fontWeight: 600,
    textAlign: 'center',
    marginTop: 10,
  },
  error: {
    background: '#fff1f0',
    border: '1px solid #ffa39e',
    color: '#c0392b',
    borderRadius: 10,
    padding: '12px 16px',
    fontSize: 13,
    marginTop: 8,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    padding: '8px 10px',
    fontWeight: 600,
    color: '#777',
    textAlign: 'right',
    borderBottom: '2px solid #eee',
    whiteSpace: 'nowrap',
  },
  td: { padding: '9px 10px', borderBottom: '1px solid #f0f0f0', color: '#333' },
  notFound: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Heebo', sans-serif",
    direction: 'rtl',
    background: BRAND.bg,
    color: '#555',
    fontSize: 16,
    gap: 8,
  },
};

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value, green }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color: green === true ? BRAND.green : green === false ? '#e74c3c' : '#333' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

// ─── Weight table ─────────────────────────────────────────────────────────────

function WeekTable({ weeks }) {
  if (!weeks || weeks.length === 0) {
    return <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>עדיין אין שקילות</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={S.table}>
        <thead>
          <tr>
            {['שבוע', 'שקילת שני', 'שקילת חמישי', 'ממוצע'].map((h) => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week_start}>
              <td style={S.td}>{formatDate(w.week_start)}</td>
              <td style={S.td}>{w.monday_weight ?? <span style={{ color: '#ccc' }}>—</span>}</td>
              <td style={S.td}>{w.thursday_weight ?? <span style={{ color: '#ccc' }}>—</span>}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>
                {w.average !== null
                  ? <>{w.average}{w.average_approximate && <span style={{ fontSize: 10, color: '#aaa', marginRight: 2 }}>*</span>}</>
                  : <span style={{ color: '#ccc' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PublicWeight() {
  const { token } = useParams();
  const queryClient = useQueryClient();

  const [date,    setDate]    = useState(todayStr);
  const [weight,  setWeight]  = useState('');
  const [success, setSuccess] = useState(false);
  const [dateErr, setDateErr] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-weight', token],
    queryFn:  () => apiGet(`/public/weight/${token}`),
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: ({ date: d, weight: w }) => apiPost(`/public/weight/${token}`, { date: d, weight: w }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['public-weight', token], (old) => ({ ...old, ...updated }));
      setWeight('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    },
  });

  function validateDate(val) {
    const d = new Date(val + 'T12:00:00Z');
    const day = d.getUTCDay();
    if (day !== 1 && day !== 4) {
      setDateErr('ניתן לרשום שקילה רק בימי שני וחמישי');
    } else {
      setDateErr(null);
    }
    setDate(val);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const w = parseFloat(weight);
    if (isNaN(w) || w < 20 || w > 300) return;
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    if (day !== 1 && day !== 4) return;
    saveMut.mutate({ date, weight: w });
  }

  if (isLoading) {
    return (
      <div style={S.page}>
        <div style={S.header}><p style={S.greeting}>טוען...</p></div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={S.notFound}>
        <div style={{ fontSize: 40 }}>🔗</div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>הקישור אינו תקין</div>
        <div style={{ color: '#aaa', fontSize: 14 }}>פנה לנתנאל לקבלת קישור חדש</div>
      </div>
    );
  }

  const { client_name, latest_weight, total_change, recent_weeks } = data;
  const changeGreen = total_change !== null ? total_change < 0 : null;

  return (
    <div style={S.page}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={S.header}>
        <p style={S.greeting}>היי {client_name} 👋</p>
        <p style={S.subtitle}>מעקב שקילה שבועי</p>
      </div>

      <div style={S.body}>

        {/* Stats */}
        <div style={S.statRow}>
          <StatPill label="משקל נוכחי" value={latest_weight ? `${latest_weight} ק״ג` : null} />
          <StatPill
            label="שינוי מתחילת התהליך"
            value={total_change !== null ? `${total_change > 0 ? '+' : ''}${total_change} ק״ג` : null}
            green={changeGreen}
          />
        </div>

        {/* Entry form */}
        <div style={S.card}>
          <div style={S.sectionTitle}>רישום שקילה חדשה</div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <input
                type="date"
                value={date}
                onChange={(e) => validateDate(e.target.value)}
                style={S.input}
                required
              />
              {dateErr && <div style={S.error}>{dateErr}</div>}
            </div>

            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="20"
              max="300"
              placeholder="משקל בק״ג (לדוגמה: 78.5)"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              style={S.input}
              required
            />

            {saveMut.isError && (
              <div style={S.error}>{saveMut.error?.message || 'שגיאה בשמירה'}</div>
            )}

            {success && (
              <div style={S.success}>מעולה! השקילה נשמרה 💪🏽</div>
            )}

            <button
              type="submit"
              style={{ ...S.btn, ...(saveMut.isPending ? S.btnDisabled : {}) }}
              disabled={saveMut.isPending || !!dateErr}
            >
              {saveMut.isPending ? 'שומר...' : 'שמור שקילה'}
            </button>
          </form>
        </div>

        {/* Last 4 weeks */}
        <div style={S.card}>
          <div style={S.sectionTitle}>4 שבועות אחרונים</div>
          <WeekTable weeks={recent_weeks} />
          {recent_weeks?.length > 0 && (
            <p style={{ fontSize: 11, color: '#aaa', marginTop: 8, textAlign: 'right' }}>
              * ממוצע משקילה אחת בלבד
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
