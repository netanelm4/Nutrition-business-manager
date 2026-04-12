const WEBHOOK_URL = 'https://web-production-790f4.up.railway.app/api/calendly/webhook';
const WEBHOOK_EVENTS = ['invitee.created', 'invitee.canceled'];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`,
  };
}

async function registerCalendlyWebhook() {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) {
    console.log('[calendly] CALENDLY_TOKEN not set — skipping webhook registration.');
    return;
  }

  // 1. Get user URI
  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: authHeaders(),
  });
  if (!meRes.ok) {
    console.error('[calendly] Failed to fetch user info:', meRes.status, await meRes.text());
    return;
  }
  const { resource } = await meRes.json();
  const userUri = resource.uri;

  // 2. Check existing webhooks
  const listUrl = new URL('https://api.calendly.com/webhook_subscriptions');
  listUrl.searchParams.set('organization', userUri);
  listUrl.searchParams.set('scope', 'user');

  const listRes = await fetch(listUrl.toString(), { headers: authHeaders() });
  if (!listRes.ok) {
    console.error('[calendly] Failed to list webhooks:', listRes.status, await listRes.text());
    return;
  }
  const { collection } = await listRes.json();
  const alreadyExists = (collection || []).some((w) => w.callback_url === WEBHOOK_URL);

  if (alreadyExists) {
    console.log('[calendly] Webhook already exists — no action needed.');
    return;
  }

  // 3. Register webhook
  const createRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      url: WEBHOOK_URL,
      events: WEBHOOK_EVENTS,
      organization: userUri,
      scope: 'user',
    }),
  });

  if (createRes.ok) {
    console.log('[calendly] Webhook registered successfully.');
  } else {
    console.error('[calendly] Failed to register webhook:', createRes.status, await createRes.text());
  }
}

module.exports = { registerCalendlyWebhook };
