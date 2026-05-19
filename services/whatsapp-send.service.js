// ─── WhatsApp Cloud API — send outbound message ───────────────────────────────

async function sendWhatsAppMessage(to_phone, message_text) {
  const phoneId     = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !accessToken) {
    console.warn('[whatsapp-send] WHATSAPP_PHONE_ID or WHATSAPP_ACCESS_TOKEN not set — skipping send');
    return null;
  }

  const url  = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to:                to_phone,
    type:              'text',
    text:              { body: message_text },
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!res.ok) {
    console.error('[whatsapp-send] API error:', JSON.stringify(json));
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }

  console.log(`[whatsapp-send] sent to ${to_phone}: "${message_text.slice(0, 60)}..."`);
  return json;
}

module.exports = { sendWhatsAppMessage };
