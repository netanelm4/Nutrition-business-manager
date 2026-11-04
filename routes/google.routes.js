const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getAuthUrl,
  exchangeCode,
  isConnected,
  syncGoogleCalendar,
  resetSyncState,
} = require('../services/google-calendar.service');
const db = require('../database/db');

const router = express.Router();

// ── GET /api/google/auth-url (auth required) ──────────────────────────────────

router.get('/auth-url', requireAuth, (req, res) => {
  try {
    const url = getAuthUrl();
    return res.json({ success: true, data: { url } });
  } catch (err) {
    console.error('[GET /google/auth-url]', err);
    return res.status(500).json({ success: false, error: 'Failed to generate auth URL.' });
  }
});

// ── GET /api/google/callback (NO auth — Google redirects here) ────────────────

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.error('[google/callback] Error or missing code:', error);
    return res.redirect('/meetings?google=error');
  }

  try {
    await exchangeCode(code);
    return res.redirect('/meetings?google=connected');
  } catch (err) {
    console.error('[google/callback] exchangeCode failed:', err.message);
    return res.redirect('/meetings?google=error');
  }
});

// ── GET /api/google/status (auth required) ────────────────────────────────────

router.get('/status', requireAuth, (req, res) => {
  try {
    return res.json({ success: true, data: { connected: isConnected() } });
  } catch (err) {
    console.error('[GET /google/status]', err);
    return res.status(500).json({ success: false, error: 'Failed to get status.' });
  }
});

// ── DELETE /api/google/disconnect (auth required) ─────────────────────────────

router.delete('/disconnect', requireAuth, (req, res) => {
  try {
    db.prepare(
      'UPDATE settings SET google_refresh_token = NULL, google_connected = 0 WHERE id = 1'
    ).run();
    resetSyncState(); // a reconnected account starts with a fresh full sync
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /google/disconnect]', err);
    return res.status(500).json({ success: false, error: 'Failed to disconnect.' });
  }
});

// ── POST /api/google/sync — run an incremental sync now (auth required) ───────
// Kept: /poll-now (older clients). Both return the sync stats.

async function runSyncNow(req, res) {
  try {
    const stats = await syncGoogleCalendar();
    if (stats.error) return res.status(502).json({ success: false, error: stats.error });
    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[POST /google/sync]', err);
    return res.status(500).json({ success: false, error: 'Sync failed.' });
  }
}

router.post('/sync', requireAuth, runSyncNow);
router.post('/poll-now', requireAuth, runSyncNow);

module.exports = router;
