const express = require('express');
const db = require('../database/db');
const { LEAD_STATUS, CLIENT_STATUS } = require('../constants/statuses');
const { createCalendarEvent } = require('../services/google-calendar.service');

const router = express.Router();

const TERMINAL_STATUSES = new Set([LEAD_STATUS.BECAME_CLIENT, LEAD_STATUS.NOT_RELEVANT, LEAD_STATUS.MEETING_HELD]);
const FROZEN_DAYS = 5;

function computeFrozen(lead) {
  if (TERMINAL_STATUSES.has(lead.status)) return false;
  const lastUpdate = lead.status_updated_at || lead.created_at;
  if (!lastUpdate) return false;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - FROZEN_DAYS);
  return new Date(lastUpdate) < threshold;
}

function attachFrozen(lead) {
  return { ...lead, frozen: computeFrozen(lead) };
}

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─── GET /api/leads ───────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
    return ok(res, leads.map(attachFrozen));
  } catch (err) {
    console.error('[GET /leads]', err);
    return fail(res, 500, 'Failed to fetch leads.');
  }
});

// ─── POST /api/leads ──────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const { full_name, phone, source, status, notes, follow_up_date } = req.body;

    if (!full_name || !full_name.trim()) {
      return fail(res, 400, 'full_name is required.');
    }

    const result = db.prepare(`
      INSERT INTO leads (full_name, phone, source, status, notes, follow_up_date)
      VALUES (@full_name, @phone, @source, @status, @notes, @follow_up_date)
    `).run({
      full_name: full_name.trim(),
      phone: phone || null,
      source: source || null,
      status: status || LEAD_STATUS.NEW,
      notes: notes || null,
      follow_up_date: follow_up_date || null,
    });

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, lead);
  } catch (err) {
    console.error('[POST /leads]', err);
    return fail(res, 500, 'Failed to create lead.');
  }
});

// ─── GET /api/leads/:id ───────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');
    return ok(res, attachFrozen(lead));
  } catch (err) {
    console.error('[GET /leads/:id]', err);
    return fail(res, 500, 'Failed to fetch lead.');
  }
});

// ─── PUT /api/leads/:id ───────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    const fields = ['full_name', 'phone', 'source', 'status', 'notes', 'follow_up_date'];
    const updates = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        updates[f] = req.body[f];
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 400, 'No updatable fields provided.');
    }

    // Stamp status_updated_at whenever status changes
    if ('status' in updates && updates.status !== lead.status) {
      updates.status_updated_at = new Date().toISOString();
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE leads SET ${setClauses} WHERE id = @id`).run({ ...updates, id: req.params.id });

    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    return ok(res, attachFrozen(updated));
  } catch (err) {
    console.error('[PUT /leads/:id]', err);
    return fail(res, 500, 'Failed to update lead.');
  }
});

// ─── POST /api/leads/:id/convert ──────────────────────────────────────────────
// One-click conversion: marks lead as became_client AND creates the client row.
// Returns { client_id } so the UI can navigate directly to the client page.

router.post('/:id/convert', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    console.log(`[convert] Starting conversion: lead id=${lead.id} name="${lead.full_name}" current_status=${lead.status}`);

    // Idempotent: if already converted, return the existing client
    if (lead.status === LEAD_STATUS.BECAME_CLIENT) {
      const existing = db.prepare('SELECT id FROM clients WHERE converted_from_lead_id = ?').get(lead.id);
      if (existing) {
        console.log(`[convert] Already converted — returning existing client id=${existing.id}`);
        return ok(res, { client_id: existing.id });
      }
      return fail(res, 409, 'Lead already converted but no matching client found.');
    }

    // Fetch intake data to copy clinical fields to the client record
    const intake = db.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(lead.id);
    console.log(`[convert] Intake data found: ${intake ? 'yes' : 'no'}`);

    // Mark lead as converted
    db.prepare('UPDATE leads SET status = ?, status_updated_at = ? WHERE id = ?').run(
      LEAD_STATUS.BECAME_CLIENT,
      new Date().toISOString(),
      lead.id
    );
    console.log(`[convert] Lead ${lead.id} marked as became_client`);

    // Create the client row automatically
    console.log(`[convert] Inserting client row for lead ${lead.id}...`);
    const result = db.prepare(`
      INSERT INTO clients
        (full_name, phone, age, gender, initial_weight, status, converted_from_lead_id)
      VALUES
        (@full_name, @phone, @age, @gender, @initial_weight, @status, @converted_from_lead_id)
    `).run({
      full_name:             lead.full_name,
      phone:                 lead.phone    || null,
      age:                   intake?.age   || null,
      gender:                intake?.gender || null,
      initial_weight:        intake?.weight || null,
      status:                CLIENT_STATUS.ACTIVE,
      converted_from_lead_id: lead.id,
    });

    const clientId = result.lastInsertRowid;
    console.log(`[convert] Created client id=${clientId} status=active`);

    // Copy full intake data as pending (for session 1 pre-fill)
    if (intake) {
      try {
        db.prepare('UPDATE clients SET pending_intake_data = ? WHERE id = ?').run(
          JSON.stringify(intake), clientId
        );
        console.log(`[convert] Copied intake data to pending_intake_data on client ${clientId}`);
      } catch (err) {
        console.error('[convert] Failed to copy intake data:', err.message);
      }
    }

    return ok(res, { client_id: clientId });
  } catch (err) {
    console.error('[POST /leads/:id/convert]', err);
    return fail(res, 500, 'Failed to convert lead.');
  }
});

// ─── POST /api/leads/:id/meeting ─────────────────────────────────────────────

router.post('/:id/meeting', async (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    const { date, time, event_type, notes } = req.body;
    if (!date || !time || !event_type) {
      return fail(res, 400, 'date, time, and event_type are required.');
    }

    // Build naive ISO strings (no Z suffix) so they are interpreted as
    // Israel local time both by Google Calendar (with timeZone hint) and
    // by the browser (which parses naive strings as local time).
    const startISO = `${date}T${time}:00`;

    // Add 1 hour via simple arithmetic on the time components (timezone-agnostic)
    const [hh, mm] = time.split(':').map(Number);
    const endH = hh + 1;
    let endDate = date;
    let endTimeStr = `${String(endH % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (endH >= 24) {
      // Roll to next calendar day (edge case: meeting starting at 23:xx)
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      endDate = d.toISOString().slice(0, 10);
    }
    const endISO = `${endDate}T${endTimeStr}:00`;

    // Generate a unique ID for manual events
    const eventId = `manual_${Date.now()}_${lead.id}`;

    db.prepare(`
      INSERT INTO calendly_events
        (id, client_id, lead_id, event_type, invitee_name, invitee_phone,
         start_time, end_time, status, source, notes)
      VALUES
        (@id, NULL, @lead_id, @event_type, @invitee_name, @invitee_phone,
         @start_time, @end_time, 'active', 'manual', @notes)
    `).run({
      id: eventId,
      lead_id: lead.id,
      event_type,
      invitee_name: lead.full_name,
      invitee_phone: lead.phone || null,
      start_time: startISO,
      end_time:   endISO,
      notes: notes || null,
    });

    // Try to add to Google Calendar — silently skip if not connected
    try {
      const gcal = await createCalendarEvent({
        title:       `פגישה עם ${lead.full_name}`,
        startTime:   startISO,
        endTime:     endISO,
        description: notes || '',
        location:    '',
      });

      if (gcal.success && gcal.eventId) {
        db.prepare('UPDATE calendly_events SET google_event_id = ? WHERE id = ?')
          .run(gcal.eventId, eventId);
        console.log(`[google] Calendar event created: ${gcal.eventId}`);
      } else if (gcal.error !== 'not_connected') {
        console.error('[google] createCalendarEvent failed:', gcal.error);
      }
    } catch (err) {
      console.error('[google] Unexpected error creating calendar event:', err.message);
    }

    return ok(res, { event_id: eventId });
  } catch (err) {
    console.error('[POST /leads/:id/meeting]', err);
    return fail(res, 500, 'Failed to schedule meeting.');
  }
});

// ─── GET /api/leads/:id/meeting ──────────────────────────────────────────────

router.get('/:id/meeting', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    const event = db.prepare(`
      SELECT * FROM calendly_events
      WHERE lead_id = ? AND status = 'active'
      ORDER BY start_time DESC
      LIMIT 1
    `).get(req.params.id);

    return ok(res, event || null);
  } catch (err) {
    console.error('[GET /leads/:id/meeting]', err);
    return fail(res, 500, 'Failed to fetch meeting.');
  }
});

// ─── DELETE /api/leads/:id ────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    return ok(res, { id: Number(req.params.id) });
  } catch (err) {
    console.error('[DELETE /leads/:id]', err);
    return fail(res, 500, 'Failed to delete lead.');
  }
});

module.exports = router;
