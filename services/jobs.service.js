const {
  nowUtcISO, addHoursUtcISO, israelLocalToUtcISO, israelDateOf,
} = require('../utils/dates');
const { upsertAction } = require('./action-queue.service');
const { sendMeetingReminder } = require('./reminders.service');
const { publish } = require('./event-bus.service');

// ─── Scheduled jobs ──────────────────────────────────────────────────────────
// One-off timed work, persisted in scheduled_jobs so restarts/deploys lose
// nothing. reconcileJobs() derives the jobs that SHOULD exist from current data
// (idempotent via dedupe_key) — so existing records are covered too — and
// runDueJobs() executes what is due, with retries.
//
//   meeting_reminder_24h  24h before an active meeting → WhatsApp confirmation
//   menu_sla_due          48h after session 1 was held → inbox if no menu yet
//   freeze_end            on frozen_until → inbox "return to the process?"

const MAX_ATTEMPTS = 3;
const REMINDER_LEAD_HOURS = 24;
const REMINDER_MIN_NOTICE_HOURS = 2;     // too late to bother for meetings < 2h away
const REMINDER_HORIZON_DAYS = 30;
const MENU_SLA_HOURS = 48;

function parsePayload(job) {
  try { return job.payload ? JSON.parse(job.payload) : {}; } catch { return {}; }
}

/**
 * Create a pending job, or move a still-pending one to a new time.
 * Jobs that already ran (done/failed/canceled) are left alone.
 */
function scheduleJob(database, { type, runAt, payload = {}, dedupeKey }) {
  const now = nowUtcISO();
  const existing = database.prepare('SELECT * FROM scheduled_jobs WHERE dedupe_key = ?').get(dedupeKey);
  if (!existing) {
    database.prepare(`
      INSERT INTO scheduled_jobs (type, run_at, payload, status, dedupe_key, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(type, runAt, JSON.stringify(payload), dedupeKey, now, now);
    return 'created';
  }
  if (existing.status === 'pending' && existing.run_at !== runAt) {
    database.prepare('UPDATE scheduled_jobs SET run_at = ?, payload = ?, updated_at = ? WHERE id = ?')
      .run(runAt, JSON.stringify(payload), now, existing.id);
    return 'moved';
  }
  return 'kept';
}

function cancelPendingJobs(database, where, params) {
  return database.prepare(`
    UPDATE scheduled_jobs SET status = 'canceled', updated_at = ?
    WHERE status = 'pending' AND ${where}
  `).run(nowUtcISO(), ...params).changes;
}

// ─── Reconciler ──────────────────────────────────────────────────────────────

function reconcileMeetingReminders(database) {
  const now = nowUtcISO();
  const stats = { scheduled: 0, canceled: 0 };
  const meetings = database.prepare(`
    SELECT id, start_time FROM meetings
    WHERE status = 'active' AND confirmation_sent = 0
      AND start_time > ? AND start_time <= ?
  `).all(addHoursUtcISO(REMINDER_MIN_NOTICE_HOURS), addHoursUtcISO(24 * REMINDER_HORIZON_DAYS));

  const wanted = new Set();
  for (const m of meetings) {
    const key = `meeting_reminder_24h:meeting:${m.id}:${m.start_time}`; // reschedule → new key
    wanted.add(key);
    const due = addHoursUtcISO(-REMINDER_LEAD_HOURS, new Date(m.start_time));
    const runAt = due < now ? now : due;
    if (scheduleJob(database, { type: 'meeting_reminder_24h', runAt, payload: { meetingId: m.id, startTime: m.start_time }, dedupeKey: key }) === 'created') {
      stats.scheduled++;
    }
  }
  // Pending reminders for meetings that were canceled, moved, confirmed or passed
  for (const job of database.prepare("SELECT id, dedupe_key FROM scheduled_jobs WHERE type = 'meeting_reminder_24h' AND status = 'pending'").all()) {
    if (!wanted.has(job.dedupe_key)) stats.canceled += cancelPendingJobs(database, 'id = ?', [job.id]);
  }
  return stats;
}

function reconcileMenuSla(database) {
  const stats = { scheduled: 0, canceled: 0 };
  const rows = database.prepare(`
    SELECT c.id AS client_id, s.session_date
    FROM clients c
    JOIN sessions s ON s.client_id = c.id AND s.session_number = 1 AND s.status = 'held'
    WHERE c.status IN ('active', 'ending_soon') AND c.menu_sent = 0 AND s.session_date IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM menus m WHERE m.client_id = c.id AND m.status = 'final')
  `).all();
  const wanted = new Set();
  for (const r of rows) {
    const date = israelDateOf(r.session_date);
    const key = `menu_sla_due:client:${r.client_id}:session1:${date}`;
    wanted.add(key);
    const runAt = addHoursUtcISO(MENU_SLA_HOURS, new Date(israelLocalToUtcISO(date, '23:59')));
    if (scheduleJob(database, { type: 'menu_sla_due', runAt, payload: { clientId: r.client_id }, dedupeKey: key }) === 'created') {
      stats.scheduled++;
    }
  }
  for (const job of database.prepare("SELECT id, dedupe_key FROM scheduled_jobs WHERE type = 'menu_sla_due' AND status = 'pending'").all()) {
    if (!wanted.has(job.dedupe_key)) stats.canceled += cancelPendingJobs(database, 'id = ?', [job.id]);
  }
  return stats;
}

function reconcileFreezeEnds(database) {
  const stats = { scheduled: 0, canceled: 0 };
  const rows = database.prepare(
    "SELECT id, frozen_until FROM clients WHERE status = 'frozen' AND frozen_until IS NOT NULL"
  ).all();
  const wanted = new Set();
  for (const c of rows) {
    const key = `freeze_end:client:${c.id}:${c.frozen_until}`;
    wanted.add(key);
    const runAt = israelLocalToUtcISO(israelDateOf(c.frozen_until), '08:00');
    if (scheduleJob(database, { type: 'freeze_end', runAt, payload: { clientId: c.id, frozenUntil: c.frozen_until }, dedupeKey: key }) === 'created') {
      stats.scheduled++;
    }
  }
  for (const job of database.prepare("SELECT id, dedupe_key FROM scheduled_jobs WHERE type = 'freeze_end' AND status = 'pending'").all()) {
    if (!wanted.has(job.dedupe_key)) stats.canceled += cancelPendingJobs(database, 'id = ?', [job.id]);
  }
  return stats;
}

/** Derive the jobs that should exist from current data. Idempotent. */
function reconcileJobs(database) {
  const stats = {
    reminders: reconcileMeetingReminders(database),
    menuSla: reconcileMenuSla(database),
    freezeEnds: reconcileFreezeEnds(database),
  };
  const created = stats.reminders.scheduled + stats.menuSla.scheduled + stats.freezeEnds.scheduled;
  if (created) console.log(`[jobs] Scheduled ${created} job(s)`, JSON.stringify(stats));
  return stats;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const HANDLERS = {
  meeting_reminder_24h: async (database, { meetingId }) => sendMeetingReminder(database, meetingId),

  menu_sla_due: async (database, { clientId }) => {
    const client = database.prepare('SELECT id, full_name, status, menu_sent FROM clients WHERE id = ?').get(clientId);
    if (!client || client.menu_sent || !['active', 'ending_soon'].includes(client.status)) return { skipped: true };
    const hasFinal = database.prepare("SELECT 1 FROM menus WHERE client_id = ? AND status = 'final'").get(clientId);
    if (hasFinal) return { skipped: true };
    upsertAction(database, {
      kind: 'menu_overdue',
      dedupeKey: `menu_overdue:client:${clientId}`,
      title: `תפריט באיחור: ${client.full_name}`,
      body: 'עברו 48 שעות מהפגישה הראשונה והתפריט טרם נשלח',
      clientId,
      priority: 'urgent',
      source: 'job',
    });
    return { queued: true };
  },

  freeze_end: async (database, { clientId, frozenUntil }) => {
    const client = database.prepare('SELECT id, full_name, status, frozen_until, phone FROM clients WHERE id = ?').get(clientId);
    if (!client || client.status !== 'frozen' || client.frozen_until !== frozenUntil) return { skipped: true };
    upsertAction(database, {
      kind: 'freeze_end',
      dedupeKey: `freeze_end:client:${clientId}:${frozenUntil}`,
      title: `ההקפאה של ${client.full_name} הסתיימה`,
      body: 'לבדוק אם לחזור לתהליך',
      clientId,
      priority: 'medium',
      source: 'job',
    });
    return { queued: true };
  },
};

/** Execute every due pending job (run_at <= now). */
async function runDueJobs(database, { limit = 50 } = {}) {
  const now = nowUtcISO();
  const due = database.prepare(`
    SELECT * FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?
  `).all(now, limit);
  const stats = { ran: 0, failed: 0, retried: 0 };

  for (const job of due) {
    const claimed = database.prepare(`
      UPDATE scheduled_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(nowUtcISO(), job.id).changes;
    if (!claimed) continue;

    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      const result = await handler(database, parsePayload(job));
      database.prepare("UPDATE scheduled_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?")
        .run(nowUtcISO(), job.id);
      stats.ran++;
      console.log(`[jobs] ${job.type} #${job.id} done ${JSON.stringify(result || {})}`);
    } catch (err) {
      const attempts = job.attempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        database.prepare("UPDATE scheduled_jobs SET status = 'pending', run_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
          .run(addHoursUtcISO(0.25 * attempts), err.message, nowUtcISO(), job.id); // 15 / 30 min backoff
        stats.retried++;
      } else {
        database.prepare("UPDATE scheduled_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
          .run(err.message, nowUtcISO(), job.id);
        stats.failed++;
        publish(database, 'job.failed', { entityType: 'job', entityId: job.id, payload: { type: job.type, error: err.message } });
      }
      console.error(`[jobs] ${job.type} #${job.id} attempt ${attempts} failed: ${err.message}`);
    }
  }
  return stats;
}

module.exports = { scheduleJob, reconcileJobs, runDueJobs, HANDLERS };
