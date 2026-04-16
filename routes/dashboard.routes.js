const express = require('express');
const db = require('../database/db');
const { computeClientAlerts, hasActiveAlert } = require('../services/alerts.service');
const { CLIENT_STATUS, LEAD_STATUS, ALERT_STATE } = require('../constants/statuses');
const { todayISO, addDays, toISODate, parseDate } = require('../utils/dates');

const FROZEN_DAYS = 5;
const RETENTION_DAYS = 14;
const TERMINAL_LEAD_STATUSES = new Set([LEAD_STATUS.BECAME_CLIENT, LEAD_STATUS.NOT_RELEVANT, LEAD_STATUS.MEETING_HELD]);

const router = express.Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─── GET /api/dashboard ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const today = todayISO();

    // ── 1. Active clients with their windows and sessions ──────────────────
    const clients = db
      .prepare("SELECT * FROM clients WHERE status != ? ORDER BY full_name")
      .all(CLIENT_STATUS.ENDED);

    const allWindows = db.prepare('SELECT * FROM session_windows').all();
    const allSessions = db.prepare('SELECT * FROM sessions').all();

    // Index by client_id for fast lookup
    const windowsByClient = {};
    for (const w of allWindows) {
      if (!windowsByClient[w.client_id]) windowsByClient[w.client_id] = [];
      windowsByClient[w.client_id].push(w);
    }
    const sessionsByClient = {};
    for (const s of allSessions) {
      if (!sessionsByClient[s.client_id]) sessionsByClient[s.client_id] = [];
      sessionsByClient[s.client_id].push(s);
    }

    // ── 2. This week's sessions ────────────────────────────────────────────
    // "This week" = Monday 00:00 → Sunday 23:59 in Asia/Jerusalem.

    // Compute Monday of current week in Israel timezone
    const nowInIsrael    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const israelDayOfWeek = nowInIsrael.getDay();                               // 0=Sun
    const daysFromMonday  = israelDayOfWeek === 0 ? 6 : israelDayOfWeek - 1;   // Mon=0..Sun=6
    const mondayISO = toISODate(addDays(nowInIsrael, -daysFromMonday));
    const sundayISO = toISODate(addDays(nowInIsrael, 6 - daysFromMonday));

    // 2a. client_sessions — session_windows for active clients
    const client_sessions = [];

    for (const client of clients) {
      const windows  = windowsByClient[client.id] || [];
      const sessions = sessionsByClient[client.id] || [];

      const sessionByNumber = {};
      for (const s of sessions) sessionByNumber[s.session_number] = s;

      for (const w of windows) {
        if (w.expected_date >= mondayISO && w.expected_date <= sundayISO) {
          const existingSession = sessionByNumber[w.session_number] || null;
          // Skip sessions that have already been held (session_date recorded)
          if (existingSession && existingSession.session_date) continue;
          client_sessions.push({
            client_id: client.id,
            client_name: client.full_name,
            phone: client.phone,
            session_number: w.session_number,
            expected_date: w.expected_date,
            manually_overridden: w.manually_overridden === 1,
            session_scheduled: !!existingSession,
            session_date: null,
          });
        }
      }
    }

    // 2b. lead_meetings — calendly_events linked to a lead this week
    const leadMeetingRows = db.prepare(`
      SELECT ce.id, ce.start_time, ce.event_type,
             ce.lead_id, l.full_name AS lead_name, l.phone AS lead_phone
      FROM   calendly_events ce
      JOIN   leads l ON ce.lead_id = l.id
      WHERE  ce.status = 'active'
        AND  ce.lead_id IS NOT NULL
        AND  l.status = 'meeting_scheduled'
        AND  substr(ce.start_time, 1, 10) >= ?
        AND  substr(ce.start_time, 1, 10) <= ?
      ORDER  BY ce.start_time ASC
    `).all(mondayISO, sundayISO);

    const lead_meetings = leadMeetingRows.map((ev) => ({
      event_id:   ev.id,
      lead_id:    ev.lead_id,
      lead_name:  ev.lead_name,
      phone:      ev.lead_phone,
      start_time: ev.start_time,
      event_type: ev.event_type,
    }));

    // ── 3. All alerts ──────────────────────────────────────────────────────
    const alerts = [];
    for (const client of clients) {
      const windows = windowsByClient[client.id] || [];
      const sessions = sessionsByClient[client.id] || [];
      const clientAlerts = computeClientAlerts(client, windows, sessions);

      if (!hasActiveAlert(clientAlerts)) continue;

      const alertEntry = {
        client_id: client.id,
        client_name: client.full_name,
        phone: client.phone,
        status: client.status,
        process_end_date: client.process_end_date,
        menu_sent: client.menu_sent === 1,
        menu_alert: clientAlerts.menuAlert,
        ending_soon_alert: clientAlerts.endingSoonAlert,
        process_ended_alert: clientAlerts.processEndedAlert,
        window_alerts: clientAlerts.windowAlerts.filter(
          (w) => w.state === ALERT_STATE.RED || w.state === ALERT_STATE.YELLOW
        ),
      };

      alerts.push(alertEntry);
    }

    // Sort: RED first, then YELLOW, then other alerts
    alerts.sort((a, b) => {
      const aHasRed = a.window_alerts.some((w) => w.state === ALERT_STATE.RED);
      const bHasRed = b.window_alerts.some((w) => w.state === ALERT_STATE.RED);
      if (aHasRed && !bHasRed) return -1;
      if (!aHasRed && bHasRed) return 1;
      return 0;
    });

    // ── 4. Frozen leads ────────────────────────────────────────────────────
    const allLeads = db.prepare('SELECT * FROM leads').all();
    const frozenThreshold = new Date();
    frozenThreshold.setDate(frozenThreshold.getDate() - FROZEN_DAYS);

    const frozen_leads = allLeads
      .filter((lead) => {
        if (TERMINAL_LEAD_STATUSES.has(lead.status)) return false;
        const lastUpdate = lead.status_updated_at || lead.created_at;
        return lastUpdate && new Date(lastUpdate) < frozenThreshold;
      })
      .map((lead) => {
        const lastUpdate = lead.status_updated_at || lead.created_at;
        const daysFrozen = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: lead.id,
          full_name: lead.full_name,
          phone: lead.phone,
          status: lead.status,
          days_frozen: daysFrozen,
        };
      });

    // ── 5. Retention alerts — active clients with no contact in 14+ days ──
    const retentionThreshold = toISODate(addDays(parseDate(today), -RETENTION_DAYS));

    const activeClients = clients.filter((c) => c.status === CLIENT_STATUS.ACTIVE);
    const retention_alerts = [];

    for (const client of activeClients) {
      const sessions = sessionsByClient[client.id] || [];
      const lastSessionDate = sessions.length > 0
        ? sessions.reduce((max, s) => (s.session_date > max ? s.session_date : max), '')
        : null;

      const contactDate = lastSessionDate || client.start_date;
      if (!contactDate) continue;

      if (contactDate <= retentionThreshold) {
        const daysAgo = Math.floor(
          (Date.now() - new Date(contactDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        retention_alerts.push({
          id: client.id,
          full_name: client.full_name,
          phone: client.phone,
          days_since_contact: daysAgo,
        });
      }
    }

    // Sort retention alerts: most days first
    retention_alerts.sort((a, b) => b.days_since_contact - a.days_since_contact);

    // ── 6. Unpaid clients ─────────────────────────────────────────────────
    const unpaidRows = db
      .prepare(`
        SELECT c.id, c.full_name, c.phone, c.payment_status, c.package_price,
               COALESCE(SUM(p.amount), 0) as total_paid
        FROM clients c
        LEFT JOIN payments p ON p.client_id = c.id
        WHERE c.payment_status != 'paid'
          AND c.status != ?
        GROUP BY c.id
        ORDER BY c.full_name
      `)
      .all(CLIENT_STATUS.ENDED);

    const unpaid_clients = unpaidRows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      payment_status: r.payment_status,
      package_price: r.package_price,
      total_paid: r.total_paid,
    }));

    // ── 7. Summary counters ────────────────────────────────────────────────
    const activeCount = db
      .prepare("SELECT COUNT(*) as n FROM clients WHERE status = ?")
      .get(CLIENT_STATUS.ACTIVE).n;

    // Leads created in the current calendar month
    const monthStart = today.slice(0, 7) + '-01'; // "YYYY-MM-01"
    const leadsThisMonth = db
      .prepare("SELECT COUNT(*) as n FROM leads WHERE created_at >= ?")
      .get(monthStart).n;

    // Sessions this week = upcoming client sessions + lead meetings this week
    const sessionsThisWeek = client_sessions.length + lead_meetings.length;

    return ok(res, {
      client_sessions,
      lead_meetings,
      alerts,
      frozen_leads,
      retention_alerts,
      unpaid_clients,
      counters: {
        active_clients: activeCount,
        leads_this_month: leadsThisMonth,
        sessions_this_week: sessionsThisWeek,
      },
    });
  } catch (err) {
    console.error('[GET /dashboard]', err);
    return fail(res, 500, 'Failed to load dashboard.');
  }
});

module.exports = router;
