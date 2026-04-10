const express = require('express');
const db = require('../database/db');

const router = express.Router();

// ─── In-memory rate limiter: 5 requests per IP per hour ───────────────────────

const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

// Clean up stale entries every hour to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// ─── POST /api/leads/public ───────────────────────────────────────────────────

router.post('/leads/public', (req, res) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({
      success: false,
      error: 'שלחת יותר מידי בקשות. נסה שוב מאוחר יותר.',
    });
  }

  const { full_name, phone, goal, notes } = req.body;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ success: false, error: 'שם מלא הוא שדה חובה.' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ success: false, error: 'טלפון הוא שדה חובה.' });
  }

  try {
    db.prepare(`
      INSERT INTO leads (full_name, phone, source, status, notes)
      VALUES (@full_name, @phone, @source, @status, @notes)
    `).run({
      full_name: full_name.trim(),
      phone: phone.trim(),
      source: 'landing_page',
      status: 'new',
      notes: goal
        ? `מטרה: ${goal}${notes?.trim() ? '\n' + notes.trim() : ''}`
        : notes?.trim() || null,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /leads/public]', err);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית. נסה שוב.' });
  }
});

module.exports = router;
