const express = require('express');
const db = require('../database/db');

const router = express.Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─── PUT /api/session-windows/:id ─────────────────────────────────────────────
// Manually override a session window's expected date.

router.put('/:id', (req, res) => {
  try {
    const window = db.prepare('SELECT * FROM session_windows WHERE id = ?').get(req.params.id);
    if (!window) return fail(res, 404, 'Session window not found.');

    const { expected_date, override_note } = req.body;
    if (!expected_date) return fail(res, 400, 'expected_date is required.');

    db.prepare(`
      UPDATE session_windows
      SET expected_date = @expected_date,
          manually_overridden = 1,
          override_note = @override_note
      WHERE id = @id
    `).run({
      expected_date,
      override_note: override_note || null,
      id: req.params.id,
    });

    const updated = db.prepare('SELECT * FROM session_windows WHERE id = ?').get(req.params.id);
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /session-windows/:id]', err);
    return fail(res, 500, 'Failed to update session window.');
  }
});

module.exports = router;
