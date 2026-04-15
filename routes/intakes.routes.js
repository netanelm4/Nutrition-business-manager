const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const db      = require('../database/db');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ── PDF upload setup ──────────────────────────────────────────────────────────

const LABS_DIR = path.join(__dirname, '..', 'data', 'labs');
if (!fs.existsSync(LABS_DIR)) fs.mkdirSync(LABS_DIR, { recursive: true });

const upload = multer({
  dest: LABS_DIR,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('PDF only'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── GET /api/sessions/:id/intake ──────────────────────────────────────────────

router.get('/sessions/:id/intake', (req, res) => {
  try {
    const sessionId = req.params.id;
    const session = db.prepare('SELECT id, client_id, session_number FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return fail(res, 404, 'Session not found.');

    const intake = db.prepare('SELECT * FROM session_intakes WHERE session_id = ?').get(sessionId);

    if (intake) {
      // Parse JSON fields
      try { intake.medical_conditions  = JSON.parse(intake.medical_conditions  || '{}'); } catch { intake.medical_conditions = {}; }
      try { intake.medications         = JSON.parse(intake.medications         || '[]'); } catch { intake.medications = []; }
      try { intake.eating_patterns     = JSON.parse(intake.eating_patterns     || '{}'); } catch { intake.eating_patterns = {}; }
      try { intake.nutrition_anamnesis = JSON.parse(intake.nutrition_anamnesis || 'null'); } catch { intake.nutrition_anamnesis = null; }
      return ok(res, intake);
    }

    // For session 1: check if the client has pending intake data from lead conversion
    if (session.session_number === 1) {
      const client = db.prepare('SELECT pending_intake_data FROM clients WHERE id = ?').get(session.client_id);
      if (client?.pending_intake_data) {
        try {
          const pending = JSON.parse(client.pending_intake_data);
          return ok(res, { ...pending, _pending: true });
        } catch {
          // Corrupted pending data — ignore
        }
      }
    }

    return ok(res, null);
  } catch (err) {
    console.error('[GET /sessions/:id/intake]', err);
    return fail(res, 500, 'Failed to fetch intake.');
  }
});

// ── POST /api/sessions/:id/intake ─────────────────────────────────────────────

router.post('/sessions/:id/intake', (req, res) => {
  try {
    const sessionId = req.params.id;
    const session = db.prepare('SELECT id, client_id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return fail(res, 404, 'Session not found.');

    const existing = db.prepare('SELECT id FROM session_intakes WHERE session_id = ?').get(sessionId);
    if (existing) return fail(res, 409, 'Intake already exists. Use PUT to update.');

    const data = buildIntakeData(req.body);

    const result = db.prepare(`
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
    `).run({ session_id: sessionId, client_id: session.client_id, ...data });

    // Clear pending intake data from the client once session 1 intake is saved
    try {
      db.prepare('UPDATE clients SET pending_intake_data = NULL WHERE id = ?').run(session.client_id);
    } catch { /* best-effort */ }

    const intake = db.prepare('SELECT * FROM session_intakes WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, intake);
  } catch (err) {
    console.error('[POST /sessions/:id/intake]', err);
    return fail(res, 500, 'Failed to create intake.');
  }
});

// ── PUT /api/sessions/:id/intake ──────────────────────────────────────────────

router.put('/sessions/:id/intake', (req, res) => {
  try {
    const sessionId = req.params.id;
    const intake = db.prepare('SELECT id FROM session_intakes WHERE session_id = ?').get(sessionId);
    if (!intake) return fail(res, 404, 'Intake not found. Use POST to create.');

    const data = buildIntakeData(req.body);

    db.prepare(`
      UPDATE session_intakes SET
        age = @age, gender = @gender, weight = @weight, goal = @goal,
        activity_factor = @activity_factor, bmr_mifflin = @bmr_mifflin,
        bmr_harris = @bmr_harris, bmr_average = @bmr_average,
        adjusted_weight = @adjusted_weight, tdee = @tdee,
        height = @height, marital_status = @marital_status, num_children = @num_children,
        occupation = @occupation, work_hours = @work_hours, work_type = @work_type,
        eating_at_work = @eating_at_work, medical_conditions = @medical_conditions,
        medications = @medications, prev_treatment = @prev_treatment,
        prev_treatment_goal = @prev_treatment_goal, prev_success = @prev_success,
        prev_challenges = @prev_challenges, reason_for_treatment = @reason_for_treatment,
        diet_type = @diet_type, eating_patterns = @eating_patterns,
        water_intake = @water_intake, coffee_per_day = @coffee_per_day,
        alcohol_per_week = @alcohol_per_week, sleep_hours = @sleep_hours,
        sleep_quality = @sleep_quality, physical_activity = @physical_activity,
        activity_type = @activity_type, activity_frequency = @activity_frequency,
        favorite_snacks = @favorite_snacks, favorite_foods = @favorite_foods,
        nutrition_anamnesis = @nutrition_anamnesis,
        updated_at = CURRENT_TIMESTAMP
      WHERE session_id = @session_id
    `).run({ session_id: sessionId, ...data });

    const updated = db.prepare('SELECT * FROM session_intakes WHERE session_id = ?').get(sessionId);
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /sessions/:id/intake]', err);
    return fail(res, 500, 'Failed to update intake.');
  }
});

// ── POST /api/sessions/:id/intake/lab-pdf ─────────────────────────────────────

router.post('/sessions/:id/intake/lab-pdf', upload.single('pdf'), (req, res) => {
  try {
    const sessionId = req.params.id;
    const session = db.prepare('SELECT id, client_id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return fail(res, 404, 'Session not found.');

    if (!req.file) return fail(res, 400, 'No PDF file uploaded.');

    // Rename to a deterministic filename
    const filename = `${session.client_id}_${sessionId}.pdf`;
    const dest     = path.join(LABS_DIR, filename);
    fs.renameSync(req.file.path, dest);

    // Update lab_results_pdf_path in session_intakes (create row if needed)
    const existing = db.prepare('SELECT id FROM session_intakes WHERE session_id = ?').get(sessionId);
    if (existing) {
      db.prepare('UPDATE session_intakes SET lab_results_pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?')
        .run(filename, sessionId);
    } else {
      db.prepare('INSERT INTO session_intakes (session_id, client_id, lab_results_pdf_path) VALUES (?, ?, ?)')
        .run(sessionId, session.client_id, filename);
    }

    return ok(res, { path: filename });
  } catch (err) {
    console.error('[POST /sessions/:id/intake/lab-pdf]', err);
    // Clean up temp file if rename failed
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
    return fail(res, 500, 'Failed to upload PDF.');
  }
});

// ── GET /api/leads/:id/intake ─────────────────────────────────────────────────

router.get('/leads/:id/intake', (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(leadId);
    if (!lead) return fail(res, 404, 'Lead not found.');

    const intake = db.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(leadId);

    if (intake) {
      try { intake.medical_conditions  = JSON.parse(intake.medical_conditions  || '{}'); } catch { intake.medical_conditions = {}; }
      try { intake.medications         = JSON.parse(intake.medications         || '[]'); } catch { intake.medications = []; }
      try { intake.eating_patterns     = JSON.parse(intake.eating_patterns     || '{}'); } catch { intake.eating_patterns = {}; }
      try { intake.nutrition_anamnesis = JSON.parse(intake.nutrition_anamnesis || 'null'); } catch { intake.nutrition_anamnesis = null; }
    }

    return ok(res, intake || null);
  } catch (err) {
    console.error('[GET /leads/:id/intake]', err);
    return fail(res, 500, 'Failed to fetch lead intake.');
  }
});

// ── POST /api/leads/:id/intake ────────────────────────────────────────────────

router.post('/leads/:id/intake', (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(leadId);
    if (!lead) return fail(res, 404, 'Lead not found.');

    const existing = db.prepare('SELECT id FROM lead_intakes WHERE lead_id = ?').get(leadId);
    if (existing) return fail(res, 409, 'Lead intake already exists. Use PUT to update.');

    const data = buildIntakeData(req.body);

    const result = db.prepare(`
      INSERT INTO lead_intakes
        (lead_id,
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
        (@lead_id,
         @age, @gender, @weight, @goal, @activity_factor,
         @bmr_mifflin, @bmr_harris, @bmr_average, @adjusted_weight, @tdee,
         @height, @marital_status, @num_children, @occupation,
         @work_hours, @work_type, @eating_at_work, @medical_conditions, @medications,
         @lab_results_pdf_path, @prev_treatment, @prev_treatment_goal, @prev_success,
         @prev_challenges, @reason_for_treatment, @diet_type, @eating_patterns,
         @water_intake, @coffee_per_day, @alcohol_per_week, @sleep_hours, @sleep_quality,
         @physical_activity, @activity_type, @activity_frequency, @favorite_snacks, @favorite_foods,
         @nutrition_anamnesis)
    `).run({ lead_id: leadId, ...data });

    const intake = db.prepare('SELECT * FROM lead_intakes WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, intake);
  } catch (err) {
    console.error('[POST /leads/:id/intake]', err);
    return fail(res, 500, 'Failed to create lead intake.');
  }
});

// ── PUT /api/leads/:id/intake ─────────────────────────────────────────────────

router.put('/leads/:id/intake', (req, res) => {
  try {
    const leadId = req.params.id;
    const intake = db.prepare('SELECT id FROM lead_intakes WHERE lead_id = ?').get(leadId);
    if (!intake) return fail(res, 404, 'Lead intake not found. Use POST to create.');

    const data = buildIntakeData(req.body);

    db.prepare(`
      UPDATE lead_intakes SET
        age = @age, gender = @gender, weight = @weight, goal = @goal,
        activity_factor = @activity_factor, bmr_mifflin = @bmr_mifflin,
        bmr_harris = @bmr_harris, bmr_average = @bmr_average,
        adjusted_weight = @adjusted_weight, tdee = @tdee,
        height = @height, marital_status = @marital_status, num_children = @num_children,
        occupation = @occupation, work_hours = @work_hours, work_type = @work_type,
        eating_at_work = @eating_at_work, medical_conditions = @medical_conditions,
        medications = @medications, prev_treatment = @prev_treatment,
        prev_treatment_goal = @prev_treatment_goal, prev_success = @prev_success,
        prev_challenges = @prev_challenges, reason_for_treatment = @reason_for_treatment,
        diet_type = @diet_type, eating_patterns = @eating_patterns,
        water_intake = @water_intake, coffee_per_day = @coffee_per_day,
        alcohol_per_week = @alcohol_per_week, sleep_hours = @sleep_hours,
        sleep_quality = @sleep_quality, physical_activity = @physical_activity,
        activity_type = @activity_type, activity_frequency = @activity_frequency,
        favorite_snacks = @favorite_snacks, favorite_foods = @favorite_foods,
        nutrition_anamnesis = @nutrition_anamnesis,
        updated_at = CURRENT_TIMESTAMP
      WHERE lead_id = @lead_id
    `).run({ lead_id: leadId, ...data });

    const updated = db.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(leadId);
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /leads/:id/intake]', err);
    return fail(res, 500, 'Failed to update lead intake.');
  }
});

// ── POST /api/leads/:id/intake/lab-pdf ───────────────────────────────────────

router.post('/leads/:id/intake/lab-pdf', upload.single('pdf'), (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(leadId);
    if (!lead) return fail(res, 404, 'Lead not found.');

    if (!req.file) return fail(res, 400, 'No PDF file uploaded.');

    const filename = `lead_${leadId}.pdf`;
    const dest     = path.join(LABS_DIR, filename);
    fs.renameSync(req.file.path, dest);

    const existing = db.prepare('SELECT id FROM lead_intakes WHERE lead_id = ?').get(leadId);
    if (existing) {
      db.prepare('UPDATE lead_intakes SET lab_results_pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE lead_id = ?')
        .run(filename, leadId);
    } else {
      db.prepare('INSERT INTO lead_intakes (lead_id, lab_results_pdf_path) VALUES (?, ?)').run(leadId, filename);
    }

    return ok(res, { path: filename });
  } catch (err) {
    console.error('[POST /leads/:id/intake/lab-pdf]', err);
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
    return fail(res, 500, 'Failed to upload PDF.');
  }
});

// ── Helper: normalise request body into DB-ready object ───────────────────────

function buildIntakeData(body) {
  return {
    age:                  body.age                  != null ? Number(body.age)             : null,
    gender:               body.gender               ?? null,
    weight:               body.weight               != null ? Number(body.weight)           : null,
    goal:                 body.goal                 ?? null,
    activity_factor:      body.activity_factor      != null ? Number(body.activity_factor)  : null,
    bmr_mifflin:          body.bmr_mifflin          != null ? Number(body.bmr_mifflin)      : null,
    bmr_harris:           body.bmr_harris           != null ? Number(body.bmr_harris)       : null,
    bmr_average:          body.bmr_average          != null ? Number(body.bmr_average)      : null,
    adjusted_weight:      body.adjusted_weight      != null ? Number(body.adjusted_weight)  : null,
    tdee:                 body.tdee                 != null ? Number(body.tdee)             : null,
    height:               body.height               ?? null,
    marital_status:       body.marital_status        ?? null,
    num_children:         body.num_children          ?? null,
    occupation:           body.occupation            ?? null,
    work_hours:           body.work_hours            ?? null,
    work_type:            body.work_type             ?? null,
    eating_at_work:       body.eating_at_work        ?? null,
    medical_conditions:   JSON.stringify(body.medical_conditions    || {}),
    medications:          JSON.stringify(body.medications           || []),
    lab_results_pdf_path: body.lab_results_pdf_path  ?? null,
    prev_treatment:       body.prev_treatment        ? 1 : 0,
    prev_treatment_goal:  body.prev_treatment_goal   ?? null,
    prev_success:         body.prev_success          ?? null,
    prev_challenges:      body.prev_challenges       ?? null,
    reason_for_treatment: body.reason_for_treatment  ?? null,
    diet_type:            body.diet_type             ?? null,
    eating_patterns:      JSON.stringify(body.eating_patterns       || {}),
    water_intake:         body.water_intake          ?? null,
    coffee_per_day:       body.coffee_per_day        ?? null,
    alcohol_per_week:     body.alcohol_per_week      ?? null,
    sleep_hours:          body.sleep_hours           ?? null,
    sleep_quality:        body.sleep_quality         ?? null,
    physical_activity:    body.physical_activity     ? 1 : 0,
    activity_type:        body.activity_type         ?? null,
    activity_frequency:   body.activity_frequency    ?? null,
    favorite_snacks:      body.favorite_snacks       ?? null,
    favorite_foods:       body.favorite_foods        ?? null,
    nutrition_anamnesis:  body.nutrition_anamnesis != null ? JSON.stringify(body.nutrition_anamnesis) : null,
  };
}

module.exports = router;
