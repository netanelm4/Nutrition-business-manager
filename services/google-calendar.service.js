const { google } = require('googleapis');
const db = require('../database/db');
const { toUtcISO, nowUtcISO, addHoursUtcISO } = require('../utils/dates');
const {
  cancelSessionsForEvent, rescheduleSessionsForEvent, scheduleSessionForEvent,
} = require('./session-lifecycle.service');
const { publish } = require('./event-bus.service');


// ── normalizePhone ────────────────────────────────────────────────────────────
// Israeli local format 05XXXXXXXX, used to match bookings to clients/leads
function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  if (digits.startsWith('0')) return digits;
  return digits;
}

// ── parseBookedBy ─────────────────────────────────────────────────────────────
// Extracts name, email, phone from the "Booked by" block in event description.
// Handles: HTML tags (<b>Booked by</b>), RTL/LTR unicode marks, and markdown
// email links ([addr](mailto:addr)).
function parseBookedBy(description) {
  if (!description) return { name: '', email: '', phone: '' };

  // 1. Strip HTML tags
  const noHtml = description.replace(/<[^>]+>/g, '');

  // 2. Strip RTL/LTR unicode directional control characters
  const plain = noHtml.replace(/[‎‏‪‫‬]/g, '');

  const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => /^booked by$/i.test(l));
  if (idx === -1) return { name: '', email: '', phone: '' };

  const block = lines.slice(idx + 1, idx + 10);
  const name  = block[0] || '';

  // 3. Extract email — handles [text](mailto:addr) or plain addr@domain
  const emailLine = block.find((l) => l.includes('@')) || '';
  const markdownMatch = emailLine.match(/\[.*?\]\(mailto:([^)]+)\)/);
  const email = markdownMatch ? markdownMatch[1] : emailLine;

  const phone = block.find(
    (l) => /^[\d\s\-()+]+$/.test(l) && l.replace(/\D/g, '').length >= 9
  ) || '';

  return { name, email, phone };
}

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// ── Guard: skip all Google functionality if credentials not configured ─────────

const googleEnabled = !!(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET
);

if (!googleEnabled) {
  console.log('[google] Google Calendar not configured — skipping');
}

// ── OAuth2 client (singleton) ─────────────────────────────────────────────────

const oauth2Client = googleEnabled
  ? new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    )
  : null;

// ── getAuthUrl ────────────────────────────────────────────────────────────────

function getAuthUrl() {
  if (!googleEnabled) return null;
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

// ── exchangeCode ──────────────────────────────────────────────────────────────

async function exchangeCode(code) {
  if (!googleEnabled) return { success: false, error: 'not_configured' };
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (tokens.refresh_token) {
    db.prepare(
      'UPDATE settings SET google_refresh_token = ?, google_connected = 1 WHERE id = 1'
    ).run(tokens.refresh_token);
    console.log('[google] Refresh token saved to DB.');
  } else {
    // No refresh_token returned — mark connected anyway (access_token reuse)
    db.prepare('UPDATE settings SET google_connected = 1 WHERE id = 1').run();
    console.log('[google] Connected (no new refresh_token — may already exist).');
  }

  return { success: true };
}

// ── loadStoredToken ───────────────────────────────────────────────────────────

async function loadStoredToken() {
  if (!googleEnabled) return;
  const row = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1').get();
  if (!row?.google_refresh_token) return;

  oauth2Client.setCredentials({ refresh_token: row.google_refresh_token });
  console.log('[google] Loaded stored refresh token.');
}

// ── isConnected ───────────────────────────────────────────────────────────────

function isConnected() {
  try {
    const row = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1').get();
    return !!(row?.google_refresh_token);
  } catch {
    return false;
  }
}

// ── createCalendarEvent ───────────────────────────────────────────────────────

async function createCalendarEvent({ title, startTime, endTime, description = '', location = '' }) {
  if (!googleEnabled) return { success: false, error: 'not_configured' };
  if (!isConnected()) {
    return { success: false, error: 'not_connected' };
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: title,
      description,
      location,
      start: { dateTime: startTime, timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: endTime,   timeZone: 'Asia/Jerusalem' },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    return {
      success: true,
      eventId:  response.data.id,
      htmlLink: response.data.htmlLink,
    };
  } catch (err) {
    console.error('[google] createCalendarEvent error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── updateCalendarEvent ───────────────────────────────────────────────────────

async function updateCalendarEvent(eventId, { title, startTime, endTime, description = '' }) {
  if (!googleEnabled || !eventId) return { success: false, error: 'not_configured' };
  if (!isConnected()) return { success: false, error: 'not_connected' };

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: title,
      description,
      start: { dateTime: startTime, timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: endTime,   timeZone: 'Asia/Jerusalem' },
    };

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId,
      resource: event,
    });

    return { success: true, eventId: response.data.id };
  } catch (err) {
    console.error('[google] updateCalendarEvent error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── deleteCalendarEvent ───────────────────────────────────────────────────────

async function deleteCalendarEvent(eventId) {
  if (!googleEnabled || !eventId) return { success: true };

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    return { success: true };
  } catch (err) {
    // 404 = already deleted — treat as success
    if (err.code === 404 || err.status === 404) return { success: true };
    console.error('[google] deleteCalendarEvent error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Incremental sync (Google Calendar is the single scheduling source)
//
// events.list with a syncToken returns every event created, changed or
// cancelled since the previous sync — bookings, reschedules and cancellations
// in one pass. The token lives in settings.google_sync_token, so restarts and
// deploys lose nothing. It is saved only after all changes were applied; on
// 410 (token expired) we fall back to a full sync of the last
// SYNC_LOOKBACK_DAYS days. All instants are stored as canonical UTC ISO.
// ─────────────────────────────────────────────────────────────────────────────

const SYNC_LOOKBACK_DAYS = 30;
const BOOKING_MARKER = /booked by/i; // Google appointment-scheduling bookings
let syncInProgress = false;

function findClientByPhone(database, phone) {
  if (!phone) return null;
  const all = database.prepare("SELECT id, phone FROM clients WHERE status != 'ended'").all();
  return all.find((c) => normalizePhone(c.phone) === phone) || null;
}

function findLead(database, { email, phone }) {
  if (email) {
    const byEmail = database.prepare('SELECT id, status FROM leads WHERE email = ? LIMIT 1').get(email);
    if (byEmail) return byEmail;
  }
  if (phone) {
    const all = database.prepare('SELECT id, status, phone FROM leads').all();
    return all.find((l) => normalizePhone(l.phone) === phone) || null;
  }
  return null;
}

/**
 * Apply one changed Google event to the DB.
 * @returns {'created'|'updated'|'canceled'|'ignored'}
 */
function processCalendarEvent(database, event) {
  const existing = database.prepare('SELECT * FROM meetings WHERE google_event_id = ?').get(event.id);

  // ── Cancelled (deleted in Google, or the client cancelled the booking) ──────
  if (event.status === 'cancelled') {
    if (!existing || existing.status === 'canceled') return 'ignored';
    database.prepare("UPDATE meetings SET status = 'canceled' WHERE id = ?").run(existing.id);
    cancelSessionsForEvent(database, existing);
    console.log(`[google-sync] Canceled meeting ${existing.id} (${existing.invitee_name || ''})`);
    return 'canceled';
  }

  if (!event.start?.dateTime) return 'ignored'; // all-day events are not meetings
  const startTime = toUtcISO(event.start.dateTime);
  const endTime   = toUtcISO(event.end?.dateTime) || null;
  if (!startTime) return 'ignored';

  // ── Known meeting (a booking we stored, or a meeting the CRM created) ───────
  if (existing) {
    if (existing.status === 'canceled') return 'ignored';
    if (existing.start_time === startTime && existing.end_time === endTime) return 'ignored';
    database.prepare(`
      UPDATE meetings SET start_time = ?, end_time = ?, confirmation_sent = 0, confirmation_link = NULL
      WHERE id = ?
    `).run(startTime, endTime, existing.id);
    rescheduleSessionsForEvent(database, existing.id, startTime);
    console.log(`[google-sync] Rescheduled meeting ${existing.id}: ${existing.start_time} → ${startTime}`);
    return 'updated';
  }

  // ── New booking from an appointment-scheduling page ─────────────────────────
  if (!BOOKING_MARKER.test(event.description || '')) return 'ignored';

  const { name, email, phone } = parseBookedBy(event.description || '');
  const attendee = (event.attendees || []).find((a) => !a.organizer && !a.self);
  const resolvedEmail = email || attendee?.email || '';
  const resolvedName  = name  || attendee?.displayName || '';
  const resolvedPhone = normalizePhone(phone);
  const eventType = /ראשונ|first/i.test(event.summary || '') ? 'first_meeting' : 'follow_up';

  const client = findClientByPhone(database, resolvedPhone);
  let leadId = null;
  if (!client) {
    const lead = findLead(database, { email: resolvedEmail, phone: resolvedPhone });
    if (lead) {
      leadId = lead.id;
      if (['new', 'contacted'].includes(lead.status)) {
        database.prepare("UPDATE leads SET status = 'meeting_scheduled', status_updated_at = ? WHERE id = ?")
          .run(nowUtcISO(), lead.id);
      }
    } else if (eventType === 'first_meeting' && (resolvedName || resolvedEmail || resolvedPhone)) {
      leadId = database.prepare(
        "INSERT INTO leads (full_name, phone, email, source, status) VALUES (?, ?, ?, 'google_calendar', 'meeting_scheduled')"
      ).run(resolvedName || 'לא ידוע', resolvedPhone || null, resolvedEmail || null).lastInsertRowid;
      console.log(`[google-sync] Created lead ${leadId}: ${resolvedName} (${resolvedPhone || resolvedEmail})`);
    }
  }

  const engagementId = client
    ? database.prepare("SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1").get(client.id)?.id ?? null
    : null;

  database.prepare(`
    INSERT OR IGNORE INTO meetings
      (id, client_id, lead_id, event_type, invitee_name, invitee_phone,
       invitee_email, start_time, end_time, status, google_event_id, source, engagement_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'google_calendar', ?)
  `).run(
    event.id, client?.id ?? null, leadId, eventType,
    resolvedName, resolvedPhone || null, resolvedEmail || null,
    startTime, endTime, event.id, engagementId,
  );

  if (client && eventType === 'follow_up') {
    scheduleSessionForEvent(database, { clientId: client.id, eventId: event.id, startTime, engagementId });
  }
  console.log(`[google-sync] New booking: ${resolvedName} (${eventType}) — ${startTime}`);
  return 'created';
}

async function listAllEvents(calendar, params) {
  const items = [];
  let pageToken;
  let nextSyncToken = null;
  do {
    const res = await calendar.events.list({
      calendarId: 'primary', singleEvents: true, maxResults: 250, ...params, pageToken,
    });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

/**
 * Run one sync pass. `listEvents(params)` can be injected (tests); by default
 * it calls the Google Calendar API with the stored OAuth credentials.
 */
async function syncGoogleCalendar({ listEvents, database = db } = {}) {
  if (!listEvents) {
    if (!googleEnabled || !isConnected()) return { skipped: 'not_connected' };
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    listEvents = (params) => listAllEvents(calendar, params);
  }
  if (syncInProgress) return { skipped: 'in_progress' };
  syncInProgress = true;

  try {
    database.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
    const token = database.prepare('SELECT google_sync_token FROM settings WHERE id = 1').get()?.google_sync_token;
    const fullParams = { timeMin: addHoursUtcISO(-24 * SYNC_LOOKBACK_DAYS) };

    let mode = token ? 'incremental' : 'full';
    let result;
    try {
      result = await listEvents(token ? { syncToken: token } : fullParams);
    } catch (err) {
      if (token && (err.code === 410 || err.status === 410)) {
        console.warn('[google-sync] Sync token expired (410) — running a full sync');
        mode = 'full';
        result = await listEvents(fullParams);
      } else {
        throw err;
      }
    }

    const stats = { mode, received: result.items.length, created: 0, updated: 0, canceled: 0, ignored: 0 };
    database.transaction(() => {
      for (const event of result.items) stats[processCalendarEvent(database, event)]++;
      if (result.nextSyncToken) {
        database.prepare('UPDATE settings SET google_sync_token = ?, google_last_sync_at = ? WHERE id = 1')
          .run(result.nextSyncToken, nowUtcISO());
      }
    })();

    if (stats.created || stats.updated || stats.canceled) {
      publish(database, 'meeting.synced', { payload: stats });
      console.log(`[google-sync] ${mode}: +${stats.created} new, ${stats.updated} rescheduled, ${stats.canceled} canceled`);
    }
    return stats;
  } catch (err) {
    console.error('[google-sync] ERROR:', err.message);
    return { error: err.message };
  } finally {
    syncInProgress = false;
  }
}

/** Forget the sync position (e.g. after disconnecting the account). */
function resetSyncState(database = db) {
  database.prepare('UPDATE settings SET google_sync_token = NULL, google_last_sync_at = NULL WHERE id = 1').run();
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  loadStoredToken,
  isConnected,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  syncGoogleCalendar,
  processCalendarEvent,
  resetSyncState,
  parseBookedBy,
  normalizePhone,
};
