const express = require('express');
const db      = require('../database/db');

const router = express.Router();

const STOP_REASON_LABEL = {
  goal_achieved:  'השיג את המטרה',
  cant_continue:  'לא יכול/רוצה להמשיך',
  not_suitable:   'לא מתאים לו התהליך',
  frozen:         'הקפאת תהליך',
  other:          'אחר',
};

// ─── GET /api/stats/stop-reasons ──────────────────────────────────────────────

router.get('/stop-reasons', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT stop_reason, COUNT(*) AS count
      FROM   clients
      WHERE  stop_reason IS NOT NULL
      GROUP  BY stop_reason
      ORDER  BY count DESC
    `).all();

    const total = rows.reduce((s, r) => s + r.count, 0);
    const data  = rows.map((r) => ({
      reason:      r.stop_reason,
      label:       STOP_REASON_LABEL[r.stop_reason] || r.stop_reason,
      count:       r.count,
      percentage:  total > 0 ? Math.round((r.count / total) * 100) : 0,
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /stats/stop-reasons]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

module.exports = router;
