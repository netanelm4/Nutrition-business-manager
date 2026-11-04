const express = require('express');
const db = require('../database/db');
const { deleteCalendarEvent, updateCalendarEvent } = require('../services/google-calendar.service');
const {
  cancelSessionsForEvent, rescheduleSessionsForEvent, markEventSessionsHeld,
} = require('../services/session-lifecycle.service');
const { israelLocalToUtcISO, addHoursUtcISO, nowUtcISO } = require('../utils/dates');
const { bookingLinks } = require('../config/booking');
const { publish } = require('../services/event-bus.service');

// ─── Meetings (Google Calendar is the single scheduling source) ──────────────
// Mounted at /api/meetings, after requireAuth. Bookings arrive through the
// Google Calendar sync (services/google-calendar.service.js); manual meetings
// are created from a lead (POST /api/leads/:id/meeting) and pushed to Google.
// start_time / end_time are canonical UTC ISO — compare with nowUtcISO(), never
// with SQLite datetime('now').

const router = express.Router();

const MEETING_DURATION_HOURS = 1;
const EVENT_TYPE_LABEL = { first_meeting: 'פגישה ראשונה', follow_up: 'מעקב', consultation: 'ייעוץ' };

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ── GET /api/meetings/config — booking links ─────────────────────────────────
router.get('/config', (req, res) => ok(res, bookingLinks()));

// ── GET /api/meetings/upcoming ───────────────────────────────────────────────
router.get('/upcoming', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        m.id, m.event_type, m.invitee_name, m.client_id, m.lead_id,
        m.start_time, m.end_time, m.confirmation_sent, m.confirmation_link, m.source,
        COALESCE(m.invitee_phone, c.phone, l.phone)         AS phone_for_wa,
        COALESCE(c.full_name, l.full_name, m.invitee_name)  AS matched_name
      FROM   meetings m
      LEFT JOIN clients c ON m.client_id = c.id
      LEFT JOIN leads   l ON m.lead_id   = l.id
      WHERE  m.status = 'active' AND m.start_time > ?
      ORDER  BY m.start_time ASC
    `).all(nowUtcISO());
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /meetings/upcoming]', err);
    return fail(res, 500, 'Failed to fetch upcoming meetings.');
  }
});

// ── PUT /api/meetings/events/:id — reschedule / edit ─────────────────────────
// Body: { date: "YYYY-MM-DD", time: "HH:MM" (Israel local), event_type, notes }
router.put('/events/:id', async (req, res) => {
  try {
    const { date, time, event_type, notes } = req.body;
    if (!date || !time) return fail(res, 400, 'date and time are required.');

    const event = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
    if (!event) return fail(res, 404, 'Event not found.');

    const startISO = israelLocalToUtcISO(date, time);
    if (!startISO) return fail(res, 400, 'Invalid date or time.');
    const endISO = addHoursUtcISO(MEETING_DURATION_HOURS, new Date(startISO));
    const type = event_type || event.event_type;

    const moved = startISO !== event.start_time;
    db.prepare(`
      UPDATE meetings SET start_time = ?, end_time = ?, event_type = ?, notes = ?,
             confirmation_sent = CASE WHEN ? THEN 0 ELSE confirmation_sent END,
             confirmation_link = CASE WHEN ? THEN NULL ELSE confirmation_link END
      WHERE id = ?
    `).run(startISO, endISO, type, notes || null, moved ? 1 : 0, moved ? 1 : 0, req.params.id);
    rescheduleSessionsForEvent(db, req.params.id, startISO);
    if (moved) publish(db, 'meeting.rescheduled', { entityType: 'meeting', entityId: req.params.id, payload: { from: event.start_time, to: startISO } });

    if (event.google_event_id) {
      const lead   = event.lead_id   ? db.prepare('SELECT full_name FROM leads   WHERE id = ?').get(event.lead_id)   : null;
      const client = event.client_id ? db.prepare('SELECT full_name FROM clients WHERE id = ?').get(event.client_id) : null;
      const personName = lead?.full_name || client?.full_name || event.invitee_name || '';
      const typeLabel = EVENT_TYPE_LABEL[type] || type;
      const result = await updateCalendarEvent(event.google_event_id, {
        title: personName ? `${typeLabel}: ${personName}` : typeLabel,
        startTime: startISO,
        endTime: endISO,
        description: notes || '',
      });
      if (!result.success && result.error !== 'not_connected' && result.error !== 'not_configured') {
        console.error('[google] Failed to update calendar event:', result.error);
      }
    }
    return ok(res, db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id));
  } catch (err) {
    console.error('[PUT /meetings/events/:id]', err);
    return fail(res, 500, 'Failed to update event.');
  }
});

// ── PUT /api/meetings/events/:id/cancel ──────────────────────────────────────
router.put('/events/:id/cancel', async (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
    if (!event) return fail(res, 404, 'Event not found.');

    db.prepare("UPDATE meetings SET status = 'canceled' WHERE id = ?").run(req.params.id);
    const sessions = cancelSessionsForEvent(db, event);
    publish(db, 'meeting.canceled', { entityType: 'meeting', entityId: req.params.id, payload: { sessions } });

    if (event.google_event_id) {
      const result = await deleteCalendarEvent(event.google_event_id);
      if (!result.success) console.error('[google] Failed to delete calendar event:', result.error);
    }
    return ok(res, { id: req.params.id, sessions });
  } catch (err) {
    console.error('[PUT /meetings/events/:id/cancel]', err);
    return fail(res, 500, 'Failed to cancel event.');
  }
});

// ── PUT /api/meetings/events/:id/complete — the meeting took place ────────────
router.put('/events/:id/complete', (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
    if (!event) return fail(res, 404, 'Event not found.');

    db.prepare("UPDATE meetings SET status = 'completed' WHERE id = ?").run(req.params.id);
    const sessionsHeld = markEventSessionsHeld(db, req.params.id);
    publish(db, 'meeting.completed', { entityType: 'meeting', entityId: req.params.id, payload: { sessionsHeld } });
    const updated = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
    return ok(res, { ...updated, sessions_held: sessionsHeld });
  } catch (err) {
    console.error('[PUT /meetings/events/:id/complete]', err);
    return fail(res, 500, 'Failed to complete event.');
  }
});

// ── GET /api/meetings/clients/:clientId/events — upcoming for one client ─────
router.get('/clients/:clientId/events', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM meetings
      WHERE client_id = ? AND status = 'active' AND start_time > ?
      ORDER BY start_time ASC
    `).all(req.params.clientId, nowUtcISO());
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /meetings/clients/:clientId/events]', err);
    return fail(res, 500, 'Failed to fetch client events.');
  }
});

// ── POST /api/meetings/check-reminders — manual trigger ──────────────────────
router.post('/check-reminders', (req, res) => {
  try {
    // Reminders are scheduled jobs now: derive due jobs and run them immediately
    const { reconcileJobs, runDueJobs } = require('../services/jobs.service');
    reconcileJobs(db);
    runDueJobs(db).then((r) => ok(res, { count: r.ran })).catch((err) => {
      console.error('[POST /meetings/check-reminders]', err);
      fail(res, 500, 'Failed to check reminders.');
    });
    return;
  } catch (err) {
    console.error('[POST /meetings/check-reminders]', err);
    return fail(res, 500, 'Failed to check reminders.');
  }
});

module.exports = router;
