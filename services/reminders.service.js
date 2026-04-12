const db = require('../database/db');
const { renderTemplate, generateLink } = require('./whatsapp.service');

/**
 * Find calendly events starting in 23-25 hours that haven't had a
 * confirmation link generated yet.  For each one, render the
 * session_confirmation WhatsApp template, generate a wa.me deeplink,
 * store it in the DB, and mark confirmation_sent = 1.
 *
 * Returns the number of confirmation links generated this run.
 */
function checkUpcomingReminders() {
  const events = db.prepare(`
    SELECT
      ce.*,
      COALESCE(ce.invitee_phone, c.phone, l.phone) AS phone_for_wa
    FROM   calendly_events ce
    LEFT JOIN clients c ON ce.client_id = c.id
    LEFT JOIN leads   l ON ce.lead_id   = l.id
    WHERE  ce.status = 'active'
      AND  ce.confirmation_sent = 0
      AND  ce.start_time BETWEEN datetime('now', '+23 hours')
                             AND datetime('now', '+25 hours')
  `).all();

  if (events.length === 0) return 0;

  const template = db.prepare(`
    SELECT body_template
    FROM   whatsapp_templates
    WHERE  trigger_event = 'session_confirmation' AND is_active = 1
    LIMIT  1
  `).get();

  let count = 0;

  for (const event of events) {
    const phone = event.phone_for_wa;
    if (!phone || !template) continue;

    const startTime = new Date(event.start_time);
    const date = startTime.toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const time = startTime.toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit',
    });

    const message = renderTemplate(template.body_template, {
      client_name: event.invitee_name,
      date,
      time,
    });

    const link = generateLink(phone, message);

    db.prepare(`
      UPDATE calendly_events
      SET    confirmation_sent = 1, confirmation_link = ?
      WHERE  id = ?
    `).run(link, event.id);

    count++;
    console.log(`[reminders] Confirmation link generated for ${event.invitee_name} on ${date} at ${time}`);
  }

  return count;
}

module.exports = { checkUpcomingReminders };
