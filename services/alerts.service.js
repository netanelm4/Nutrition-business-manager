const { ALERT_STATE, CLIENT_STATUS } = require('../constants/statuses');
const {
  SESSION_TOLERANCE_DAYS,
  MENU_ALERT_THRESHOLD_DAYS,
  ENDING_SOON_THRESHOLD_DAYS,
} = require('../constants/events');
const {
  isWithinTolerance,
  isInThePast,
  isWithinNextDays,
  diffDays,
  todayISO,
} = require('../utils/dates');

/**
 * Compute the alert state for a single session window.
 *
 * @param {object} window     - A session_windows row: { session_number, expected_date, ... }
 * @param {object|null} session - The sessions row for the same session_number, or null if none exists
 * @returns {string} ALERT_STATE value
 */
function computeWindowAlertState(window, session) {
  const { expected_date } = window;

  if (session && session.session_date) {
    // Session exists — check if it landed within tolerance
    return isWithinTolerance(session.session_date, expected_date, SESSION_TOLERANCE_DAYS)
      ? ALERT_STATE.GREEN
      : ALERT_STATE.YELLOW; // session exists but outside the expected window
  }

  // No session yet — decide based on where today falls relative to the window
  const today = todayISO();
  if (isWithinTolerance(today, expected_date, SESSION_TOLERANCE_DAYS)) {
    return ALERT_STATE.YELLOW; // inside window, no session scheduled
  }

  if (isInThePast(expected_date) && diffDays(today, expected_date) > SESSION_TOLERANCE_DAYS) {
    return ALERT_STATE.RED; // window has fully passed, no session recorded
  }

  return ALERT_STATE.NONE; // window is still in the future
}

/**
 * Compute all alert states for a client.
 *
 * @param {object}   client   - A clients row
 * @param {object[]} windows  - All session_windows rows for this client (sorted by session_number)
 * @param {object[]} sessions - All sessions rows for this client
 * @returns {object} Alert summary
 *   {
 *     windowAlerts: [{ session_number, expected_date, manually_overridden, state }],
 *     menuAlert: boolean,
 *     endingSoonAlert: boolean,
 *     processEndedAlert: boolean,
 *   }
 */
function computeClientAlerts(client, windows, sessions) {
  // Index sessions by session_number for O(1) lookup
  const sessionByNumber = {};
  for (const s of sessions) {
    sessionByNumber[s.session_number] = s;
  }

  // Window-level alert states
  const windowAlerts = windows.map((w) => ({
    session_number: w.session_number,
    expected_date: w.expected_date,
    manually_overridden: w.manually_overridden === 1,
    override_note: w.override_note || null,
    state: computeWindowAlertState(w, sessionByNumber[w.session_number] || null),
  }));

  // Menu alert: session 1 was held more than MENU_ALERT_THRESHOLD_DAYS ago, menu not sent
  const session1 = sessionByNumber[1];
  const menuAlert =
    !client.menu_sent &&
    !!session1 &&
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
  return hasRedOrYellow || alerts.menuAlert || alerts.endingSoonAlert || alerts.processEndedAlert;
}

module.exports = { computeWindowAlertState, computeClientAlerts, hasActiveAlert };
