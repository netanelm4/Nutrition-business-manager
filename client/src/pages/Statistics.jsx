import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchStopReasons } from '../lib/api';

const COLORS = ['#31B996', '#567DBF', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Statistics() {
  const { data: stopReasons = [], isLoading } = useQuery({
    queryKey: ['stats-stop-reasons'],
    queryFn:  fetchStopReasons,
  });

  return (
    <div className="crm-page" style={{ maxWidth: 800 }}>
      <h1 className="page-title" style={{ marginBottom: 24 }}>סטטיסטיקות</h1>

      <section className="bg-surface rounded-xl border border-gray-200 p-5">
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 16 }}>
          סיבות עצירת תהליך
        </h2>

        {isLoading && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>טוען...</p>
        )}

        {!isLoading && stopReasons.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>אין נתונים עדיין — נתונים יופיעו לאחר עצירת תהליכים.</p>
        )}

        {stopReasons.length > 0 && (
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <ResponsiveContainer width={260} height={260}>
              <PieChart>
                <Pie
                  data={stopReasons}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ percentage }) => `${percentage}%`}
                  labelLine={false}
                >
                  {stopReasons.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, name) => [`${v} לקוחות`, name]} />
              </PieChart>
            </ResponsiveContainer>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
              {stopReasons.map((r, i) => (
                <div key={r.reason} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', marginInlineStart: 'auto' }}>
                    {r.count} · {r.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
