const express = require('express');
const db = require('../database/db');
const { LEAD_STATUS, CLIENT_STATUS } = require('../constants/statuses');
const { calculateSessionWindows } = require('../utils/dates');
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
// Atomically converts a lead into an active client.
// All steps run inside a single db.transaction() — if anything fails, nothing
// is committed and the lead stays unconverted (safe to retry).
// Returns { clientId, sessionId }.

// Shared helper: copy intake fields into session_intakes row.
function insertSessionIntakeFromLead(database, sessionId, clientId, intake) {
  database.prepare(`
    INSERT INTO session_intakes
      (session_id, client_id,
       age, gender, weight, goal, activity_factor,
       bmr_mifflin, bmr_harris, bmr_average, adjusted_weight, tdee,
       height, marital_status, num_children, occupation,
       work_hours, work_type, eating_at_work, medical_conditions, medications,
       lab_results_pdf_path, prev_treatment, prev_treatment_goal, prev_success,
       prev_challenges, reason_for_treatment, diet_type, eating_patterns,
       water_intake, coffee_per_day, alcohol_per_week, sleep_hours, sleep_quality,
       physical_activity, activity_type, activity_frequency, favorite_snacks, favorite_foods,
       nutrition_anamnesis)
    VALUES
      (@session_id, @client_id,
       @age, @gender, @weight, @goal, @activity_factor,
       @bmr_mifflin, @bmr_harris, @bmr_average, @adjusted_weight, @tdee,
       @height, @marital_status, @num_children, @occupation,
       @work_hours, @work_type, @eating_at_work, @medical_conditions, @medications,
       @lab_results_pdf_path, @prev_treatment, @prev_treatment_goal, @prev_success,
       @prev_challenges, @reason_for_treatment, @diet_type, @eating_patterns,
       @water_intake, @coffee_per_day, @alcohol_per_week, @sleep_hours, @sleep_quality,
       @physical_activity, @activity_type, @activity_frequency, @favorite_snacks, @favorite_foods,
       @nutrition_anamnesis)
  `).run({
    session_id:           sessionId,
    client_id:            clientId,
    age:                  intake.age,
    gender:               intake.gender,
    weight:               intake.weight,
    goal:                 intake.goal,
    activity_factor:      intake.activity_factor,
    bmr_mifflin:          intake.bmr_mifflin,
    bmr_harris:           intake.bmr_harris,
    bmr_average:          intake.bmr_average,
    adjusted_weight:      intake.adjusted_weight,
    tdee:                 intake.tdee,
    height:               intake.height,
    marital_status:       intake.marital_status,
    num_children:         intake.num_children,
    occupation:           intake.occupation,
    work_hours:           intake.work_hours,
    work_type:            intake.work_type,
    eating_at_work:       intake.eating_at_work,
    medical_conditions:   intake.medical_conditions,
    medications:          intake.medications,
    lab_results_pdf_path: intake.lab_results_pdf_path,
    prev_treatment:       intake.prev_treatment,
    prev_treatment_goal:  intake.prev_treatment_goal,
    prev_success:         intake.prev_success,
    prev_challenges:      intake.prev_challenges,
    reason_for_treatment: intake.reason_for_treatment,
    diet_type:            intake.diet_type,
    eating_patterns:      intake.eating_patterns,
    water_intake:         intake.water_intake,
    coffee_per_day:       intake.coffee_per_day,
    alcohol_per_week:     intake.alcohol_per_week,
    sleep_hours:          intake.sleep_hours,
    sleep_quality:        intake.sleep_quality,
    physical_activity:    intake.physical_activity,
    activity_type:        intake.activity_type,
    activity_frequency:   intake.activity_frequency,
    favorite_snacks:      intake.favorite_snacks,
    favorite_foods:       intake.favorite_foods,
    nutrition_anamnesis:  intake.nutrition_anamnesis,
  });
}

router.post('/:id/convert', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    console.log(`[convert] Starting conversion: lead id=${lead.id} name="${lead.full_name}" status=${lead.status}`);

    // Idempotent: already converted AND client row exists → return it
    if (lead.status === LEAD_STATUS.BECAME_CLIENT) {
      const existing = db.prepare('SELECT id FROM clients WHERE converted_from_lead_id = ?').get(lead.id);
      if (existing) {
        console.log(`[convert] Already converted — returning existing client id=${existing.id}`);
        return ok(res, { clientId: existing.id });
      }
      // Lead stuck as became_client but no client row — fall through and repair it
      console.log(`[convert] Lead is became_client but no client row — repairing...`);
    }

    // Pre-fetch data outside the transaction (read-only, safe)
    const intake  = db.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(lead.id);
    const meeting = db.prepare(`
      SELECT * FROM calendly_events
      WHERE lead_id = ? AND status = 'active'
      ORDER BY start_time ASC LIMIT 1
    `).get(lead.id);

    console.log(`[convert] Intake: ${intake ? 'found' : 'none'} | Meeting: ${meeting ? meeting.start_time.slice(0, 10) : 'none'}`);

    const sessionDate = meeting
      ? meeting.start_time.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const windows = calculateSessionWindows(sessionDate);

    // ── Atomic transaction: all steps or nothing ──────────────────────────────
    const doConvert = db.transaction(() => {
      // a) INSERT client (start_date included from the start)
      const clientRes = db.prepare(`
        INSERT INTO clients
          (full_name, phone, age, gender, initial_weight, status,
           converted_from_lead_id, start_date)
        VALUES
          (@full_name, @phone, @age, @gender, @initial_weight, @status,
           @converted_from_lead_id, @start_date)
      `).run({
        full_name:              lead.full_name,
        phone:                  lead.phone          || '',
        age:                    intake?.age         || null,
        gender:                 intake?.gender      || null,
        initial_weight:         intake?.weight      || null,
        status:                 CLIENT_STATUS.ACTIVE,
        converted_from_lead_id: lead.id,
        start_date:             sessionDate,
      });
      const clientId = clientRes.lastInsertRowid;
      console.log(`[convert] ✓ a) Client created id=${clientId}`);

      // b) UPDATE lead status (after client insert — never before)
      db.prepare('UPDATE leads SET status = ?, status_updated_at = ? WHERE id = ?').run(
        LEAD_STATUS.BECAME_CLIENT, new Date().toISOString(), lead.id
      );
      console.log(`[convert] ✓ b) Lead ${lead.id} → became_client`);

      // d) INSERT session 1
      const sessionRes = db.prepare(`
        INSERT INTO sessions (client_id, session_number, session_date, highlights, tasks)
        VALUES (?, 1, ?, '', '[]')
      `).run(clientId, sessionDate);
      const sessionId = sessionRes.lastInsertRowid;
      console.log(`[convert] ✓ d) Session 1 id=${sessionId} date=${sessionDate}`);

      // e) Link calendly_event → new client
      if (meeting) {
        db.prepare('UPDATE calendly_events SET client_id = ? WHERE id = ?').run(clientId, meeting.id);
        console.log(`[convert] ✓ e) Linked calendly_event ${meeting.id} → client ${clientId}`);
      }

      // g) DELETE stale windows, INSERT 6 fresh ones
      db.prepare('DELETE FROM session_windows WHERE client_id = ?').run(clientId);
      const insertWin = db.prepare(
        'INSERT INTO session_windows (client_id, session_number, expected_date) VALUES (?, ?, ?)'
      );
      for (const w of windows) insertWin.run(clientId, w.session_number, w.expected_date);
      console.log(`[convert] ✓ g) Created ${windows.length} session windows from ${sessionDate}`);

      // h) Copy lead_intakes → session_intakes
      if (intake) {
        insertSessionIntakeFromLead(db, sessionId, clientId, intake);
        console.log(`[convert] ✓ h) Copied intake to session_intakes`);
      }

      // i) Store raw intake in pending_intake_data for backward compat
      if (intake) {
        db.prepare('UPDATE clients SET pending_intake_data = ? WHERE id = ?').run(
          JSON.stringify(intake), clientId
        );
      }

      return { clientId, sessionId };
    });

    const { clientId, sessionId } = doConvert();
    console.log(`[convert] ✓ Conversion complete: client=${clientId} session=${sessionId}`);
    return ok(res, { clientId, sessionId });
  } catch (err) {
    console.error('[POST /leads/:id/convert] FAILED:', err.message);
    return fail(res, 500, `Failed to convert lead: ${err.message}`);
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
