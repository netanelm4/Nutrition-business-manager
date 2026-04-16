const express = require('express');
const db = require('../database/db');
const { parseJsonArray } = require('../utils/parseJson');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1500;

let _client = null;
function getAIClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function serializeProtocol(row) {
  if (!row) return null;
  return {
    ...row,
    highlights:    parseJsonArray(row.highlights),
    default_tasks: parseJsonArray(row.default_tasks),
  };
}

// ─── GET /api/protocols ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM protocols WHERE is_active = 1 ORDER BY is_custom ASC, id ASC')
      .all();
    return ok(res, rows.map(serializeProtocol));
  } catch (err) {
    console.error('[GET /protocols]', err);
    return fail(res, 500, 'Failed to fetch protocols.');
  }
});

// ─── GET /api/protocols/:id ───────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id);
    if (!row) return fail(res, 404, 'Protocol not found.');
    return ok(res, serializeProtocol(row));
  } catch (err) {
    console.error('[GET /protocols/:id]', err);
    return fail(res, 500, 'Failed to fetch protocol.');
  }
});

// ─── POST /api/protocols ──────────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const { name, description, highlights, default_tasks, is_active } = req.body;
    if (!name || !name.trim()) return fail(res, 400, 'name is required.');

    const result = db.prepare(`
      INSERT INTO protocols (name, description, highlights, default_tasks, is_custom, is_active)
      VALUES (@name, @description, @highlights, @default_tasks, 1, @is_active)
    `).run({
      name: name.trim(),
      description: description || null,
      highlights: Array.isArray(highlights) ? JSON.stringify(highlights) : JSON.stringify([]),
      default_tasks: Array.isArray(default_tasks) ? JSON.stringify(default_tasks) : JSON.stringify([]),
      is_active: is_active === false ? 0 : 1,
    });

    const created = db.prepare('SELECT * FROM protocols WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, serializeProtocol(created));
  } catch (err) {
    console.error('[POST /protocols]', err);
    return fail(res, 500, 'Failed to create protocol.');
  }
});

// ─── PUT /api/protocols/:id ───────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const protocol = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id);
    if (!protocol) return fail(res, 404, 'Protocol not found.');

    const allowed = ['name', 'description', 'highlights', 'default_tasks', 'is_active'];
    const updates = {};

    for (const f of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        const val = req.body[f];
        updates[f] = Array.isArray(val) ? JSON.stringify(val) : val;
      }
    }

    if (Object.keys(updates).length === 0) return fail(res, 400, 'No updatable fields provided.');

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE protocols SET ${setClauses} WHERE id = @id`).run({ ...updates, id: req.params.id });

    const updated = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id);
    return ok(res, serializeProtocol(updated));
  } catch (err) {
    console.error('[PUT /protocols/:id]', err);
    return fail(res, 500, 'Failed to update protocol.');
  }
});

// ─── DELETE /api/protocols/:id ────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const protocol = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id);
    if (!protocol) return fail(res, 404, 'Protocol not found.');
    if (protocol.is_custom === 0) return fail(res, 403, 'Cannot delete a seeded protocol.');
    db.prepare('DELETE FROM protocols WHERE id = ?').run(req.params.id);
    return ok(res, { id: Number(req.params.id) });
  } catch (err) {
    console.error('[DELETE /protocols/:id]', err);
    return fail(res, 500, 'Failed to delete protocol.');
  }
});

// ─── POST /api/protocols/:id/personalize ─────────────────────────────────────

router.post('/:id/personalize', async (req, res) => {
  try {
    const protocol = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id);
    if (!protocol) return fail(res, 404, 'Protocol not found.');

    const clientId = Number(req.body.clientId);
    if (!clientId || isNaN(clientId)) return fail(res, 400, 'clientId is required and must be a number.');

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) return fail(res, 404, 'Client not found.');

    const pastSessions = db
      .prepare('SELECT session_number, highlights, soap_notes FROM sessions WHERE client_id = ? ORDER BY session_number')
      .all(clientId);

    // Fetch session-1 intake if it exists
    const intake = db.prepare(`
      SELECT si.* FROM session_intakes si
      JOIN sessions s ON s.id = si.session_id
      WHERE s.client_id = ? AND s.session_number = 1
    `).get(clientId);

    const highlights = parseJsonArray(protocol.highlights);
    const tasks = parseJsonArray(protocol.default_tasks);

    const highlightsBullet = highlights.map((h) => `• ${h}`).join('\n');
    const tasksBullet = tasks.map((t) => `• ${t.text ?? t}`).join('\n');

    let sessionHistorySummary;
    if (pastSessions.length === 0) {
      sessionHistorySummary = 'פגישה ראשונה — אין היסטוריה';
    } else {
      sessionHistorySummary = pastSessions
        .map((s) => {
          const parts = [`פגישה ${s.session_number}`];
          if (s.highlights) parts.push(s.highlights.slice(0, 200));
          return parts.join(': ');
        })
        .join('\n');
    }

    // Build intake section string (only when intake data exists)
    let intakeSection = '';
    if (intake) {
      const medConds = (() => {
        try {
          const c = JSON.parse(intake.medical_conditions || '{}');
          const active = Object.entries(c).filter(([, v]) => v).map(([k]) => k);
          return active.length > 0 ? active.join(', ') : 'אין';
        } catch { return 'אין'; }
      })();
      const meds = (() => {
        try {
          const m = JSON.parse(intake.medications || '[]');
          return Array.isArray(m) && m.length > 0 ? m.join(', ') : 'אין';
        } catch { return 'אין'; }
      })();
      const bmi = (intake.weight && intake.height)
        ? (intake.weight / ((Number(intake.height) / 100) ** 2)).toFixed(1)
        : 'לא חושב';

      intakeSection = `
נתוני טופס היכרות:
גיל: ${intake.age ?? 'לא ידוע'} | מגדר: ${intake.gender ?? 'לא ידוע'}
גובה: ${intake.height ?? 'לא ידוע'} ס״מ | משקל: ${intake.weight ?? 'לא ידוע'} ק״ג
BMI: ${bmi} | משקל מתוקנן: ${intake.adjusted_weight ?? 'לא נדרש'}
הוצאה קלורית יומית: ${intake.tdee ?? 'לא חושב'} קק״ל
מקדם פעילות: ${intake.activity_factor ?? 'לא ידוע'}
מצבים רפואיים פעילים: ${medConds}
תרופות: ${meds}
סוג תזונה: ${intake.diet_type ?? 'לא צוין'}
פעילות גופנית: ${intake.activity_type ?? 'לא צוין'}, ${intake.activity_frequency ?? 'לא צוין'}
שינה: ${intake.sleep_hours ?? 'לא ידוע'} שעות, איכות: ${intake.sleep_quality ?? 'לא ידוע'}`;
    }

    const systemPrompt = `You are a clinical nutrition assistant helping a licensed nutritionist personalize a base protocol for a specific client.

Your role is to ADAPT — not replace — the existing protocol.
You may:
  - Add specific recommendations based on the client profile
  - Flag interactions or contraindications with medical notes
  - Adjust emphasis based on client goals and history
  - Add personalized tasks based on what is known about this client

You may NOT:
  - Invent or recommend interventions not supported by current scientific consensus
  - Reference anecdotal evidence or unverified sources
  - Make medical diagnoses or prescribe medications
  - Add recommendations that contradict established guidelines from:
      WHO (World Health Organization)
      AND (Academy of Nutrition and Dietetics)
      EASD (European Association for the Study of Diabetes)
      AHA (American Heart Association)
      Or peer-reviewed meta-analyses with broad scientific consensus

If a client's medical notes suggest a condition where you lack sufficient evidence-based guidance, state this explicitly and recommend consulting the relevant specialist.

If the intake form data includes BMI, weight, or other calculated metrics, do NOT suggest calculating them again as tasks — they are already known. Use them as context to give specific, personalized recommendations instead.

Always ground your additions in the client's specific data. Do not give generic advice that applies to everyone.

Respond ONLY in Hebrew.`;

    const userPrompt = `בסיס הפרוטוקול:
דגשים:
${highlightsBullet}
משימות:
${tasksBullet}

פרופיל הלקוח:
גיל: ${client.age || 'לא ידוע'} | מגדר: ${client.gender || 'לא ידוע'} | משקל התחלתי: ${client.initial_weight ? client.initial_weight + ' ק״ג' : 'לא ידוע'}
מטרה: ${client.goal || 'לא צוין'}
הערות רפואיות: ${client.medical_notes || 'אין'}
היסטוריית פגישות: ${sessionHistorySummary}
${intakeSection}
אנא התאם את הפרוטוקול לפרופיל זה.
החזר JSON בלבד במבנה הבא:
{
  "personalized_highlights": ["...", "..."],
  "personalized_tasks": ["...", "..."],
  "clinical_notes": "הערות קליניות חשובות אם יש"
}`;

    const message = await getAIClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0]?.text;
    if (!responseText) return fail(res, 500, 'תגובה ריקה מה-AI.');

    // Strip markdown fences if present
    const cleaned = responseText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return fail(res, 500, 'תגובת ה-AI אינה בפורמט תקין. נסה שוב.');
    }

    return ok(res, {
      personalized_highlights: Array.isArray(parsed.personalized_highlights) ? parsed.personalized_highlights : [],
      personalized_tasks: Array.isArray(parsed.personalized_tasks) ? parsed.personalized_tasks : [],
      clinical_notes: typeof parsed.clinical_notes === 'string' ? parsed.clinical_notes : '',
    });
  } catch (err) {
    console.error('[POST /protocols/:id/personalize]', err);
    return fail(res, 500, err.message || 'Failed to personalize protocol.');
  }
});

module.exports = router;
