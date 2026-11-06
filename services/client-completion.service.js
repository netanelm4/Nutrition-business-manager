const { TOTAL_SESSIONS, COMPLETION_GRACE_DAYS } = require('../constants/events');
const { CLIENT_STATUS, SESSION_STATUS } = require('../constants/statuses');
const { closeActiveEngagements } = require('./client-lifecycle.service');
const { isPlaceholderSession } = require('./session-lifecycle.service');
const { publish } = require('./event-bus.service');
const {
  todayISO, nowUtcISO, addDays, parseDate, toISODate, israelLocalToUtcISO,
} = require('../utils/dates');

// ─── Client completion ───────────────────────────────────────────────────────
// Automatic rule (daily job): when the 6th session of the current process has
// been held, the client stays active until
//     completeAt = max(6th held session date + COMPLETION_GRACE_DAYS, process_end_date)
// and moves to "ended" the day after. Nothing is completed while a future
// session or calendar meeting is still booked.
//
// endClientProcess() is the single way a process ends (automatic rule,
// "עצור תהליך" and PUT status=ended), so open scheduling work is always closed.

const ACTIVE_STATUSES = [CLIENT_STATUS.ACTIVE, CLIENT_STATUS.ENDING_SOON];

// Inbox kinds that only make sense while the client is in an active process
const OPEN_WORK_KINDS = [
  'session_due', 'process_ending', 'process_ended', 'menu_overdue', 'freeze_end',
  'agent_schedule_meeting', 'agent_schedule_followup', 'meeting_prep',
];
// Scheduled jobs keyed by client that become pointless once the process ends
const CLIENT_JOB_TYPES = ['menu_sla_due', 'freeze_end'];

const plusDays = (date, days) => toISODate(addDays(parseDate(date), days));

/** Held sessions of the client's current process, oldest first. */
function heldSessionsOfCurrentProcess(db, clientId) {
  const eng = db.prepare(
    "SELECT id, number FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1"
  ).get(clientId);
  const rows = db.prepare(`
    SELECT id, session_number, session_date, engagement_id FROM sessions
    WHERE client_id = ? AND status = ? AND session_date IS NOT NULL
    ORDER BY session_date, session_number
  `).all(clientId, SESSION_STATUS.HELD);
  if (!eng) return rows;
  // Sessions recorded before engagements existed have no engagement_id → first process
  return rows.filter((s) => s.engagement_id === eng.id || (s.engagement_id === null && eng.number === 1));
}

/** A session or calendar meeting booked on/after `today`. */
function hasBookingFrom(db, clientId, today) {
  const session = db.prepare(`
    SELECT 1 FROM sessions WHERE client_id = ? AND status = ? AND session_date >= ? LIMIT 1
  `).get(clientId, SESSION_STATUS.SCHEDULED, today);
  if (session) return true;
  return !!db.prepare(`
    SELECT 1 FROM meetings WHERE client_id = ? AND status = 'active' AND start_time >= ? LIMIT 1
  `).get(clientId, israelLocalToUtcISO(today, '00:00'));
}

/**
 * Evaluate the completion rule for one client on `today` (Israel date).
 * @returns {{ eligible: boolean, reason: string, heldCount: number,
 *             sixthHeldDate: string|null, completeAt: string|null }}
 */
function evaluateCompletion(db, client, today = todayISO()) {
  const base = { eligible: false, heldCount: 0, sixthHeldDate: null, completeAt: null };
  if (!ACTIVE_STATUSES.includes(client.status)) return { ...base, reason: 'not_active' };

  const held = heldSessionsOfCurrentProcess(db, client.id);
  const result = { ...base, heldCount: held.length };
  if (held.length < TOTAL_SESSIONS) return { ...result, reason: 'sessions_remaining' };

  const sixthHeldDate = held[TOTAL_SESSIONS - 1].session_date;
  const graceEnd = plusDays(sixthHeldDate, COMPLETION_GRACE_DAYS);
  const end = client.process_end_date;
  const completeAt = end && end > graceEnd ? end : graceEnd;
  Object.assign(result, { sixthHeldDate, completeAt });

  if (today <= completeAt) return { ...result, reason: 'grace_period' };
  if (hasBookingFrom(db, client.id, today)) return { ...result, reason: 'booking_ahead' };
  return { ...result, eligible: true, reason: 'due' };
}

/**
 * Close everything that schedules more work for a client whose process ended:
 * pending Inbox items of process kinds, empty placeholder sessions and
 * client-keyed jobs. Real bookings (sessions linked to a calendar meeting) are
 * left untouched. Idempotent.
 */
function closeClientOpenWork(db, clientId) {
  const now = nowUtcISO();
  const inbox = db.prepare(`
    UPDATE action_queue SET status = 'done', resolved_at = ?, resolved_by = 'client_ended', updated_at = ?
    WHERE client_id = ? AND status = 'pending' AND kind IN (${OPEN_WORK_KINDS.map(() => '?').join(',')})
  `).run(now, now, clientId, ...OPEN_WORK_KINDS).changes;

  let placeholders = 0;
  const scheduled = db.prepare('SELECT * FROM sessions WHERE client_id = ? AND status = ?')
    .all(clientId, SESSION_STATUS.SCHEDULED);
  const activeMeeting = db.prepare("SELECT 1 FROM meetings WHERE id = ? AND status = 'active'");
  for (const s of scheduled) {
    if (!isPlaceholderSession(db, s)) continue;
    if (s.meeting_id && activeMeeting.get(s.meeting_id)) continue; // a real calendar booking stays
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(SESSION_STATUS.CANCELED, s.id);
    placeholders++;
  }

  const jobs = db.prepare(`
    UPDATE scheduled_jobs SET status = 'canceled', updated_at = ?
    WHERE status = 'pending' AND type IN (${CLIENT_JOB_TYPES.map(() => '?').join(',')})
      AND json_extract(payload, '$.clientId') = ?
  `).run(now, ...CLIENT_JOB_TYPES, clientId).changes;

  return { inbox, placeholders, jobs };
}

/**
 * End a client's process (status → ended) and close their open work.
 * @param {object} opts { today, reason, reasonText, automatic }
 */
function endClientProcess(db, clientId, { today = todayISO(), reason = null, reasonText = null, automatic = false } = {}) {
  const run = db.transaction(() => {
    db.prepare(`
      UPDATE clients
      SET status = 'ended', stop_reason = ?, stop_reason_text = ?, stop_date = ?, stopped_at = ?,
          completed_automatically = ?
      WHERE id = ?
    `).run(reason, reasonText, today, nowUtcISO(), automatic ? 1 : 0, clientId);
    closeActiveEngagements(db, clientId, today);
    return closeClientOpenWork(db, clientId);
  });
  const closed = run();
  publish(db, automatic ? 'client.completed' : 'client.ended', {
    entityType: 'client', entityId: clientId, payload: { automatic, today, closed },
  });
  return closed;
}

/**
 * Daily job: complete every active client that passed the rule on `today`.
 * Process summaries are generated afterwards by the AI backfill job.
 */
function runAutoCompletion(db, { today = todayISO() } = {}) {
  const clients = db.prepare(
    `SELECT * FROM clients WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`
  ).all(...ACTIVE_STATUSES);
  const completed = [];
  for (const c of clients) {
    const ev = evaluateCompletion(db, c, today);
    if (!ev.eligible) continue;
    const closed = endClientProcess(db, c.id, {
      today,
      automatic: true,
      reasonText: `התהליך הושלם אוטומטית: ${TOTAL_SESSIONS} פגישות התקיימו (האחרונה ב-${ev.sixthHeldDate}), תקופת ההמשך הסתיימה ב-${ev.completeAt}`,
    });
    completed.push({ clientId: c.id, name: c.full_name, sixthHeldDate: ev.sixthHeldDate, completeAt: ev.completeAt, closed });
  }
  if (completed.length) console.log(`[completion] Completed ${completed.length} client(s) on ${today}`, JSON.stringify(completed.map((x) => x.clientId)));
  return { today, checked: clients.length, completed };
}

module.exports = {
  evaluateCompletion, endClientProcess, closeClientOpenWork, runAutoCompletion, OPEN_WORK_KINDS,
};
