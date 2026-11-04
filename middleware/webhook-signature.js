const crypto = require('crypto');

// ─── Webhook signature verification ──────────────────────────────────────────
// The verifier needs the exact raw request bytes — server.js captures them in
// express.json({ verify }) as req.rawBody.
//
// Enforcement policy: enforced only when the secret env var is set.
// When the secret is missing it logs a warning (once) and lets the request
// through, so deploying this code cannot silently break live integrations.
// Set WHATSAPP_APP_SECRET in Railway to turn enforcement on.

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// ── Meta / WhatsApp Cloud API: X-Hub-Signature-256: sha256=<hex> ─────────────
function verifyMetaSignature(req, res, next) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    warnOnce('meta', '[webhook-signature] WHATSAPP_APP_SECRET not set — WhatsApp webhook signature NOT enforced');
    return next();
  }

  const header = req.get('x-hub-signature-256') || '';
  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : '';
  const expected = hmacHex(secret, req.rawBody || Buffer.alloc(0));

  if (!safeEqualHex(provided, expected)) {
    console.warn(`[webhook-signature] Rejected WhatsApp webhook: bad signature from ip=${req.ip}`);
    return res.sendStatus(401);
  }
  return next();
}

module.exports = { verifyMetaSignature };
