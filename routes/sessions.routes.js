const express   = require('express');
const db         = require('../database/db');
const { sessionInsights, checkinMessage } = require('../services/ai/generators');
const { parseJsonArray } = require('../utils/parseJson');
const { SESSION_STATUS } = require('../constants/statuses');
const { todayISO, israelDateOf } = require('../utils/dates');
const { isValidSessionStatus, autoMarkHeldSessions } = require('../services/session-lifecycle.service');
const { publish } = require('../services/event-bus.service');


const { filesForSessions, removeFiles } = require('../services/recordings.service');
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

    const allowedFields = ['session_date', 'weight', 'highlights', 'ai_insights', 'ai_flags', 'tasks', 'soap_notes', 'status'];
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
    if ('status' in updates && !isValidSessionStatus(updates.status)) {
      return fail(res, 400, 'status must be one of: scheduled, held, no_show, canceled.');
    }
    if (updates.session_date) updates.session_date = israelDateOf(updates.session_date);

    // Writing clinical notes / weight on a booked session whose day has come
    // is the confirmation that it took place → held.
    const effectiveDate = updates.session_date || session.session_date;
    const recordsContent = (updates.highlights && String(updates.highlights).trim())
      || (updates.weight !== undefined && updates.weight !== null && updates.weight !== '');
    if (!('status' in updates) && session.status === SESSION_STATUS.SCHEDULED
        && recordsContent && effectiveDate && effectiveDate <= todayISO()) {
      updates.status = SESSION_STATUS.HELD;
    }

    // A held session happened — its date cannot be in the future
    const finalStatus = updates.status || session.status;
    if (finalStatus === SESSION_STATUS.HELD && effectiveDate && effectiveDate > todayISO()) {
      return fail(res, 400, 'תאריך של פגישה שהתקיימה לא יכול להיות עתידי.');
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

// ─── POST /api/sessions/lifecycle/run — run the auto-held job now ────────────

router.post('/lifecycle/run', (req, res) => {
  try {
    return ok(res, autoMarkHeldSessions(db));
  } catch (err) {
    console.error('[POST /sessions/lifecycle/run]', err);
    return fail(res, 500, 'Failed to run session lifecycle.');
  }
});

// ─── PUT /api/sessions/:id/status — held / no_show / canceled / scheduled ────

router.put('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!isValidSessionStatus(status)) {
      return fail(res, 400, 'status must be one of: scheduled, held, no_show, canceled.');
    }
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, req.params.id);
    publish(db, 'session.status_changed', { entityType: 'session', entityId: session.id, payload: { from: session.status, to: status, clientId: session.client_id } });
    return ok(res, serializeSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)));
  } catch (err) {
    console.error('[PUT /sessions/:id/status]', err);
    return fail(res, 500, 'Failed to update session status.');
  }
});

// ─── PUT /api/sessions/:id/complete ──────────────────────────────────────────

router.put('/:id/complete', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');

    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(SESSION_STATUS.HELD, req.params.id);

    try {
      const parts = [`פגישה ${session.session_number}`];
      if (session.weight)     parts.push(`משקל: ${session.weight} ק"ג`);
      if (session.highlights) parts.push(`דגשים: ${session.highlights}`);
      db.prepare(
        "INSERT INTO ai_memory (client_id, memory_type, content, source_type, source_id) VALUES (?, 'progress', ?, 'session', ?)"
      ).run(session.client_id, parts.join(' | '), session.id);
    } catch {}

    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    return ok(res, serializeSession(updated));
  } catch (err) {
    console.error('[PUT /sessions/:id/complete]', err);
    return fail(res, 500, 'Failed to complete session.');
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
    const { insights, flags } = await sessionInsights(client, previousSessions, session.highlights, soapNotes);

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

    const text = await checkinMessage(client, session);
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
    const recordingFiles = filesForSessions(db, [session.id]); // rows cascade with the session
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    removeFiles(recordingFiles);
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[DELETE /sessions/:id]', err);
    return fail(res, 500, 'Failed to delete session.');
  }
});

module.exports = router;
