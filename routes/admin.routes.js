const express   = require('express');
const db         = require('../database/db');

const router = express.Router();

const { assessIntake } = require('../services/ai/generators');
function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── POST /api/admin/repair-ai-assessments ────────────────────────────────────
// Retroactively generates AI assessments for:
//   1. Session-1 intakes where sessions.ai_insights has no initial_assessment entry
//   2. Lead intakes where lead_intakes.ai_assessment is NULL

router.post('/repair-ai-assessments', async (req, res) => {
  try {
    // Re-query with ai_insights from sessions
    const sessionRowsWithInsights = db.prepare(`
      SELECT s.id AS session_id, s.ai_insights, si.*
      FROM sessions s
      JOIN session_intakes si ON si.session_id = s.id
      WHERE s.session_number = 1
    `).all();

    const sessionsToRepair = sessionRowsWithInsights.filter((row) => {
      try {
        const insights = JSON.parse(row.ai_insights || '[]');
        return !Array.isArray(insights) || !insights.some((i) => i.type === 'initial_assessment');
      } catch {
        return true;
      }
    });

    // ── Lead intakes needing assessment ────────────────────────────────
    const leadsToRepair = db.prepare(`
      SELECT li.*, l.id AS lead_id
      FROM lead_intakes li
      JOIN leads l ON l.id = li.lead_id
      WHERE li.ai_assessment IS NULL OR li.ai_assessment = ''
    `).all();

    if (sessionsToRepair.length === 0 && leadsToRepair.length === 0) {
      return ok(res, { repaired: 0, message: 'אין הערכות חסרות' });
    }

    let repaired = 0;

    // Process sessions sequentially to avoid rate limits
    for (const row of sessionsToRepair) {
      try {
        const text = await assessIntake(row);

        if (!text) continue;

        let existing = [];
        try { existing = JSON.parse(row.ai_insights || '[]'); } catch {}
        if (!Array.isArray(existing)) existing = [];

        const updated = JSON.stringify([
          ...existing.filter((i) => i.type !== 'initial_assessment'),
          { text, saved_for_next: false, type: 'initial_assessment' },
        ]);

        db.prepare('UPDATE sessions SET ai_insights = ? WHERE id = ?').run(updated, row.session_id);
        repaired++;
      } catch (err) {
        console.error(`[repair-ai] session ${row.session_id}:`, err.message);
      }
    }

    // Process leads sequentially
    for (const row of leadsToRepair) {
      try {
        const text = await assessIntake(row);

        if (!text) continue;

        db.prepare('UPDATE lead_intakes SET ai_assessment = ? WHERE lead_id = ?').run(text, row.lead_id);
        repaired++;
      } catch (err) {
        console.error(`[repair-ai] lead ${row.lead_id}:`, err.message);
      }
    }

    return ok(res, { repaired });
  } catch (err) {
    console.error('[POST /admin/repair-ai-assessments]', err);
    return fail(res, 500, 'שגיאה בתיקון הערכות AI.');
  }
});

module.exports = router;
