import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Dot,
} from 'recharts';

const BASE = '/api';

async function apiGet(path) {
  const res  = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'שגיאה');
  return json.data;
}

async function apiPost(path, body) {
  const res  = await fetch(`${BASE}${path}`, {
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

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${String(d.getUTCFullYear()).slice(2)}`;
}

function addThreeDays(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

// ─── Brand ────────────────────────────────────────────────────────────────────

const C = {
  bg:    '#fcf4f9',
  pink:  '#F5DBEA',
  blue:  '#567DBF',
  green: '#31B996',
  text:  '#222',
  sub:   '#666',
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100dvh',
    background: C.bg,
    fontFamily: "'Heebo', 'Arial', sans-serif",
    direction: 'rtl',
    padding: '0 0 48px',
  },
  header: {
    background: C.bg,
    paddingTop: 28,
    paddingBottom: 12,
    textAlign: 'center',
    borderBottom: `1px solid ${C.pink}`,
  },
  logo: {
    maxHeight: 72,
    maxWidth: 180,
    objectFit: 'contain',
    margin: '0 auto 12px',
    display: 'block',
  },
  greeting: { fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 2px' },
  subtitle:  { fontSize: 13, color: C.sub, margin: 0 },
  body:      { maxWidth: 480, margin: '0 auto', padding: '0 16px' },
  card: {
    background: '#fff',
    borderRadius: 16,
    border: `1px solid ${C.pink}`,
    boxShadow: '0 2px 10px rgba(86,125,191,0.06)',
    padding: '18px 20px',
    marginTop: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 },
  statRow: { display: 'flex', gap: 12, marginTop: 16 },
  stat: {
    flex: 1,
    background: C.pink,
    borderRadius: 12,
    padding: '14px 12px',
    textAlign: 'center',
    border: `1px solid ${C.pink}`,
  },
  statLabel: { fontSize: 11, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  statValue: { fontSize: 22, fontWeight: 700, color: C.text, marginTop: 4 },
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
    fontFamily: 'inherit',
  },
  btn: {
    width: '100%',
    height: 48,
    background: C.blue,
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 10,
    fontFamily: 'inherit',
  },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  success: {
    background: '#e8f9f4',
    border: `1px solid ${C.green}`,
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
  expandBtn: {
    display: 'block',
    margin: '12px auto 0',
    background: 'none',
    border: `1px solid ${C.blue}`,
    color: C.blue,
    borderRadius: 8,
    padding: '6px 16px',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  notFound: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Heebo', 'Arial', sans-serif",
    direction: 'rtl',
    background: C.bg,
    color: '#555',
    fontSize: 16,
    gap: 8,
  },
};

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value, green }) {
  const valueColor = green === true ? C.green : green === false ? '#e74c3c' : C.text;
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color: valueColor }}>{value ?? '—'}</div>
    </div>
  );
}

// ─── Weight table ─────────────────────────────────────────────────────────────

const COLLAPSED_ROWS = 8;

function WeekTable({ weeks }) {
  const [expanded, setExpanded] = useState(false);

  if (!weeks || weeks.length === 0) {
    return (
      <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
        עדיין אין שקילות
      </p>
    );
  }

  const visible = expanded ? weeks : weeks.slice(0, COLLAPSED_ROWS);
  const hasMore = weeks.length > COLLAPSED_ROWS;

  return (
    <>
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
            {visible.map((w) => (
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

      {hasMore && (
        <button style={S.expandBtn} onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'הסתר היסטוריה' : `הצג את כל ההיסטוריה (${weeks.length} שבועות)`}
        </button>
      )}
    </>
  );
}

// ─── Progress chart ───────────────────────────────────────────────────────────

function WeightChart({ allWeeks }) {
  if (!allWeeks || allWeeks.length < 2) return null;

  // Build chart data oldest→newest, only weeks with an average
  const chartData = [...allWeeks]
    .reverse()
    .filter((w) => w.average !== null)
    .map((w) => ({ label: formatDate(w.week_start), weight: w.average }));

  if (chartData.length < 2) return null;

  const weights  = chartData.map((d) => d.weight);
  const minW     = Math.min(...weights);
  const maxW     = Math.max(...weights);
  const padding  = Math.max(1, (maxW - minW) * 0.2);
  const domainMin = Math.floor((minW - padding) * 2) / 2;
  const domainMax = Math.ceil((maxW  + padding) * 2) / 2;

  const first = chartData[0].weight;
  const last  = chartData[chartData.length - 1].weight;
  const diff  = Math.round((last - first) * 10) / 10;
  const weeks = chartData.length;
  const trendText = diff === 0
    ? 'אין שינוי במשקל'
    : diff < 0
      ? `מגמה: ירידה של ${Math.abs(diff)} ק״ג ב-${weeks} שבועות`
      : `מגמה: עלייה של ${diff} ק״ג ב-${weeks} שבועות`;
  const trendColor = diff < 0 ? C.green : diff > 0 ? '#e74c3c' : '#888';

  return (
    <div style={S.card}>
      <div style={S.sectionTitle}>גרף התקדמות</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0eaf4" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#999', fontFamily: 'inherit' }}
            tickLine={false}
            axisLine={{ stroke: '#eee' }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[domainMin, domainMax]}
            tick={{ fontSize: 11, fill: '#999', fontFamily: 'inherit' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            formatter={(v) => [`${v} ק״ג`, 'ממוצע שבועי']}
            labelFormatter={(l) => `שבוע ${l}`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.pink}`, fontFamily: 'inherit', direction: 'rtl' }}
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke={C.blue}
            strokeWidth={2.5}
            dot={<Dot r={4} fill={C.green} stroke="#fff" strokeWidth={1.5} />}
            activeDot={{ r: 6, fill: C.blue }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 12, color: trendColor, fontWeight: 600, marginTop: 8, textAlign: 'center' }}>
        {trendText}
      </p>
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
    const day = new Date(val + 'T12:00:00Z').getUTCDay();
    setDateErr(day !== 1 && day !== 4 ? 'ניתן לרשום שקילה רק בימי שני וחמישי' : null);
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
        <div style={S.header}>
          <img src="/logo-color.png" alt="לוגו" style={S.logo} />
          <p style={S.greeting}>טוען...</p>
        </div>
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

  const { client_name, latest_weight, total_change, all_weeks = [], recent_weeks = [] } = data;
  const changeGreen = total_change !== null ? total_change < 0 : null;
  // Use all_weeks for table and chart; fall back to recent_weeks for old API responses
  const tableWeeks = all_weeks.length > 0 ? all_weeks : recent_weeks;

  return (
    <div style={S.page}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={S.header}>
        <img src="/logo-color.png" alt="לוגו" style={S.logo} />
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

        {/* Progress chart */}
        <WeightChart allWeeks={tableWeeks} />

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

        {/* Full history */}
        <div style={S.card}>
          <div style={S.sectionTitle}>היסטוריית שקילות</div>
          <WeekTable weeks={tableWeeks} />
          {tableWeeks.length > 0 && (
            <p style={{ fontSize: 11, color: '#aaa', marginTop: 8, textAlign: 'right' }}>
              * ממוצע משקילה אחת בלבד
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
