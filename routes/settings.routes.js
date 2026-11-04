const express = require('express');
const bcrypt  = require('bcrypt');
const db      = require('../database/db');

const router = express.Router();

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── GET /api/settings/users ───────────────────────────────────────────────────
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, is_active, created_at, last_login_at
      FROM users
      ORDER BY created_at ASC
    `).all();
    return ok(res, users);
  } catch (err) {
    console.error('[GET /settings/users]', err);
    return fail(res, 500, 'Failed to fetch users.');
  }
});

// ─── POST /api/settings/users ──────────────────────────────────────────────────
router.post('/users', (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name?.trim() || !password) {
      return fail(res, 400, 'Name and password are required.');
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (name, password_hash) VALUES (?, ?)').run(name.trim(), hash);
    const user = db.prepare(`
      SELECT id, name, is_active, created_at, last_login_at FROM users WHERE id = ?
    `).get(result.lastInsertRowid);

    return ok(res, user);
  } catch (err) {
    console.error('[POST /settings/users]', err);
    return fail(res, 500, 'Failed to create user.');
  }
});

// ─── PUT /api/settings/users/:id/toggle ────────────────────────────────────────
router.put('/users/:id/toggle', (req, res) => {
  try {
    const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(req.params.id);
    if (!user) return fail(res, 404, 'User not found.');

    const newStatus = user.is_active ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);

    const updated = db.prepare(`
      SELECT id, name, is_active, created_at, last_login_at FROM users WHERE id = ?
    `).get(req.params.id);
    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /settings/users/:id/toggle]', err);
    return fail(res, 500, 'Failed to toggle user status.');
  }
});

// ─── PUT /api/settings/users/:id/password ──────────────────────────────────────
router.put('/users/:id/password', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return fail(res, 400, 'Password is required.');

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return fail(res, 404, 'User not found.');

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);

    return ok(res, { id: user.id, passwordReset: true });
  } catch (err) {
    console.error('[PUT /settings/users/:id/password]', err);
    return fail(res, 500, 'Failed to reset password.');
  }
});

// ─── GET /api/settings/activity ────────────────────────────────────────────────
router.get('/activity', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, user_name, method, path, label, created_at
      FROM activity_log
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /settings/activity]', err);
    return fail(res, 500, 'Failed to fetch activity log.');
  }
});

module.exports = router;
