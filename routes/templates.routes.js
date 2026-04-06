const express = require('express');
const db = require('../database/db');
const { renderTemplate, generateLink, activeMode } = require('../services/whatsapp.service');
const { formatDateHebrew } = require('../utils/dates');

const router = express.Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─── GET /api/templates ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const templates = db
      .prepare('SELECT * FROM whatsapp_templates ORDER BY is_custom ASC, id ASC')
      .all();
    return ok(res, templates);
  } catch (err) {
    console.error('[GET /templates]', err);
    return fail(res, 500, 'Failed to fetch templates.');
  }
});

// ─── PUT /api/templates/:id ───────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM whatsapp_templates WHERE id = ?').get(req.params.id);
    if (!template) return fail(res, 404, 'Template not found.');

    const fields = ['name', 'body_template', 'is_active'];
    const updates = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        updates[f] = req.body[f];
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 400, 'No updatable fields provided.');
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE whatsapp_templates SET ${setClauses} WHERE id = @id`).run({
      ...updates,
      id: req.params.id,
    });

    const updated = db.prepare('SELECT * FROM whatsapp_templates WHERE id = ?').get(req.params.id);
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /templates/:id]', err);
    return fail(res, 500, 'Failed to update template.');
  }
});

// ─── POST /api/templates ─────────────────────────────────────────────────────
// Create a new custom template.
// Body: { name, body_template, trigger_event? }

const VALID_TRIGGER_EVENTS = [
  'session_reminder',
  'welcome',
  'weekly_checkin',
  'menu_sent',
  'process_ending',
  'custom',
];

router.post('/', (req, res) => {
  try {
    const { name, body_template, trigger_event } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return fail(res, 400, 'name is required and must be a non-empty string.');
    }
    if (!body_template || typeof body_template !== 'string' || body_template.trim() === '') {
      return fail(res, 400, 'body_template is required and must be a non-empty string.');
    }

    const resolvedTrigger = trigger_event !== undefined ? trigger_event : 'custom';
    if (!VALID_TRIGGER_EVENTS.includes(resolvedTrigger)) {
      return fail(
        res,
        400,
        `trigger_event must be one of: ${VALID_TRIGGER_EVENTS.join(', ')}.`
      );
    }

    const result = db
      .prepare(
        'INSERT INTO whatsapp_templates (name, body_template, trigger_event, is_custom) VALUES (?, ?, ?, 1)'
      )
      .run(name.trim(), body_template.trim(), resolvedTrigger);

    const created = db
      .prepare('SELECT * FROM whatsapp_templates WHERE id = ?')
      .get(result.lastInsertRowid);

    return ok(res, created);
  } catch (err) {
    console.error('[POST /templates]', err);
    return fail(res, 500, 'Failed to create template.');
  }
});

// ─── DELETE /api/templates/:id ────────────────────────────────────────────────
// Delete a custom template only (is_custom = 1).

router.delete('/:id', (req, res) => {
  try {
    const template = db
      .prepare('SELECT * FROM whatsapp_templates WHERE id = ?')
      .get(req.params.id);
    if (!template) return fail(res, 404, 'Template not found.');

    if (template.is_custom === 0) {
      return fail(res, 403, 'Cannot delete a pre-built template.');
    }

    db.prepare('DELETE FROM whatsapp_templates WHERE id = ?').run(req.params.id);

    return ok(res, { id: Number(req.params.id) });
  } catch (err) {
    console.error('[DELETE /templates/:id]', err);
    return fail(res, 500, 'Failed to delete template.');
  }
});

// ─── POST /api/templates/render ───────────────────────────────────────────────
// Render a template with real client data and return the wa.me link.
// Body: { templateId, clientId, date?, time? }

router.post('/render', (req, res) => {
  try {
    const { templateId, clientId, date, time } = req.body;

    if (!templateId) return fail(res, 400, 'templateId is required.');
    if (!clientId) return fail(res, 400, 'clientId is required.');

    const template = db
      .prepare('SELECT * FROM whatsapp_templates WHERE id = ?')
      .get(templateId);
    if (!template) return fail(res, 404, 'Template not found.');

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) return fail(res, 404, 'Client not found.');

    const variables = {
      client_name: client.full_name,
      date: date ? formatDateHebrew(date) : '',
      time: time || '',
      phone: client.phone || '',
    };

    const rendered_text = renderTemplate(template.body_template, variables);
    const whatsapp_link = generateLink(client.phone, rendered_text);

    return ok(res, {
      rendered_text,
      whatsapp_link,
      whatsapp_mode: activeMode,
      template_name: template.name,
    });
  } catch (err) {
    console.error('[POST /templates/render]', err);
    return fail(res, 500, 'Failed to render template.');
  }
});

module.exports = router;
