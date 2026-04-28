const { google } = require('googleapis');
const db = require('../database/db');

// Last successful poll timestamp — initialized lazily to (now - 10 min) on first run
let lastPollTime = null;

// ── normalizePhone ────────────────────────────────────────────────────────────
// Mirrors normalizePhoneForDB in calendly.routes.js — 05XXXXXXXXX format
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

// ── pollNewBookings ───────────────────────────────────────────────────────────
// Runs every 5 minutes. Fetches Google Calendar events updated since the last
// poll, inserts new bookings into calendly_events, and matches them to clients.
async function pollNewBookings() {
  console.log('[poll] running at', new Date().toISOString());
  console.log('[poll] lastPollTime:', lastPollTime);

  if (!googleEnabled) { console.log('[poll] SKIP: google not enabled'); return; }
  if (!isConnected())  { console.log('[poll] SKIP: not connected (no refresh token)'); return; }

  try {
    const now   = new Date();
    const since = lastPollTime || new Date(Date.now() - 10 * 60 * 1000);
    lastPollTime = now;
    console.log('[poll] querying events updated since:', since.toISOString());

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const res = await calendar.events.list({
      calendarId:   'primary',
      updatedMin:   since.toISOString(),
      singleEvents: true,
      orderBy:      'updated',
      maxResults:   50,
    });

    const events = res.data.items || [];
    console.log('[poll] events found:', events.length);
    let inserted = 0;

    for (const event of events) {
      console.log(`[poll] event: id=${event.id} summary="${event.summary}" status=${event.status} start=${event.start?.dateTime || event.start?.date || 'none'}`);
      console.log(`[poll] description: ${JSON.stringify(event.description || '')}`);

      if (event.status === 'cancelled') {
        console.log('[poll] SKIP: cancelled');
        continue;
      }
      if (!event.start?.dateTime) {
        console.log('[poll] SKIP: no dateTime (all-day or task)');
        continue;
      }

      // Deduplication — skip if already stored
      const existing = db.prepare(
        'SELECT id FROM calendly_events WHERE google_event_id = ?'
      ).get(event.id);
      if (existing) {
        console.log('[poll] SKIP: already in DB');
        continue;
      }

      // Extract contact info from "Booked by" block in description
      const { name, email, phone } = parseBookedBy(event.description || '');
      console.log(`[poll] parsed — name="${name}" email="${email}" phone="${phone}"`);

      // Fall back to attendees array for email
      const clientAttendee = (event.attendees || []).find((a) => !a.organizer && !a.self);
      const resolvedEmail = email || clientAttendee?.email || '';
      const resolvedName  = name  || clientAttendee?.displayName || '';
      const resolvedPhone = normalizePhone(phone);
      console.log(`[poll] resolved — name="${resolvedName}" email="${resolvedEmail}" phone="${resolvedPhone}"`);

      // Detect event type from summary
      const summary = event.summary || '';
      const event_type = /ראשונ|first/i.test(summary) ? 'first_meeting' : 'follow_up';
      console.log(`[poll] event_type: ${event_type}`);

      // Match client: email first, then phone
      let client_id = null;
      let lead_id   = null;

      if (resolvedEmail) {
        try {
          const row = db.prepare(
            "SELECT id FROM clients WHERE email = ? AND status != 'ended' LIMIT 1"
          ).get(resolvedEmail);
          if (row) { client_id = row.id; console.log(`[poll] matched client by email: id=${client_id}`); }
        } catch { /* clients table may not have email column */ }
      }
      if (!client_id && resolvedPhone) {
        const all = db.prepare("SELECT id, phone FROM clients WHERE status != 'ended'").all();
        const match = all.find((c) => normalizePhone(c.phone) === resolvedPhone);
        if (match) { client_id = match.id; console.log(`[poll] matched client by phone: id=${client_id}`); }
      }

      // Fall back to leads
      if (!client_id) {
        if (resolvedEmail) {
          try {
            const row = db.prepare('SELECT id FROM leads WHERE email = ? LIMIT 1').get(resolvedEmail);
            if (row) { lead_id = row.id; console.log(`[poll] matched lead by email: id=${lead_id}`); }
          } catch { /* safe */ }
        }
        if (!lead_id && resolvedPhone) {
          const all = db.prepare('SELECT id, phone FROM leads').all();
          const match = all.find((l) => normalizePhone(l.phone) === resolvedPhone);
          if (match) { lead_id = match.id; console.log(`[poll] matched lead by phone: id=${lead_id}`); }
        }
      }

      // Auto-create lead for unmatched first_meeting bookings
      if (!client_id && !lead_id && event_type === 'first_meeting') {
        if (resolvedName || resolvedEmail || resolvedPhone) {
          const r = db.prepare(
            'INSERT INTO leads (full_name, phone, email, source, status) VALUES (?, ?, ?, ?, ?)'
          ).run(
            resolvedName || 'לא ידוע',
            resolvedPhone || null,
            resolvedEmail || null,
            'google_calendar',
            'meeting_scheduled',
          );
          lead_id = r.lastInsertRowid;
          console.log(`[poll] CREATED LEAD: ${resolvedName} — ${resolvedEmail} — ${resolvedPhone}`);
        } else {
          console.log('[poll] no client/lead match and no contact info — inserting unlinked');
        }
      } else if (!client_id && !lead_id) {
        console.log('[poll] no client/lead match — inserting unlinked');
      }

      const start_time = event.start.dateTime;
      const end_time   = event.end?.dateTime || '';

      db.prepare(`
        INSERT OR IGNORE INTO calendly_events
          (id, client_id, lead_id, event_type, invitee_name, invitee_phone,
           invitee_email, start_time, end_time, status, google_event_id, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'google_calendar')
      `).run(
        event.id, client_id, lead_id, event_type,
        resolvedName, resolvedPhone || null, resolvedEmail || null,
        start_time, end_time, event.id,
      );

      // Auto-create session for matched clients booking a follow-up
      if (client_id && event_type === 'follow_up') {
        const nextWindow = db.prepare(`
          SELECT w.session_number
          FROM   session_windows w
          LEFT JOIN sessions s
            ON s.client_id = w.client_id AND s.session_number = w.session_number
          WHERE  w.client_id = ? AND s.id IS NULL
          ORDER  BY w.session_number ASC
          LIMIT  1
        `).get(client_id);

        if (nextWindow) {
          db.prepare(`
            INSERT OR IGNORE INTO sessions (client_id, session_number, session_date, highlights)
            VALUES (?, ?, ?, '')
          `).run(client_id, nextWindow.session_number, start_time);
          console.log(`[google-poll] Created session ${nextWindow.session_number} for client ${client_id}`);
        }
      }

      inserted++;
      console.log(`[poll] INSERTED: ${resolvedName} (${event_type}) — ${resolvedPhone || resolvedEmail || 'no contact'} — ${start_time}`);
    }

    console.log(`[poll] done — checked ${events.length} event(s), inserted ${inserted}`);
  } catch (err) {
    console.error('[poll] ERROR:', err.message);
    console.error(err.stack);
  }
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  loadStoredToken,
  isConnected,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  syncCanceledEvents,
  pollNewBookings,
};
