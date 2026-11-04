const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcrypt');
const db      = require('../database/db');
const { loginLimiter } = require('../middleware/rate-limit');

const router = express.Router();

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginLimiter, (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name?.trim() || !password) {
      return fail(res, 400, 'Name and password are required.');
    }

    const user = db.prepare('SELECT * FROM users WHERE name = ? AND is_active = 1').get(name.trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return fail(res, 401, 'שם או סיסמה שגויים.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO auth_sessions (user_id, token) VALUES (?, ?)').run(user.id, token);
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    return ok(res, { token, user: { id: user.id, name: user.name } });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    return fail(res, 500, 'Failed to log in.');
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  try {
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length);
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    }
    return ok(res, { loggedOut: true });
  } catch (err) {
    console.error('[POST /auth/logout]', err);
    return fail(res, 500, 'Failed to log out.');
  }
});

module.exports = router;
