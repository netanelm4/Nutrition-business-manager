import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  fetchCalendlyConfig,
  fetchCalendlyUpcoming,
  checkCalendlyReminders,
  cancelCalendlyEvent,
  fetchClients,
  fetchTemplates,
  fetchGoogleAuthUrl,
  fetchGoogleStatus,
  disconnectGoogle,
  syncGoogleCalendar,
  pollGoogleCalendar,
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
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 50, display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--ink-1)', color: '#fff', fontSize: 13,
      padding: '10px 16px', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      whiteSpace: 'nowrap',
    }}>
      <span>{msg}</span>
      <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface-1)', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-1)', margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
        </div>
        <div style={{ padding: '10px 12px' }}>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לקוח..." className="field-input" style={{ width: '100%' }} autoFocus />
        </div>
        <ul style={{ maxHeight: 240, overflowY: 'auto', listStyle: 'none', margin: 0, padding: 0 }}>
          {filtered.map((c) => (
            <li key={c.id} style={{ borderTop: '1px solid var(--hairline)' }}>
              <button
                onClick={() => handleSelect(c)}
                style={{ width: '100%', textAlign: 'right', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'block' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                <p style={{ fontWeight: 500, fontSize: 13.5, color: 'var(--ink-1)', margin: 0 }}>{c.full_name}</p>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>{c.phone}</p>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>לא נמצאו לקוחות</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ── Link card ─────────────────────────────────────────────────────────────────

function LinkCard({ title, subtitle, url, onCopy, onSendToClient }) {
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <p style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-1)', marginBottom: 2 }}>{title}</p>
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>{subtitle}</p>
      </div>
      {url ? (
        <p style={{ fontSize: 11.5, color: 'var(--blue)', wordBreak: 'break-all', background: 'var(--blue-soft)', borderRadius: 6, padding: '6px 10px', lineHeight: 1.5 }}>
          {url}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          לא הוגדר — הוסף את משתנה הסביבה בהגדרות Railway
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={onCopy} disabled={!url} className="crm-btn crm-btn--sm" style={{ opacity: !url ? 0.4 : 1 }}>העתק קישור</button>
        <button onClick={() => window.open(url, '_blank')} disabled={!url} className="crm-btn crm-btn--sm" style={{ opacity: !url ? 0.4 : 1 }}>פתח</button>
        <button onClick={onSendToClient} disabled={!url} className="crm-btn crm-btn--primary crm-btn--sm" style={{ opacity: !url ? 0.4 : 1 }}>שלח ללקוח</button>
      </div>
    </div>
  );
}

// ── Event type labels ─────────────────────────────────────────────────────────

const EVENT_TYPE_META = {
  follow_up:     { label: 'פגישת מעקב',   chipClass: 'chip--blue'   },
  first_meeting: { label: 'פגישה ראשונה', chipClass: 'chip--green' },
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CalendlySettings() {
  const [toast, setToast]       = useState('');
  const [picker, setPicker]     = useState(null); // { type: 'first' | 'followup' }
  const [cancelConfirm, setCancelConfirm] = useState(null); // row to confirm
  const [googleConnecting, setGoogleConnecting] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  // Show toast based on ?google= URL param after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g === 'connected') showToast('Google Calendar חובר בהצלחה');
    if (g === 'error')     showToast('שגיאה בחיבור Google Calendar');
    if (g) {
      // Remove the param without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete('google');
      window.history.replaceState({}, '', url.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const { data: googleStatus, refetch: refetchGoogle } = useQuery({
    queryKey: ['googleStatus'],
    queryFn: fetchGoogleStatus,
    staleTime: 30_000,
  });
  const googleConnected = !!googleStatus?.connected;

  const disconnectMutation = useMutation({
    mutationFn: disconnectGoogle,
    onSuccess: () => {
      refetchGoogle();
      showToast('Google Calendar נותק');
    },
    onError: () => showToast('שגיאה בניתוק'),
  });

  const syncMutation = useMutation({
    mutationFn: syncGoogleCalendar,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendlyUpcoming'] });
      showToast(data.synced > 0 ? `סונכרן ${data.synced} פגישות` : 'הכל מסונכרן');
    },
    onError: () => showToast('שגיאה בסנכרון'),
  });

  const pollMutation = useMutation({
    mutationFn: pollGoogleCalendar,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendlyUpcoming'] });
      showToast(data.inserted > 0 ? `נוספו ${data.inserted} פגישות חדשות` : 'אין פגישות חדשות');
    },
    onError: () => showToast('שגיאה בבדיקת פגישות'),
  });

  async function handleGoogleConnect() {
    setGoogleConnecting(true);
    try {
      const url = await fetchGoogleAuthUrl();
      window.location.href = url;
    } catch {
      showToast('שגיאה בקבלת קישור התחברות');
      setGoogleConnecting(false);
    }
  }

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
    <div className="crm-page">
      {/* Subhead */}
      <div className="subhead" style={{ marginBottom: 20 }}>
        <b style={{ fontSize: 14, color: 'var(--ink-1)' }}>קביעת פגישות</b>
      </div>

      {/* ── Google Calendar ── */}
      <section style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>חיבור Google Calendar</div>
        {googleConnected ? (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderColor: 'var(--green-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--green)', fontSize: 18, lineHeight: 1 }}>✓</span>
              <div>
                <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-1)', margin: 0 }}>Google Calendar מחובר</p>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>פגישות ידניות מתווספות אוטומטית ליומן</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending} className="crm-btn crm-btn--sm crm-btn--primary">
                {pollMutation.isPending ? 'בודק...' : 'בדוק פגישות חדשות'}
              </button>
              <button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="crm-btn crm-btn--sm" style={{ color: 'var(--blue)', borderColor: 'var(--blue-soft)' }}>
                {syncMutation.isPending ? 'מסנכרן...' : 'סנכרן עכשיו'}
              </button>
              <button onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                {disconnectMutation.isPending ? 'מנתק...' : 'נתק'}
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>פגישות שתקבע ידנית יתווספו אוטומטית ליומן Google שלך.</p>
            <button onClick={handleGoogleConnect} disabled={googleConnecting} className="crm-btn crm-btn--primary" style={{ alignSelf: 'flex-start' }}>
              {googleConnecting ? 'מתחבר...' : 'התחבר עם Google'}
            </button>
          </div>
        )}
      </section>

      {/* ── Calendly Links ── */}
      <section style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>קישורי Calendly</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          <LinkCard title="פגישה ראשונה" subtitle="ללקוחות חדשים" url={firstLink} onCopy={() => handleCopy(firstLink)} onSendToClient={() => setPicker({ type: 'first' })} />
          <LinkCard title="פגישת מעקב" subtitle="ללקוחות קיימים" url={followupLink} onCopy={() => handleCopy(followupLink)} onSendToClient={() => setPicker({ type: 'followup' })} />
        </div>
      </section>

      {/* ── Upcoming sessions ── */}
      <section style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>פגישות קרובות</div>
        {upcomingLoading ? (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>טוען...</p>
        ) : upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>אין פגישות קרובות מתוזמנות.</p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {upcoming.map((row) => {
                const et = EVENT_TYPE_META[row.event_type] || { label: row.event_type, chipClass: '' };
                const isConfirming = cancelConfirm?.id === row.id;
                return (
                  <li key={row.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-1)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.matched_name}</p>
                        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>{formatDateHebrew(row.start_time)} · {formatTimeHebrew(row.start_time)}</p>
                      </div>
                      <span className={`chip ${et.chipClass}`}>{et.label}</span>
                      {row.confirmation_sent
                        ? <span className="chip chip--green">אישור נשלח ✓</span>
                        : <span className="chip">טרם נשלח</span>
                      }
                      <button onClick={() => handleSendNow(row)} className="crm-btn crm-btn--sm crm-btn--primary" style={{ whiteSpace: 'nowrap' }}>שלח אישור עכשיו</button>
                      <button onClick={() => setCancelConfirm(isConfirming ? null : row)} className="crm-btn crm-btn--sm" style={{ color: 'var(--red-ink)', borderColor: 'var(--red-soft)', whiteSpace: 'nowrap' }}>בטל פגישה</button>
                    </div>

                    {isConfirming && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: 'var(--red-soft)', borderRadius: 8, padding: '10px 12px' }}>
                        <p style={{ fontSize: 13, color: 'var(--red-ink)', flex: 1, margin: 0 }}>
                          האם לבטל את הפגישה עם <strong>{row.matched_name}</strong> ב-{formatDateHebrew(row.start_time)}?
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => cancelMutation.mutate(row.id)} disabled={cancelMutation.isPending} className="crm-btn crm-btn--sm" style={{ color: 'var(--red-ink)', border: 'none', background: 'rgba(255,255,255,0.6)' }}>
                            {cancelMutation.isPending ? 'מבטל...' : 'כן, בטל'}
                          </button>
                          <button onClick={() => setCancelConfirm(null)} className="crm-btn crm-btn--sm">לא</button>
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

      {/* ── Reminder settings ── */}
      <section style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>הגדרות תזכורות</div>
        <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
            המערכת בודקת פגישות קרובות כל 30 דקות.<br />
            24 שעות לפני כל פגישה — נוצר קישור וואטסאפ לאישור הגעה אוטומטית ומוצג כאן לשליחה.
          </p>
          <button onClick={() => reminderMutation.mutate()} disabled={reminderMutation.isPending} className="crm-btn crm-btn--primary" style={{ alignSelf: 'flex-start' }}>
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
