const { google } = require('googleapis');
const db = require('../database/db');

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

// ── syncCanceledEvents ────────────────────────────────────────────────────────
// Polls Google Calendar for events that were deleted/canceled there,
// and marks them as canceled in our DB. Runs every 30 minutes.

async function syncCanceledEvents() {
  if (!googleEnabled || !isConnected()) return 0;

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Only check recent active events that have a Google event ID
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const events = db.prepare(`
      SELECT id, google_event_id FROM calendly_events
      WHERE status = 'active'
        AND google_event_id IS NOT NULL
        AND start_time > ?
    `).all(cutoff);

    let canceledCount = 0;

    for (const ev of events) {
      try {
        const res = await calendar.events.get({
          calendarId: 'primary',
          eventId:    ev.google_event_id,
        });

        if (res.data.status === 'cancelled') {
          db.prepare("UPDATE calendly_events SET status = 'canceled' WHERE id = ?").run(ev.id);
          console.log(`[google] Event canceled in Google Calendar: ${ev.google_event_id}`);
          canceledCount++;
        }
      } catch (err) {
        // 404 = deleted from Google Calendar
        if (err.code === 404 || err.status === 404) {
          db.prepare("UPDATE calendly_events SET status = 'canceled' WHERE id = ?").run(ev.id);
          console.log(`[google] Event deleted in Google Calendar: ${ev.google_event_id}`);
          canceledCount++;
        }
        // Other errors (network, rate limit) — skip this event silently
      }
    }

    if (canceledCount > 0) {
      console.log(`[google] Sync complete — ${canceledCount} event(s) marked canceled`);
    }

    return canceledCount;
  } catch (err) {
    console.error('[google] syncCanceledEvents error:', err.message);
    return 0;
  }
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  loadStoredToken,
  isConnected,
  createCalendarEvent,
  deleteCalendarEvent,
  syncCanceledEvents,
};
