const express = require('express');
const db = require('../database/db');
const { LEAD_STATUS } = require('../constants/statuses');

const router = express.Router();

const TERMINAL_STATUSES = new Set([LEAD_STATUS.BECAME_CLIENT, LEAD_STATUS.NOT_RELEVANT]);
const FROZEN_DAYS = 5;

function computeFrozen(lead) {
  if (TERMINAL_STATUSES.has(lead.status)) return false;
  const lastUpdate = lead.status_updated_at || lead.created_at;
  if (!lastUpdate) return false;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - FROZEN_DAYS);
  return new Date(lastUpdate) < threshold;
}

function attachFrozen(lead) {
  return { ...lead, frozen: computeFrozen(lead) };
}

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─── GET /api/leads ───────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
    return ok(res, leads.map(attachFrozen));
  } catch (err) {
    console.error('[GET /leads]', err);
    return fail(res, 500, 'Failed to fetch leads.');
  }
});

// ─── POST /api/leads ──────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const { full_name, phone, source, status, notes, follow_up_date } = req.body;

    if (!full_name || !full_name.trim()) {
      return fail(res, 400, 'full_name is required.');
    }

    const result = db.prepare(`
      INSERT INTO leads (full_name, phone, source, status, notes, follow_up_date)
      VALUES (@full_name, @phone, @source, @status, @notes, @follow_up_date)
    `).run({
      full_name: full_name.trim(),
      phone: phone || null,
      source: source || null,
      status: status || LEAD_STATUS.NEW,
      notes: notes || null,
      follow_up_date: follow_up_date || null,
    });

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, lead);
  } catch (err) {
    console.error('[POST /leads]', err);
    return fail(res, 500, 'Failed to create lead.');
  }
});

// ─── GET /api/leads/:id ───────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');
    return ok(res, attachFrozen(lead));
  } catch (err) {
    console.error('[GET /leads/:id]', err);
    return fail(res, 500, 'Failed to fetch lead.');
  }
});

// ─── PUT /api/leads/:id ───────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    const fields = ['full_name', 'phone', 'source', 'status', 'notes', 'follow_up_date'];
    const updates = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        updates[f] = req.body[f];
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 400, 'No updatable fields provided.');
    }

    // Stamp status_updated_at whenever status changes
    if ('status' in updates && updates.status !== lead.status) {
      updates.status_updated_at = new Date().toISOString();
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE leads SET ${setClauses} WHERE id = @id`).run({ ...updates, id: req.params.id });

    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    return ok(res, attachFrozen(updated));
  } catch (err) {
    console.error('[PUT /leads/:id]', err);
    return fail(res, 500, 'Failed to update lead.');
  }
});

// ─── POST /api/leads/:id/convert ──────────────────────────────────────────────
// Returns pre-fill data for the new client form. Does NOT create the client.
// The UI submits the form to POST /api/clients to complete the conversion.

router.post('/:id/convert', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');

    if (lead.status === LEAD_STATUS.BECAME_CLIENT) {
      return fail(res, 409, 'This lead has already been converted to a client.');
    }

    // Mark lead as converted
    db.prepare('UPDATE leads SET status = ?, status_updated_at = ? WHERE id = ?').run(
      LEAD_STATUS.BECAME_CLIENT,
      new Date().toISOString(),
      req.params.id
    );

    // Return the pre-fill data — caller uses this to populate the client creation form
    return ok(res, {
      full_name: lead.full_name,
      phone: lead.phone || '',
      converted_from_lead_id: lead.id,
    });
  } catch (err) {
    console.error('[POST /leads/:id/convert]', err);
    return fail(res, 500, 'Failed to convert lead.');
  }
});

// ─── DELETE /api/leads/:id ────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return fail(res, 404, 'Lead not found.');
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    return ok(res, { id: Number(req.params.id) });
  } catch (err) {
    console.error('[DELETE /leads/:id]', err);
    return fail(res, 500, 'Failed to delete lead.');
  }
});

module.exports = router;
