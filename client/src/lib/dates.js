import { format, parseISO, differenceInDays, isValid } from 'date-fns';
import { he } from 'date-fns/locale';

/**
 * Parse an ISO date string or Date object safely.
 * Returns null if input is falsy or invalid.
 */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

/**
 * Format a date for display: "DD/MM/YYYY"
 */
export function formatDateHebrew(value) {
  const d = parseDate(value);
  if (!d) return '';
  return format(d, 'dd/MM/yyyy');
}

/**
 * Format a date with Hebrew day name: "יום ג׳, 15/04/2026"
 */
export function formatDateFull(value) {
  const d = parseDate(value);
  if (!d) return '';
  return format(d, "EEEE, dd/MM/yyyy", { locale: he });
}

/**
 * How many days from today until the given date.
 * Positive = future, negative = past.
 */
export function daysUntil(value) {
  const d = parseDate(value);
  if (!d) return null;
  return differenceInDays(d, new Date());
}

/**
 * Format a time from a stored ISO string using Israel timezone.
 * Always pass timeZone explicitly so the output is correct both
 * locally and on Railway (UTC servers).
 */
export function formatTimeHebrew(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
}

/**
 * Human-readable relative label in Hebrew.
 * e.g. "היום", "מחר", "בעוד 3 ימים", "לפני 5 ימים"
 */
export function relativeLabel(value) {
  const days = daysUntil(value);
  if (days === null) return '';
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === -1) return 'אתמול';
  if (days > 1) return `בעוד ${days} ימים`;
  return `לפני ${Math.abs(days)} ימים`;
}

const BUSINESS_TZ = 'Asia/Jerusalem';

/**
 * Israel calendar date "YYYY-MM-DD" of a stored instant (meetings.start_time is
 * UTC ISO — slicing the string would give the UTC day, wrong late in the evening).
 * Date-only strings pass through unchanged.
 */
export function israelDateOf(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ }); // en-CA → YYYY-MM-DD
}

/** Israel wall-clock "HH:MM" (24h) of a stored instant — for edit forms. */
export function israelTimeOf(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BUSINESS_TZ });
}

/** Today's date in Israel, "YYYY-MM-DD". */
export function todayIsraelISO() {
  return israelDateOf(new Date().toISOString());
}
