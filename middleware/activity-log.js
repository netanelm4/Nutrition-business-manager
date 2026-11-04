const db = require('../database/db');

// Small curated map of human-readable Hebrew labels for the most meaningful
// mutating actions. Paths not listed here are still logged with method+path.
const LABELS = {
  'POST /clients':              'יצירת לקוח',
  'POST /clients/:id/stop':     'עצירת תהליך',
  'POST /clients/:id/payments': 'הוספת תשלום',
  'POST /whatsapp/send':        'שליחת WhatsApp',
};

function normalizePath(path) {
  return path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

function logActivity(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.user) {
    try {
      const label = LABELS[`${req.method} ${normalizePath(req.path)}`] || null;
      db.prepare(`
        INSERT INTO activity_log (user_id, user_name, method, path, label)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.user.id, req.user.name, req.method, req.path, label);
    } catch (err) {
      console.error('[activity-log] Failed to record activity:', err.message);
    }
  }
  next();
}

module.exports = { logActivity };
