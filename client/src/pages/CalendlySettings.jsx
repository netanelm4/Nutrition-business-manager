import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCalendlyConfig,
  fetchCalendlyUpcoming,
  checkCalendlyReminders,
  cancelCalendlyEvent,
  fetchClients,
  fetchTemplates,
} from '../lib/api';
import { formatDateHebrew, formatTimeHebrew } from '../lib/dates';

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseForWA(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

function generateWALink(phone, message) {
  return `https://wa.me/${normaliseForWA(phone)}?text=${encodeURIComponent(message)}`;
}

function renderMsg(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}


// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, onClose }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 right-1/2 translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl">
      <span>{msg}</span>
      <button onClick={onClose} className="text-gray-400 hover:text-white leading-none">✕</button>
    </div>
  );
}

// ── Client picker modal ───────────────────────────────────────────────────────

function ClientPicker({ title, calendlyUrl, templates, onClose }) {
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => fetchClients(),
    staleTime: 30_000,
  });
  const [search, setSearch] = useState('');

  const active = clients.filter((c) => c.status !== 'ended');
  const filtered = search.trim()
    ? active.filter(
        (c) =>
          c.full_name.includes(search) ||
          (c.phone || '').includes(search),
      )
    : active;

  const calendlyTmpl = templates?.find((t) => t.trigger_event === 'calendly_link');

  function handleSelect(client) {
    const body =
      calendlyTmpl?.body_template ||
      'היי {{client_name}} 😊\nהקישור לקביעת הפגישה הקרובה שלנו:\n{{calendly_link}}\nניתן לבחור שעה נוחה — אני אהיה שם!';
    const msg = renderMsg(body, {
      client_name: client.full_name,
      calendly_link: calendlyUrl,
    });
    window.open(generateWALink(client.phone, msg), '_blank');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="p-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לקוח..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            autoFocus
          />
        </div>
        <ul className="max-h-64 overflow-y-auto divide-y divide-gray-50">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => handleSelect(c)}
                className="w-full text-right px-4 py-3 text-sm hover:bg-indigo-50 transition-colors"
              >
                <p className="font-medium text-gray-900">{c.full_name}</p>
                <p className="text-xs text-gray-400">{c.phone}</p>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-400">לא נמצאו לקוחות</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ── Link card ─────────────────────────────────────────────────────────────────

function LinkCard({ title, subtitle, url, onCopy, onSendToClient }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <p className="font-semibold text-gray-900 text-sm">{title}</p>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
      {url ? (
        <p className="text-xs text-indigo-600 break-all bg-indigo-50 rounded px-2 py-1.5 leading-relaxed">
          {url}
        </p>
      ) : (
        <p className="text-xs text-gray-400 italic">
          לא הוגדר — הוסף את משתנה הסביבה בהגדרות Railway
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onCopy}
          disabled={!url}
          className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          העתק קישור
        </button>
        <button
          onClick={() => window.open(url, '_blank')}
          disabled={!url}
          className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          פתח
        </button>
        <button
          onClick={onSendToClient}
          disabled={!url}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          שלח ללקוח
        </button>
      </div>
    </div>
  );
}

// ── Event type labels ─────────────────────────────────────────────────────────

const EVENT_TYPE_META = {
  follow_up:     { label: 'פגישת מעקב',   color: 'bg-blue-100 text-blue-700'   },
  first_meeting: { label: 'פגישה ראשונה', color: 'bg-purple-100 text-purple-700' },
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CalendlySettings() {
  const [toast, setToast]       = useState('');
  const [picker, setPicker]     = useState(null); // { type: 'first' | 'followup' }
  const [cancelConfirm, setCancelConfirm] = useState(null); // row to confirm

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const { data: config } = useQuery({
    queryKey: ['calendlyConfig'],
    queryFn: fetchCalendlyConfig,
  });

  const { data: upcoming = [], isLoading: upcomingLoading } = useQuery({
    queryKey: ['calendlyUpcoming'],
    queryFn: fetchCalendlyUpcoming,
    refetchInterval: 60_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: (eventId) => cancelCalendlyEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendlyUpcoming'] });
      setCancelConfirm(null);
      showToast('הפגישה בוטלה');
    },
    onError: () => showToast('שגיאה בביטול הפגישה'),
  });

  const reminderMutation = useMutation({
    mutationFn: checkCalendlyReminders,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendlyUpcoming'] });
      showToast(
        data.count > 0
          ? `נמצאו ${data.count} פגישות לתזכורת`
          : 'אין פגישות קרובות',
      );
    },
    onError: () => showToast('שגיאה בבדיקת תזכורות'),
  });

  const followupLink = config?.followupLink || '';
  const firstLink    = config?.firstLink    || '';

  function handleCopy(url) {
    navigator.clipboard.writeText(url).then(() => showToast('הועתק ✓'));
  }

  function handleSendNow(row) {
    // Use pre-generated link if available
    if (row.confirmation_link) {
      window.open(row.confirmation_link, '_blank');
      return;
    }

    // Generate on the fly from template + available data
    const phone = row.phone_for_wa;
    if (!phone) { showToast('אין מספר טלפון לשליחה'); return; }

    const tmpl = templates.find((t) => t.trigger_event === 'session_confirmation');
    const body =
      tmpl?.body_template ||
      'היי {{client_name}} 👋\nרציתי לאשר את הפגישה שלנו מחר {{date}} בשעה {{time}}.\nאשמח לאישור הגעה 🙏\nאם צריך לשנות — נדבר!';

    const msg = renderMsg(body, {
      client_name: row.matched_name || row.invitee_name,
      date: formatDateHebrew(row.start_time),
      time: formatTimeHebrew(row.start_time),
    });

    window.open(generateWALink(phone, msg), '_blank');
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-xl font-bold text-gray-900">קביעת פגישות</h1>

      {/* ── Section 1 — Calendly links ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">קישורי Calendly</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <LinkCard
            title="פגישה ראשונה"
            subtitle="ללקוחות חדשים"
            url={firstLink}
            onCopy={() => handleCopy(firstLink)}
            onSendToClient={() => setPicker({ type: 'first' })}
          />
          <LinkCard
            title="פגישת מעקב"
            subtitle="ללקוחות קיימים"
            url={followupLink}
            onCopy={() => handleCopy(followupLink)}
            onSendToClient={() => setPicker({ type: 'followup' })}
          />
        </div>
      </section>

      {/* ── Section 2 — Upcoming sessions ─────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">פגישות קרובות</h2>
        {upcomingLoading ? (
          <p className="text-sm text-gray-400">טוען...</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">אין פגישות קרובות מתוזמנות.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {upcoming.map((row) => {
                const et = EVENT_TYPE_META[row.event_type] || {
                  label: row.event_type,
                  color: 'bg-gray-100 text-gray-600',
                };
                const isConfirming = cancelConfirm?.id === row.id;
                return (
                  <li key={row.id} className="px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {row.matched_name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatDateHebrew(row.start_time)} · {formatTimeHebrew(row.start_time)}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${et.color}`}>
                        {et.label}
                      </span>
                      {row.confirmation_sent ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                          אישור נשלח ✓
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          טרם נשלח
                        </span>
                      )}
                      <button
                        onClick={() => handleSendNow(row)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors whitespace-nowrap"
                      >
                        שלח אישור עכשיו
                      </button>
                      <button
                        onClick={() => setCancelConfirm(isConfirming ? null : row)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 font-medium hover:bg-red-100 transition-colors whitespace-nowrap"
                      >
                        בטל פגישה
                      </button>
                    </div>

                    {/* Inline cancel confirmation */}
                    {isConfirming && (
                      <div className="flex flex-wrap items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                        <p className="text-sm text-red-700 flex-1">
                          האם לבטל את הפגישה עם <span className="font-semibold">{row.matched_name}</span> ב-{formatDateHebrew(row.start_time)}?
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => cancelMutation.mutate(row.id)}
                            disabled={cancelMutation.isPending}
                            className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                          >
                            {cancelMutation.isPending ? 'מבטל...' : 'כן, בטל'}
                          </button>
                          <button
                            onClick={() => setCancelConfirm(null)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            לא
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* ── Section 3 — Reminder settings ─────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">הגדרות תזכורות</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            המערכת בודקת פגישות קרובות כל 30 דקות.<br />
            24 שעות לפני כל פגישה — נוצר קישור וואטסאפ לאישור הגעה אוטומטית ומוצג כאן לשליחה.
          </p>
          <button
            onClick={() => reminderMutation.mutate()}
            disabled={reminderMutation.isPending}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {reminderMutation.isPending ? 'בודק...' : 'בדוק עכשיו'}
          </button>
        </div>
      </section>

      {/* ── Client picker modal ─────────────────────────────────────────────── */}
      {picker && (
        <ClientPicker
          title={
            picker.type === 'first'
              ? 'שלח קישור פגישה ראשונה'
              : 'שלח קישור פגישת מעקב'
          }
          calendlyUrl={picker.type === 'first' ? firstLink : followupLink}
          templates={templates}
          onClose={() => setPicker(null)}
        />
      )}

      <Toast msg={toast} onClose={() => setToast('')} />
    </div>
  );
}
