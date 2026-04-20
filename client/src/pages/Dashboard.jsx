import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchDashboard, fetchTemplates, renderTemplate, repairAIAssessments,
  fetchDailyTasks, createDailyTask, updateDailyTask, deleteDailyTask, runAIScan,
  fetchClients,
} from '../lib/api';
import { formatDateHebrew, formatTimeHebrew, relativeLabel } from '../lib/dates';
import { useAlertColor } from '../hooks/useAlertColor';
import AlertBadge from '../components/ui/AlertBadge';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import { ALERT_STATE } from '../constants/statuses';

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

// ─── Section 1: This week's sessions ─────────────────────────────────────────

function SessionStateOrder(state) {
  if (state === ALERT_STATE.RED)    return 0;
  if (state === ALERT_STATE.YELLOW) return 1;
  if (state === ALERT_STATE.GREEN)  return 2;
  return 3;
}

function WeeklySessionCard({ item }) {
  // Determine alert state from session_scheduled + the data
  const state = item.session_scheduled
    ? ALERT_STATE.GREEN
    : item.is_overdue
    ? ALERT_STATE.RED
    : ALERT_STATE.YELLOW;

  const { border, bg } = useAlertColor(state);

  return (
    <Link
      to={`/clients/${item.client_id}`}
      className={`block rounded-xl border p-4 hover:shadow-sm transition-shadow ${border} ${bg}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{item.client_name}</p>
          <p className="text-sm text-gray-500 mt-0.5">
            פגישה {item.session_number} מתוך 6
          </p>
          <p className="text-xs text-gray-400 mt-1">
            תאריך צפוי: {formatDateHebrew(item.expected_date)}
            {' · '}
            {relativeLabel(item.expected_date)}
            {item.manually_overridden && (
              <span className="mr-1 text-orange-500" title="תאריך עודכן ידנית">✱</span>
            )}
          </p>
        </div>
        <AlertBadge
          state={state}
          label={item.session_scheduled ? 'נקבעה' : state === ALERT_STATE.RED ? 'עברה' : 'ממתין'}
        />
      </div>
    </Link>
  );
}

function resolveState(item) {
  if (item.session_scheduled) return ALERT_STATE.GREEN;
  if (item.is_overdue)         return ALERT_STATE.RED;
  return ALERT_STATE.YELLOW;
}

function ClientSessions({ data }) {
  if (!data || data.length === 0) {
    return <EmptyState message="אין פגישות לקוחות השבוע" sub="לקוחות שחלון הפגישה שלהם חל השבוע יופיעו כאן" />;
  }

  const sorted = [...data].sort(
    (a, b) => SessionStateOrder(resolveState(a)) - SessionStateOrder(resolveState(b))
  );

  return (
    <div className="space-y-3">
      {sorted.map((item, i) => (
        <WeeklySessionCard key={`${item.client_id}-${item.session_number}-${i}`} item={item} />
      ))}
    </div>
  );
}

// ─── Lead meeting card ────────────────────────────────────────────────────────

function LeadMeetingCard({ item }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/leads/${item.lead_id}`)}
      className="w-full text-right block rounded-xl border border-purple-200 bg-purple-50 p-4 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{item.lead_name}</p>
          {item.phone && (
            <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{item.phone}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">
            {formatDateHebrew(item.start_time.slice(0, 10))}
            {' · '}
            {formatTimeHebrew(item.start_time)}
          </p>
        </div>
        <span className="flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
          פגישת היכרות
        </span>
      </div>
    </button>
  );
}

function LeadMeetings({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="space-y-3">
      {data.map((item) => (
        <LeadMeetingCard key={item.event_id} item={item} />
      ))}
    </div>
  );
}

// ─── Section 2: Alerts ────────────────────────────────────────────────────────

function WhatsAppButton({ clientId, phone, triggerEvent, templates }) {
  const template = templates?.find((t) => t.trigger_event === triggerEvent);
  if (!template || !phone) return null;

  async function handleClick() {
    try {
      const result = await renderTemplate(template.id, clientId);
      window.open(result.whatsapp_link, '_blank', 'noopener');
    } catch {
      // Fallback: open WhatsApp with just the phone
      window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank', 'noopener');
    }
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 text-xs font-medium hover:bg-green-100 transition-colors flex-shrink-0"
    >
      <span>💬</span>
      <span>שלח WhatsApp</span>
    </button>
  );
}

function AlertRow({ clientId, clientName, phone, description, triggerEvent, templates }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <Link
          to={`/clients/${clientId}`}
          className="font-medium text-gray-900 hover:text-indigo-600 transition-colors text-sm"
        >
          {clientName}
        </Link>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <WhatsAppButton
        clientId={clientId}
        phone={phone}
        triggerEvent={triggerEvent}
        templates={templates}
      />
    </div>
  );
}

function AlertsSection({ alerts, templates }) {
  const processEnded   = alerts.filter((a) => a.process_ended_alert);
  const endingSoon     = alerts.filter((a) => a.ending_soon_alert && !a.process_ended_alert);
  const menuMissing    = alerts.filter((a) => a.menu_alert);
  const overdueWindows = alerts.filter((a) => a.window_alerts?.some((w) => w.state === ALERT_STATE.RED));

  const hasAny = processEnded.length || endingSoon.length || menuMissing.length || overdueWindows.length;

  if (!hasAny) {
    return <EmptyState message="אין התראות פעילות" sub="כל הלקוחות על המסלול הנכון" />;
  }

  return (
    <div className="space-y-5">
      {processEnded.length > 0 && (
        <AlertGroup title="עברו את תאריך הסיום" color="text-red-600" items={processEnded}
          description={(a) => `תהליך הסתיים בתאריך ${formatDateHebrew(a.process_end_date)}`}
          triggerEvent="process_ending" templates={templates} />
      )}
      {endingSoon.length > 0 && (
        <AlertGroup title="מסיימים בקרוב" color="text-orange-600" items={endingSoon}
          description={(a) => `תהליך מסתיים בתאריך ${formatDateHebrew(a.process_end_date)} · ${relativeLabel(a.process_end_date)}`}
          triggerEvent="process_ending" templates={templates} />
      )}
      {menuMissing.length > 0 && (
        <AlertGroup title="תפריט לא נשלח" color="text-yellow-700" items={menuMissing}
          description={() => 'עברו יותר מיומיים מאז הפגישה הראשונה'}
          triggerEvent="menu_sent" templates={templates} />
      )}
      {overdueWindows.length > 0 && (
        <AlertGroup title="חלון פגישה עבר" color="text-red-600" items={overdueWindows}
          description={(a) => {
            const red = a.window_alerts?.find((w) => w.state === ALERT_STATE.RED);
            return red
              ? `פגישה ${red.session_number} — הייתה אמורה להתקיים ${formatDateHebrew(red.expected_date)}`
              : 'חלון פגישה עבר ללא תיעוד';
          }}
          triggerEvent="session_reminder" templates={templates} />
      )}
    </div>
  );
}

function AlertGroup({ title, color, items, description, triggerEvent, templates }) {
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${color}`}>{title}</h3>
      <div className="bg-white rounded-xl border border-gray-200 px-4 divide-y divide-gray-100">
        {items.map((a) => (
          <AlertRow
            key={a.client_id}
            clientId={a.client_id}
            clientName={a.client_name}
            phone={a.phone}
            description={description(a)}
            triggerEvent={triggerEvent}
            templates={templates}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Section: Frozen leads ────────────────────────────────────────────────────

function FrozenLeadRow({ item }) {
  function handleWhatsApp(e) {
    e.stopPropagation();
    if (item.phone) {
      window.open(`https://wa.me/${item.phone.replace(/\D/g, '')}`, '_blank', 'noopener');
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <Link
          to={`/leads/${item.id}`}
          className="font-medium text-gray-900 hover:text-indigo-600 transition-colors text-sm"
        >
          {item.full_name}
        </Link>
        <p className="text-xs text-gray-500 mt-0.5">קפוא מזה {item.days_frozen} ימים</p>
      </div>
      {item.phone && (
        <button
          onClick={handleWhatsApp}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 text-xs font-medium hover:bg-green-100 transition-colors flex-shrink-0"
        >
          <span>💬</span>
          <span>WhatsApp</span>
        </button>
      )}
    </div>
  );
}

function FrozenLeadsSection({ frozenLeads }) {
  if (!frozenLeads || frozenLeads.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 text-orange-600">לידים קפואים</h3>
      <div className="bg-white rounded-xl border border-gray-200 px-4 divide-y divide-gray-100">
        {frozenLeads.map((item) => (
          <FrozenLeadRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

// ─── Section: Retention alerts ────────────────────────────────────────────────

function RetentionSection({ retentionAlerts, templates }) {
  if (!retentionAlerts || retentionAlerts.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 text-purple-600">לקוחות ללא קשר</h3>
      <div className="bg-white rounded-xl border border-gray-200 px-4 divide-y divide-gray-100">
        {retentionAlerts.map((item) => (
          <AlertRow
            key={item.id}
            clientId={item.id}
            clientName={item.full_name}
            phone={item.phone}
            description={`לא היה קשר מזה ${item.days_since_contact} ימים`}
            triggerEvent="weekly_checkin"
            templates={templates}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Section: Unpaid clients ──────────────────────────────────────────────────

const PAYMENT_STATUS_LABEL = {
  partial: 'תשלום חלקי',
  unpaid:  'טרם שולם',
};

function UnpaidClientsSection({ unpaidClients, templates }) {
  if (!unpaidClients || unpaidClients.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 text-red-600">תשלומים פתוחים</h3>
      <div className="bg-white rounded-xl border border-gray-200 px-4 divide-y divide-gray-100">
        {unpaidClients.map((item) => {
          const owed = item.package_price > 0
            ? `${(item.package_price - item.total_paid).toLocaleString()} ₪ יתרה`
            : PAYMENT_STATUS_LABEL[item.payment_status] ?? item.payment_status;
          return (
            <AlertRow
              key={item.id}
              clientId={item.id}
              clientName={item.full_name}
              phone={item.phone}
              description={owed}
              triggerEvent="payment_reminder"
              templates={templates}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Section 3: Summary counters ─────────────────────────────────────────────

function Counters({ counters }) {
  return (
    <div className="flex gap-3">
      <StatCard value={counters.active_clients}   label="לקוחות פעילים"  color="text-indigo-600" />
      <StatCard value={counters.leads_this_month} label="לידים החודש"    color="text-purple-600" />
      <StatCard value={counters.sessions_this_week} label="פגישות השבוע"  color="text-green-600"  />
    </div>
  );
}

// ─── Admin: repair missing AI assessments ────────────────────────────────────

function AdminRepairButton() {
  const [status, setStatus] = useState('idle'); // idle | loading | done
  const [repairedCount, setRepairedCount] = useState(0);

  async function handleRepair() {
    setStatus('loading');
    try {
      const result = await repairAIAssessments();
      setRepairedCount(result.repaired ?? 0);
      setStatus('done');
    } catch {
      setStatus('idle');
    }
  }

  if (status === 'done') {
    return (
      <p className="text-xs text-center text-green-600">
        תוקנו {repairedCount} הערכות AI
      </p>
    );
  }

  return (
    <button
      onClick={handleRepair}
      disabled={status === 'loading'}
      className="w-full text-xs text-gray-400 hover:text-gray-600 py-2 transition-colors disabled:opacity-50"
    >
      {status === 'loading' ? 'מתקן...' : 'תקן הערכות AI חסרות'}
    </button>
  );
}

// ─── Daily Tasks — Eisenhower Matrix ─────────────────────────────────────────

const QUADRANT_CONFIG = [
  { q: 1, label: 'דחוף + חשוב',       sub: 'בצע עכשיו', border: '#E24B4A', headerBg: 'rgba(226,75,74,0.08)',    badge: 'bg-red-100 text-red-700'    },
  { q: 2, label: 'חשוב + לא דחוף',    sub: 'תכנן',       border: '#567DBF', headerBg: 'rgba(86,125,191,0.08)',   badge: 'bg-blue-100 text-blue-700'  },
  { q: 3, label: 'דחוף + לא חשוב',    sub: 'האצל',       border: '#BA7517', headerBg: 'rgba(186,117,23,0.08)',   badge: 'bg-amber-100 text-amber-700' },
  { q: 4, label: 'לא דחוף + לא חשוב', sub: 'בטל',        border: '#888780', headerBg: 'rgba(136,135,128,0.08)', badge: 'bg-gray-100 text-gray-600'  },
];

function TaskItem({ task, onToggle, onDelete }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0 group">
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onToggle(task)}
        className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded border transition-colors flex items-center justify-center ${
          task.completed
            ? 'bg-green-500 border-green-500'
            : 'border-gray-300 hover:border-indigo-400 bg-white'
        }`}
        aria-label={task.completed ? 'סמן כלא הושלם' : 'סמן כהושלם'}
      >
        {task.completed && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug transition-all duration-200 ${
          task.completed ? 'line-through text-gray-400' : 'text-gray-800'
        }`}>
          {task.text}
        </p>
        {(task.client_id || task.source === 'ai' || task.carried_over) && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {task.client_id && task.client_name && (
              <Link
                to={`/clients/${task.client_id}`}
                className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
              >
                {task.client_name}
              </Link>
            )}
            {task.source === 'ai' && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: '#EEEDFE', color: '#534AB7' }}
              >
                AI
              </span>
            )}
            {!!task.carried_over && (
              <span className="text-xs text-gray-400">עבר מאתמול</span>
            )}
          </div>
        )}
      </div>

      {/* Delete (visible on hover) */}
      <button
        type="button"
        onClick={() => onDelete(task.id)}
        className="flex-shrink-0 text-lg leading-none text-gray-300 hover:text-red-400 transition-all duration-150 opacity-0 group-hover:opacity-100"
        aria-label="מחק משימה"
      >
        ×
      </button>
    </div>
  );
}

function QuadrantCard({ config, tasks, onToggle, onDelete }) {
  return (
    <div
      className="rounded-xl border-2 overflow-hidden bg-white"
      style={{ borderColor: config.border }}
    >
      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center justify-between"
        style={{ background: config.headerBg }}
      >
        <div>
          <p className="text-xs font-semibold text-gray-700 leading-tight">{config.label}</p>
          <p className="text-xs text-gray-400">{config.sub}</p>
        </div>
        {tasks.length > 0 && (
          <span className={`text-xs font-bold min-w-[1.25rem] h-5 px-1 rounded-full flex items-center justify-center ${config.badge}`}>
            {tasks.length}
          </span>
        )}
      </div>

      {/* Tasks */}
      <div className="px-3">
        {tasks.length === 0 ? (
          <p className="text-xs text-gray-300 py-4 text-center">אין משימות</p>
        ) : (
          tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))
        )}
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
      setError(err.message || 'שגיאה בהוספת המשימה');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3"
      dir="rtl"
    >
      <input
        autoFocus
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="תאר את המשימה..."
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        dir="rtl"
      />
      <div className="flex gap-2 flex-wrap">
        <select
          value={quadrant}
          onChange={(e) => setQuadrant(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value={1}>1 — דחוף + חשוב</option>
          <option value={2}>2 — חשוב + לא דחוף</option>
          <option value={3}>3 — דחוף + לא חשוב</option>
          <option value={4}>4 — לא דחוף + לא חשוב</option>
        </select>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">ללא לקוח</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.full_name}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!text.trim() || submitting}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {submitting ? 'מוסיף...' : 'הוסף'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

function DailyTasksSection() {
  const queryClient = useQueryClient();
  const [addOpen,          setAddOpen]          = useState(false);
  const [aiToast,          setAiToast]          = useState(null);
  const [expandCompleted,  setExpandCompleted]  = useState(false);

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
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

  const todayLabel = new Date().toLocaleDateString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const q1        = tasksData?.q1        ?? [];
  const q2        = tasksData?.q2        ?? [];
  const q3        = tasksData?.q3        ?? [];
  const q4        = tasksData?.q4        ?? [];
  const completed = tasksData?.completed ?? [];
  const totalActive = q1.length + q2.length + q3.length + q4.length;
  const quadrantTasks = [q1, q2, q3, q4];

  function handleToggle(task) {
    toggleMutation.mutate({ id: task.id, completed: !task.completed });
  }

  function handleDelete(id) {
    deleteMutation.mutate(id);
  }

  return (
    <section>
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-700">משימות היום</h2>
          <p className="text-xs text-gray-400 mt-0.5">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="text-sm px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            + הוסף משימה
          </button>
          <button
            type="button"
            onClick={() => aiScanMutation.mutate()}
            disabled={aiScanMutation.isPending}
            className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>✨</span>
            <span>{aiScanMutation.isPending ? 'סורק לקוחות...' : 'סריקת AI'}</span>
          </button>
        </div>
      </div>

      {/* AI success toast */}
      {aiToast !== null && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-700 font-medium">
          נוספו {aiToast} משימות חדשות
        </div>
      )}

      {/* AI error */}
      {aiScanMutation.isError && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
          שגיאה בסריקת AI — {aiScanMutation.error?.message}
        </div>
      )}

      {/* Add task form */}
      {addOpen && (
        <div className="mb-4">
          <AddTaskForm
            onAdd={addMutation.mutateAsync}
            onClose={() => setAddOpen(false)}
            clients={activeClients}
          />
        </div>
      )}

      {/* Loading skeleton */}
      {tasksLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse bg-gray-200 rounded-xl h-32" />
          ))}
        </div>
      ) : (
        <>
          {/* Empty state — no tasks at all */}
          {totalActive === 0 && completed.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-sm text-gray-400 mb-1">אין משימות להיום</p>
              <p className="text-xs text-gray-300">לחץ על "סריקת AI" לקבלת המלצות, או הוסף משימה ידנית</p>
            </div>
          ) : (
            <>
              {/* 2×2 Eisenhower Matrix */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {QUADRANT_CONFIG.map((config, idx) => (
                  <QuadrantCard
                    key={config.q}
                    config={config}
                    tasks={quadrantTasks[idx]}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                  />
                ))}
              </div>

              {/* Completed tasks — collapsed */}
              {completed.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setExpandCompleted((v) => !v)}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <span className="text-xs">{expandCompleted ? '▲' : '▼'}</span>
                    <span>הושלמו היום ({completed.length})</span>
                  </button>
                  {expandCompleted && (
                    <div className="mt-2 bg-white rounded-xl border border-gray-200 px-3">
                      {completed.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onToggle={handleToggle}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: dashboard, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 60_000,
  });

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  });

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">לוח בקרה</h1>
        <p className="text-sm text-gray-400 mt-0.5">סקירה יומית של הפגישות וההתראות</p>
      </div>

      {/* Section 0 — Daily Tasks */}
      <DailyTasksSection />

      {/* Section 3 — Counters (shown first for quick scan) */}
      {isLoading ? (
        <div className="flex gap-3">
          <Skeleton className="h-24 flex-1" />
          <Skeleton className="h-24 flex-1" />
          <Skeleton className="h-24 flex-1" />
        </div>
      ) : isError ? (
        <p className="text-red-500 text-sm">שגיאה בטעינת הנתונים.</p>
      ) : (
        <>
          <Counters counters={dashboard.counters} />
          {dashboard.counters.active_clients === 0 && (
            <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500 text-sm mb-3">עדיין אין לקוחות פעילים</p>
              <Link to="/clients" className="inline-flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                הוסף את הלקוח הראשון שלך
              </Link>
            </div>
          )}
        </>
      )}

      {/* Section 1 — This week's sessions */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">הפגישות השבוע</h2>
        {isLoading ? (
          <SectionSkeleton />
        ) : isError ? (
          <p className="text-red-500 text-sm">לא ניתן לטעון את הפגישות.</p>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">פגישות לקוחות</h3>
              <ClientSessions data={dashboard.client_sessions} />
            </div>
            {dashboard.lead_meetings?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-purple-600 mb-2">פגישות היכרות עם לידים</h3>
                <LeadMeetings data={dashboard.lead_meetings} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 2 — Alerts */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">התראות</h2>
        {isLoading ? (
          <SectionSkeleton />
        ) : isError ? (
          <p className="text-red-500 text-sm">לא ניתן לטעון את ההתראות.</p>
        ) : (
          <div className="space-y-6">
            <AlertsSection alerts={dashboard.alerts} templates={templates} />
            <FrozenLeadsSection frozenLeads={dashboard.frozen_leads} />
            <RetentionSection retentionAlerts={dashboard.retention_alerts} templates={templates} />
            <UnpaidClientsSection unpaidClients={dashboard.unpaid_clients} templates={templates} />
          </div>
        )}
      </section>

      {/* Admin */}
      <AdminRepairButton />
    </div>
  );
}
