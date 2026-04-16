const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const db         = require('../database/db');

const router = express.Router();

const AI_MODEL = 'claude-sonnet-4-20250514';

let _aiClient = null;
function getAIClient() {
  if (!_aiClient) _aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _aiClient;
}

const ASSESSMENT_SYSTEM_PROMPT = `You are a clinical nutrition assistant helping a licensed nutritionist prepare for a first session with a new client.

Based on the intake form data provided, generate an initial clinical assessment that includes:

1. קליני-תזונתי ראשוני: A brief clinical nutrition profile based on the data (BMI category, energy needs, key nutritional considerations)

2. נקודות לתשומת לב: Red flags or important points from medical history, eating patterns, or lifestyle that require attention

3. כיוון טיפולי ראשוני: Suggested initial direction for the nutrition treatment plan based on the client's goal, medical history, and lifestyle

Base ALL recommendations on current scientific consensus from WHO, AND, AHA, EASD and peer-reviewed research.
Do not make medical diagnoses.
Respond in Hebrew only.
Be concise — maximum 3-4 bullet points per section.`;

function buildAssessmentUserPrompt(intake) {
  const medConds = (() => {
    try {
      const c = typeof intake.medical_conditions === 'string'
        ? JSON.parse(intake.medical_conditions)
        : (intake.medical_conditions || {});
      const active = Object.entries(c).filter(([, v]) => v).map(([k]) => k);
      return active.length > 0 ? active.join(', ') : 'אין';
    } catch { return 'אין'; }
  })();

  const meds = (() => {
    try {
      const m = typeof intake.medications === 'string'
        ? JSON.parse(intake.medications)
        : (intake.medications || []);
      return Array.isArray(m) && m.length > 0 ? m.join(', ') : 'אין';
    } catch { return 'אין'; }
  })();

  const bmi = (intake.weight && intake.height)
    ? (intake.weight / ((Number(intake.height) / 100) ** 2)).toFixed(1)
    : 'לא חושב';

  return `פרטי הלקוח:
גיל: ${intake.age ?? 'לא ידוע'} | מגדר: ${intake.gender ?? 'לא ידוע'} | גובה: ${intake.height ?? 'לא ידוע'} ס״מ | משקל: ${intake.weight ?? 'לא ידוע'} ק״ג | BMI: ${bmi} | משקל מתוקנן: ${intake.adjusted_weight ?? 'לא נדרש'}
הוצאה קלורית יומית: ${intake.tdee ?? 'לא חושב'} קק״ל
מטרה: ${intake.goal ?? 'לא צוין'}
מצבים רפואיים: ${medConds}
תרופות: ${meds}
סוג תזונה: ${intake.diet_type ?? 'לא צוין'}
פעילות גופנית: ${intake.physical_activity ? `${intake.activity_type ?? ''} ${intake.activity_frequency ?? ''}`.trim() : 'לא פעיל'}
שינה: ${intake.sleep_hours ?? 'לא ידוע'} שעות, איכות: ${intake.sleep_quality ?? 'לא ידוע'}

צור הערכה ראשונית קלינית.`;
}

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── POST /api/admin/repair-ai-assessments ────────────────────────────────────
// Retroactively generates AI assessments for:
//   1. Session-1 intakes where sessions.ai_insights has no initial_assessment entry
//   2. Lead intakes where lead_intakes.ai_assessment is NULL

router.post('/repair-ai-assessments', async (req, res) => {
  try {
    // ── 1. Session-1 intakes needing assessment ────────────────────────────
    const sessionRows = db.prepare(`
      SELECT s.id AS session_id, si.*
      FROM sessions s
      JOIN session_intakes si ON si.session_id = s.id
      WHERE s.session_number = 1
    `).all();

    const sessionsNeedingRepair = sessionRows.filter((row) => {
      try {
        const insights = JSON.parse(row.ai_insights || '[]');
        return !Array.isArray(insights) || !insights.some((i) => i.type === 'initial_assessment');
      } catch {
        return true;
      }
    // ai_insights is on the sessions table, not on si — need to fetch it separately
    // Actually we need to join it properly below
    });

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

    // ── 2. Lead intakes needing assessment ────────────────────────────────
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
        const text = await getAIClient().messages.create({
          model: AI_MODEL,
          max_tokens: 1200,
          system: ASSESSMENT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildAssessmentUserPrompt(row) }],
        }).then((m) => m.content[0]?.text ?? '');

        if (!text) continue;

        // Merge with existing insights if any
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
        const text = await getAIClient().messages.create({
          model: AI_MODEL,
          max_tokens: 1200,
          system: ASSESSMENT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildAssessmentUserPrompt(row) }],
        }).then((m) => m.content[0]?.text ?? '');

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
