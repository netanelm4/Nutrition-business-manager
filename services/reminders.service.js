const { renderTemplate, generateLink, normalisePhone } = require('./whatsapp.service');
const { sendWhatsAppMessage, sendWhatsAppTemplate, canAutoSend } = require('./whatsapp-send.service');
const { upsertAction } = require('./action-queue.service');
const { publish } = require('./event-bus.service');
const { nowUtcISO, BUSINESS_TZ } = require('../utils/dates');

// ─── 24h meeting confirmation (run by the meeting_reminder_24h job) ──────────
// Automated when the WhatsApp Cloud API is available (decision: 24h reminders
// are sent without approval). Business-initiated messages need an approved
// template → WHATSAPP_REMINDER_TEMPLATE (body params: name, date, time).
// When automatic sending is not possible, or fails, the reminder becomes an
// urgent inbox item with a one-click wa.me link.

const DEFAULT_BODY =
  'היי {{client_name}},\nרציתי לאשר את הפגישה שלנו מחר {{date}} בשעה {{time}}.\nאשמח לאישור הגעה.\nאם צריך לשנות, נדבר.';

function israelDateTime(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BUSINESS_TZ }),
    time: d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ }),
  };
}

/**
 * Send (or queue for one-click sending) the confirmation for one meeting.
 * @returns {{ sent?: true, queued?: true, skipped?: string }}
 */
async function sendMeetingReminder(database, meetingId) {
  const m = database.prepare(`
    SELECT m.*,
           COALESCE(m.invitee_phone, c.phone, l.phone)        AS phone_for_wa,
           COALESCE(c.full_name, l.full_name, m.invitee_name) AS person_name
    FROM meetings m
    LEFT JOIN clients c ON c.id = m.client_id
    LEFT JOIN leads   l ON l.id = m.lead_id
    WHERE m.id = ?
  `).get(meetingId);

  if (!m) return { skipped: 'missing' };
  if (m.status !== 'active') return { skipped: 'not_active' };
  if (m.confirmation_sent) return { skipped: 'already_sent' };
  if (m.start_time <= nowUtcISO()) return { skipped: 'started' };
  if (!m.phone_for_wa) return { skipped: 'no_phone' };

  const { date, time } = israelDateTime(m.start_time);
  const name = m.person_name || '';
  const template = database.prepare(
    "SELECT body_template FROM whatsapp_templates WHERE trigger_event = 'session_confirmation' AND is_active = 1 LIMIT 1"
  ).get();
  const message = renderTemplate(template?.body_template || DEFAULT_BODY, { client_name: name, date, time });

  let sendError = null;
  if (canAutoSend()) {
    try {
      const to = normalisePhone(m.phone_for_wa);
      const approvedTemplate = process.env.WHATSAPP_REMINDER_TEMPLATE;
      if (approvedTemplate) {
        await sendWhatsAppTemplate(to, approvedTemplate, [name, date, time], process.env.WHATSAPP_TEMPLATE_LANG || 'he');
      } else {
        await sendWhatsAppMessage(to, message);
      }
      database.prepare('UPDATE meetings SET confirmation_sent = 1, confirmation_link = NULL WHERE id = ?').run(m.id);
      if (m.client_id) {
        database.prepare(`
          INSERT INTO whatsapp_log (client_id, rendered_message, direction, message_type, status)
          VALUES (?, ?, 'outgoing', 'meeting_reminder', 'sent')
        `).run(m.client_id, message);
      }
      publish(database, 'reminder.sent', { entityType: 'meeting', entityId: m.id, payload: { name, date, time } });
      return { sent: true };
    } catch (err) {
      sendError = err.message;
      console.warn(`[reminders] Auto-send failed for meeting ${m.id}: ${err.message} — queued in inbox`);
    }
  }

  // Fallback: one-click inbox item
  const link = generateLink(m.phone_for_wa, message);
  database.prepare('UPDATE meetings SET confirmation_link = ? WHERE id = ?').run(link, m.id);
  upsertAction(database, {
    kind: 'meeting_reminder',
    category: 'message',
    dedupeKey: `meeting_reminder:meeting:${m.id}:${m.start_time}`,
    title: `אישור הגעה: ${name}, ${date} ${time}`,
    body: sendError ? `שליחה אוטומטית נכשלה: ${sendError}` : 'תזכורת 24 שעות לפני הפגישה',
    clientId: m.client_id,
    leadId: m.client_id ? null : m.lead_id,
    meetingId: m.id,
    phone: m.phone_for_wa,
    message,
    priority: 'urgent',
    source: 'job',
  });
  return { queued: true, error: sendError };
}

module.exports = { sendMeetingReminder };
