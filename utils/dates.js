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

/**
 * ISO week key of the Israel calendar date of a value (default: now), e.g. "2026-W45".
 * Used as a deterministic dedupe bucket for weekly inbox items.
 */
function isoWeekKey(value = new Date()) {
  const date = israelDateOf(value instanceof Date ? value.toISOString() : value);
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7;            // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);          // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Hebrew natural-language dates (WhatsApp commands) ──────────────────────
// Resolves what Netanel writes ("אתמול", "ביום חמישי", "ב-04/11", "לפני 3 ימים")
// to an Israel calendar date. Weekday names mean the MOST RECENT such day
// (today included); a date without a year is this year unless that would be in
// the future. Future dates are rejected: weigh-ins and completions are past events.

const HEBREW_WEEKDAYS = [
  ['ראשון', "א'", 'א׳'], ['שני', "ב'", 'ב׳'], ['שלישי', "ג'", 'ג׳'], ['רביעי', "ד'", 'ד׳'],
  ['חמישי', "ה'", 'ה׳'], ['שישי', "ו'", 'ו׳'], ['שבת', "ש'", 'ש׳'],
];
const HEBREW_WEEKDAY_NAMES = HEBREW_WEEKDAYS.map((w) => w[0]);

/**
 * @param {string} text  the date as written ('' → today)
 * @param {string} [today] Israel date "YYYY-MM-DD" (defaults to now)
 * @returns {{ date: string, label: string } | { error: string }}
 */
function resolveHebrewDate(text, today = todayISO()) {
  const t = String(text || '').trim().replace(/^ב-?|^ביום\s+|^יום\s+/u, '').replace(/[.,;!?]+$/, '').trim();
  const base = parseDate(`${today}T12:00:00Z`);
  const shift = (days) => toISODate(addDays(base, days));
  const done = (date) => {
    if (date > today) return { error: `התאריך ${formatDateHebrewShort(date)} עוד לא הגיע.` };
    return { date, label: `${hebrewWeekday(date)} ${formatDateHebrewShort(date)}` };
  };
  if (!t || /^(היום|עכשיו|הבוקר)$/u.test(t)) return done(today);
  if (/^אתמול$/u.test(t)) return done(shift(-1));
  if (/^(מחר|מחרתיים)$/u.test(t)) return { error: `"${t}" עוד לא הגיע. אפשר לרשום רק תאריך שעבר.` };
  if (/^(שלשום|לפני יומיים)$/u.test(t)) return done(shift(-2));
  const ago = /^לפני\s+(\d{1,2})\s+ימים$/u.exec(t);
  if (ago) return done(shift(-Number(ago[1])));

  // weekday name → most recent (today included)
  const wd = HEBREW_WEEKDAYS.findIndex((names) => names.some((n) => t === n || t === `יום ${n}`));
  if (wd !== -1) {
    const todayDow = base.getUTCDay();
    return done(shift(-((todayDow - wd + 7) % 7)));
  }

  // ISO
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return validDate(+m[1], +m[2], +m[3]) ? done(t) : { error: `התאריך "${text}" לא תקין.` };

  // DD/MM[/YY|YYYY] with / . or -
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const day = +m[1];
    const month = +m[2];
    let year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
    // no year and in the future: far ahead ("15/12" written in January) → last year;
    // a few weeks ahead is more likely a mistake → rejected below as "not yet"
    if (!m[3] && isoOf(year, month, day) > today && diffDays(isoOf(year, month, day), today) > 60) year -= 1;
    if (!validDate(year, month, day)) return { error: `התאריך "${text}" לא תקין.` };
    return done(isoOf(year, month, day));
  }
  return { error: `לא הצלחתי להבין את התאריך "${text}".` };
}

function isoOf(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function hebrewWeekday(iso) { return `יום ${HEBREW_WEEKDAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()]}`; }
function formatDateHebrewShort(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }

module.exports = {
  resolveHebrewDate,
  hebrewWeekday,
  formatDateHebrewShort,
  isoWeekKey,
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
