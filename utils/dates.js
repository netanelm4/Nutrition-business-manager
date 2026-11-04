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
  // Business day in Israel — the UTC day is wrong between 00:00 and 02:00/03:00 local
  return zonedParts(new Date()).date;
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

// ─────────────────────────────────────────────────────────────────────────────
// Instants vs calendar dates
//
// INSTANT  (a moment in time — meeting start/end): stored as canonical UTC ISO,
//          exactly "YYYY-MM-DDTHH:MM:SS.sssZ" (Date#toISOString). Fixed length,
//          so plain string comparison in SQL sorts chronologically. Always compare
//          against nowUtcISO()/addHoursUtcISO() params, never SQLite datetime('now')
//          (which returns "YYYY-MM-DD HH:MM:SS" and does not compare correctly).
// CALENDAR DATE (session_date, start_date, windows): "YYYY-MM-DD" as the day in
//          Israel. A meeting at 00:30 Israel time on the 5th is session_date 5th,
//          even though it is the 4th in UTC.
// ─────────────────────────────────────────────────────────────────────────────

const BUSINESS_TZ = 'Asia/Jerusalem';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_LOCAL = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** Wall-clock parts of an instant in the business time zone. */
function zonedParts(date, timeZone = BUSINESS_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    second: get('second'),
  };
}

/** Offset (ms) of the business zone from UTC at the given instant. */
function zoneOffsetMs(date, timeZone = BUSINESS_TZ) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.parse(`${p.date}T${p.time}:${p.second}Z`);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert an Israel wall-clock date + time ("2026-07-15", "10:00") to a
 * canonical UTC instant. DST-safe (re-checks the offset at the result).
 */
function israelLocalToUtcISO(dateStr, timeStr = '00:00', seconds = '00') {
  const guess = Date.parse(`${dateStr}T${timeStr}:${seconds}Z`);
  if (isNaN(guess)) return null;
  let utc = guess - zoneOffsetMs(new Date(guess));
  utc = guess - zoneOffsetMs(new Date(utc));
  return new Date(utc).toISOString();
}

/**
 * Normalize any stored/received instant to canonical UTC ISO.
 *   "2026-11-05T08:00:00.000000Z"  (Calendly)        → "2026-11-05T08:00:00.000Z"
 *   "2026-11-05T10:00:00+02:00"    (Google)          → "2026-11-05T08:00:00.000Z"
 *   "2026-11-05T10:00:00"          (manual, naive)   → treated as Israel local time
 * Returns null for empty/unparseable input.
 */
function toUtcISO(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  const str = String(value).trim();
  if (CANONICAL_INSTANT.test(str)) return str;
  if (HAS_ZONE.test(str)) {
    const ms = Date.parse(str);
    return isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const naive = str.match(NAIVE_LOCAL);
  if (naive) return israelLocalToUtcISO(naive[1], `${naive[2]}:${naive[3]}`, naive[4] || '00');
  if (DATE_ONLY.test(str)) return israelLocalToUtcISO(str, '00:00');
  return null;
}

function isCanonicalInstant(value) {
  return typeof value === 'string' && CANONICAL_INSTANT.test(value);
}

function nowUtcISO() {
  return new Date().toISOString();
}

function addHoursUtcISO(hours, from = new Date()) {
  const base = from instanceof Date ? from.getTime() : Date.parse(toUtcISO(from));
  return new Date(base + hours * 3600 * 1000).toISOString();
}

/** Israel calendar date ("YYYY-MM-DD") of an instant or date-ish value. */
function israelDateOf(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (DATE_ONLY.test(str)) return str;
  const naive = str.match(NAIVE_LOCAL);
  if (naive && !HAS_ZONE.test(str)) return naive[1]; // already Israel wall-clock
  const iso = toUtcISO(str);
  return iso ? zonedParts(new Date(iso)).date : null;
}

/** Israel wall-clock { date: "YYYY-MM-DD", time: "HH:MM" } for display/edit forms. */
function israelDateTimeParts(value) {
  const iso = toUtcISO(value);
  if (!iso) return null;
  const p = zonedParts(new Date(iso));
  return { date: p.date, time: p.time };
}

/** Today's date in Israel ("YYYY-MM-DD"). */
function todayIsraelISO() {
  return zonedParts(new Date()).date;
}

module.exports = {
  BUSINESS_TZ,
  toUtcISO,
  isCanonicalInstant,
  israelLocalToUtcISO,
  israelDateOf,
  israelDateTimeParts,
  todayIsraelISO,
  nowUtcISO,
  addHoursUtcISO,
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
