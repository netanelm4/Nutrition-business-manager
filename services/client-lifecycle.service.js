const crypto = require('crypto');
const { LEAD_STATUS, CLIENT_STATUS } = require('../constants/statuses');
const { calculateSessionWindows, calculateProcessEndDate, todayISO } = require('../utils/dates');

// ─── Client lifecycle commands ───────────────────────────────────────────────
// Single source of truth for creating/closing a client's process.
// Every function takes the db handle as a parameter (no require of db.js here),
// so the same code is usable from routes AND from startup repairs in db.js.

function generateWeightToken() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Return the id of the client's active engagement, creating engagement #1 when
 * the client has none at all. Never creates a second engagement — renewals go
 * through POST /api/engagements/client/:id.
 */
function ensureActiveEngagement(database, clientId, startedAt) {
  const active = database.prepare(
    "SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1"
  ).get(clientId);
  if (active) return active.id;

  const any = database.prepare('SELECT COUNT(*) AS n FROM engagements WHERE client_id = ?').get(clientId);
  if (any.n > 0) return null; // all engagements completed — do not auto-reopen

  const res = database.prepare(`
    INSERT INTO engagements (client_id, number, status, started_at)
    VALUES (?, 1, 'active', ?)
  `).run(clientId, startedAt || todayISO());
  return res.lastInsertRowid;
}

/** Mark every active engagement of the client as completed. */
function closeActiveEngagements(database, clientId, endedAt) {
  return database.prepare(`
    UPDATE engagements SET status = 'completed', ended_at = ?
    WHERE client_id = ? AND status = 'active'
  `).run(endedAt || todayISO(), clientId).changes;
}

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

/**
 * Atomically convert a lead into an active client.
 * Idempotent: if the lead already has a client row, returns it untouched.
 *
 * Creates: client (start_date, process_end_date = +90d, weight_token),
 *          engagement #1, session 1 (linked to the engagement),
 *          6 session windows, session intake copied from the lead intake,
 *          and links the lead's meeting to the new client.
 *
 * @returns {{ clientId: number, sessionId: number|null, alreadyConverted: boolean }}
 * @throws  Error with .status = 404 when the lead does not exist
 */
function convertLeadToClient(database, leadId) {
  const lead = database.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) {
    const err = new Error('Lead not found.');
    err.status = 404;
    throw err;
  }

  const existing = database.prepare('SELECT id FROM clients WHERE converted_from_lead_id = ?').get(lead.id);
  if (existing) {
    // Self-heal the lead status if it drifted
    if (lead.status !== LEAD_STATUS.BECAME_CLIENT) {
      database.prepare('UPDATE leads SET status = ?, status_updated_at = ? WHERE id = ?')
        .run(LEAD_STATUS.BECAME_CLIENT, new Date().toISOString(), lead.id);
    }
    return { clientId: existing.id, sessionId: null, alreadyConverted: true };
  }

  const intake  = database.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(lead.id);
  const meeting = database.prepare(`
    SELECT * FROM calendly_events
    WHERE lead_id = ? AND status = 'active'
    ORDER BY start_time ASC LIMIT 1
  `).get(lead.id);

  const sessionDate = meeting ? meeting.start_time.slice(0, 10) : todayISO();
  const windows = calculateSessionWindows(sessionDate);

  const run = database.transaction(() => {
    const clientRes = database.prepare(`
      INSERT INTO clients
        (full_name, phone, age, gender, initial_weight, status,
         converted_from_lead_id, start_date, process_end_date, weight_token,
         pending_intake_data)
      VALUES
        (@full_name, @phone, @age, @gender, @initial_weight, @status,
         @converted_from_lead_id, @start_date, @process_end_date, @weight_token,
         @pending_intake_data)
    `).run({
      full_name:              lead.full_name,
      phone:                  lead.phone || '',
      age:                    intake?.age    || null,
      gender:                 intake?.gender || null,
      initial_weight:         intake?.weight || null,
      status:                 CLIENT_STATUS.ACTIVE,
      converted_from_lead_id: lead.id,
      start_date:             sessionDate,
      process_end_date:       calculateProcessEndDate(sessionDate),
      weight_token:           generateWeightToken(),
      pending_intake_data:    intake ? JSON.stringify(intake) : null,
    });
    const clientId = clientRes.lastInsertRowid;

    database.prepare('UPDATE leads SET status = ?, status_updated_at = ? WHERE id = ?')
      .run(LEAD_STATUS.BECAME_CLIENT, new Date().toISOString(), lead.id);

    const engagementId = ensureActiveEngagement(database, clientId, sessionDate);

    const sessionRes = database.prepare(`
      INSERT INTO sessions (client_id, session_number, session_date, highlights, tasks, engagement_id)
      VALUES (?, 1, ?, '', '[]', ?)
    `).run(clientId, sessionDate, engagementId);
    const sessionId = sessionRes.lastInsertRowid;

    if (meeting) {
      database.prepare('UPDATE calendly_events SET client_id = ?, engagement_id = ? WHERE id = ?')
        .run(clientId, engagementId, meeting.id);
    }

    const insertWin = database.prepare(
      'INSERT INTO session_windows (client_id, session_number, expected_date) VALUES (?, ?, ?)'
    );
    for (const w of windows) insertWin.run(clientId, w.session_number, w.expected_date);

    if (intake) insertSessionIntakeFromLead(database, sessionId, clientId, intake);

    return { clientId, sessionId };
  });

  const { clientId, sessionId } = run();
  console.log(`[convert] lead ${lead.id} → client ${clientId} (session ${sessionId}, start ${sessionDate})`);
  return { clientId, sessionId, alreadyConverted: false };
}

module.exports = {
  generateWeightToken,
  ensureActiveEngagement,
  closeActiveEngagements,
  insertSessionIntakeFromLead,
  convertLeadToClient,
};
