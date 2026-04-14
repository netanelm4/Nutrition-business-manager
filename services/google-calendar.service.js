const { google } = require('googleapis');
const db = require('../database/db');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// ── OAuth2 client (singleton) ─────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

// ── getAuthUrl ────────────────────────────────────────────────────────────────

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

// ── exchangeCode ──────────────────────────────────────────────────────────────

async function exchangeCode(code) {
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

// ── deleteCalendarEvent ───────────────────────────────────────────────────────

async function deleteCalendarEvent(eventId) {
  if (!eventId) return { success: true };

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

module.exports = {
  getAuthUrl,
  exchangeCode,
  loadStoredToken,
  isConnected,
  createCalendarEvent,
  deleteCalendarEvent,
};
