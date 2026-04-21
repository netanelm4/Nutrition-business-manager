// TEMPORARY ROUTES — NO AUTH — REMOVE AFTER USE
// These exist only to diagnose and repair orphaned leads in production.
// To remove: delete this file and the two lines in server.js that reference it.

const express = require('express');
const db      = require('../database/db');
const { calculateSessionWindows } = require('../utils/dates');

const router = express.Router();

// ─── GET /api/admin/diagnose-leads ────────────────────────────────────────────
router.get('/diagnose-leads', (req, res) => {
  try {
    const stuck_leads = db.prepare(`
      SELECT id, full_name, status, created_at
      FROM leads
      WHERE status = 'became_client'
    `).all();

    const all_clients = db.prepare(`
      SELECT id, full_name, status, converted_from_lead_id, start_date
      FROM clients
      ORDER BY created_at DESC
    `).all();

    const orphaned_leads = db.prepare(`
      SELECT l.id, l.full_name, l.status
      FROM leads l
      WHERE l.status = 'became_client'
        AND NOT EXISTS (
          SELECT 1 FROM clients c WHERE c.converted_from_lead_id = l.id
        )
    `).all();

    console.log('[diagnose-leads] stuck_leads:', stuck_leads.length,
                '| all_clients:', all_clients.length,
                '| orphaned_leads:', orphaned_leads.length);

    return res.json({ success: true, data: { stuck_leads, all_clients, orphaned_leads } });
  } catch (err) {
    console.error('[GET /admin/diagnose-leads]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/admin/repair-now ────────────────────────────────────────────────
router.get('/repair-now', (req, res) => {
  try {
    const orphaned = db.prepare(`
      SELECT l.id, l.full_name, l.phone, l.created_at,
             li.age, li.gender, li.weight, li.goal, li.activity_factor,
             li.bmr_mifflin, li.bmr_harris, li.bmr_average, li.adjusted_weight, li.tdee,
             li.height, li.marital_status, li.num_children, li.occupation,
             li.work_hours, li.work_type, li.eating_at_work, li.medical_conditions,
             li.medications, li.lab_results_pdf_path, li.prev_treatment,
             li.prev_treatment_goal, li.prev_success, li.prev_challenges,
             li.reason_for_treatment, li.diet_type, li.eating_patterns, li.water_intake,
             li.coffee_per_day, li.alcohol_per_week, li.sleep_hours, li.sleep_quality,
             li.physical_activity, li.activity_type, li.activity_frequency,
             li.favorite_snacks, li.favorite_foods, li.nutrition_anamnesis
      FROM leads l
      LEFT JOIN lead_intakes li ON li.lead_id = l.id
      WHERE l.status = 'became_client'
        AND NOT EXISTS (
          SELECT 1 FROM clients c WHERE c.converted_from_lead_id = l.id
        )
    `).all();

    console.log(`[repair-now] Found ${orphaned.length} orphaned lead(s)`);

    if (orphaned.length === 0) {
      return res.json({ success: true, data: { repaired: 0, details: [] } });
    }

    const details = [];

    for (const lead of orphaned) {
      try {
        const meeting = db.prepare(`
          SELECT * FROM calendly_events
          WHERE lead_id = ? AND status = 'active'
          ORDER BY start_time ASC LIMIT 1
        `).get(lead.id);

        const sessionDate = meeting
          ? meeting.start_time.slice(0, 10)
          : (lead.created_at ? lead.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));

        const doRepair = db.transaction(() => {
          // a) Create client row
          const clientRes = db.prepare(`
            INSERT INTO clients
              (full_name, phone, age, gender, initial_weight, status,
               converted_from_lead_id, start_date)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `).run(
            lead.full_name, lead.phone || '',
            lead.age || null, lead.gender || null, lead.weight || null,
            lead.id, sessionDate
          );
          const clientId = clientRes.lastInsertRowid;
          console.log(`[repair-now] ✓ Client id=${clientId} for lead ${lead.id} "${lead.full_name}"`);

          // b) Create session 1
          const sessionRes = db.prepare(`
            INSERT INTO sessions (client_id, session_number, session_date, highlights, tasks)
            VALUES (?, 1, ?, '', '[]')
          `).run(clientId, sessionDate);
          const sessionId = sessionRes.lastInsertRowid;
          console.log(`[repair-now] ✓ Session id=${sessionId}`);

          // c) Link calendly_event
          if (meeting) {
            db.prepare('UPDATE calendly_events SET client_id = ? WHERE id = ?')
              .run(clientId, meeting.id);
            console.log(`[repair-now] ✓ Linked calendly_event ${meeting.id} to client ${clientId}`);
          }

          // d) Create 6 session windows
          const windows = calculateSessionWindows(sessionDate);
          db.prepare('DELETE FROM session_windows WHERE client_id = ?').run(clientId);
          const insertWin = db.prepare(
            'INSERT INTO session_windows (client_id, session_number, expected_date) VALUES (?, ?, ?)'
          );
          for (const w of windows) insertWin.run(clientId, w.session_number, w.expected_date);
          console.log(`[repair-now] ✓ Created ${windows.length} windows for client ${clientId}`);

          // e) Copy intake data if available
          const hasIntake = lead.age || lead.gender || lead.weight || lead.medical_conditions;
          if (hasIntake) {
            db.prepare(`
              INSERT INTO session_intakes
                (session_id, client_id, age, gender, weight, goal, activity_factor,
                 bmr_mifflin, bmr_harris, bmr_average, adjusted_weight, tdee,
                 height, marital_status, num_children, occupation,
                 work_hours, work_type, eating_at_work, medical_conditions, medications,
                 lab_results_pdf_path, prev_treatment, prev_treatment_goal, prev_success,
                 prev_challenges, reason_for_treatment, diet_type, eating_patterns,
                 water_intake, coffee_per_day, alcohol_per_week, sleep_hours, sleep_quality,
                 physical_activity, activity_type, activity_frequency, favorite_snacks,
                 favorite_foods, nutrition_anamnesis)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              sessionId, clientId,
              lead.age, lead.gender, lead.weight, lead.goal, lead.activity_factor,
              lead.bmr_mifflin, lead.bmr_harris, lead.bmr_average, lead.adjusted_weight, lead.tdee,
              lead.height, lead.marital_status, lead.num_children, lead.occupation,
              lead.work_hours, lead.work_type, lead.eating_at_work,
              lead.medical_conditions, lead.medications, lead.lab_results_pdf_path,
              lead.prev_treatment, lead.prev_treatment_goal, lead.prev_success, lead.prev_challenges,
              lead.reason_for_treatment, lead.diet_type, lead.eating_patterns, lead.water_intake,
              lead.coffee_per_day, lead.alcohol_per_week, lead.sleep_hours, lead.sleep_quality,
              lead.physical_activity, lead.activity_type, lead.activity_frequency,
              lead.favorite_snacks, lead.favorite_foods, lead.nutrition_anamnesis || null
            );
            console.log(`[repair-now] ✓ Intake copied for client ${clientId}`);
          } else {
            console.log(`[repair-now] ℹ No intake data for lead ${lead.id}`);
          }

          return { clientId, sessionId };
        });

        const result = doRepair();
        details.push({
          lead_id:      lead.id,
          lead_name:    lead.full_name,
          client_id:    result.clientId,
          session_id:   result.sessionId,
          session_date: sessionDate,
          had_meeting:  !!meeting,
          had_intake:   !!(lead.age || lead.gender || lead.weight || lead.medical_conditions),
        });
      } catch (err) {
        console.error(`[repair-now] Failed for lead ${lead.id}:`, err.message);
        details.push({ lead_id: lead.id, lead_name: lead.full_name, error: err.message });
      }
    }

    const repaired = details.filter((d) => !d.error).length;
    console.log(`[repair-now] Done. Repaired ${repaired}/${orphaned.length}`);
    return res.json({ success: true, data: { repaired, details } });
  } catch (err) {
    console.error('[GET /admin/repair-now]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
