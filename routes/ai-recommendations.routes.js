const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { runAnalysis } = require('../services/ai-intelligence.service');

// GET /api/ai-recommendations — list active (non-dismissed) recommendations
router.get('/', (req, res) => {
  try {
    const recs = db.prepare(`
      SELECT r.*, c.full_name AS client_name, c.phone AS client_phone
      FROM ai_recommendations r
      JOIN clients c ON c.id = r.client_id
      WHERE r.is_dismissed = 0
        AND (r.expires_at IS NULL OR r.expires_at > datetime('now'))
      ORDER BY
        CASE r.priority WHEN 'urgent' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        r.created_at DESC
    `).all();
    res.json({ success: true, data: recs });
  } catch (err) {
    console.error('[ai-recommendations] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-recommendations/:id/dismiss
router.post('/:id/dismiss', (req, res) => {
  try {
    const result = db.prepare(
      'UPDATE ai_recommendations SET is_dismissed = 1 WHERE id = ?'
    ).run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-recommendations] POST /:id/dismiss error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-recommendations/:id/sent
router.post('/:id/sent', (req, res) => {
  try {
    const result = db.prepare(
      'UPDATE ai_recommendations SET is_sent = 1 WHERE id = ?'
    ).run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-recommendations] POST /:id/sent error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-recommendations/run — manual trigger for analysis
router.post('/run', async (req, res) => {
  try {
    runAnalysis().catch(e => console.error('[ai-recommendations] manual run error:', e.message));
    res.json({ success: true, message: 'Analysis started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
