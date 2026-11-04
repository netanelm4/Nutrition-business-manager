// ─── In-memory fixed-window rate limiter ─────────────────────────────────────
// Single-process deployment (Railway, one instance) → a Map is sufficient.
// Keyed by client IP + limiter name, so limits are independent per route group.
// Requires app.set('trust proxy', 1) so req.ip is the real client IP behind Railway's proxy.

const RATE_LIMIT_MESSAGE = 'יותר מדי בקשות. נסו שוב בעוד מספר דקות.';

function createRateLimiter({ name, windowMs, max }) {
  const hits = new Map(); // key → { count, resetAt }

  // Periodic cleanup so the Map does not grow without bound
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return function rateLimit(req, res, next) {
    const key = `${name}:${req.ip}`;
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      console.warn(`[rate-limit] ${name} blocked ip=${req.ip} (${entry.count}/${max})`);
      return res.status(429).json({ success: false, error: RATE_LIMIT_MESSAGE });
    }
    return next();
  };
}

const FIFTEEN_MIN = 15 * 60 * 1000;

// Public forms that create new rows (leads, food submissions, recipes)
const publicFormLimiter = createRateLimiter({ name: 'public-form', windowMs: FIFTEEN_MIN, max: 10 });

// Token-scoped client actions (weight entry, favorites)
const publicActionLimiter = createRateLimiter({ name: 'public-action', windowMs: FIFTEEN_MIN, max: 60 });

// Login brute-force protection
const loginLimiter = createRateLimiter({ name: 'login', windowMs: FIFTEEN_MIN, max: 10 });

module.exports = { createRateLimiter, publicFormLimiter, publicActionLimiter, loginLimiter };
