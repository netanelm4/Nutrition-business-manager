import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchDashboard, fetchTemplates, renderTemplate, repairAIAssessments,
  fetchDailyTasks, createDailyTask, updateDailyTask, deleteDailyTask, runAIScan,
  fetchClients,
  fetchAIRecommendations, dismissRecommendation, markRecommendationSent, runAIAnalysis,
} from '../lib/api';
import { formatDateHebrew, formatTimeHebrew, relativeLabel } from '../lib/dates';
import { ALERT_STATE } from '../constants/statuses';

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function Ic({ d, size = 14, sw = 1.6, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {children || <path d={d}/>}
    </svg>
  );
}
const IcCheck  = (p) => <Ic {...p}><path d="m5 12 4 4 10-10"/></Ic>;
const IcChev   = (p) => <Ic {...p}><path d="m9 6 6 6-6 6"/></Ic>;
const IcClock  = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Ic>;
const IcWarn   = (p) => <Ic {...p}><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.7 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/></Ic>;
const IcMsg    = (p) => <Ic {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></Ic>;
const IcCash   = (p) => <Ic {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></Ic>;
const IcHeart  = (p) => <Ic {...p}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></Ic>;
const IcSparkle= (p) => <Ic {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></Ic>;
const IcSnow   = (p) => <Ic {...p}><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07"/></Ic>;
const IcFlag   = (p) => <Ic {...p}><path d="M4 22V4M4 15h11l-2-4 2-4H4"/></Ic>;

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skel({ style }) {
  return (
    <div
      className="animate-pulse"
      style={{ background: 'var(--surface-3)', borderRadius: 'var(--r-md)', ...style }}
    />
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AV_CLASSES = ['av--blue', 'av--green', 'av--pink', 'av--blue', 'av--green'];

function Av({ name = '', size = 26 }) {
  const parts    = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  const ci       = name.charCodeAt(0) % AV_CLASSES.length;
  return (
    <div
      className={`av ${AV_CLASSES[ci]}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

// ─── Stats row ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, subColor }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value t-mono">{value ?? '—'}</div>
      {sub && (
        <div className="stat-delta">
          <span style={{ color: subColor ?? 'var(--ink-3)' }}>{sub}</span>
        </div>
      )}
    </div>
  );
}

// ─── Tasks card ───────────────────────────────────────────────────────────────

const QUAD_LABELS = { q1: 'דחוף וחשוב', q2: 'חשוב', q3: 'דחוף', q4: 'שגרה' };

function TaskRow({ task, onToggle, onDelete }) {
  const quad = `q${task.quadrant}`;
  return (
    <div className={`task-row${task.completed ? ' is-done' : ''}`}>
      <button
        type="button"
        className={`check-box${task.completed ? ' is-on' : ''}`}
        onClick={() => onToggle(task)}
        aria-label={task.completed ? 'סמן כלא הושלם' : 'סמן כהושלם'}
      >
        {task.completed && <IcCheck size={11} sw={2.4}/>}
      </button>

      <div className="task-title">
        <span style={{ wordBreak: 'break-word' }}>
          {task.text}
        </span>
        {task.source === 'ai' && (
          <span className="chip chip--blue" style={{ fontSize: 10.5, height: 18, padding: '0 6px', flexShrink: 0 }}>AI</span>
        )}
      </div>

      <div className="task-meta">
        {task.client_id && task.client_name && (
          <Link
            to={`/clients/${task.client_id}`}
            className="task-meta"
            style={{ gap: 5 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Av name={task.client_name} size={18} />
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{task.client_name}</span>
          </Link>
        )}
      </div>

      <div className="task-meta" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className="crm-btn crm-btn--ghost crm-btn--icon"
          style={{ width: 22, height: 22, fontSize: 16, opacity: 0, transition: 'opacity .12s' }}
          aria-label="מחק"
          onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = 0)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function AddTaskForm({ onAdd, onClose, clients }) {
  const [text,       setText]       = useState('');
  const [quadrant,   setQuadrant]   = useState(1);
  const [clientId,   setClientId]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ text: text.trim(), quadrant: Number(quadrant), client_id: clientId || null });
      onClose();
    } catch (err) {
      setError(err.message || 'שגיאה');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card"
      style={{ margin: '8px 0', borderRadius: 'var(--r-md)', boxShadow: 'none' }}
      dir="rtl"
    >
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          autoFocus
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="תאר את המשימה..."
          style={{
            height: 36, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
            padding: '0 10px', fontSize: 13, background: 'var(--surface-2)',
            outline: 'none', width: '100%',
          }}
          dir="rtl"
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={quadrant}
            onChange={(e) => setQuadrant(e.target.value)}
            style={{ flex: 1, height: 32, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '0 8px', fontSize: 12, background: 'var(--surface)' }}
          >
            <option value={1}>1 — דחוף + חשוב</option>
            <option value={2}>2 — חשוב + לא דחוף</option>
            <option value={3}>3 — דחוף + לא חשוב</option>
            <option value={4}>4 — לא דחוף + לא חשוב</option>
          </select>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            style={{ flex: 1, height: 32, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '0 8px', fontSize: 12, background: 'var(--surface)' }}
          >
            <option value="">ללא לקוח</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        {error && <p style={{ fontSize: 12, color: 'var(--red-ink)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={!text.trim() || submitting} className="crm-btn crm-btn--primary crm-btn--sm">
            {submitting ? 'מוסיף...' : 'הוסף'}
          </button>
          <button type="button" onClick={onClose} className="crm-btn crm-btn--sm">ביטול</button>
        </div>
      </div>
    </form>
  );
}

const TASK_CATEGORIES = [
  { id: 'q1',      label: 'דחוף וחשוב',  accentColor: 'var(--red-ink)' },
  { id: 'q3',      label: 'דחוף',         accentColor: 'oklch(0.62 0.14 55)' },
  { id: 'q2',      label: 'חשוב',         accentColor: 'var(--blue)' },
  { id: 'q4',      label: 'שגרה',         accentColor: 'var(--ink-3)' },
  { id: 'carried', label: 'עבר מאתמול',   accentColor: 'var(--ink-3)' },
];

function TasksCard() {
  const queryClient = useQueryClient();
  const [openCategory, setOpenCategory] = useState(null);
  const [addOpen,      setAddOpen]      = useState(false);
  const [aiToast,      setAiToast]      = useState(null);

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['daily-tasks'],
    queryFn:  fetchDailyTasks,
    refetchInterval: 120_000,
  });

  const { data: activeClients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn:  () => fetchClients(false),
    enabled:  addOpen,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: createDailyTask,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['daily-tasks'] }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }) => updateDailyTask(id, { completed }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['daily-tasks'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteDailyTask,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['daily-tasks'] }),
  });
  const aiScanMutation = useMutation({
    mutationFn: runAIScan,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['daily-tasks'] });
      setAiToast(data.added);
      setTimeout(() => setAiToast(null), 4000);
    },
  });

  const q1        = tasksData?.q1        ?? [];
  const q2        = tasksData?.q2        ?? [];
  const q3        = tasksData?.q3        ?? [];
  const q4        = tasksData?.q4        ?? [];
  const completed = tasksData?.completed ?? [];
  const all       = [...q1, ...q2, ...q3, ...q4];
  const carried   = all.filter((t) => t.carried_over);
  const done      = completed.length;

  const categoryTasks = { q1, q2, q3, q4, carried };

  function toggleCategory(id) {
    if (!categoryTasks[id]?.length) return;
    setOpenCategory((prev) => (prev === id ? null : id));
  }

  const todayLabel = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2" style={{ fontWeight: 600 }}>משימות שלי היום</div>
          <div className="t-sm t-muted" style={{ marginTop: 5 }}>
            {isLoading ? todayLabel : `${all.length} משימות · ${done} הושלמו`}
          </div>
        </div>
      </div>

      {aiToast !== null && (
        <div style={{ padding: '8px 18px', background: 'var(--blue-soft)', color: 'var(--blue-ink)', fontSize: 13, borderBottom: '1px solid var(--hairline)' }}>
          נוספו {aiToast} משימות חדשות
        </div>
      )}
      {aiScanMutation.isError && (
        <div style={{ padding: '8px 18px', background: 'var(--red-soft)', color: 'var(--red-ink)', fontSize: 13, borderBottom: '1px solid var(--hairline)' }}>
          שגיאה בסריקת AI
        </div>
      )}

      {addOpen && (
        <AddTaskForm
          onAdd={addMutation.mutateAsync}
          onClose={() => setAddOpen(false)}
          clients={activeClients}
        />
      )}

      <div className="card__body" style={{ padding: 0 }}>
        {isLoading ? (
          <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map((i) => <Skel key={i} style={{ height: 40 }} />)}
          </div>
        ) : (
          TASK_CATEGORIES.map(({ id, label, accentColor }) => {
            const tasks   = categoryTasks[id] ?? [];
            const isEmpty = tasks.length === 0;
            const isOpen  = openCategory === id;

            return (
              <div key={id}>
                {/* Accordion header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(id)}
                  disabled={isEmpty}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '11px 18px',
                    background: isOpen ? 'var(--surface-2)' : 'transparent',
                    border: 'none', borderBottom: '1px solid var(--hairline)',
                    cursor: isEmpty ? 'default' : 'pointer',
                    direction: 'rtl', textAlign: 'right',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, color: isEmpty ? 'var(--ink-4)' : 'var(--ink-1)' }}>
                    {label}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      minWidth: 20, textAlign: 'center',
                      padding: '2px 8px', borderRadius: 100,
                      background: isEmpty ? 'var(--surface-3)' : isOpen ? accentColor : 'var(--surface-3)',
                      color: isEmpty ? 'var(--ink-4)' : isOpen ? '#fff' : 'var(--ink-2)',
                      transition: 'background 0.15s, color 0.15s',
                    }}>
                      {tasks.length}
                    </span>
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke={isEmpty ? 'var(--ink-4)' : 'var(--ink-2)'}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}
                      aria-hidden="true"
                    >
                      <path d="m9 6 6 6-6 6"/>
                    </svg>
                  </div>
                </button>

                {/* Expanded task list */}
                {isOpen && (
                  <div style={{ background: 'var(--surface-1)', borderBottom: '2px solid var(--hairline)' }}>
                    {tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onToggle={(t) => toggleMutation.mutate({ id: t.id, completed: !t.completed })}
                        onDelete={(id) => deleteMutation.mutate(id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {done > 0 && (
          <div style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--hairline)',
            fontSize: 12, color: 'var(--ink-4)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <IcCheck size={12} sw={2} />
            {done} משימות הושלמו היום
          </div>
        )}
      </div>

      <div className="card__foot">
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{todayLabel}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="crm-btn crm-btn--ghost crm-btn--sm"
            onClick={() => setAddOpen((v) => !v)}
          >
            + הוסף
          </button>
          <button
            type="button"
            className="crm-btn crm-btn--sm"
            onClick={() => aiScanMutation.mutate()}
            disabled={aiScanMutation.isPending}
            style={{ gap: 5 }}
          >
            <IcSparkle size={12} />
            {aiScanMutation.isPending ? 'סורק...' : 'סריקת AI'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Progress card ────────────────────────────────────────────────────────────

const BAR_COLORS = ['var(--blue)', 'var(--green)', 'oklch(0.65 0.16 295)'];

function ProgressCard({ clients, isLoading }) {
  if (isLoading) {
    return (
      <section className="card">
        <div className="card__head">
          <div className="h-2" style={{ fontWeight: 600 }}>התקדמות מטופלים</div>
        </div>
        <div className="card__body" style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => <Skel key={i} style={{ height: 50 }} />)}
        </div>
      </section>
    );
  }

  if (!clients?.length) return null;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2" style={{ fontWeight: 600 }}>התקדמות מטופלים</div>
          <div className="t-sm t-muted" style={{ marginTop: 2 }}>{clients.length} פעילים</div>
        </div>
        <Link to="/clients" className="crm-btn crm-btn--ghost crm-btn--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          כל המטופלים <IcChev size={12}/>
        </Link>
      </div>
      <div className="card__body">
        {clients.map((r, idx) => {
          const barColor = BAR_COLORS[idx % BAR_COLORS.length];
          return (
            <Link
              key={r.client_id}
              to={`/clients/${r.client_id}`}
              style={{ display: 'block', padding: '10px 18px', textDecoration: 'none', borderBottom: '1px solid var(--hairline)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Av name={r.client_name} size={28} />
                  <span style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.client_name}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {r.sessions_done} / {r.sessions_total} פגישות
                  {' · '}
                  <span style={{ color: barColor, fontWeight: 600 }}>{r.pct}%</span>
                </span>
              </div>
              <div style={{ marginTop: 6, height: 4, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${r.pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.4s ease' }} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ─── Sessions card ────────────────────────────────────────────────────────────

function resolveState(item) {
  if (item.session_scheduled) return ALERT_STATE.GREEN;
  if (item.is_overdue)        return ALERT_STATE.RED;
  return ALERT_STATE.YELLOW;
}

const STATE_CHIP = {
  [ALERT_STATE.GREEN]:  { bg: 'var(--green-soft)', color: 'var(--green-ink)', label: 'נקבעה' },
  [ALERT_STATE.YELLOW]: { bg: 'var(--amber-soft)', color: 'var(--amber-ink)', label: 'ממתין' },
  [ALERT_STATE.RED]:    { bg: 'var(--red-soft)',   color: 'var(--red-ink)',   label: 'עבר'   },
};

function ClientSessRow({ item }) {
  const state = resolveState(item);
  const { bg, color, label } = STATE_CHIP[state];
  return (
    <Link
      to={`/clients/${item.client_id}`}
      className="sess-row"
      style={{ textDecoration: 'none', gridTemplateColumns: '30px 1fr auto' }}
    >
      <Av name={item.client_name} size={30} />
      <div className="sess-body">
        <div className="sess-who">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.client_name}</span>
          <span className="chip" style={{ background: bg, color, borderColor: 'transparent', height: 20, fontSize: 10.5 }}>
            {label}
          </span>
        </div>
        <div className="sess-det">
          פגישה {item.session_number} מתוך 6
          {item.manually_overridden && <span title="תאריך עודכן ידנית" style={{ color: 'var(--amber-ink)' }}>✱</span>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {formatDateHebrew(item.expected_date)}
      </div>
    </Link>
  );
}

function LeadSessRow({ item }) {
  const navigate = useNavigate();
  const timeStr  = formatTimeHebrew(item.start_time);
  const [hh, mm] = timeStr.split(':');
  return (
    <button type="button" className="sess-row" style={{ textAlign: 'right' }} onClick={() => navigate(`/leads/${item.lead_id}`)}>
      <div className="sess-time">
        <span className="sess-hh">{hh}</span>
        <span className="sess-mm">{mm}</span>
      </div>
      <div className="sess-body">
        <div className="sess-who">
          <Av name={item.lead_name} size={22} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.lead_name}</span>
          <span className="chip chip--blue" style={{ height: 20, fontSize: 10.5 }}>היכרות</span>
        </div>
        <div className="sess-det">
          {formatDateHebrew(item.start_time.slice(0, 10))}
        </div>
      </div>
      <button
        className="crm-btn crm-btn--sm"
        type="button"
        onClick={(e) => { e.stopPropagation(); navigate(`/leads/${item.lead_id}`); }}
      >
        הצטרף
      </button>
    </button>
  );
}

// Group meetings by relative day label
const DAY_KEYS   = ['yesterday', 'today', 'tomorrow', 'week'];
const DAY_LABELS = { yesterday: 'אתמול', today: 'היום', tomorrow: 'מחר', week: 'השבוע' };

function groupByDay(clientSessions, leadMeetings) {
  const now       = new Date();
  const todayStr  = now.toISOString().slice(0, 10);
  const d         = (offset) => {
    const d = new Date(now); d.setDate(now.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const yStr = d(-1), tStr = todayStr, tmStr = d(1);

  function bucket(dateStr) {
    if (dateStr === yStr)  return 'yesterday';
    if (dateStr === tStr)  return 'today';
    if (dateStr === tmStr) return 'tomorrow';
    return 'week';
  }

  const groups = { yesterday: [], today: [], tomorrow: [], week: [] };

  for (const item of (clientSessions ?? [])) {
    groups[bucket(item.expected_date)]?.push({ ...item, _type: 'client' });
  }
  for (const item of (leadMeetings ?? [])) {
    groups[bucket(item.start_time.slice(0, 10))]?.push({ ...item, _type: 'lead' });
  }

  DAY_KEYS.forEach((k) => {
    groups[k].sort((a, b) => {
      const aD = a._type === 'lead' ? a.start_time : a.expected_date;
      const bD = b._type === 'lead' ? b.start_time : b.expected_date;
      return aD.localeCompare(bD);
    });
  });

  return groups;
}

function SessionsCard({ clientSessions, leadMeetings, isLoading, isError }) {
  const total  = (clientSessions?.length ?? 0) + (leadMeetings?.length ?? 0);
  const groups = groupByDay(clientSessions, leadMeetings);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2" style={{ fontWeight: 600 }}>פגישות השבוע</div>
          <div className="t-sm t-muted" style={{ marginTop: 5 }}>
            {isLoading ? '...' : `${total} פגישות`}
          </div>
        </div>
        <Link to="/calendly" className="crm-btn crm-btn--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          לוח השבוע <IcChev size={12}/>
        </Link>
      </div>

      <div className="card__body">
        {isLoading ? (
          <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2].map((i) => <Skel key={i} style={{ height: 48 }} />)}
          </div>
        ) : isError ? (
          <div style={{ padding: '16px 18px', color: 'var(--red-ink)', fontSize: 13 }}>שגיאה בטעינת נתונים</div>
        ) : total === 0 ? (
          <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            אין פגישות השבוע
          </div>
        ) : (
          DAY_KEYS.map((key) => {
            const items = groups[key];
            if (!items.length) return null;
            return (
              <div key={key}>
                <div style={{
                  padding: '5px 18px 4px',
                  fontSize: 11, fontWeight: 600,
                  color: key === 'today' ? 'var(--blue-ink)' : 'var(--ink-4)',
                  background: key === 'today' ? 'var(--blue-soft)' : 'var(--surface-2)',
                  borderBottom: '1px solid var(--hairline)',
                  borderTop: '1px solid var(--hairline)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  {DAY_LABELS[key]}
                </div>
                {items.map((item, i) =>
                  item._type === 'lead'
                    ? <LeadSessRow key={item.event_id} item={item} />
                    : <ClientSessRow key={`${item.client_id}-${item.session_number}-${i}`} item={item} />
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// ─── Alerts card ──────────────────────────────────────────────────────────────

function WhatsAppButton({ clientId, phone, triggerEvent, templates }) {
  const template = templates?.find((t) => t.trigger_event === triggerEvent);
  if (!template || !phone) return null;
  async function handleClick(e) {
    e.stopPropagation();
    try {
      const result = await renderTemplate(template.id, clientId);
      window.open(result.whatsapp_link, '_blank', 'noopener');
    } catch {
      window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank', 'noopener');
    }
  }
  return (
    <button onClick={handleClick} className="crm-btn crm-btn--sm" style={{ gap: 4 }}>
      <IcMsg size={12}/>
      <span className="hidden sm:inline">שלח</span>
    </button>
  );
}

const ALERT_DEFS = [
  {
    key: 'processEnded',
    icon: IcFlag, kind: 'is-red',
    filter: (a) => a.process_ended_alert,
    title: 'עבר תאריך סיום',
    body: (a) => `תהליך הסתיים ${formatDateHebrew(a.process_end_date)}`,
    trigger: 'process_ending',
  },
  {
    key: 'endingSoon',
    icon: IcClock, kind: '',
    filter: (a) => a.ending_soon_alert && !a.process_ended_alert,
    title: 'מסתיים בקרוב',
    body: (a) => `${formatDateHebrew(a.process_end_date)} · ${relativeLabel(a.process_end_date)}`,
    trigger: 'process_ending',
  },
  {
    key: 'menu',
    icon: IcMsg, kind: 'is-blue',
    filter: (a) => a.menu_alert,
    title: 'תפריט לא נשלח',
    body: () => 'עברו יותר מיומיים מהפגישה הראשונה',
    trigger: 'menu_sent',
  },
  {
    key: 'overdue',
    icon: IcWarn, kind: 'is-red',
    filter: (a) => a.window_alerts?.some((w) => w.state === ALERT_STATE.RED),
    title: 'חלון פגישה עבר',
    body: (a) => {
      const red = a.window_alerts?.find((w) => w.state === ALERT_STATE.RED);
      return red ? `פגישה ${red.session_number} — הייתה ${formatDateHebrew(red.expected_date)}` : 'חלון פגישה עבר';
    },
    trigger: 'session_reminder',
  },
];

function AlertRow({ item, def, templates, linkPrefix = '/clients' }) {
  const Icon = def.icon;
  return (
    <Link to={`${linkPrefix}/${item.client_id ?? item.id}`} className="alert-row" style={{ textDecoration: 'none' }}>
      <div className={`alert-ic ${def.kind}`}><Icon size={13}/></div>
      <div>
        <div className="alert-title">{item.client_name ?? item.full_name}</div>
        <div className="alert-body">{def.body(item)}</div>
      </div>
      <WhatsAppButton
        clientId={item.client_id ?? item.id}
        phone={item.phone}
        triggerEvent={def.trigger}
        templates={templates}
      />
    </Link>
  );
}

const PAYMENT_LABEL = { partial: 'תשלום חלקי', unpaid: 'טרם שולם' };

function AlertsCard({ alerts, frozenLeads, retentionAlerts, unpaidClients, templates, isLoading, isError }) {
  const sections = [];

  if (!isLoading && !isError) {
    ALERT_DEFS.forEach((def) => {
      const items = (alerts ?? []).filter(def.filter);
      if (items.length) sections.push({ type: 'clients', def, items });
    });

    if (frozenLeads?.length) {
      sections.push({
        type: 'frozen',
        def: { icon: IcSnow, kind: '', title: 'לידים קפואים', body: (a) => `קפוא מזה ${a.days_frozen} ימים`, trigger: null },
        items: frozenLeads,
        linkPrefix: '/leads',
      });
    }
    if (retentionAlerts?.length) {
      sections.push({
        type: 'retention',
        def: { icon: IcHeart, kind: 'is-green', title: 'לקוחות ללא קשר', body: (a) => `לא היה קשר מזה ${a.days_since_contact} ימים`, trigger: 'weekly_checkin' },
        items: retentionAlerts.map((r) => ({ ...r, client_id: r.id, client_name: r.full_name })),
      });
    }
    if (unpaidClients?.length) {
      sections.push({
        type: 'unpaid',
        def: { icon: IcCash, kind: 'is-red', title: 'תשלומים פתוחים', body: (u) => u.package_price > 0 ? `${(u.package_price - u.total_paid).toLocaleString()} ₪ יתרה` : PAYMENT_LABEL[u.payment_status] ?? u.payment_status, trigger: 'payment_reminder' },
        items: unpaidClients.map((u) => ({ ...u, client_id: u.id, client_name: u.full_name })),
      });
    }
  }

  const totalCount = sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2" style={{ fontWeight: 600 }}>התראות</div>
          <div className="t-sm t-muted" style={{ marginTop: 5 }}>
            {isLoading ? '...' : totalCount > 0 ? `${totalCount} פריטים דורשים טיפול` : 'הכל תקין'}
          </div>
        </div>
      </div>

      <div className="card__body">
        {isLoading ? (
          <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2].map((i) => <Skel key={i} style={{ height: 48 }} />)}
          </div>
        ) : isError ? (
          <div style={{ padding: '16px 18px', color: 'var(--red-ink)', fontSize: 13 }}>שגיאה</div>
        ) : totalCount === 0 ? (
          <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            כל הלקוחות על המסלול הנכון ✓
          </div>
        ) : (
          sections.map((sec) =>
            sec.items.map((item) => (
              <AlertRow
                key={`${sec.type}-${item.client_id ?? item.id}`}
                item={item}
                def={sec.def}
                templates={templates}
                linkPrefix={sec.linkPrefix}
              />
            ))
          )
        )}
      </div>
    </section>
  );
}

// ─── Admin repair ─────────────────────────────────────────────────────────────

function AdminRepairButton() {
  const [status, setStatus] = useState('idle');
  const [count,  setCount]  = useState(0);

  async function handleRepair() {
    setStatus('loading');
    try {
      const result = await repairAIAssessments();
      setCount(result.repaired ?? 0);
      setStatus('done');
    } catch { setStatus('idle'); }
  }

  if (status === 'done') {
    return <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--green-ink)', margin: 0 }}>תוקנו {count} הערכות AI</p>;
  }
  return (
    <button
      onClick={handleRepair}
      disabled={status === 'loading'}
      style={{ width: '100%', fontSize: 11.5, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
    >
      {status === 'loading' ? 'מתקן...' : 'תקן הערכות AI חסרות'}
    </button>
  );
}

// ─── AI Recommendations card ──────────────────────────────────────────────────

const REC_PRIORITY_STYLE = {
  urgent: { bg: 'var(--red-surface, #fff1f1)', ink: 'oklch(0.55 0.18 25)', label: 'דחוף' },
  medium: { bg: 'oklch(0.98 0.04 60)',         ink: 'oklch(0.58 0.15 55)', label: 'בינוני' },
  low:    { bg: 'var(--surface-2)',             ink: 'var(--ink-3)',        label: 'נמוך' },
};

const REC_TYPE_LABEL = {
  weight_missing:          'חסר משקל',
  weight_not_progressing:  'קיפאון במשקל',
  no_contact:              'אין קשר',
  upcoming_meeting:        'פגישה קרובה',
  blood_test_due:          'בדיקות דם',
  motivation_drop:         'ירידה במוטיבציה',
  menu_update_needed:      'תפריט לעדכון',
};

function RecRow({ rec, onDismiss, onSent }) {
  const [expanded, setExpanded] = useState(false);
  const pStyle = REC_PRIORITY_STYLE[rec.priority] || REC_PRIORITY_STYLE.low;

  function buildWaLink() {
    const phone = (rec.client_phone || '').replace(/\D/g, '');
    if (!phone || !rec.message_draft) return null;
    return `https://wa.me/${phone.startsWith('0') ? '972' + phone.slice(1) : phone}?text=${encodeURIComponent(rec.message_draft)}`;
  }

  const waLink = buildWaLink();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '10px 14px', borderRadius: 'var(--r-sm)',
      background: pStyle.bg, border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 20,
          background: pStyle.ink, color: '#fff', flexShrink: 0,
        }}>{pStyle.label}</span>

        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', flexShrink: 0 }}>
          {REC_TYPE_LABEL[rec.type] || rec.type}
        </span>

        <Link to={`/clients/${rec.client_id}`} style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {rec.client_name}
        </Link>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {rec.message_draft && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="crm-btn crm-btn--ghost"
              style={{ height: 26, fontSize: 11.5, padding: '0 8px' }}
            >
              {expanded ? 'הסתר' : 'הצג הודעה'}
            </button>
          )}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="crm-btn crm-btn--primary"
              style={{ height: 26, fontSize: 11.5, padding: '0 8px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              onClick={() => onSent(rec.id)}
            >
              שלח
            </a>
          )}
          <button
            type="button"
            onClick={() => onDismiss(rec.id)}
            className="crm-btn crm-btn--ghost"
            style={{ height: 26, fontSize: 11.5, padding: '0 8px', opacity: 0.6 }}
          >
            סגור
          </button>
        </div>
      </div>

      {rec.action_suggestion && (
        <div style={{ fontSize: 12, color: 'var(--ink-2)', paddingRight: 2 }}>
          {rec.action_suggestion}
        </div>
      )}

      {expanded && rec.message_draft && (
        <div style={{
          fontSize: 12.5, color: 'var(--ink-1)', background: 'var(--surface-1)',
          border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
          padding: '8px 12px', whiteSpace: 'pre-wrap', direction: 'rtl',
        }}>
          {rec.message_draft}
        </div>
      )}
    </div>
  );
}

function AIRecommendationsCard() {
  const queryClient = useQueryClient();

  const { data: recs, isLoading } = useQuery({
    queryKey: ['ai-recommendations'],
    queryFn:  fetchAIRecommendations,
    refetchInterval: 5 * 60 * 1000,
  });

  const dismissMut = useMutation({
    mutationFn: dismissRecommendation,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] }),
  });

  const sentMut = useMutation({
    mutationFn: markRecommendationSent,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] }),
  });

  const [running, setRunning] = useState(false);
  async function handleRun() {
    setRunning(true);
    try { await runAIAnalysis(); setTimeout(() => queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] }), 3000); }
    finally { setRunning(false); }
  }

  if (isLoading) {
    return (
      <div className="card" style={{ padding: '16px 20px' }}>
        <Skel style={{ height: 18, width: 140, marginBottom: 10 }} />
        <Skel style={{ height: 52 }} />
      </div>
    );
  }

  const list = recs ?? [];

  if (list.length === 0) return null;

  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <IcSparkle size={14} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>המלצות AI</span>
        <span className="chip chip--blue" style={{ fontSize: 10.5, height: 18, padding: '0 7px' }}>{list.length}</span>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="crm-btn crm-btn--ghost"
          style={{ marginRight: 'auto', height: 26, fontSize: 11.5, padding: '0 8px', opacity: 0.7 }}
        >
          {running ? 'סורק...' : 'עדכן'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((rec) => (
          <RecRow
            key={rec.id}
            rec={rec}
            onDismiss={(id) => dismissMut.mutate(id)}
            onSent={(id) => sentMut.mutate(id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: dashboard, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  fetchDashboard,
    refetchInterval: 60_000,
  });

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn:  fetchTemplates,
  });

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';

  const todayStr      = new Date().toISOString().slice(0, 10);
  const todayLong     = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayMeetings = (dashboard?.lead_meetings ?? []).filter(
    (m) => m.start_time?.slice(0, 10) === todayStr
  ).length;

  const counters    = dashboard?.counters;
  const totalAlerts = (dashboard?.alerts?.length ?? 0)
    + (dashboard?.unpaid_clients?.length ?? 0)
    + (dashboard?.frozen_leads?.length ?? 0)
    + (dashboard?.retention_alerts?.length ?? 0);

  return (
    <div className="crm-page">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-head">
        <div>
          <div className="page-title">{greeting}, נתנאל</div>
          <div className="page-sub">
            {todayLong}
            {counters && ` · ${counters.active_clients} מטופלים פעילים · ${todayMeetings} פגישות היום`}
          </div>
        </div>
        <div className="page-actions">
          <Link to="/ai" className="crm-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IcSparkle size={12} />
            עוזר AI
          </Link>
          <Link to="/calendly" className="crm-btn crm-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            קבע פגישה +
          </Link>
        </div>
      </div>

      {/* ── AI Recommendations ───────────────────────────────────────── */}
      <AIRecommendationsCard />

      {/* ── Stats row ────────────────────────────────────────────────── */}
      <div className="dash-stats">
        {isLoading ? (
          [1, 2, 3, 4].map((i) => <Skel key={i} style={{ height: 80 }} />)
        ) : isError ? (
          <p style={{ gridColumn: '1 / -1', color: 'var(--red-ink)', fontSize: 13 }}>שגיאה בטעינת נתונים</p>
        ) : (
          <>
            <StatCard
              label="מטופלים פעילים"
              value={counters.active_clients}
              sub={counters.new_clients_this_month > 0 ? `+${counters.new_clients_this_month} החודש` : null}
              subColor="var(--blue)"
            />
            <StatCard
              label="לידים חדשים החודש"
              value={counters.leads_this_month}
              sub={counters.leads_this_month > 0 ? 'פעילים' : null}
              subColor="var(--green)"
            />
            <StatCard
              label="פגישות השבוע"
              value={counters.sessions_this_week}
              sub={counters.sessions_this_week > 0 ? `${counters.sessions_this_week} קבועות` : null}
              subColor="oklch(0.65 0.14 55)"
            />
            <StatCard
              label="התראות פתוחות"
              value={totalAlerts}
              sub={totalAlerts > 0 ? 'דורשות טיפול' : 'הכל תקין'}
              subColor={totalAlerts > 0 ? 'oklch(0.6 0.18 295)' : 'var(--green)'}
            />
          </>
        )}
      </div>

      {/* ── Main grid ────────────────────────────────────────────────── */}
      <div className="dash-grid">

        {/* Left column: Tasks (top) + Alerts (bottom) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <TasksCard />
          <AlertsCard
            alerts={dashboard?.alerts ?? []}
            frozenLeads={dashboard?.frozen_leads}
            retentionAlerts={dashboard?.retention_alerts}
            unpaidClients={dashboard?.unpaid_clients}
            templates={templates}
            isLoading={isLoading}
            isError={isError}
          />
          <AdminRepairButton />
        </div>

        {/* Right column: Sessions (top) + Progress (bottom) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SessionsCard
            clientSessions={dashboard?.client_sessions}
            leadMeetings={dashboard?.lead_meetings}
            isLoading={isLoading}
            isError={isError}
          />
          <ProgressCard
            clients={dashboard?.clients_progress}
            isLoading={isLoading}
          />
          {!isLoading && !isError && counters?.active_clients === 0 && (
            <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 12px' }}>עדיין אין מטופלים פעילים</p>
              <Link to="/clients" className="crm-btn crm-btn--primary">
                הוסף את המטופל הראשון שלך
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
