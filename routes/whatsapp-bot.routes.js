const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { processIncomingMessage } = require('../services/whatsapp-bot.service');

const router = express.Router();

// ─── POST /api/whatsapp/webhook ───────────────────────────────────────────────
// Stub — will be wired to WhatsApp Business API when number is ready.
// Must remain public (no auth) since WhatsApp calls it without credentials.

router.post('/webhook', (req, res) => {
  res.sendStatus(200);
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
