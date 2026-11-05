const { ALERT_STATE, CLIENT_STATUS, SESSION_STATUS } = require('../constants/statuses');
const {
  SESSION_SLA_DAYS,
  MENU_ALERT_THRESHOLD_DAYS,
  ENDING_SOON_THRESHOLD_DAYS,
} = require('../constants/events');
const {
  isInThePast,
  isWithinNextDays,
  diffDays,
  todayISO,
  addDays,
  parseDate,
  toISODate,
  nowUtcISO,
} = require('../utils/dates');

/**
 * Rolling session SLA (the only "session due" rule):
 *   stale = more than SESSION_SLA_DAYS since the last HELD session
 *           (or since the process start when nothing was held yet)
 *           AND no upcoming session / calendar meeting.
 * Derived from actual session dates, so editing a date retroactively
 * recalculates it on the next read.
 *
 * @param {object}   client             - clients row (start_date is the fallback anchor)
 * @param {object[]} sessions           - all sessions rows of the client
 * @param {object}   [opts]
 * @param {boolean}  [opts.hasUpcomingMeeting] - an active future meeting exists in meetings
 */
function computeSessionSla(client, sessions, { hasUpcomingMeeting = false } = {}) {
  const today = todayISO();
  const held = sessions
    .filter((s) => s.status === SESSION_STATUS.HELD && s.session_date)
    .sort((a, b) => (a.session_date < b.session_date ? 1 : -1));
  const lastHeldDate = held[0]?.session_date || null;
  const hasUpcomingSession = sessions.some(
    (s) => s.status === SESSION_STATUS.SCHEDULED && s.session_date && s.session_date >= today
  );
  const hasUpcoming = hasUpcomingSession || !!hasUpcomingMeeting;
  const anchorDate = lastHeldDate || client?.start_date || null;
  const daysSince = anchorDate ? diffDays(today, anchorDate) : null;
  return {
    lastHeldDate,
    anchorDate,
    anchor: lastHeldDate ? 'held' : 'start',
    daysSinceHeld: lastHeldDate ? daysSince : null,
    daysSince,
    dueDate: anchorDate ? toISODate(addDays(parseDate(anchorDate), SESSION_SLA_DAYS)) : null,
    hasUpcoming,
    stale: daysSince !== null && daysSince > SESSION_SLA_DAYS && !hasUpcoming,
  };
}

/** True when the client has an active calendar meeting in the future. */
function hasUpcomingMeeting(database, clientId) {
  return !!database.prepare(
    "SELECT 1 FROM meetings WHERE client_id = ? AND status = 'active' AND start_time > ? LIMIT 1"
  ).get(clientId, nowUtcISO());
}

/**
 * Badge state of one timeline slot.
 *   held / scheduled session → GREEN (done or booked)
 *   empty slot               → RED only when it is the next open slot and the
 *                              client breached the rolling SLA; otherwise NONE.
 * The theoretical expected_date no longer drives alerts.
 */
function computeWindowAlertState(window, session, { isNextOpen = false, stale = false } = {}) {
  if (session && (session.status === SESSION_STATUS.HELD || session.status === SESSION_STATUS.SCHEDULED)) {
    return ALERT_STATE.GREEN;
  }
  return isNextOpen && stale ? ALERT_STATE.RED : ALERT_STATE.NONE;
}

/**
 * Compute all alert states for a client.
 *
 * @param {object}   client   - A clients row
 * @param {object[]} windows  - All session_windows rows for this client (sorted by session_number)
 * @param {object[]} sessions - All sessions rows for this client
 * @param {object}   [opts]   - { hasUpcomingMeeting }
 * @returns {object} Alert summary
 *   {
 *     windowAlerts: [{ session_number, expected_date, manually_overridden, state }],
 *     sessionSla: { lastHeldDate, daysSinceHeld, dueDate, hasUpcoming, stale },
 *     menuAlert, endingSoonAlert, processEndedAlert: boolean,
 *   }
 */
function computeClientAlerts(client, windows, sessions, opts = {}) {
  // Index sessions by session_number for O(1) lookup.
  // Canceled / no-show sessions do not fill their window — it stays open.
  const sessionByNumber = {};
  for (const s of sessions) {
    if (s.status === SESSION_STATUS.CANCELED || s.status === SESSION_STATUS.NO_SHOW) continue;
    sessionByNumber[s.session_number] = s;
  }

  const sessionSla = computeSessionSla(client, sessions, opts);
  const nextOpen = [...windows]
    .sort((a, b) => a.session_number - b.session_number)
    .find((w) => !sessionByNumber[w.session_number]);

  // Window-level alert states
  const windowAlerts = windows.map((w) => ({
    session_number: w.session_number,
    expected_date: w.expected_date,
    manually_overridden: w.manually_overridden === 1,
    override_note: w.override_note || null,
    state: computeWindowAlertState(w, sessionByNumber[w.session_number] || null, {
      isNextOpen: nextOpen?.session_number === w.session_number,
      stale: sessionSla.stale,
    }),
  }));

  // Menu alert: session 1 was held more than MENU_ALERT_THRESHOLD_DAYS ago, menu not sent
  const session1 = sessionByNumber[1];
  const menuAlert =
    !client.menu_sent &&
    !!session1 &&
    session1.status === SESSION_STATUS.HELD &&
    !!session1.session_date &&
    diffDays(todayISO(), session1.session_date) > MENU_ALERT_THRESHOLD_DAYS;

  // Ending soon alert: process_end_date is within 14 days and process not already ended
  const endingSoonAlert =
    !!client.process_end_date &&
    client.status !== CLIENT_STATUS.ENDED &&
    isWithinNextDays(client.process_end_date, ENDING_SOON_THRESHOLD_DAYS);

  // Process ended alert: process_end_date has passed and status not already marked ended
  const processEndedAlert =
    !!client.process_end_date &&
    client.status !== CLIENT_STATUS.ENDED &&
    isInThePast(client.process_end_date);

  return {
    windowAlerts,
    sessionSla,
    menuAlert,
    endingSoonAlert,
    processEndedAlert,
  };
}

/**
 * Return true if any alert for this client requires attention
 * (used to sort clients on the dashboard).
 */
function hasActiveAlert(alerts) {
  const hasRedOrYellow = alerts.windowAlerts.some(
    (w) => w.state === ALERT_STATE.RED || w.state === ALERT_STATE.YELLOW
  );
  return hasRedOrYellow || !!alerts.sessionSla?.stale || alerts.menuAlert || alerts.endingSoonAlert || alerts.processEndedAlert;
}

module.exports = { computeWindowAlertState, computeClientAlerts, computeSessionSla, hasUpcomingMeeting, hasActiveAlert };
