const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { processIncomingMessage } = require('../services/whatsapp-bot.service');
const { verifyMetaSignature } = require('../middleware/webhook-signature');

const router = express.Router();

// ─── GET /api/whatsapp/webhook — Meta verification challenge ──────────────────

router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[whatsapp-bot] webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ─── POST /api/whatsapp/webhook — incoming messages from Meta ─────────────────

router.post('/webhook', verifyMetaSignature, (req, res) => {
  // Acknowledge immediately — Meta requires fast 200
  res.sendStatus(200);

  try {
    const entry   = req.body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;
    if (message.type !== 'text') return;

    const from_phone   = message.from;
    const message_text = message.text?.body;
    if (!from_phone || !message_text) return;

    // Process async — do not await (Meta needs 200 before we finish)
    processIncomingMessage({
      from_phone,
      message_text,
      timestamp: new Date().toISOString(),
    }).catch((err) => console.error('[whatsapp-bot] processIncomingMessage error:', err.message));

  } catch (err) {
    console.error('[whatsapp-bot] webhook parse error:', err.message);
  }
});

// ─── POST /api/whatsapp/test ──────────────────────────────────────────────────
// Simulate an incoming WhatsApp message without a real connection.
// Body: { phone, message }

router.post('/test', requireAuth, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone and message are required' });
  }
  try {
    const result = await processIncomingMessage({
      from_phone:   phone,
      message_text: message,
      timestamp:    new Date().toISOString(),
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[POST /whatsapp/test]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
