// ─── WhatsApp Cloud API — send outbound message ───────────────────────────────
//
// Business-initiated messages outside the 24h customer-service window must be
// approved *template* messages (free text is rejected with error 131047).
// Automated reminders therefore use sendWhatsAppTemplate() when
// WHATSAPP_REMINDER_TEMPLATE is configured, and fall back to an Inbox item
// (one-click wa.me) when sending is unavailable or fails.

const GRAPH_URL = 'https://graph.facebook.com/v19.0';

function credentials() {
  const phoneId     = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  return phoneId && accessToken ? { phoneId, accessToken } : null;
}

/**
 * True when the CRM may send WhatsApp messages by itself: Cloud API
 * credentials are set and WHATSAPP_MODE is not "deeplink" (manual wa.me mode).
 */
function canAutoSend() {
  return !!credentials() && (process.env.WHATSAPP_MODE || 'deeplink') !== 'deeplink';
}

async function postMessage(body) {
  const creds = credentials();
  if (!creds) {
    console.warn('[whatsapp-send] WHATSAPP_PHONE_ID or WHATSAPP_ACCESS_TOKEN not set — skipping send');
    return null;
  }
  const res = await fetch(`${GRAPH_URL}/${creds.phoneId}/messages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.accessToken}` },
    body:    JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('[whatsapp-send] API error:', JSON.stringify(json));
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }
  return json;
}

async function sendWhatsAppMessage(to_phone, message_text) {
  const json = await postMessage({ to: to_phone, type: 'text', text: { body: message_text } });
  if (json) console.log(`[whatsapp-send] sent to ${to_phone}: "${message_text.slice(0, 60)}..."`);
  return json;
}

/**
 * Send an approved template message.
 * @param {string}   to_phone      E.164 digits without "+"
 * @param {string}   templateName  name approved in Meta Business Manager
 * @param {string[]} params        body parameters {{1}}, {{2}}, ...
 * @param {string}   [language]    template language code (default "he")
 */
async function sendWhatsAppTemplate(to_phone, templateName, params = [], language = 'he') {
  const json = await postMessage({
    to: to_phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: params.length
        ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
        : [],
    },
  });
  if (json) console.log(`[whatsapp-send] template "${templateName}" sent to ${to_phone}`);
  return json;
}

module.exports = { sendWhatsAppMessage, sendWhatsAppTemplate, canAutoSend };
