const express = require('express');
const crypto = require('crypto');
const db = require('../database/db');
const kapso = require('../services/kapso.service');
const { handleInbound } = require('../services/admin-whatsapp.service');
const { sendBrief, BUILDERS } = require('../services/admin-briefs.service');

// ─── Admin WhatsApp channel (Kapso) ─────────────────────────────────────────
// Public (mounted BEFORE requireAuth):
//   POST /api/integrations/whatsapp/webhook   Kapso events, HMAC-verified
// Authenticated (mounted after requireAuth):
//   GET  /api/integrations/whatsapp/status
//   GET  /api/integrations/whatsapp/messages
//   POST /api/integrations/whatsapp/briefs/:kind/run    kind: daily | weigh_in

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

/** X-Webhook-Signature = hex HMAC-SHA256(raw body, KAPSO_WEBHOOK_SECRET). Fails closed. */
function verifyKapsoSignature(req) {
  const secret = kapso.config().webhookSecret;
  const given = String(req.get('x-webhook-signature') || '');
  if (!secret || !given || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(given.replace(/^sha256=/, ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Message events from an unbuffered or buffered (batch) delivery. */
function messageEvents(body) {
  const items = body?.batch === true && Array.isArray(body.data) ? body.data : [body];
  return items.filter((e) => e && e.message);
}

/** Text of a text message, or of a quick-reply button (template "פירוט" button). */
function messageText(m) {
  if (m.type === 'text') return m.text?.body || '';
  if (m.type === 'button') return m.button?.text || m.button?.payload || '';
  if (m.type === 'interactive') return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
  return '';
}

const publicRouter = express.Router();

publicRouter.post('/webhook', (req, res) => {
  if (!verifyKapsoSignature(req)) {
    console.warn('[admin-whatsapp] rejected webhook: bad or missing signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // Kapso needs a 200 within 10s; work continues below

  try {
    const event = req.get('x-webhook-event') || req.body?.type || '';
    if (event && event !== 'whatsapp.message.received') return;
    const ourNumber = kapso.config().phoneNumberId;
    for (const e of messageEvents(req.body)) {
      const numberId = e.phone_number_id || e.conversation?.phone_number_id;
      if (ourNumber && numberId && String(numberId) !== String(ourNumber)) continue; // another number of the project
      const m = e.message;
      const from = m.from || e.conversation?.phone_number || '';
      handleInbound(db, { providerId: m.id || req.get('x-idempotency-key') || null, from, text: messageText(m) })
        .catch((err) => console.error('[admin-whatsapp] inbound error:', err.message));
    }
  } catch (err) {
    console.error('[admin-whatsapp] webhook parse error:', err.message);
  }
});

const router = express.Router();

router.get('/status', (req, res) => {
  try {
    const c = kapso.config();
    return ok(res, {
      configured: kapso.isConfigured(),
      mock: kapso.isMock(),
      has_api_key: !!c.apiKey,
      has_phone_number_id: !!c.phoneNumberId,
      has_webhook_secret: !!c.webhookSecret,
      has_admin_phone: !!c.adminPhone,
      template: c.template,
      window_open: kapso.windowOpen(db),
    });
  } catch (err) {
    console.error('[GET /integrations/whatsapp/status]', err);
    return fail(res, 500, 'Failed to read status.');
  }
});

router.get('/messages', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    return ok(res, db.prepare('SELECT * FROM admin_whatsapp_messages ORDER BY id DESC LIMIT ?').all(limit)
      .map((m) => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })));
  } catch (err) {
    console.error('[GET /integrations/whatsapp/messages]', err);
    return fail(res, 500, 'Failed to read messages.');
  }
});

router.post('/briefs/:kind/run', async (req, res) => {
  try {
    if (!BUILDERS[req.params.kind]) return fail(res, 404, 'Unknown brief (daily | weigh_in).');
    return ok(res, await sendBrief(db, req.params.kind));
  } catch (err) {
    console.error('[POST /integrations/whatsapp/briefs/:kind/run]', err);
    return fail(res, 500, 'Failed to send the brief.');
  }
});

module.exports = { publicRouter, router, verifyKapsoSignature, messageEvents, messageText };
