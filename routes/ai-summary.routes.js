const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../database/db');

const router   = express.Router();
const AI_MODEL = 'claude-sonnet-4-20250514';
const LABS_DIR = path.join(__dirname, '..', 'data', 'labs');

let _aiClient = null;
function getAIClient() {
  if (!_aiClient) _aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _aiClient;
}

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

const SUMMARY_SYSTEM_PROMPT = `אתה עוזר קליני לתזונאי מוסמך.
בהתבסס על כלל הנתונים שסופקו על הלקוח — פרופיל, אנמנזה, תוצאות מעבדה, היסטוריית פגישות, תשלומים ופרוטוקול — הפק סיכום קליני מקיף ועדכני.

החזר JSON בלבד, ללא טקסט נוסף לפני או אחרי, בפורמט הבא:
{
  "clinical_summary": "סיכום קליני קצר — פרופיל תזונתי, BMI, TDEE, מצבים רפואיים ותרופות עיקריות",
  "focus_points": "נקודות מיקוד לפגישה הבאה — מה חשוב לבדוק ולחזק, עד 4 נקודות",
  "flags": "דגלים לתשומת לב — חסמים, תבניות חוזרות, דגלים קליניים, עד 3 נקודות",
  "recommendations": "המלצות טיפוליות — כיוון טיפול, שינויים מוצעים, עד 4 נקודות",
  "tasks": [
    { "text": "משימה קלינית מוצעת", "priority": "high" }
  ]
}

כללים:
- tasks: עד 5 משימות, priority יכול להיות "high", "medium" או "low"
- כתוב בעברית בלבד
- אל תבצע אבחנה רפואית
- בסס על WHO, AND, AHA, EASD ומחקר עדכני`;

function buildClientSummaryPrompt(client, intake, sessions, payments, protocol) {
  const lines = [];

  // ── Client profile ──────────────────────────────────────────────────────────
  lines.push('## פרופיל לקוח');
  lines.push(`שם: ${client.full_name}`);
  if (client.phone)           lines.push(`טלפון: ${client.phone}`);
  if (client.age)             lines.push(`גיל: ${client.age}`);
  if (client.gender)          lines.push(`מגדר: ${client.gender === 'male' ? 'זכר' : client.gender === 'female' ? 'נקבה' : client.gender}`);
  if (client.goal)            lines.push(`מטרה: ${client.goal}`);
  if (client.initial_weight)  lines.push(`משקל התחלתי: ${client.initial_weight} ק"ג`);
  if (client.medical_notes)   lines.push(`הערות רפואיות: ${client.medical_notes}`);
  if (client.status)          lines.push(`סטטוס: ${client.status}`);
  if (client.start_date)      lines.push(`תאריך תחילת טיפול: ${client.start_date}`);

  // ── Protocol ────────────────────────────────────────────────────────────────
  if (protocol) {
    lines.push('');
    lines.push('## פרוטוקול');
    lines.push(`שם: ${protocol.name}`);
    if (protocol.description) lines.push(`תיאור: ${protocol.description}`);
  }

  // ── Payments ─────────────────────────────────────────────────────────────────
  if (payments && payments.length > 0) {
    lines.push('');
    lines.push('## תשלומים');
    const total = payments.reduce((s, p) => s + (p.amount || 0), 0);
    lines.push(`סה"כ שולם: ${total.toFixed(0)} ₪`);
    if (client.package_price) lines.push(`מחיר חבילה: ${client.package_price} ₪`);
    if (client.payment_status) lines.push(`סטטוס תשלום: ${client.payment_status}`);
  }

  // ── Intake ───────────────────────────────────────────────────────────────────
  if (intake) {
    lines.push('');
    lines.push('## אנמנזה ראשונית');
    if (intake.age)             lines.push(`גיל: ${intake.age}`);
    if (intake.gender)          lines.push(`מגדר: ${intake.gender}`);
    if (intake.height)          lines.push(`גובה: ${intake.height} ס"מ`);
    if (intake.weight)          lines.push(`משקל: ${intake.weight} ק"ג`);
    if (intake.weight && intake.height) {
      const bmi = (intake.weight / ((Number(intake.height) / 100) ** 2)).toFixed(1);
      lines.push(`BMI: ${bmi}`);
    }
    if (intake.adjusted_weight) lines.push(`משקל מתוקנן: ${intake.adjusted_weight} ק"ג`);
    if (intake.tdee)            lines.push(`TDEE: ${Math.round(intake.tdee)} קק"ל`);
    if (intake.goal)            lines.push(`מטרה: ${intake.goal}`);

    // Medical conditions
    try {
      const conds = typeof intake.medical_conditions === 'string'
        ? JSON.parse(intake.medical_conditions)
        : (intake.medical_conditions || {});
      const active = Object.entries(conds).filter(([, v]) => v).map(([k]) => k);
      lines.push(`מצבים רפואיים: ${active.length > 0 ? active.join(', ') : 'אין'}`);
    } catch { lines.push('מצבים רפואיים: לא ידוע'); }

    // Medications
    try {
      const meds = typeof intake.medications === 'string'
        ? JSON.parse(intake.medications)
        : (intake.medications || []);
      lines.push(`תרופות: ${Array.isArray(meds) && meds.length > 0 ? meds.join(', ') : 'אין'}`);
    } catch { lines.push('תרופות: לא ידוע'); }

    if (intake.diet_type)          lines.push(`סוג תזונה: ${intake.diet_type}`);
    if (intake.physical_activity)  lines.push(`פעילות גופנית: ${intake.activity_type || ''} ${intake.activity_frequency || ''}`.trim());
    if (intake.sleep_hours)        lines.push(`שינה: ${intake.sleep_hours} שעות, איכות: ${intake.sleep_quality || 'לא ידוע'}`);
    if (intake.water_intake)       lines.push(`שתיית מים: ${intake.water_intake}`);
    if (intake.reason_for_treatment) lines.push(`סיבת הפנייה: ${intake.reason_for_treatment}`);
    if (intake.prev_treatment)     lines.push(`טיפול תזונתי קודם: כן${intake.prev_treatment_goal ? ` — ${intake.prev_treatment_goal}` : ''}`);
  }

  // ── Session history ──────────────────────────────────────────────────────────
  if (sessions && sessions.length > 0) {
    lines.push('');
    lines.push('## היסטוריית פגישות');
    lines.push(`סה"כ פגישות: ${sessions.length}`);
    for (const s of sessions) {
      lines.push(`\n### פגישה ${s.session_number} (${s.session_date || 'תאריך לא ידוע'})`);
      if (s.highlights) lines.push(`דגשים: ${s.highlights}`);

      // Parse tasks
      try {
        const tasks = typeof s.tasks === 'string' ? JSON.parse(s.tasks) : (s.tasks || []);
        if (Array.isArray(tasks) && tasks.length > 0) {
          const taskLines = tasks.map((t) => `  - [${t.status || 'open'}] ${t.text}`).join('\n');
          lines.push(`משימות:\n${taskLines}`);
        }
      } catch {}

      // Parse SOAP if present
      if (s.soap_notes) {
        try {
          const soap = typeof s.soap_notes === 'string' ? JSON.parse(s.soap_notes) : s.soap_notes;
          if (soap?.subjective) lines.push(`סובייקטיבי: ${soap.subjective}`);
          if (soap?.assessment) lines.push(`הערכה: ${soap.assessment}`);
          if (soap?.plan)       lines.push(`תוכנית: ${soap.plan}`);
        } catch {}
      }

      // Last AI insights from this session
      try {
        const insights = typeof s.ai_insights === 'string' ? JSON.parse(s.ai_insights) : (s.ai_insights || []);
        if (Array.isArray(insights) && insights.length > 0) {
          const relevant = insights.filter((i) => i.type !== 'initial_assessment' && i.text);
          if (relevant.length > 0) {
            lines.push(`תובנות AI: ${relevant.map((i) => i.text).join(' | ')}`);
          }
        }
      } catch {}
    }
  }

  lines.push('\nהפק סיכום קליני מקיף ועדכני.');
  return lines.join('\n');
}

// ── POST /api/clients/:id/ai-summary ─────────────────────────────────────────

router.post('/clients/:id/ai-summary', async (req, res) => {
  try {
    const clientId = req.params.id;

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) return fail(res, 404, 'לקוח לא נמצא.');

    // Gather all data
    const sessions = db.prepare(
      'SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number ASC'
    ).all(clientId);

    // Get session-1 intake (the main intake)
    let intake = null;
    if (sessions.length > 0) {
      const s1 = sessions.find((s) => s.session_number === 1);
      if (s1) {
        intake = db.prepare('SELECT * FROM session_intakes WHERE session_id = ?').get(s1.id);
      }
    }

    const payments = db.prepare('SELECT * FROM payments WHERE client_id = ?').all(clientId);

    let protocol = null;
    if (client.protocol_id) {
      protocol = db.prepare('SELECT id, name, description FROM protocols WHERE id = ?').get(client.protocol_id);
    }

    // Build prompt messages — include lab PDF as document if available
    const userContent = [];

    if (intake?.lab_results_pdf_path) {
      const pdfPath = path.join(LABS_DIR, intake.lab_results_pdf_path);
      if (fs.existsSync(pdfPath)) {
        try {
          const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
          userContent.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            title: 'תוצאות מעבדה',
          });
        } catch (e) {
          console.warn('[ai-summary] Failed to read lab PDF:', e.message);
        }
      }
    }

    userContent.push({
      type: 'text',
      text: buildClientSummaryPrompt(client, intake, sessions, payments, protocol),
    });

    const message = await getAIClient().messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const rawText = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

    // Parse JSON response
    let parsed;
    try {
      const cleaned = rawText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[ai-summary] Failed to parse AI response:', rawText.slice(0, 300));
      return fail(res, 500, 'שגיאה בעיבוד תגובת ה-AI.');
    }

    const summary = {
      clinical_summary:  parsed.clinical_summary  || '',
      focus_points:      parsed.focus_points      || '',
      flags:             parsed.flags             || '',
      recommendations:   parsed.recommendations   || '',
    };
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const now   = new Date().toISOString();

    // Persist to DB
    db.prepare(`
      UPDATE clients
      SET ai_summary = ?, ai_summary_updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify({ summary, tasks }), now, clientId);

    return ok(res, { summary, tasks, updated_at: now });
  } catch (err) {
    console.error('[POST /clients/:id/ai-summary]', err);
    return fail(res, 500, 'שגיאה ביצירת סיכום AI.');
  }
});

// ── GET /api/clients/:id/ai-summary ──────────────────────────────────────────
// Returns the stored summary without re-generating it.

router.get('/clients/:id/ai-summary', (req, res) => {
  try {
    const clientId = req.params.id;
    const row = db.prepare('SELECT ai_summary, ai_summary_updated_at FROM clients WHERE id = ?').get(clientId);
    if (!row) return fail(res, 404, 'לקוח לא נמצא.');

    if (!row.ai_summary) return ok(res, null);

    try {
      const { summary, tasks } = JSON.parse(row.ai_summary);
      return ok(res, { summary, tasks, updated_at: row.ai_summary_updated_at });
    } catch {
      return ok(res, null);
    }
  } catch (err) {
    console.error('[GET /clients/:id/ai-summary]', err);
    return fail(res, 500, 'שגיאה בטעינת סיכום AI.');
  }
});

// ─── POST /api/clients/:id/process-summary ────────────────────────────────────

const PROCESS_SUMMARY_SYSTEM_PROMPT = `אתה תזונאי קליני מסכם תהליך טיפולי שהסתיים.
כתוב סיכום תהליך מקצועי, חם ומועיל, שמתאר את מסע הלקוח.

החזר JSON בלבד ללא טקסט נוסף:
{
  "headline": "כותרת קצרה לסיכום (שורה אחת)",
  "journey": "תיאור המסע הטיפולי — נקודת ההתחלה, מה עבר הלקוח, איפה הוא כיום",
  "achievements": "הישגים עיקריים — מה השתנה, מה הלקוח השיג",
  "recommendations": "המלצות להמשך — איך לשמר את ההישגים ומה לעשות בהמשך",
  "closing": "משפט סיום חם ומחזק"
}

כתוב בעברית בלבד. הישג = גם שינוי התנהגותי/קוגניטיבי, לא רק ירידה במשקל.`;

router.post('/clients/:id/process-summary', async (req, res) => {
  try {
    const clientId = req.params.id;
    const client   = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) return fail(res, 404, 'לקוח לא נמצא.');

    const sessions = db.prepare(
      'SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number ASC'
    ).all(clientId);

    const lines = [];
    lines.push(`שם: ${client.full_name}`);
    if (client.goal)           lines.push(`מטרה: ${client.goal}`);
    if (client.initial_weight) lines.push(`משקל התחלתי: ${client.initial_weight} ק"ג`);
    if (client.start_date)     lines.push(`תחילת טיפול: ${client.start_date}`);
    lines.push(`מספר פגישות: ${sessions.length}`);
    lines.push('');

    // Last weight from sessions
    const lastSession = sessions.at(-1);
    if (lastSession?.weight) lines.push(`משקל בפגישה אחרונה: ${lastSession.weight} ק"ג`);

    for (const s of sessions) {
      lines.push(`\nפגישה ${s.session_number} (${s.session_date || 'לא ידוע'})`);
      if (s.highlights) lines.push(`דגשים: ${s.highlights}`);
      try {
        const tasks = JSON.parse(s.tasks || '[]');
        const done = Array.isArray(tasks) ? tasks.filter((t) => t.status === 'done').map((t) => t.text) : [];
        if (done.length) lines.push(`משימות שהושלמו: ${done.join(', ')}`);
      } catch {}
    }

    const message = await getAIClient().messages.create({
      model: AI_MODEL,
      max_tokens: 1500,
      system: PROCESS_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lines.join('\n') + '\n\nכתוב סיכום תהליך.' }],
    });

    const rawText = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

    let parsed;
    try {
      const cleaned = rawText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[process-summary] Failed to parse AI response:', rawText.slice(0, 300));
      return fail(res, 500, 'שגיאה בעיבוד תגובת ה-AI.');
    }

    db.prepare('UPDATE clients SET process_summary = ? WHERE id = ?')
      .run(JSON.stringify(parsed), clientId);

    return ok(res, parsed);
  } catch (err) {
    console.error('[POST /clients/:id/process-summary]', err);
    return fail(res, 500, 'שגיאה ביצירת סיכום תהליך.');
  }
});

// ─── GET /api/clients/:id/process-summary ─────────────────────────────────────

router.get('/clients/:id/process-summary', (req, res) => {
  try {
    const row = db.prepare('SELECT process_summary FROM clients WHERE id = ?').get(req.params.id);
    if (!row) return fail(res, 404, 'לקוח לא נמצא.');
    if (!row.process_summary) return ok(res, null);
    try {
      return ok(res, JSON.parse(row.process_summary));
    } catch {
      return ok(res, null);
    }
  } catch (err) {
    console.error('[GET /clients/:id/process-summary]', err);
    return fail(res, 500, 'שגיאה בטעינת סיכום תהליך.');
  }
});

module.exports = router;
