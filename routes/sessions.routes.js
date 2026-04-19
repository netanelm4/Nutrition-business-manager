const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const db         = require('../database/db');
const { generateInsights } = require('../services/ai.service');
const { parseJsonArray } = require('../utils/parseJson');

const AI_MODEL = 'claude-sonnet-4-20250514';
let _aiClient = null;
function getAIClient() {
  if (!_aiClient) _aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _aiClient;
}

const router = express.Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function parseSoapNotes(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function serializeSession(row) {
  if (!row) return null;
  return {
    ...row,
    ai_insights: parseJsonArray(row.ai_insights),
    ai_flags: parseJsonArray(row.ai_flags),
    tasks: parseJsonArray(row.tasks),
    soap_notes: parseSoapNotes(row.soap_notes),
  };
}

// ─── GET /api/sessions/:id ────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');
    return ok(res, serializeSession(session));
  } catch (err) {
    console.error('[GET /sessions/:id]', err);
    return fail(res, 500, 'Failed to fetch session.');
  }
});

// ─── PUT /api/sessions/:id ────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');

    const allowedFields = ['session_date', 'weight', 'highlights', 'ai_insights', 'ai_flags', 'tasks', 'soap_notes'];
    const updates = {};

    for (const f of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        // Arrays/objects must be stored as JSON strings
        const val = req.body[f];
        updates[f] = Array.isArray(val) || (val !== null && typeof val === 'object')
          ? JSON.stringify(val)
          : val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 400, 'No updatable fields provided.');
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE sessions SET ${setClauses} WHERE id = @id`).run({ ...updates, id: req.params.id });

    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    return ok(res, serializeSession(updated));
  } catch (err) {
    console.error('[PUT /sessions/:id]', err);
    return fail(res, 500, 'Failed to update session.');
  }
});

// ─── POST /api/sessions/:id/insights ─────────────────────────────────────────

router.post('/:id/insights', async (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');

    if (!session.highlights || !session.highlights.trim()) {
      return fail(res, 400, 'Session must have highlights before generating insights.');
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(session.client_id);
    if (!client) return fail(res, 404, 'Client not found.');

    // All previous sessions (exclude the current one)
    const previousSessions = db
      .prepare('SELECT * FROM sessions WHERE client_id = ? AND id != ? ORDER BY session_number')
      .all(session.client_id, session.id)
      .map(serializeSession);

    const soapNotes = parseSoapNotes(session.soap_notes);
    const { insights, flags } = await generateInsights(client, previousSessions, session.highlights, soapNotes);

    // Persist generated insights back to the session
    db.prepare('UPDATE sessions SET ai_insights = @ai_insights, ai_flags = @ai_flags WHERE id = @id').run({
      ai_insights: JSON.stringify(insights),
      ai_flags: JSON.stringify(flags),
      id: session.id,
    });

    return ok(res, { insights, flags });
  } catch (err) {
    console.error('[POST /sessions/:id/insights]', err);
    return fail(res, 500, err.message || 'Failed to generate insights.');
  }
});

// ─── POST /api/sessions/:id/checkin-message ───────────────────────────────────

router.post('/:id/checkin-message', async (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(session.client_id);
    if (!client) return fail(res, 404, 'Client not found.');

    const highlights = session.highlights || '';
    const soapNotes  = parseSoapNotes(session.soap_notes);
    const sessionSummary = [
      highlights ? `דגשים: ${highlights}` : null,
      soapNotes?.plan    ? `תוכנית: ${soapNotes.plan.trim()}`   : null,
      soapNotes?.assessment ? `הערכה: ${soapNotes.assessment.trim()}` : null,
    ].filter(Boolean).join('\n') || 'פגישה בלי תיעוד מפורט';

    const message = await getAIClient().messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      system: `אתה תזונאי קליני שכותב הודעת צ'ק-אין חמה ללקוח בסיום פגישה.
כתוב הודעת ווטסאפ קצרה (3-5 משפטים) בגוף שני, בסגנון אישי, חם ומקצועי.
אל תזכיר המלצות תזונתיות ספציפיות — רק חיזוק ועידוד.
כתוב בעברית בלבד, ללא כוכביות או סמלים מיוחדים.`,
      messages: [{
        role: 'user',
        content: `פרטי הלקוח: ${client.full_name}, פגישה ${session.session_number}.\n${sessionSummary}\nכתוב הודעת צ'ק-אין.`,
      }],
    });

    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) return fail(res, 500, 'לא התקבלה תגובה מה-AI.');

    db.prepare('UPDATE sessions SET checkin_message = ? WHERE id = ?').run(text, session.id);

    return ok(res, { message: text });
  } catch (err) {
    console.error('[POST /sessions/:id/checkin-message]', err);
    return fail(res, 500, 'שגיאה ביצירת הודעת צ\'ק-אין.');
  }
});

// ─── GET /api/sessions/:id/checkin-message ────────────────────────────────────

router.get('/:id/checkin-message', (req, res) => {
  try {
    const row = db.prepare('SELECT checkin_message FROM sessions WHERE id = ?').get(req.params.id);
    if (!row) return fail(res, 404, 'Session not found.');
    return ok(res, { message: row.checkin_message || null });
  } catch (err) {
    console.error('[GET /sessions/:id/checkin-message]', err);
    return fail(res, 500, 'שגיאה בטעינת הודעת צ\'ק-אין.');
  }
});

// ─── DELETE /api/sessions/:id ─────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[DELETE /sessions/:id]', err);
    return fail(res, 500, 'Failed to delete session.');
  }
});

module.exports = router;
