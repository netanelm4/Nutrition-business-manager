const { israelLocalToUtcISO, addHoursUtcISO } = require('../utils/dates');
const { createCalendarEvent } = require('./google-calendar.service');
const { scheduleSessionForEvent } = require('./session-lifecycle.service');
const { publish } = require('./event-bus.service');

// ─── Create a meeting from the CRM (lead or client) ─────────────────────────
// One implementation for POST /api/leads/:id/meeting and the agent's
// schedule_meeting proposal: store the meeting (canonical UTC), push it to
// Google Calendar when connected, and for a client follow-up create the
// scheduled session it belongs to.

const MEETING_DURATION_HOURS = 1;

/**
 * @param {object} p  { leadId?, clientId?, date: "YYYY-MM-DD", time: "HH:MM" (Israel), eventType, notes? }
 * @returns {Promise<{ id: string, startTime: string, googleEventId: string|null }>}
 */
async function createManualMeeting(database, { leadId = null, clientId = null, date, time, eventType, notes = null }) {
  if (!leadId && !clientId) throw Object.assign(new Error('leadId or clientId is required.'), { status: 400 });
  const person = clientId
    ? database.prepare('SELECT id, full_name, phone FROM clients WHERE id = ?').get(clientId)
    : database.prepare('SELECT id, full_name, phone FROM leads WHERE id = ?').get(leadId);
  if (!person) throw Object.assign(new Error(clientId ? 'Client not found.' : 'Lead not found.'), { status: 404 });

  const startTime = israelLocalToUtcISO(date, time);
  if (!startTime) throw Object.assign(new Error('Invalid date or time.'), { status: 400 });
  const endTime = addHoursUtcISO(MEETING_DURATION_HOURS, new Date(startTime));
  const id = `manual_${Date.now()}_${clientId ? `c${clientId}` : leadId}`;

  const engagementId = clientId
    ? database.prepare("SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1").get(clientId)?.id ?? null
    : null;

  database.prepare(`
    INSERT INTO meetings
      (id, client_id, lead_id, event_type, invitee_name, invitee_phone,
       start_time, end_time, status, source, notes, engagement_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'manual', ?, ?)
  `).run(id, clientId, clientId ? null : leadId, eventType, person.full_name, person.phone || null,
         startTime, endTime, notes, engagementId);

  if (clientId && eventType === 'follow_up') {
    scheduleSessionForEvent(database, { clientId, eventId: id, startTime, engagementId });
  }

  let googleEventId = null;
  try {
    const gcal = await createCalendarEvent({
      title: `פגישה עם ${person.full_name}`, startTime, endTime, description: notes || '', location: '',
    });
    if (gcal.success && gcal.eventId) {
      googleEventId = gcal.eventId;
      database.prepare('UPDATE meetings SET google_event_id = ? WHERE id = ?').run(gcal.eventId, id);
    } else if (gcal.error !== 'not_connected' && gcal.error !== 'not_configured') {
      console.error('[google] createCalendarEvent failed:', gcal.error);
    }
  } catch (err) {
    console.error('[google] Unexpected error creating calendar event:', err.message);
  }

  publish(database, 'meeting.created', { entityType: 'meeting', entityId: id, payload: { leadId, clientId, startTime } });
  return { id, startTime, googleEventId };
}

module.exports = { createManualMeeting };
