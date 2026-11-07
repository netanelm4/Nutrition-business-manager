const express = require('express');
const db = require('../database/db');
const {
  listActions, countOpen, approveAction, dismissAction, snoozeAction,
} = require('../services/action-queue.service');
const { reconcileInbox } = require('../services/inbox-rules.service');
const { reconcileJobs, runDueJobs } = require('../services/jobs.service');
const { addHoursUtcISO, toUtcISO } = require('../utils/dates');

// ─── Inbox (action_queue) ─── mounted at /api/inbox, after requireAuth ──────

const router = express.Router();
const MAX_BATCH = 50;

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// GET /api/inbox — open items, most urgent / earliest first
router.get('/', (req, res) => {
  try {
    // auto_send: the server sends WhatsApp itself; otherwise the browser opens
    // wa.me synchronously on click (popup blockers reject async window.open)
    return ok(res, { items: listActions(db), open: countOpen(db) });
  } catch (err) {
    console.error('[GET /inbox]', err);
    return fail(res, 500, 'Failed to load inbox.');
  }
});

// POST /api/inbox/:id/approve — task → done; message → sent (API) or wa.me link
router.post('/:id/approve', async (req, res) => {
  try {
    return ok(res, await approveAction(db, Number(req.params.id), req.user?.name || 'user'));
  } catch (err) {
    if (err.status === 404) return fail(res, 404, err.message);
    console.error('[POST /inbox/:id/approve]', err);
    return fail(res, 500, 'Failed to approve item.');
  }
});

// POST /api/inbox/:id/dismiss
router.post('/:id/dismiss', (req, res) => {
  try {
    if (!dismissAction(db, Number(req.params.id), req.user?.name || 'user')) return fail(res, 404, 'Open item not found.');
    return ok(res, { id: Number(req.params.id), status: 'dismissed' });
  } catch (err) {
    console.error('[POST /inbox/:id/dismiss]', err);
    return fail(res, 500, 'Failed to dismiss item.');
  }
});

// POST /api/inbox/:id/snooze — body { hours } or { until } (ISO)
router.post('/:id/snooze', (req, res) => {
  try {
    const { hours, until } = req.body || {};
    const untilIso = until ? toUtcISO(until) : hours > 0 ? addHoursUtcISO(Number(hours)) : null;
    if (!untilIso) return fail(res, 400, 'hours (> 0) or until is required.');
    if (!snoozeAction(db, Number(req.params.id), untilIso)) return fail(res, 404, 'Open item not found.');
    return ok(res, { id: Number(req.params.id), snoozed_until: untilIso });
  } catch (err) {
    console.error('[POST /inbox/:id/snooze]', err);
    return fail(res, 500, 'Failed to snooze item.');
  }
});

// POST /api/inbox/batch — body { ids: [...], action: 'approve' | 'dismiss' }
// Approve runs sequentially (API rate limits); results carry wa.me links for
// messages that need manual sending.
router.post('/batch', async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'ids must be a non-empty array.');
    if (ids.length > MAX_BATCH) return fail(res, 400, `At most ${MAX_BATCH} items per batch.`);
    if (!['approve', 'dismiss'].includes(action)) return fail(res, 400, "action must be 'approve' or 'dismiss'.");

    const results = [];
    for (const id of ids.map(Number)) {
      try {
        results.push(action === 'approve'
          ? await approveAction(db, id, req.user?.name || 'user')
          : { id, status: dismissAction(db, id, req.user?.name || 'user') ? 'dismissed' : 'not_open' });
      } catch (err) {
        results.push({ id, error: err.message });
      }
    }
    return ok(res, { results });
  } catch (err) {
    console.error('[POST /inbox/batch]', err);
    return fail(res, 500, 'Batch action failed.');
  }
});

// POST /api/inbox/refresh — run rules + jobs now (instead of waiting for the timers)
router.post('/refresh', async (req, res) => {
  try {
    const rules = reconcileInbox(db);
    const jobsScheduled = reconcileJobs(db);
    const jobsRun = await runDueJobs(db);
    return ok(res, { rules, jobsScheduled, jobsRun, open: countOpen(db) });
  } catch (err) {
    console.error('[POST /inbox/refresh]', err);
    return fail(res, 500, 'Refresh failed.');
  }
});

module.exports = router;
