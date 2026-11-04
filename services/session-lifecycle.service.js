const { SESSION_STATUS } = require('../constants/statuses');
const {
  toUtcISO, israelDateOf, israelLocalToUtcISO, nowUtcISO, addHoursUtcISO, todayISO,
} = require('../utils/dates');

// ─── Session lifecycle ───────────────────────────────────────────────────────
//   scheduled → held | no_show | canceled
// A booking creates a `scheduled` session linked to its meeting (Google Calendar booking).
// It becomes `held` when the nutritionist confirms it (status action, saving
// notes/weight) or automatically AUTO_HELD_AFTER_HOURS after the meeting ended
// without a cancellation. Only `held` sessions count as done.
// Every function takes the db handle (usable from routes, services and db.js).

const AUTO_HELD_AFTER_HOURS = 24;
const VALID_STATUSES = new Set(Object.values(SESSION_STATUS));

function isValidSessionStatus(status) {
  return VALID_STATUSES.has(status);
}

/** Status for a session recorded/created for a calendar date (no booking). */
function initialStatusForDate(sessionDate) {
  if (!sessionDate) return SESSION_STATUS.HELD;
  return israelDateOf(sessionDate) > todayISO() ? SESSION_STATUS.SCHEDULED : SESSION_STATUS.HELD;
}

/** Status for a session created from a booking instant. */
function initialStatusForInstant(startTime) {
  const iso = toUtcISO(startTime);
  if (!iso) return SESSION_STATUS.SCHEDULED;
  return iso > nowUtcISO() ? SESSION_STATUS.SCHEDULED : SESSION_STATUS.HELD;
}

function hasJsonContent(value) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === 'object') return Object.values(parsed).some((v) => v);
    return !!parsed;
  } catch {
    return String(value).trim().length > 0;
  }
}

/**
 * A placeholder is a session row created by a booking that holds no clinical
 * data yet — safe to delete when its booking is canceled.
 */
function isPlaceholderSession(database, session) {
  if (session.status === SESSION_STATUS.HELD) return false;
  if (session.highlights && String(session.highlights).trim()) return false;
  if (session.weight !== null && session.weight !== undefined && session.weight !== '') return false;
  if (hasJsonContent(session.tasks)) return false;
  if (hasJsonContent(session.soap_notes)) return false;
  if (session.checkin_message && String(session.checkin_message).trim()) return false;
  const intake = database.prepare('SELECT 1 FROM session_intakes WHERE session_id = ? LIMIT 1').get(session.id);
  return !intake;
}

/** Sessions belonging to an event: linked rows, or (legacy, unlinked) same client + same Israel date. */
function sessionsForEvent(database, event) {
  const linked = database.prepare('SELECT * FROM sessions WHERE meeting_id = ?').all(event.id);
  if (linked.length > 0 || !event.client_id || !event.start_time) return linked;
  return database.prepare(`
    SELECT * FROM sessions
    WHERE client_id = ? AND meeting_id IS NULL AND session_date = ? AND status = ?
  `).all(event.client_id, israelDateOf(event.start_time), SESSION_STATUS.SCHEDULED);
}

/**
 * The booking was canceled: delete its unheld placeholder session, or mark a
 * session that already has data as `canceled`. Held sessions are never touched.
 * Session 1 is never deleted — it anchors a converted client (the startup repair
 * recreates a missing session 1), so it is marked `canceled` instead.
 */
function cancelSessionsForEvent(database, event) {
  const result = { deleted: 0, canceled: 0 };
  if (!event) return result;
  for (const s of sessionsForEvent(database, event)) {
    if (s.status === SESSION_STATUS.HELD || s.status === SESSION_STATUS.CANCELED) continue;
    if (s.session_number > 1 && isPlaceholderSession(database, s)) {
      database.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      result.deleted++;
      console.log(`[sessions] Deleted placeholder session ${s.id} (client ${s.client_id}) — booking ${event.id} canceled`);
    } else {
      database.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(SESSION_STATUS.CANCELED, s.id);
      result.canceled++;
      console.log(`[sessions] Session ${s.id} (client ${s.client_id}) → canceled — booking ${event.id} canceled`);
    }
  }
  return result;
}

/** The booking moved: keep the linked (not yet held) session's date in sync. */
function rescheduleSessionsForEvent(database, eventId, newStartTime) {
  const date = israelDateOf(newStartTime);
  if (!date) return 0;
  return database.prepare(`
    UPDATE sessions SET session_date = ?
    WHERE meeting_id = ? AND status = ?
  `).run(date, eventId, SESSION_STATUS.SCHEDULED).changes;
}

/**
 * A client booked a follow-up: create (or refresh) the `scheduled` session for
 * the next free session slot, linked to the event. Returns the session id or null.
 */
function scheduleSessionForEvent(database, { clientId, eventId, startTime, engagementId = null }) {
  const sessionDate = israelDateOf(startTime);
  const existing = database.prepare('SELECT * FROM sessions WHERE meeting_id = ?').get(eventId);
  if (existing) {
    if (existing.status === SESSION_STATUS.SCHEDULED && existing.session_date !== sessionDate) {
      database.prepare('UPDATE sessions SET session_date = ? WHERE id = ?').run(sessionDate, existing.id);
    }
    return existing.id;
  }

  const nextWindow = database.prepare(`
    SELECT w.session_number
    FROM   session_windows w
    LEFT JOIN sessions s
      ON s.client_id = w.client_id AND s.session_number = w.session_number
    WHERE  w.client_id = ? AND s.id IS NULL
    ORDER  BY w.session_number ASC
    LIMIT  1
  `).get(clientId);
  if (!nextWindow) return null;

  const res = database.prepare(`
    INSERT OR IGNORE INTO sessions
      (client_id, session_number, session_date, highlights, engagement_id, status, meeting_id)
    VALUES (?, ?, ?, '', ?, ?, ?)
  `).run(clientId, nextWindow.session_number, sessionDate, engagementId,
         SESSION_STATUS.SCHEDULED, eventId); // held only after confirmation or auto-held
  if (!res.changes) return null;
  console.log(`[sessions] Session ${nextWindow.session_number} scheduled for client ${clientId} on ${sessionDate} (event ${eventId})`);
  return res.lastInsertRowid;
}

/** Mark sessions linked to an event as held (e.g. meeting marked completed). */
function markEventSessionsHeld(database, eventId) {
  return database.prepare(`
    UPDATE sessions SET status = ?
    WHERE meeting_id = ? AND status = ?
  `).run(SESSION_STATUS.HELD, eventId, SESSION_STATUS.SCHEDULED).changes;
}

/**
 * Auto-held: a scheduled session whose meeting ended more than
 * AUTO_HELD_AFTER_HOURS ago with no cancellation recorded becomes `held`.
 * Sessions whose booking was canceled get the cancellation rule instead.
 * Idempotent — safe to run on every interval.
 */
function autoMarkHeldSessions(database) {
  const rows = database.prepare(`
    SELECT s.*, ce.id AS ev_id, ce.status AS ev_status, ce.client_id AS ev_client_id,
           ce.start_time AS ev_start, ce.end_time AS ev_end
    FROM sessions s
    LEFT JOIN meetings ce ON ce.id = s.meeting_id
    WHERE s.status = ?
  `).all(SESSION_STATUS.SCHEDULED);

  const cutoff = addHoursUtcISO(-AUTO_HELD_AFTER_HOURS);
  const result = { held: 0, canceled: 0, deleted: 0 };

  for (const s of rows) {
    if (s.ev_id && s.ev_status === 'canceled') {
      const r = cancelSessionsForEvent(database, {
        id: s.ev_id, client_id: s.ev_client_id, start_time: s.ev_start,
      });
      result.canceled += r.canceled;
      result.deleted  += r.deleted;
      continue;
    }
    const endedAt = toUtcISO(s.ev_end) || toUtcISO(s.ev_start)
      || (s.session_date ? israelLocalToUtcISO(israelDateOf(s.session_date), '23:59') : null);
    if (endedAt && endedAt <= cutoff) {
      database.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(SESSION_STATUS.HELD, s.id);
      result.held++;
      console.log(`[sessions] Auto-held session ${s.id} (client ${s.client_id}, ${s.session_date}) — ${AUTO_HELD_AFTER_HOURS}h passed, no cancellation`);
    }
  }
  return result;
}

module.exports = {
  AUTO_HELD_AFTER_HOURS,
  isValidSessionStatus,
  initialStatusForDate,
  initialStatusForInstant,
  isPlaceholderSession,
  cancelSessionsForEvent,
  rescheduleSessionsForEvent,
  scheduleSessionForEvent,
  markEventSessionsHeld,
  autoMarkHeldSessions,
};
