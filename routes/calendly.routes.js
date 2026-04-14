const express = require('express');
const db = require('../database/db');
const { generateLink } = require('../services/whatsapp.service');
const { deleteCalendarEvent } = require('../services/google-calendar.service');

// Two routers:
//   webhookRouter  — mounted BEFORE requireAuth (no auth)
//   calendlyRouter — mounted AFTER  requireAuth (auth required)
const webhookRouter  = express.Router();
const calendlyRouter = express.Router();

// ── Phone normalization for DB comparison → 05XXXXXXXXX ───────────────────────

function normalizePhoneForDB(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // +9725XXXXXXXX or 9725XXXXXXXX → 05XXXXXXXX
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  // Already 05XXXXXXXX
  if (digits.startsWith('0')) return digits;
  return digits;
}

// ── invitee.created handler ───────────────────────────────────────────────────

function handleCreated(payload) {
  // Correct field paths based on actual Calendly webhook payload structure
  const scheduledEvent  = payload.scheduled_event || {};
  const eventUri        = scheduledEvent.uri || '';
  const event_uuid      = payload.uri?.split('/').pop() || eventUri.split('/').pop();
  const invitee_name    = payload.name  || '';
  const invitee_email   = payload.email || '';
  const start_time      = scheduledEvent.start_time || '';
  const end_time        = scheduledEvent.end_time   || '';
  const event_type_uri  = scheduledEvent.event_type || '';
  const event_name      = scheduledEvent.name       || '';

  // Extract phone from questions_and_answers (root of payload)
  const qas = payload.questions_and_answers || [];
  const phoneQA = qas.find((qa) => /טלפון|phone/i.test(qa.question || ''));
  const invitee_phone = phoneQA?.answer?.trim() || null;

  // Determine event type from event name (most reliable) then URI
  let event_type = 'first_meeting';
  if (/מעקב/.test(event_name)) {
    event_type = 'follow_up';
  } else if (/ראשונ/.test(event_name)) {
    event_type = 'first_meeting';
  } else if (event_type_uri.includes('follow_up_meetings')) {
    event_type = 'follow_up';
  } else if (event_type_uri.includes('first_meeting')) {
    event_type = 'first_meeting';
  }

  // Normalize phone for DB matching
  const normPhone = normalizePhoneForDB(invitee_phone || '');

  // Match to client or lead by phone
  let client_id = null;
  let lead_id   = null;

  if (normPhone) {
    const clients = db.prepare('SELECT id, phone FROM clients WHERE status != ?').all('ended');
    const matchedClient = clients.find((c) => normalizePhoneForDB(c.phone) === normPhone);
    if (matchedClient) {
      client_id = matchedClient.id;
    } else {
      const leads = db.prepare('SELECT id, phone FROM leads').all();
      const matchedLead = leads.find((l) => normalizePhoneForDB(l.phone) === normPhone);
      if (matchedLead) lead_id = matchedLead.id;
    }
  }

  // Insert calendly event (idempotent)
  db.prepare(`
    INSERT OR IGNORE INTO calendly_events
      (id, client_id, lead_id, event_type, invitee_name, invitee_phone,
       invitee_email, start_time, end_time, status, calendly_event_uri)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    event_uuid, client_id, lead_id, event_type,
    invitee_name, invitee_phone, invitee_email,
    start_time, end_time, eventUri,
  );

  // Auto-create session for matched clients booking a follow-up
  if (client_id && event_type === 'follow_up') {
    const nextWindow = db.prepare(`
      SELECT w.session_number
      FROM   session_windows w
      LEFT JOIN sessions s
        ON s.client_id = w.client_id AND s.session_number = w.session_number
      WHERE  w.client_id = ? AND s.id IS NULL
      ORDER  BY w.session_number ASC
      LIMIT  1
    `).get(client_id);

    if (nextWindow) {
      db.prepare(`
        INSERT OR IGNORE INTO sessions (client_id, session_number, session_date, highlights)
        VALUES (?, ?, ?, '')
      `).run(client_id, nextWindow.session_number, start_time);
      console.log(`[calendly] Created session ${nextWindow.session_number} for client ${client_id}`);
    }
  }

  console.log(`[calendly] Booked: ${invitee_name} (${event_type}) — ${invitee_phone || 'no phone'} — ${start_time}`);
}

// ── invitee.canceled handler ──────────────────────────────────────────────────

function handleCanceled(payload) {
  const event_uuid = payload.uri?.split('/').pop();
  if (!event_uuid) return;

  const event = db.prepare('SELECT * FROM calendly_events WHERE id = ?').get(event_uuid);
  if (!event) return;

  db.prepare("UPDATE calendly_events SET status = 'canceled' WHERE id = ?").run(event_uuid);

  // Delete auto-created session if it has no meaningful content
  if (event.client_id && event.start_time) {
    db.prepare(`
      DELETE FROM sessions
      WHERE  client_id = ? AND session_date = ?
        AND (highlights IS NULL OR highlights = '')
        AND (tasks IS NULL OR tasks = '[]' OR tasks = '')
    `).run(event.client_id, event.start_time);
  }

  console.log(`[calendly] Canceled: ${event.invitee_name}`);
}

// ── POST /api/calendly/webhook ────────────────────────────────────────────────

webhookRouter.post('/webhook', (req, res) => {
  // Respond immediately so Calendly doesn't retry on slow processing
  res.json({ received: true });

  const eventName = req.body?.event;
  const payload   = req.body?.payload;

  if (!eventName || !payload) return;

  try {
    if (eventName === 'invitee.created')  handleCreated(payload);
    if (eventName === 'invitee.canceled') handleCanceled(payload);
  } catch (err) {
    console.error('[calendly webhook]', err);
  }
});

// ── GET /api/calendly/config ──────────────────────────────────────────────────

calendlyRouter.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      followupLink: process.env.CALENDLY_FOLLOWUP_LINK || '',
      firstLink:    process.env.CALENDLY_FIRST_LINK    || '',
    },
  });
});

// ── GET /api/calendly/upcoming ────────────────────────────────────────────────

calendlyRouter.get('/upcoming', (req, res) => {
  const rows = db.prepare(`
    SELECT
      ce.id, ce.event_type, ce.invitee_name, ce.client_id, ce.lead_id,
      ce.start_time, ce.end_time, ce.confirmation_sent, ce.confirmation_link,
      COALESCE(ce.invitee_phone, c.phone, l.phone)         AS phone_for_wa,
      COALESCE(c.full_name, l.full_name, ce.invitee_name)  AS matched_name
    FROM   calendly_events ce
    LEFT JOIN clients c ON ce.client_id = c.id
    LEFT JOIN leads   l ON ce.lead_id   = l.id
    WHERE  ce.status = 'active' AND ce.start_time > datetime('now')
    ORDER  BY ce.start_time ASC
  `).all();

  res.json({ success: true, data: rows });
});

// ── PUT /api/calendly/events/:id/cancel ──────────────────────────────────────

calendlyRouter.put('/events/:id/cancel', async (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM calendly_events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found.' });

    db.prepare("UPDATE calendly_events SET status = 'canceled' WHERE id = ?").run(req.params.id);

    // Delete from Google Calendar if linked
    if (event.google_event_id) {
      try {
        await deleteCalendarEvent(event.google_event_id);
        console.log(`[google] Deleted calendar event: ${event.google_event_id}`);
      } catch (err) {
        console.error('[google] Failed to delete calendar event:', err.message);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[PUT /calendly/events/:id/cancel]', err);
    return res.status(500).json({ success: false, error: 'Failed to cancel event.' });
  }
});

// ── POST /api/calendly/check-reminders ───────────────────────────────────────

calendlyRouter.post('/check-reminders', (req, res) => {
  const { checkUpcomingReminders } = require('../services/reminders.service');
  const count = checkUpcomingReminders();
  res.json({ success: true, data: { count } });
});

module.exports = { webhookRouter, calendlyRouter };
