const crypto = require('crypto');

// ─── Webhook signature verification ──────────────────────────────────────────
// Both verifiers need the exact raw request bytes — server.js captures them in
// express.json({ verify }) as req.rawBody.
//
// Enforcement policy: a verifier enforces only when its secret env var is set.
// When the secret is missing it logs a warning (once) and lets the request
// through, so deploying this code cannot silently break live integrations.
// Set the env vars in Railway to turn enforcement on.

const CALENDLY_TOLERANCE_SEC = 3 * 60;

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

// ── Calendly: Calendly-Webhook-Signature: t=<unix>,v1=<hex> over "<t>.<body>" ─
function verifyCalendlySignature(req, res, next) {
  const secret = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!secret) {
    warnOnce('calendly', '[webhook-signature] CALENDLY_WEBHOOK_SIGNING_KEY not set — Calendly webhook signature NOT enforced');
    return next();
  }

  const header = req.get('calendly-webhook-signature') || '';
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2)
  );
  const timestamp = Number(parts.t);
  const provided  = parts.v1;

  if (!timestamp || !provided) {
    console.warn(`[webhook-signature] Rejected Calendly webhook: missing signature from ip=${req.ip}`);
    return res.sendStatus(401);
  }
  if (Math.abs(Date.now() / 1000 - timestamp) > CALENDLY_TOLERANCE_SEC) {
    console.warn(`[webhook-signature] Rejected Calendly webhook: stale timestamp from ip=${req.ip}`);
    return res.sendStatus(401);
  }

  const body = (req.rawBody || Buffer.alloc(0)).toString('utf8');
  const expected = hmacHex(secret, `${parts.t}.${body}`);
  if (!safeEqualHex(provided, expected)) {
    console.warn(`[webhook-signature] Rejected Calendly webhook: bad signature from ip=${req.ip}`);
    return res.sendStatus(401);
  }
  return next();
}

module.exports = { verifyMetaSignature, verifyCalendlySignature };
