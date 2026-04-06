const {
  SESSION_INTERVAL_DAYS,
  TOTAL_SESSIONS,
  PROCESS_DURATION_DAYS,
} = require('../constants/events');

/**
 * Add a number of days to a date and return a new Date.
 * Does not mutate the input.
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Return the absolute difference in days between two dates.
 * Works with Date objects or ISO date strings.
 */
function diffDays(dateA, dateB) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((a.getTime() - b.getTime()) / msPerDay);
}

/**
 * Parse a value to a Date object. Accepts Date instances or ISO strings.
 * Returns null if the value is falsy or unparseable.
 */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a Date (or ISO string) to an ISO date-only string: "YYYY-MM-DD".
 * Returns null if the input is falsy or invalid.
 */
function toISODate(date) {
  const d = parseDate(date);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Return today's date as an ISO date-only string: "YYYY-MM-DD".
 */
function todayISO() {
  return toISODate(new Date());
}

/**
 * Format a date for display in Hebrew locale: "DD/MM/YYYY".
 * Returns an empty string if the input is falsy or invalid.
 */
function formatDateHebrew(date) {
  const d = parseDate(date);
  if (!d) return '';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Calculate the process end date for a client.
 * process_end_date = start_date + PROCESS_DURATION_DAYS (90 days).
 * Returns an ISO date string.
 */
function calculateProcessEndDate(startDate) {
  const d = parseDate(startDate);
  if (!d) return null;
  return toISODate(addDays(d, PROCESS_DURATION_DAYS));
}

/**
 * Calculate all 6 expected session window dates for a client.
 * Session N expected date = start_date + (N-1) * SESSION_INTERVAL_DAYS.
 * Returns an array of objects: [{ session_number, expected_date }]
 * where expected_date is an ISO date string.
 */
function calculateSessionWindows(startDate) {
  const d = parseDate(startDate);
  if (!d) return [];

  const windows = [];
  for (let i = 1; i <= TOTAL_SESSIONS; i++) {
    const expected = addDays(d, (i - 1) * SESSION_INTERVAL_DAYS);
    windows.push({
      session_number: i,
      expected_date: toISODate(expected),
    });
  }
  return windows;
}

/**
 * Check whether a given date falls within ±toleranceDays of expectedDate.
 * All inputs accept Date objects or ISO strings.
 * Returns true if |date - expectedDate| <= toleranceDays.
 */
function isWithinTolerance(date, expectedDate, toleranceDays) {
  const d = parseDate(date);
  const e = parseDate(expectedDate);
  if (!d || !e) return false;
  return Math.abs(diffDays(d, e)) <= toleranceDays;
}

/**
 * Check whether a given date is strictly in the past relative to today.
 * Returns true if date < today (UTC day comparison).
 */
function isInThePast(date) {
  const d = parseDate(date);
  if (!d) return false;
  return diffDays(new Date(), d) > 0;
}

/**
 * Check whether a given date is within the next N days (inclusive of today).
 * Returns true if 0 <= days until date <= withinDays.
 */
function isWithinNextDays(date, withinDays) {
  const d = parseDate(date);
  if (!d) return false;
  const delta = diffDays(d, new Date());
  return delta >= 0 && delta <= withinDays;
}

module.exports = {
  addDays,
  diffDays,
  parseDate,
  toISODate,
  todayISO,
  formatDateHebrew,
  calculateProcessEndDate,
  calculateSessionWindows,
  isWithinTolerance,
  isInThePast,
  isWithinNextDays,
};
