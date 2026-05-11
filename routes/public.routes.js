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

// ─── Weight entry helpers (duplicated to keep this file self-contained) ───────

function getDayOfWeekPublic(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  if (day === 1) return 'monday';
  if (day === 4) return 'thursday';
  return null;
}

function getMondayOfWeekPublic(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function groupWeightRows(rows) {
  const weekMap = {};
  for (const row of rows) {
    const ws = getMondayOfWeekPublic(row.weigh_date);
    if (!weekMap[ws]) weekMap[ws] = { week_start: ws, monday_weight: null, monday_id: null, thursday_weight: null, thursday_id: null };
    if (row.day_of_week === 'monday')   { weekMap[ws].monday_weight = row.weight;   weekMap[ws].monday_id = row.id; }
    if (row.day_of_week === 'thursday') { weekMap[ws].thursday_weight = row.weight; weekMap[ws].thursday_id = row.id; }
  }
  return Object.values(weekMap)
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .map((w) => {
      const both = w.monday_weight !== null && w.thursday_weight !== null;
      const one  = w.monday_weight !== null || w.thursday_weight !== null;
      const avg  = both ? Math.round(((w.monday_weight + w.thursday_weight) / 2) * 10) / 10
                        : one ? (w.monday_weight ?? w.thursday_weight) : null;
      return { ...w, average: avg, average_approximate: !both && one };
    });
}

function buildWeightStats(clientId) {
  const rows = db.prepare(
    'SELECT id, weigh_date, weight, day_of_week FROM weight_logs WHERE client_id = ? ORDER BY weigh_date ASC'
  ).all(clientId);

  const allWeights  = rows.map((r) => r.weight);
  const firstWeight = allWeights.length > 0 ? allWeights[0] : null;
  const latestWeight = allWeights.length > 0 ? allWeights[allWeights.length - 1] : null;
  const totalChange  = firstWeight !== null && latestWeight !== null
    ? Math.round((latestWeight - firstWeight) * 10) / 10
    : null;

  // Newest-first for the 4-week view
  const rowsDesc = [...rows].reverse();
  const recent_weeks = groupWeightRows(rowsDesc).slice(0, 4);

  return { first_weight: firstWeight, latest_weight: latestWeight, total_change: totalChange, recent_weeks };
}

// ─── Ensure weight schema exists (in case migration didn't run on this volume) ─

function ensureWeightSchema() {
  try { db.exec('ALTER TABLE clients ADD COLUMN weight_token TEXT UNIQUE'); } catch {}
  try { db.exec('CREATE TABLE IF NOT EXISTS weight_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id), weigh_date TEXT NOT NULL, weight REAL NOT NULL, day_of_week TEXT CHECK (day_of_week IN (\'monday\',\'thursday\')), notes TEXT, created_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(client_id, weigh_date))'); } catch {}
  try { db.exec("UPDATE clients SET weight_token = hex(randomblob(8)) WHERE weight_token IS NULL"); } catch {}
}

// ─── GET /api/public/weight/:token ───────────────────────────────────────────

router.get('/public/weight/:token', (req, res) => {
  try {
    ensureWeightSchema();
    const client = db.prepare('SELECT id, full_name FROM clients WHERE weight_token = ?').get(req.params.token);
    if (!client) return res.status(404).json({ success: false, error: 'קישור לא תקין' });

    const stats = buildWeightStats(client.id);
    return res.json({ success: true, data: { client_name: client.full_name, ...stats } });
  } catch (err) {
    console.error('[GET /public/weight/:token]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── POST /api/public/weight/:token ──────────────────────────────────────────

router.post('/public/weight/:token', (req, res) => {
  try {
    ensureWeightSchema();
    const client = db.prepare('SELECT id FROM clients WHERE weight_token = ?').get(req.params.token);
    if (!client) return res.status(404).json({ success: false, error: 'קישור לא תקין' });

    const { date, weight } = req.body;
    if (!date || weight === undefined || weight === null) {
      return res.status(400).json({ success: false, error: 'date ו-weight הם שדות חובה' });
    }

    const w = Number(weight);
    if (isNaN(w) || w < 20 || w > 300) {
      return res.status(400).json({ success: false, error: 'משקל לא תקין — יש להזין ערך בין 20 ל-300 ק"ג' });
    }

    const dayOfWeek = getDayOfWeekPublic(date);
    if (!dayOfWeek) {
      return res.status(400).json({ success: false, error: 'ניתן להוסיף שקילה רק בימי שני וחמישי' });
    }

    db.prepare(`
      INSERT INTO weight_logs (client_id, weigh_date, weight, day_of_week)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(client_id, weigh_date) DO UPDATE SET weight = excluded.weight
    `).run(client.id, date, w, dayOfWeek);

    const stats = buildWeightStats(client.id);
    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[POST /public/weight/:token]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── TEMP DEBUG: GET /api/public/debug/weight-schema (no auth) ───────────────

router.get('/public/debug/weight-schema', (req, res) => {
  const result = {};

  try {
    result.clients_sql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='clients'"
    ).get();
  } catch (err) {
    result.clients_sql_error = err.message;
  }

  try {
    result.clients_sample = db.prepare('SELECT id, full_name FROM clients LIMIT 3').all();
  } catch (err) {
    result.clients_sample_error = err.message;
  }

  try {
    result.weight_token_sample = db.prepare('SELECT weight_token FROM clients LIMIT 1').get();
  } catch (err) {
    result.weight_token_error = err.message;
  }

  return res.json(result);
});

module.exports = router;
