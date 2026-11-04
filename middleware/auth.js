const db = require('../database/db');

/**
 * Multi-user session middleware.
 * Expects: Authorization: Bearer <session-token>
 * The token must match an active session whose user is still active.
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization header missing or malformed.' });
  }

  const token = header.slice('Bearer '.length);

  const row = db.prepare(`
    SELECT u.id, u.name
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.is_active = 1
  `).get(token);

  if (!row) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session.' });
  }

  req.user = { id: row.id, name: row.name };
  next();
}

module.exports = { requireAuth };
