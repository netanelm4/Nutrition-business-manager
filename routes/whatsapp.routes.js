const express = require('express');
const db = require('../database/db');

const router = express.Router();

function ok(res, data) { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── POST /api/whatsapp/log ───────────────────────────────────────────────────

router.post('/log', (req, res) => {
  try {
    const { client_id, template_id, rendered_message } = req.body;
    if (!client_id) return fail(res, 400, 'client_id is required.');
    if (!rendered_message || !rendered_message.trim()) return fail(res, 400, 'rendered_message is required.');

    const result = db.prepare(`
      INSERT INTO whatsapp_log (client_id, template_id, rendered_message)
      VALUES (@client_id, @template_id, @rendered_message)
    `).run({
      client_id: Number(client_id),
      template_id: template_id ? Number(template_id) : null,
      rendered_message: rendered_message.trim(),
    });

    const entry = db.prepare('SELECT * FROM whatsapp_log WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, entry);
  } catch (err) {
    console.error('[POST /whatsapp/log]', err);
    return fail(res, 500, 'Failed to log message.');
  }
});

module.exports = router;
