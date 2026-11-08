const { computeClientAlerts } = require('./alerts.service');
const { upsertAction, resolveStale } = require('./action-queue.service');
const { renderTemplate } = require('./whatsapp.service');
const { bookingLinks } = require('../config/booking');
const { ALERT_STATE, SESSION_STATUS } = require('../constants/statuses');
const {
  todayISO, addDays, parseDate, toISODate, israelLocalToUtcISO, nowUtcISO, isoWeekKey,
} = require('../utils/dates');

// ─── Inbox rules reconciler ──────────────────────────────────────────────────
// Replaces the alerts the dashboard used to recompute on every request.
// For each rule: compute the set of conditions that hold NOW, upsert one inbox
// item per condition (deterministic dedupe_key), and auto-resolve pending
// items of that kind whose condition no longer holds. Idempotent — runs on
// startup, every 15 minutes and shortly after any mutation.

const RETENTION_DAYS = 14;
const STALE_LEAD_DAYS = 5;
const ACTIVE = ['active', 'ending_soon'];
const TERMINAL_LEAD = new Set(['became_client', 'not_relevant', 'meeting_held', 'backed_out']);

function templateBody(database, trigger) {
  return database.prepare(
    'SELECT body_template FROM whatsapp_templates WHERE trigger_event = ? AND is_active = 1 ORDER BY is_custom ASC LIMIT 1'
  ).get(trigger)?.body_template || null;
}

function draft(database, trigger, vars) {
  const body = templateBody(database, trigger);
  return body ? renderTemplate(body, vars) : null;
}

function at9(date) {
  return israelLocalToUtcISO(date, '09:00');
}

function reconcileInbox(database) {
  const today = todayISO();
  const { followupLink } = bookingLinks();
  const keys = {
    session_due: new Set(), process_ending: new Set(), process_ended: new Set(),
    checkin: new Set(), lead_followup: new Set(), menu_overdue: new Set(), freeze_end: new Set(),
  };

  const clients = database.prepare(`SELECT * FROM clients WHERE status IN (${ACTIVE.map(() => '?').join(',')})`).all(...ACTIVE);
  const windowsByClient = {};
  for (const w of database.prepare('SELECT * FROM session_windows ORDER BY session_number').all()) {
    (windowsByClient[w.client_id] ||= []).push(w);
  }
  const sessionsByClient = {};
  for (const s of database.prepare('SELECT * FROM sessions ORDER BY session_number').all()) {
    (sessionsByClient[s.client_id] ||= []).push(s);
  }
  const upcomingByClient = new Set(
    database.prepare("SELECT DISTINCT client_id FROM meetings WHERE status = 'active' AND start_time > ? AND client_id IS NOT NULL")
      .all(nowUtcISO()).map((r) => r.client_id)
  );

  for (const c of clients) {
    const sessions = sessionsByClient[c.id] || [];
    const alerts = computeClientAlerts(c, windowsByClient[c.id] || [], sessions, { hasUpcomingMeeting: upcomingByClient.has(c.id) });
    const vars = { client_name: c.full_name, booking_link: followupLink, calendly_link: followupLink };

    // ── Rolling SLA: >14 days since the last held session, nothing booked ──
    // Keyed by the last held date: if that date is edited retroactively the
    // old item auto-resolves and the condition is re-evaluated from scratch.
    const sla = alerts.sessionSla;
    if (sla.stale) {
      const key = `session_due:client:${c.id}:after:${sla.anchorDate}`;
      keys.session_due.add(key);
      const message = followupLink ? draft(database, 'booking_link', vars) : null;
      upsertAction(database, {
        kind: 'session_due',
        dedupeKey: key,
        title: sla.anchor === 'held'
          ? `עברו ${sla.daysSince} ימים מהפגישה האחרונה: ${c.full_name}`
          : `עברו ${sla.daysSince} ימים מתחילת התהליך ללא פגישה: ${c.full_name}`,
        body: sla.anchor === 'held'
          ? `פגישה אחרונה התקיימה ב-${sla.anchorDate} ואין פגישה עתידית ביומן. לשלוח קישור לקביעת פגישה`
          : `התהליך התחיל ב-${sla.anchorDate}, עדיין לא התקיימה פגישה ואין פגישה עתידית ביומן. לשלוח קישור לקביעת פגישה`,
        clientId: c.id,
        phone: message ? c.phone : null,
        message,
        priority: 'urgent',
        dueAt: at9(sla.dueDate),
      });
    }

    // ── Process ending soon → check in about next steps ───────────────────
    if (alerts.endingSoonAlert && !alerts.processEndedAlert) {
      const key = `process_ending:client:${c.id}:${c.process_end_date}`;
      keys.process_ending.add(key);
      const message = draft(database, 'process_ending', vars);
      upsertAction(database, {
        kind: 'process_ending',
        dedupeKey: key,
        title: `התהליך מסתיים בקרוב: ${c.full_name}`,
        body: `תאריך סיום: ${c.process_end_date}`,
        clientId: c.id,
        phone: message ? c.phone : null,
        message,
        priority: 'medium',
        dueAt: at9(toISODate(addDays(parseDate(c.process_end_date), -14))),
      });
    }

    // ── Process end date passed → close or renew ──────────────────────────
    if (alerts.processEndedAlert) {
      const key = `process_ended:client:${c.id}:${c.process_end_date}`;
      keys.process_ended.add(key);
      upsertAction(database, {
        kind: 'process_ended',
        dedupeKey: key,
        title: `עבר תאריך סיום התהליך: ${c.full_name}`,
        body: `התהליך היה אמור להסתיים ב-${c.process_end_date}. לסיים, להקפיא או לחדש`,
        clientId: c.id,
        priority: 'urgent',
        dueAt: at9(c.process_end_date),
      });
    }

    // ── Menu overdue (created by the menu_sla_due job) — keep while unsent ──
    if (!c.menu_sent) keys.menu_overdue.add(`menu_overdue:client:${c.id}`);

    // ── No contact for 14+ days and nothing booked → weekly check-in ──────
    if (c.status === 'active' && !upcomingByClient.has(c.id)
        && !sessions.some((s) => s.status === SESSION_STATUS.SCHEDULED && s.session_date >= today)) {
      const held = sessions.filter((s) => s.status === SESSION_STATUS.HELD && s.session_date);
      const lastContact = held.length ? held[held.length - 1].session_date : c.start_date;
      const threshold = toISODate(addDays(parseDate(today), -RETENTION_DAYS));
      if (lastContact && lastContact <= threshold) {
        const week = isoWeekKey();
        const key = `checkin:client:${c.id}:${week}`;
        keys.checkin.add(key);
        const message = draft(database, 'weekly_checkin', vars);
        upsertAction(database, {
          kind: 'checkin',
          dedupeKey: key,
          supersedePrefix: `checkin:client:${c.id}:`,
          title: `צ'ק-אין: ${c.full_name}`,
          body: `אין קשר מאז ${lastContact}`,
          clientId: c.id,
          phone: message ? c.phone : null,
          message,
          priority: 'low',
          dueAt: nowUtcISO(),
        });
      }
    }
  }

  // ── Frozen clients keep their freeze_end item until reactivated ─────────
  for (const c of database.prepare("SELECT id, frozen_until FROM clients WHERE status = 'frozen'").all()) {
    keys.freeze_end.add(`freeze_end:client:${c.id}:${c.frozen_until}`);
  }

  // ── Leads with no status change for 5+ days ─────────────────────────────
  const staleBefore = new Date(Date.now() - STALE_LEAD_DAYS * 864e5).toISOString();
  for (const l of database.prepare('SELECT * FROM leads').all()) {
    if (TERMINAL_LEAD.has(l.status)) continue;
    const last = l.status_updated_at || l.created_at;
    if (!last) continue;
    const lastIso = String(last).includes('T') ? String(last) : `${String(last).replace(' ', 'T')}Z`;
    if (lastIso >= staleBefore) continue;
    const key = `lead_followup:lead:${l.id}:${l.status}:${lastIso.slice(0, 10)}`;
    keys.lead_followup.add(key);
    upsertAction(database, {
      kind: 'lead_followup',
      dedupeKey: key,
      title: `ליד ללא התקדמות: ${l.full_name}`,
      body: `אין שינוי סטטוס מאז ${lastIso.slice(0, 10)}`,
      leadId: l.id,
      priority: 'low',
      dueAt: nowUtcISO(),
    });
  }

  const resolved = {};
  for (const [kind, set] of Object.entries(keys)) resolved[kind] = resolveStale(database, kind, set);
  const resolvedTotal = Object.values(resolved).reduce((a, b) => a + b, 0);
  if (resolvedTotal) console.log(`[inbox] Auto-resolved ${resolvedTotal} item(s)`, JSON.stringify(resolved));
  return { resolved };
}

// Debounced trigger after mutations (many writes in a burst → one reconcile)
let pending = null;
function scheduleReconcile(database, delayMs = 2000) {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    try { reconcileInbox(database); } catch (err) { console.error('[inbox] reconcile error:', err.message); }
  }, delayMs);
}

module.exports = { reconcileInbox, scheduleReconcile };
