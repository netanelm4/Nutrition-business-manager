const { nowUtcISO } = require('../utils/dates');

// ─── Kapso (WhatsApp Business API gateway) — admin operational channel ──────
// A separate number from the client bot (which stays on Meta directly).
//   POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages
//   header X-API-Key
// Free text only inside the 24h customer-service window (Netanel wrote to the
// number in the last 24h); otherwise an approved template (KAPSO_BRIEF_TEMPLATE).
// KAPSO_MOCK=1 → nothing is sent; messages are only logged (tests).

const BASE_URL = process.env.KAPSO_BASE_URL || 'https://api.kapso.ai/meta/whatsapp/v24.0';
const WINDOW_MS = 24 * 3600 * 1000;
const WINDOW_SAFETY_MS = 10 * 60 * 1000; // do not rely on the last minutes of the window

const isMock = () => process.env.KAPSO_MOCK === '1';

function config() {
  return {
    apiKey: process.env.KAPSO_API_KEY || '',
    phoneNumberId: process.env.KAPSO_PHONE_NUMBER_ID || '',
    webhookSecret: process.env.KAPSO_WEBHOOK_SECRET || '',
    adminPhone: normalizePhone(process.env.ADMIN_WHATSAPP_PHONE || ''),
    template: process.env.KAPSO_BRIEF_TEMPLATE || 'ops_brief',
    templateLang: process.env.KAPSO_TEMPLATE_LANG || 'he',
  };
}

/** Can the channel send? (mock counts as configured) */
function isConfigured() {
  const c = config();
  return !!c.adminPhone && (isMock() || (!!c.apiKey && !!c.phoneNumberId));
}

/** WhatsApp ids are digits with country code, no '+': 0521234567 → 972521234567. */
function normalizePhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return d;
}

function logMessage(db, fields) {
  return db.prepare(`
    INSERT INTO admin_whatsapp_messages (direction, provider_id, kind, body, status, error, meta, created_at)
    VALUES (@direction, @provider_id, @kind, @body, @status, @error, @meta, @created_at)
  `).run({
    provider_id: null, status: null, error: null, meta: null, kind: 'text', ...fields,
    meta: fields.meta ? JSON.stringify(fields.meta) : null, created_at: nowUtcISO(),
  }).lastInsertRowid;
}

/** Is the 24h window open (Netanel wrote to the channel recently)? */
function windowOpen(db) {
  const last = db.prepare("SELECT created_at FROM admin_whatsapp_messages WHERE direction = 'in' AND kind != 'ignored' ORDER BY id DESC LIMIT 1").get();
  return !!last && Date.now() - Date.parse(last.created_at) < WINDOW_MS - WINDOW_SAFETY_MS;
}

async function post(body) {
  const c = config();
  const res = await fetch(`${BASE_URL}/${c.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': c.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Kapso ${res.status}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
  return json;
}

/** WhatsApp text bodies are capped at 4096 chars; split long ones on paragraph boundaries. */
function chunks(text, max = 3900) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const para of text.split('\n\n')) {
    if ((cur + '\n\n' + para).length > max && cur) { out.push(cur); cur = para; } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) out.push(cur);
  return out.flatMap((c) => (c.length > max ? c.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [c]));
}

/** Send free text to Netanel. Never throws; returns { ok, mode, error }. */
async function sendText(db, body, meta = null) {
  const c = config();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  const parts = chunks(String(body));
  for (const part of parts) {
    if (isMock()) { logMessage(db, { direction: 'out', kind: 'text', body: part, status: 'mock', meta }); continue; }
    try {
      const r = await post({ messaging_product: 'whatsapp', to: c.adminPhone, type: 'text', text: { body: part } });
      logMessage(db, { direction: 'out', kind: 'text', body: part, status: 'sent', provider_id: r.messages?.[0]?.id || null, meta });
    } catch (err) {
      logMessage(db, { direction: 'out', kind: 'text', body: part, status: 'failed', error: err.message, meta });
      console.error('[kapso] send failed:', err.message);
      return { ok: false, error: err.message };
    }
  }
  return { ok: true, mode: isMock() ? 'mock' : 'text' };
}

/** Send the approved brief template with a one-line summary (named parameter {{summary}}). */
async function sendTemplate(db, summary, meta = null) {
  const c = config();
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  // template variables cannot contain new lines / tabs / long runs of spaces
  const line = String(summary).replace(/\s+/g, ' ').trim().slice(0, 900);
  const body = {
    messaging_product: 'whatsapp', to: c.adminPhone, type: 'template',
    template: {
      name: c.template, language: { code: c.templateLang },
      components: [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'summary', text: line }] }],
    },
  };
  if (isMock()) { logMessage(db, { direction: 'out', kind: 'template', body: line, status: 'mock', meta }); return { ok: true, mode: 'mock_template' }; }
  try {
    const r = await post(body);
    logMessage(db, { direction: 'out', kind: 'template', body: line, status: 'sent', provider_id: r.messages?.[0]?.id || null, meta });
    return { ok: true, mode: 'template' };
  } catch (err) {
    logMessage(db, { direction: 'out', kind: 'template', body: line, status: 'failed', error: err.message, meta });
    console.error('[kapso] template failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { config, isConfigured, isMock, normalizePhone, logMessage, windowOpen, sendText, sendTemplate, chunks };
