import { useState, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchClients } from '../lib/api';
import { CLIENT_STATUS, CLIENT_STATUS_LABEL } from '../constants/statuses';
import ClientForm from '../components/clients/ClientForm';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';

// ── Inline icons ──────────────────────────────────────────────────────────────

function IcSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
    </svg>
  );
}
function IcPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AV_COLORS = ['pink', 'blue', 'green', 'blue', 'pink', 'green'];

function Av({ name = '', idx = 0, size = 32, fontSize = 12 }) {
  const initials = name.slice(0, 2);
  const color = AV_COLORS[idx % AV_COLORS.length];
  return (
    <div
      className={`av av--${color}`}
      style={{ width: size, height: size, fontSize, flexShrink: 0 }}
    >
      {initials}
    </div>
  );
}

// ── Session dots ──────────────────────────────────────────────────────────────

function SessionDots({ recorded = [] }) {
  const set = new Set(recorded);
  return (
    <div className="dots">
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} className={set.has(i + 1) ? 'on' : ''} />
      ))}
    </div>
  );
}

// ── Progress mini-ring ────────────────────────────────────────────────────────

function MiniRing({ pct = 0 }) {
  const c = pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--blue)' : 'oklch(0.72 0.13 70)';
  return (
    <div
      className="prog-ring"
      style={{ '--p': pct, '--c': c, width: 26, height: 26 }}
    >
      <span style={{ fontSize: 8 }}>{pct}</span>
    </div>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_CHIP = {
  active:      'chip--green',
  paused:      '',
  ended:       '',
  ending_soon: 'chip--amber',
};
const STATUS_LABELS_HE = {
  active:      'פעיל',
  paused:      'מושהה',
  ended:       'סיים',
  ending_soon: 'מסיים בקרוב',
};

// ── Payment chip ──────────────────────────────────────────────────────────────

function PayChip({ status }) {
  if (status === 'paid')    return <span className="chip chip--green"><span className="dot"/>שולם</span>;
  if (status === 'partial') return <span className="chip chip--amber"><span className="dot"/>חלקי</span>;
  return <span className="chip chip--red"><span className="dot"/>טרם שולם</span>;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={i}>
          {[28, 20, 12, 16, 8, 14, 12].map((w, j) => (
            <td key={j} style={{ padding: '14px 16px' }}>
              <div
                className="animate-pulse rounded"
                style={{ height: 12, width: `${w}%`, background: 'var(--surface-3)' }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Clients() {
  const location = useLocation();
  const prefill = location.state?.prefill ?? null;

  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [includeEnded, setIncludeEnded] = useState(false);

  useEffect(() => {
    if (prefill) setAddOpen(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: clients = [], isLoading, isError } = useQuery({
    queryKey: ['clients', includeEnded],
    queryFn: () => fetchClients(includeEnded),
  });

  const counts = useMemo(() => ({
    all:     clients.length,
    active:  clients.filter((c) => c.status === CLIENT_STATUS.ACTIVE).length,
    paused:  clients.filter((c) => c.status === CLIENT_STATUS.PAUSED).length,
    ended:   clients.filter((c) => c.status === CLIENT_STATUS.ENDED).length,
  }), [clients]);

  const filtered = useMemo(() => {
    let result = clients;
    if (statusFilter && statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (c.phone && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
      );
    }
    return result;
  }, [clients, statusFilter, search]);

  const STATUS_TABS = [
    { id: 'all',    label: 'הכל' },
    { id: CLIENT_STATUS.ACTIVE, label: 'פעילים' },
    { id: CLIENT_STATUS.PAUSED, label: 'מושהים' },
    { id: CLIENT_STATUS.ENDED,  label: 'סיימו' },
  ];

  return (
    <>
      <div className="crm-page">
        {/* ── Subhead ── */}
        <div className="subhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div className="seg">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.id}
                  className={statusFilter === t.id ? 'is-active' : ''}
                  onClick={() => setStatusFilter(t.id)}
                >
                  {t.label}
                  <span className="count">{t.id === 'all' ? counts.all : (counts[t.id] ?? 0)}</span>
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-3)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeEnded}
                onChange={(e) => setIncludeEnded(e.target.checked)}
                style={{ accentColor: 'var(--blue)' }}
              />
              כולל שסיימו
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="search-box">
              <IcSearch />
              <input
                placeholder="חיפוש שם או טלפון..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="crm-btn crm-btn--primary"
              onClick={() => setAddOpen(true)}
            >
              <IcPlus />
              מטופל חדש
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        {isError && (
          <p style={{ color: 'var(--red-ink)', fontSize: 13, marginBottom: 12 }}>שגיאה בטעינת הרשימה.</p>
        )}

        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>מטופל</th>
                <th>מטרה</th>
                <th style={{ width: 110 }}>סטטוס</th>
                <th style={{ width: 130 }}>6 פגישות</th>
                <th style={{ width: 70 }}>התקדמות</th>
                <th style={{ width: 120 }}>תשלום</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton />}

              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>
                    {search || (statusFilter && statusFilter !== 'all')
                      ? 'לא נמצאו מטופלים התואמים לסינון'
                      : 'אין מטופלים עדיין'}
                  </td>
                </tr>
              )}

              {!isLoading && filtered.map((client, idx) => {
                const recorded = client.sessions_recorded ?? [];
                const pct = Math.round((recorded.length / 6) * 100);
                const chipClass = STATUS_CHIP[client.status] ?? '';

                return (
                  <tr key={client.id} onClick={() => window.location.href = `/clients/${client.id}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Av name={client.full_name} idx={idx} />
                        <div>
                          <div className="client-nm">{client.full_name}</div>
                          {client.phone && <div className="client-ph" dir="ltr">{client.phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
                      {client.goal || '—'}
                    </td>
                    <td>
                      <span className={`chip ${chipClass}`}>
                        <span className="dot" />
                        {STATUS_LABELS_HE[client.status] ?? CLIENT_STATUS_LABEL[client.status] ?? client.status}
                      </span>
                    </td>
                    <td><SessionDots recorded={recorded} /></td>
                    <td><MiniRing pct={pct} /></td>
                    <td><PayChip status={client.payment_status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {!isLoading && (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-4)' }}>
            <span>מציג {filtered.length} מתוך {clients.length} מטופלים</span>
            <span>מיון: לפי שם</span>
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title="הוספת מטופל חדש" onClose={() => setAddOpen(false)}>
          <ClientForm
            onSuccess={() => setAddOpen(false)}
            defaultValues={prefill ?? undefined}
            convertedFromLeadId={prefill?.convertedFromLeadId}
          />
        </Modal>
      )}
    </>
  );
}
