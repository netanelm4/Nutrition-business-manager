/**
 * Simple single-user password middleware.
 * Expects: Authorization: Bearer <password>
 * The password is compared to AUTH_PASSWORD from the environment.
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization header missing or malformed.' });
  }

  const token = header.slice('Bearer '.length);

  if (token !== process.env.AUTH_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Invalid password.' });
  }

  next();
}

module.exports = { requireAuth };
