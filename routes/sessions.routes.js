const express = require('express');
const db = require('../database/db');
const { generateInsights } = require('../services/ai.service');
const { parseJsonArray } = require('../utils/parseJson');

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

module.exports = router;
