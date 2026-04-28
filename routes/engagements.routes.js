const express = require('express');
const db = require('../database/db');

const router = express.Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ── GET /api/engagements/client/:clientId ─────────────────────────────────────

router.get('/client/:clientId', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.clientId);
    if (!client) return fail(res, 404, 'Client not found.');

    const engagements = db.prepare(`
      SELECT
        e.*,
        COUNT(DISTINCT s.id)            AS session_count,
        COALESCE(SUM(p.amount), 0)      AS total_paid
      FROM   engagements e
      LEFT JOIN sessions s ON s.engagement_id = e.id
      LEFT JOIN payments p ON p.engagement_id = e.id
      WHERE  e.client_id = ?
      GROUP  BY e.id
      ORDER  BY e.number DESC
    `).all(req.params.clientId);

    return ok(res, engagements);
  } catch (err) {
    console.error('[GET /engagements/client/:clientId]', err);
    return fail(res, 500, 'Failed to fetch engagements.');
  }
});

// ── POST /api/engagements/client/:clientId ────────────────────────────────────

router.post('/client/:clientId', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.clientId);
    if (!client) return fail(res, 404, 'Client not found.');

    const { goals, package_name, price, started_at } = req.body;

    const { next_number } = db.prepare(
      'SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM engagements WHERE client_id = ?'
    ).get(req.params.clientId);

    const result = db.prepare(`
      INSERT INTO engagements (client_id, number, status, goals, package_name, price, started_at)
      VALUES (@client_id, @number, 'active', @goals, @package_name, @price, @started_at)
    `).run({
      client_id:    Number(req.params.clientId),
      number:       next_number,
      goals:        goals        || null,
      package_name: package_name || null,
      price:        price != null ? Number(price) : null,
      started_at:   started_at   || null,
    });

    const engagement = db.prepare('SELECT * FROM engagements WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, engagement);
  } catch (err) {
    console.error('[POST /engagements/client/:clientId]', err);
    return fail(res, 500, 'Failed to create engagement.');
  }
});

// ── PUT /api/engagements/:id ──────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const engagement = db.prepare('SELECT id FROM engagements WHERE id = ?').get(req.params.id);
    if (!engagement) return fail(res, 404, 'Engagement not found.');

    const allowed = ['goals', 'package_name', 'price', 'status', 'ended_at'];
    const updates = {};
    for (const f of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        updates[f] = req.body[f] ?? null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 400, 'No updatable fields provided.');
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE engagements SET ${setClauses} WHERE id = @id`).run({ ...updates, id: req.params.id });

    const updated = db.prepare('SELECT * FROM engagements WHERE id = ?').get(req.params.id);
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /engagements/:id]', err);
    return fail(res, 500, 'Failed to update engagement.');
  }
});

// ── POST /api/engagements/:id/close ──────────────────────────────────────────

router.post('/:id/close', (req, res) => {
  try {
    const engagement = db.prepare('SELECT id FROM engagements WHERE id = ?').get(req.params.id);
    if (!engagement) return fail(res, 404, 'Engagement not found.');

    db.prepare(
      "UPDATE engagements SET status = 'completed', ended_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);

    const updated = db.prepare('SELECT * FROM engagements WHERE id = ?').get(req.params.id);
    return ok(res, updated);
  } catch (err) {
    console.error('[POST /engagements/:id/close]', err);
    return fail(res, 500, 'Failed to close engagement.');
  }
});

module.exports = router;
