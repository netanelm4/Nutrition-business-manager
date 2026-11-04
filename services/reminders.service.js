const db = require('../database/db');
const { renderTemplate, generateLink } = require('./whatsapp.service');
const { addHoursUtcISO, BUSINESS_TZ } = require('../utils/dates');

/**
 * Find meetings starting in 23–25 hours that have no confirmation link yet.
 * For each one, render the session_confirmation WhatsApp template, generate a
 * wa.me deeplink, store it, and mark confirmation_sent = 1.
 *
 * meetings.start_time is canonical UTC ISO, so the window bounds are UTC ISO
 * strings too (a plain string BETWEEN is chronological for that format).
 * The date/time shown in the message is Israel local time.
 *
 * Returns the number of confirmation links generated this run.
 */
function checkUpcomingReminders() {
  const events = db.prepare(`
    SELECT
      m.*,
      COALESCE(m.invitee_phone, c.phone, l.phone)        AS phone_for_wa,
      COALESCE(c.full_name, l.full_name, m.invitee_name) AS person_name
    FROM   meetings m
    LEFT JOIN clients c ON m.client_id = c.id
    LEFT JOIN leads   l ON m.lead_id   = l.id
    WHERE  m.status = 'active'
      AND  m.confirmation_sent = 0
      AND  m.start_time BETWEEN ? AND ?
  `).all(addHoursUtcISO(23), addHoursUtcISO(25));

  if (events.length === 0) return 0;

  const template = db.prepare(`
    SELECT body_template
    FROM   whatsapp_templates
    WHERE  trigger_event = 'session_confirmation' AND is_active = 1
    LIMIT  1
  `).get();
  if (!template) return 0;

  let count = 0;
  for (const event of events) {
    const phone = event.phone_for_wa;
    if (!phone) continue;

    const startTime = new Date(event.start_time);
    const date = startTime.toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BUSINESS_TZ,
    });
    const time = startTime.toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ,
    });

    const message = renderTemplate(template.body_template, {
      client_name: event.person_name || event.invitee_name,
      date,
      time,
    });

    db.prepare(`
      UPDATE meetings
      SET    confirmation_sent = 1, confirmation_link = ?
      WHERE  id = ?
    `).run(generateLink(phone, message), event.id);

    count++;
    console.log(`[reminders] Confirmation link generated for ${event.person_name || event.invitee_name} on ${date} at ${time}`);
  }
  return count;
}

module.exports = { checkUpcomingReminders };
