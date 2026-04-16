import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { fetchDashboard, fetchTemplates, renderTemplate, repairAIAssessments } from '../lib/api';
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
