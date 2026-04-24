import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchDashboard, fetchTemplates, renderTemplate, repairAIAssessments,
  fetchDailyTasks, createDailyTask, updateDailyTask, deleteDailyTask, runAIScan,
  fetchClients,
} from '../lib/api';
import { formatDateHebrew, formatTimeHebrew, relativeLabel } from '../lib/dates';
import EmptyState from '../components/ui/EmptyState';
import { ALERT_STATE } from '../constants/statuses';

// ─── Design tokens ────────────────────────────────────────────────────────────

const CANVAS = '#fcf4f9';
const BLUE   = '#567DBF';
const GREEN  = '#31B996';

// ─── Utilities ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [BLUE, GREEN, '#9B59B6', '#E24B4A', '#BA7517', '#27AE60'];

function Avatar({ name, size = 32 }) {
  const parts   = (name || '').trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] || '?').slice(0, 2);
  const colorIdx = (name || '').charCodeAt(0) % AVATAR_COLORS.length;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: '50%',
        background: AVATAR_COLORS[colorIdx], color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.375), fontWeight: 700,
        flexShrink: 0, letterSpacing: '-0.5px', userSelect: 'none',
      }}
    >
      {initials}
    </div>
  );
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-100 rounded-xl ${className}`} />;
}

function Card({ title, icon, badge, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {icon && <span className="text-sm leading-none">{icon}</span>}
            <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          </div>
          {badge != null && (
            <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {badge}
            </span>
          )}
        </div>
      )}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

// ─── Stat counters ────────────────────────────────────────────────────────────

function CounterChip({ value, label, color }) {
  return (
    <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center min-w-0">
      <div className="text-2xl font-bold" style={{ color }}>{value ?? '—'}</div>
      <div className="text-xs text-gray-400 mt-1 leading-tight">{label}</div>
    </div>
  );
}

function Counters({ counters }) {
  return (
    <div className="flex gap-3">
      <CounterChip value={counters.active_clients}     label="לקוחות פעילים"  color={BLUE}    />
      <CounterChip value={counters.leads_this_month}   label="לידים החודש"    color="#9B59B6" />
      <CounterChip value={counters.sessions_this_week} label="פגישות השבוע"   color={GREEN}   />
    </div>
  );
}

// ─── Session state helpers ────────────────────────────────────────────────────

function resolveState(item) {
  if (item.session_scheduled) return ALERT_STATE.GREEN;
  if (item.is_overdue)        return ALERT_STATE.RED;
  return ALERT_STATE.YELLOW;
}

function sessionStateOrder(state) {
  if (state === ALERT_STATE.RED)    return 0;
  if (state === ALERT_STATE.YELLOW) return 1;
  if (state === ALERT_STATE.GREEN)  return 2;
  return 3;
}

const STATE_STYLE = {
  [ALERT_STATE.GREEN]:  { bg: 'rgba(49,185,150,0.12)', color: '#31B996', label: 'נקבעה' },
  [ALERT_STATE.YELLOW]: { bg: 'rgba(245,158,11,0.12)',  color: '#D97706', label: 'ממתין' },
  [ALERT_STATE.RED]:    { bg: 'rgba(226,75,74,0.12)',   color: '#E24B4A', label: 'עבר'   },
};

// ─── Sessions card ────────────────────────────────────────────────────────────

function ClientSessionRow({ item }) {
  const state = resolveState(item);
  const { bg, color, label } = STATE_STYLE[state];

  return (
    <Link
      to={`/clients/${item.client_id}`}
      className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors rounded-lg px-1 -mx-1 group"
    >
      <Avatar name={item.client_name} size={34} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
          {item.client_name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          פגישה {item.session_number}
          {' · '}
          {relativeLabel(item.expected_date)}
          {item.manually_overridden && (
            <span className="mr-1 text-orange-400" title="תאריך עודכן ידנית">✱</span>
          )}
        </p>
      </div>
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ background: bg, color }}
      >
        {label}
      </span>
    </Link>
  );
}

function LeadMeetingRow({ item }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/leads/${item.lead_id}`)}
      className="w-full text-right flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors rounded-lg px-1 -mx-1 group"
    >
      <Avatar name={item.lead_name} size={34} />
      <div className="flex-1 min-w-0 text-right">
        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
          {item.lead_name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {formatDateHebrew(item.start_time.slice(0, 10))}
          {' · '}
          {formatTimeHebrew(item.start_time)}
        </p>
      </div>
      <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 bg-purple-50 text-purple-600">
        היכרות
      </span>
    </button>
  );
}

function SessionsCard({ clientSessions, leadMeetings, isLoading, isError }) {
  const total = (clientSessions?.length ?? 0) + (leadMeetings?.length ?? 0);

  const sorted = [...(clientSessions ?? [])].sort(
    (a, b) => sessionStateOrder(resolveState(a)) - sessionStateOrder(resolveState(b))
  );

  return (
    <Card title="פגישות השבוע" icon="📅" badge={isLoading ? undefined : total || undefined}>
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : isError ? (
        <p className="text-sm text-red-500">לא ניתן לטעון את הפגישות.</p>
      ) : total === 0 ? (
        <EmptyState message="אין פגישות השבוע" sub="" />
      ) : (
        <div>
          {sorted.length > 0 && (
            <>
              {leadMeetings?.length > 0 && sorted.length > 0 && (
                <p className="text-xs text-gray-400 font-medium mb-1">לקוחות</p>
              )}
              {sorted.map((item, i) => (
                <ClientSessionRow key={`${item.client_id}-${item.session_number}-${i}`} item={item} />
              ))}
            </>
          )}
          {leadMeetings?.length > 0 && (
            <>
              {sorted.length > 0 && (
                <p className="text-xs text-purple-400 font-medium mt-3 mb-1">פגישות היכרות</p>
              )}
              {leadMeetings.map((item) => (
                <LeadMeetingRow key={item.event_id} item={item} />
              ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Alert rows ───────────────────────────────────────────────────────────────

function WhatsAppButton({ clientId, phone, triggerEvent, templates }) {
  const template = templates?.find((t) => t.trigger_event === triggerEvent);
  if (!template || !phone) return null;

  async function handleClick() {
    try {
      const result = await renderTemplate(template.id, clientId);
      window.open(result.whatsapp_link, '_blank', 'noopener');
    } catch {
      window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank', 'noopener');
    }
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200 text-xs font-medium hover:bg-green-100 transition-colors flex-shrink-0"
    >
      <span>💬</span>
      <span className="hidden sm:inline">שלח</span>
    </button>
  );
}

function AlertRow({ clientId, clientName, phone, description, triggerEvent, templates, linkPrefix = '/clients', directWhatsApp = false }) {
  function handleDirectWhatsApp() {
    if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank', 'noopener');
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="min-w-0 flex items-start gap-2">
        <Avatar name={clientName} size={28} />
        <div className="min-w-0">
          <Link
            to={`${linkPrefix}/${clientId}`}
            className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors block leading-tight truncate"
          >
            {clientName}
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>
      {directWhatsApp ? (
        phone ? (
          <button
            onClick={handleDirectWhatsApp}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200 text-xs font-medium hover:bg-green-100 transition-colors flex-shrink-0"
          >
            <span>💬</span>
          </button>
        ) : null
      ) : (
        <WhatsAppButton clientId={clientId} phone={phone} triggerEvent={triggerEvent} templates={templates} />
      )}
    </div>
  );
}

function AlertGroup({ icon, title, color, items, description, triggerEvent, templates, linkPrefix = '/clients', directWhatsApp = false }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm leading-none">{icon}</span>
        <h3 className={`text-xs font-semibold ${color}`}>{title}</h3>
        <span className="text-xs text-gray-300 font-normal">({items.length})</span>
      </div>
      <div className="bg-gray-50 rounded-xl px-3">
        {items.map((a) => (
          <AlertRow
            key={a.client_id ?? a.id}
            clientId={a.client_id ?? a.id}
            clientName={a.client_name ?? a.full_name}
            phone={a.phone}
            description={description(a)}
            triggerEvent={triggerEvent}
            templates={templates}
            linkPrefix={linkPrefix}
            directWhatsApp={directWhatsApp}
          />
        ))}
      </div>
    </div>
  );
}

const PAYMENT_STATUS_LABEL = {
  partial: 'תשלום חלקי',
  unpaid:  'טרם שולם',
};

function AlertsCard({ alerts, frozenLeads, retentionAlerts, unpaidClients, templates, isLoading, isError }) {
  if (isLoading) {
    return (
      <Card title="התראות" icon="🔔">
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      </Card>
    );
  }

  const processEnded   = alerts?.filter((a) => a.process_ended_alert) ?? [];
  const endingSoon     = alerts?.filter((a) => a.ending_soon_alert && !a.process_ended_alert) ?? [];
  const menuMissing    = alerts?.filter((a) => a.menu_alert) ?? [];
  const overdueWindows = alerts?.filter((a) => a.window_alerts?.some((w) => w.state === ALERT_STATE.RED)) ?? [];

  const totalAlerts = processEnded.length + endingSoon.length + menuMissing.length +
    overdueWindows.length + (frozenLeads?.length ?? 0) +
    (retentionAlerts?.length ?? 0) + (unpaidClients?.length ?? 0);

  return (
    <Card title="התראות" icon="🔔" badge={totalAlerts > 0 ? totalAlerts : undefined}>
      {isError ? (
        <p className="text-sm text-red-500">לא ניתן לטעון את ההתראות.</p>
      ) : totalAlerts === 0 ? (
        <EmptyState message="אין התראות פעילות" sub="כל הלקוחות על המסלול הנכון" />
      ) : (
        <>
          {processEnded.length > 0 && (
            <AlertGroup icon="🔴" title="עברו תאריך סיום" color="text-red-600"
              items={processEnded}
              description={(a) => `תהליך הסתיים ${formatDateHebrew(a.process_end_date)}`}
              triggerEvent="process_ending" templates={templates} />
          )}
          {endingSoon.length > 0 && (
            <AlertGroup icon="⚠️" title="מסיימים בקרוב" color="text-orange-600"
              items={endingSoon}
              description={(a) => `מסתיים ${formatDateHebrew(a.process_end_date)} · ${relativeLabel(a.process_end_date)}`}
              triggerEvent="process_ending" templates={templates} />
          )}
          {menuMissing.length > 0 && (
            <AlertGroup icon="📋" title="תפריט לא נשלח" color="text-yellow-700"
              items={menuMissing}
              description={() => 'עברו יותר מיומיים מהפגישה הראשונה'}
              triggerEvent="menu_sent" templates={templates} />
          )}
          {overdueWindows.length > 0 && (
            <AlertGroup icon="🕐" title="חלון פגישה עבר" color="text-red-600"
              items={overdueWindows}
              description={(a) => {
                const red = a.window_alerts?.find((w) => w.state === ALERT_STATE.RED);
                return red
                  ? `פגישה ${red.session_number} — הייתה ${formatDateHebrew(red.expected_date)}`
                  : 'חלון פגישה עבר ללא תיעוד';
              }}
              triggerEvent="session_reminder" templates={templates} />
          )}
          {frozenLeads?.length > 0 && (
            <AlertGroup icon="❄️" title="לידים קפואים" color="text-orange-600"
              items={frozenLeads.map((l) => ({ ...l, client_id: l.id, client_name: l.full_name }))}
              description={(a) => `קפוא מזה ${a.days_frozen} ימים`}
              triggerEvent={null} templates={[]}
              linkPrefix="/leads" directWhatsApp={true} />
          )}
          {retentionAlerts?.length > 0 && (
            <AlertGroup icon="💬" title="לקוחות ללא קשר" color="text-purple-600"
              items={retentionAlerts.map((r) => ({ ...r, client_id: r.id, client_name: r.full_name }))}
              description={(a) => `לא היה קשר מזה ${a.days_since_contact} ימים`}
              triggerEvent="weekly_checkin" templates={templates} />
          )}
          {unpaidClients?.length > 0 && (
            <AlertGroup icon="💳" title="תשלומים פתוחים" color="text-red-600"
              items={unpaidClients.map((u) => ({ ...u, client_id: u.id, client_name: u.full_name }))}
              description={(a) => a.package_price > 0
                ? `${(a.package_price - a.total_paid).toLocaleString()} ₪ יתרה`
                : PAYMENT_STATUS_LABEL[a.payment_status] ?? a.payment_status}
              triggerEvent="payment_reminder" templates={templates} />
          )}
        </>
      )}
    </Card>
  );
}

// ─── Admin repair ─────────────────────────────────────────────────────────────

function AdminRepairButton() {
  const [status, setStatus] = useState('idle');
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
    return <p className="text-xs text-center text-green-600">תוקנו {repairedCount} הערכות AI</p>;
  }
  return (
    <button
      onClick={handleRepair}
      disabled={status === 'loading'}
      className="w-full text-xs text-gray-300 hover:text-gray-500 py-1 transition-colors disabled:opacity-50"
    >
      {status === 'loading' ? 'מתקן...' : 'תקן הערכות AI חסרות'}
    </button>
  );
}

// ─── Daily tasks section ──────────────────────────────────────────────────────

const QUADRANT_CONFIG = [
  { q: 1, label: 'דחוף + חשוב',       border: '#E24B4A', headerBg: 'rgba(226,75,74,0.08)',    badgeBg: 'rgba(226,75,74,0.15)'    },
  { q: 2, label: 'חשוב + לא דחוף',    border: '#567DBF', headerBg: 'rgba(86,125,191,0.08)',   badgeBg: 'rgba(86,125,191,0.15)'   },
  { q: 3, label: 'דחוף + לא חשוב',    border: '#BA7517', headerBg: 'rgba(186,117,23,0.08)',   badgeBg: 'rgba(186,117,23,0.15)'   },
  { q: 4, label: 'לא דחוף + לא חשוב', border: '#888780', headerBg: 'rgba(136,135,128,0.08)', badgeBg: 'rgba(136,135,128,0.15)' },
];

const COMPLETED_CONFIG = {
  label: 'הושלמו היום', border: '#9CA3AF', headerBg: 'rgba(156,163,175,0.06)', badgeBg: 'rgba(156,163,175,0.15)',
};

function TaskItem({ task, onToggle, onDelete }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0 group">
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
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#EEEDFE', color: '#534AB7' }}>
                AI
              </span>
            )}
            {!!task.carried_over && (
              <span className="text-xs text-gray-400">עבר מאתמול</span>
            )}
          </div>
        )}
      </div>
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

function AccordionRow({ config, tasks, isOpen, onToggleOpen, onToggle, onDelete }) {
  const count     = tasks.length;
  const canExpand = count > 0;

  return (
    <div style={{ borderRadius: 12, border: '1px solid #E5E7EB', borderRight: `4px solid ${config.border}`, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={canExpand ? onToggleOpen : undefined}
        disabled={!canExpand}
        className={`w-full flex items-center justify-between px-4 transition-colors duration-150 ${
          canExpand ? 'cursor-pointer hover:brightness-95' : 'cursor-default'
        }`}
        style={{
          height: 48,
          background: config.headerBg,
          borderRadius: isOpen && canExpand ? '11px 11px 0 0' : 11,
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: config.border }} />
          <span className="text-sm font-medium text-gray-700">{config.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={canExpand
              ? { background: config.badgeBg, color: config.border }
              : { background: '#F3F4F6', color: '#9CA3AF' }
            }
          >
            {count > 0 ? `${count} משימות` : 'אין משימות'}
          </span>
          {canExpand && (
            <svg
              className="w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200"
              style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </button>
      <div style={{ maxHeight: isOpen ? 420 : 0, overflow: 'hidden', transition: 'max-height 0.25s ease' }}>
        <div
          className="px-3"
          style={{ background: 'white', borderTop: '1px solid #F3F4F6', maxHeight: 400, overflowY: 'auto' }}
        >
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </div>
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
    <form onSubmit={handleSubmit} className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3 mb-4" dir="rtl">
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
  const [addOpen,       setAddOpen]       = useState(false);
  const [aiToast,       setAiToast]       = useState(null);
  const [openQuadrants, setOpenQuadrants] = useState(new Set());
  const [openCompleted, setOpenCompleted] = useState(false);
  const didAutoOpen = useRef(false);

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

  useEffect(() => {
    if (!didAutoOpen.current && q1.length > 0) {
      didAutoOpen.current = true;
      setOpenQuadrants(new Set([1]));
    }
  }, [q1.length]);

  function toggleQuadrant(q) {
    setOpenQuadrants((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q);
      else next.add(q);
      return next;
    });
  }

  function handleToggle(task) {
    toggleMutation.mutate({ id: task.id, completed: !task.completed });
  }

  function handleDelete(id) {
    deleteMutation.mutate(id);
  }

  return (
    <section>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-800">משימות היום</h2>
          <p className="text-xs text-gray-400 mt-0.5">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="text-sm px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            + הוסף
          </button>
          <button
            type="button"
            onClick={() => aiScanMutation.mutate()}
            disabled={aiScanMutation.isPending}
            className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>✨</span>
            <span>{aiScanMutation.isPending ? 'סורק...' : 'סריקת AI'}</span>
          </button>
        </div>
      </div>

      {aiToast !== null && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-700 font-medium">
          נוספו {aiToast} משימות חדשות
        </div>
      )}

      {aiScanMutation.isError && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
          שגיאה בסריקת AI — {aiScanMutation.error?.message}
        </div>
      )}

      {addOpen && (
        <AddTaskForm
          onAdd={addMutation.mutateAsync}
          onClose={() => setAddOpen(false)}
          clients={activeClients}
        />
      )}

      {tasksLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-12" />
          ))}
        </div>
      ) : totalActive === 0 && completed.length === 0 ? (
        <div className="text-center py-8 rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-400 mb-1">אין משימות להיום</p>
          <p className="text-xs text-gray-300">לחץ על "סריקת AI" לקבלת המלצות, או הוסף משימה ידנית</p>
        </div>
      ) : (
        <div className="space-y-2">
          {QUADRANT_CONFIG.map((config, idx) => (
            <AccordionRow
              key={config.q}
              config={config}
              tasks={quadrantTasks[idx]}
              isOpen={openQuadrants.has(config.q)}
              onToggleOpen={() => toggleQuadrant(config.q)}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
          {completed.length > 0 && (
            <AccordionRow
              config={COMPLETED_CONFIG}
              tasks={completed}
              isOpen={openCompleted}
              onToggleOpen={() => setOpenCompleted((v) => !v)}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ─── Page header ──────────────────────────────────────────────────────────────

function DashboardHeader({ counters }) {
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';

  return (
    <div className="mb-5">
      <h1 className="text-xl font-bold text-gray-900">{greeting}, נתנאל</h1>
      {counters && (
        <p className="text-sm text-gray-500 mt-0.5">
          {counters.active_clients} לקוחות פעילים · {counters.sessions_this_week} פגישות השבוע
        </p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

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

  return (
    <div dir="rtl" style={{ background: CANVAS, minHeight: '100%' }}>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <DashboardHeader counters={!isLoading && !isError ? dashboard?.counters : undefined} />

        {/* ── Stat counters ────────────────────────────────────────────── */}
        <div className="mb-5">
          {isLoading ? (
            <div className="flex gap-3">
              <Skeleton className="h-20 flex-1" />
              <Skeleton className="h-20 flex-1" />
              <Skeleton className="h-20 flex-1" />
            </div>
          ) : isError ? (
            <p className="text-sm text-red-500">שגיאה בטעינת הנתונים.</p>
          ) : (
            <Counters counters={dashboard.counters} />
          )}
        </div>

        {/* ── Two-column grid ───────────────────────────────────────────── */}
        <div className="grid gap-5 md:grid-cols-[1fr_340px]">

          {/* Tasks column (right side in RTL) */}
          <div>
            <Card>
              <DailyTasksSection />
            </Card>
          </div>

          {/* Sessions + Alerts column (left side in RTL) */}
          <div className="space-y-4">
            <SessionsCard
              clientSessions={dashboard?.client_sessions}
              leadMeetings={dashboard?.lead_meetings}
              isLoading={isLoading}
              isError={isError}
            />

            <AlertsCard
              alerts={dashboard?.alerts ?? []}
              frozenLeads={dashboard?.frozen_leads}
              retentionAlerts={dashboard?.retention_alerts}
              unpaidClients={dashboard?.unpaid_clients}
              templates={templates}
              isLoading={isLoading}
              isError={isError}
            />

            {!isLoading && !isError && dashboard?.counters.active_clients === 0 && (
              <div className="text-center py-6 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <p className="text-gray-500 text-sm mb-3">עדיין אין לקוחות פעילים</p>
                <Link
                  to="/clients"
                  className="inline-flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  הוסף את הלקוח הראשון שלך
                </Link>
              </div>
            )}

            <AdminRepairButton />
          </div>
        </div>
      </div>
    </div>
  );
}
