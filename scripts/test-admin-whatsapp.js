/**
 * Admin WhatsApp channel (Kapso): webhook security, commands, undo, briefs.
 * Runs against a live server with mocks (no real WhatsApp, no real model):
 *
 *   KAPSO_MOCK=1 KAPSO_WEBHOOK_SECRET=test-kapso-secret ADMIN_WHATSAPP_PHONE=0521234567 \
 *   KAPSO_PHONE_NUMBER_ID=999000 AI_MOCK=1 DB_PATH=/tmp/copy.db PORT=3099 node server.js
 *   node scripts/test-admin-whatsapp.js
 */

const crypto = require('crypto');
const { resolveHebrewDate } = require('../utils/dates');
const { toPlainText } = require('../services/admin-whatsapp.service');
const { messageEvents, messageText } = require('../routes/admin-whatsapp.routes');
const { groupByWeek } = require('../utils/weight-grid');

const BASE = process.env.TEST_BASE || 'http://localhost:3099/api';
const SECRET = process.env.KAPSO_WEBHOOK_SECRET || 'test-kapso-secret';
const ADMIN = '972521234567';
const NUMBER_ID = '999000';
let AUTH = '';
let passed = 0;
let failed = 0;
let seq = 0;

function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
async function req(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: AUTH }, body: body ? JSON.stringify(body) : undefined });
  let json = {};
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, ...json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(150); } }

const israelDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

function event(text, { from = ADMIN, id = `wamid.test.${++seq}`, numberId = NUMBER_ID, type = 'text' } = {}) {
  const message = { id, timestamp: String(Math.floor(Date.now() / 1000)), type, ...(from ? { from } : {}) };
  if (type === 'text') message.text = { body: text };
  if (type === 'button') message.button = { text, payload: text };
  return { message, phone_number_id: numberId, conversation: { phone_number_id: numberId } };
}

async function webhook(payload, { secret = SECRET, signature, eventName = 'whatsapp.message.received' } = {}) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const res = await fetch(`${BASE}/integrations/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig, 'X-Webhook-Event': eventName }, body: raw,
  });
  return res.status;
}

const messages = async () => (await req('GET', '/integrations/whatsapp/messages?limit=200')).data;
const outCount = async () => (await messages()).filter((m) => m.direction === 'out').length;
/** Send an admin text and wait for the reply to it. */
async function say(text, opts = {}) {
  const id = opts.id || `wamid.test.${++seq}`;
  const status = await webhook(event(text, { ...opts, id }));
  const reply = await waitFor(async () => (await messages()).find((m) => m.direction === 'out' && m.meta?.in_reply_to === id));
  return { status, reply: reply?.body || null, id };
}

async function run() {
  console.log('\n══ Admin WhatsApp channel (Kapso) ══\n');

  // ── Units ──
  console.log('── units ──');
  {
    // off-day weigh-ins → closest slot (Sun/Tue/Wed → Mon, Fri/Sat → Thu), actual date kept
    const g = groupByWeek([
      { id: 1, weigh_date: '2026-11-01', weight: 80 },   // Sunday → Mon 02/11
      { id: 2, weigh_date: '2026-11-06', weight: 79.5 }, // Friday → Thu 05/11
      { id: 3, weigh_date: '2026-11-11', weight: 79 },   // Wednesday → Mon 09/11
      { id: 4, weigh_date: '2026-11-09', weight: 78.8 }, // real Monday wins over Wednesday
      { id: 5, weigh_date: '2026-11-14', weight: 78.6 }, // Saturday → Thu 12/11
    ]);
    const wk = Object.fromEntries(g.map((w) => [w.week_start, w]));
    assert('Grid: Sunday → that week\'s Monday slot, date kept',
      wk['2026-11-02']?.monday_weight === 80 && wk['2026-11-02'].monday_date === '2026-11-01' && wk['2026-11-02'].monday_off_day === true, JSON.stringify(wk['2026-11-02']));
    assert('Grid: Friday → Thursday slot; average of both',
      wk['2026-11-02'].thursday_weight === 79.5 && wk['2026-11-02'].thursday_date === '2026-11-06' && wk['2026-11-02'].average === 79.8);
    assert('Grid: a real Monday beats an off-day; Saturday → Thursday',
      wk['2026-11-09']?.monday_id === 4 && wk['2026-11-09'].monday_off_day === false && wk['2026-11-09'].thursday_date === '2026-11-14');
    const T = '2026-11-07'; // Saturday
    const cases = [['', '2026-11-07'], ['אתמול', '2026-11-06'], ['שלשום', '2026-11-05'], ['ביום חמישי', '2026-11-05'], ["יום ה'", '2026-11-05'],
      ['ב-04/11', '2026-11-04'], ['4.11', '2026-11-04'], ['04/11/2026', '2026-11-04'], ['לפני 3 ימים', '2026-11-04'], ['בשבת', '2026-11-07']];
    const bad = cases.filter(([t, d]) => resolveHebrewDate(t, T).date !== d);
    assert('Hebrew dates: relative, weekday (most recent), DD/MM', bad.length === 0, JSON.stringify(bad));
    assert('Future dates rejected (מחר, 10/11 on 07/11)', !!resolveHebrewDate('מחר', T).error && !!resolveHebrewDate('10/11', T).error);
    assert('Year rollover: 15/12 in January → last year', resolveHebrewDate('15/12', '2026-01-10').date === '2025-12-15');
    assert('Invalid date rejected', !!resolveHebrewDate('31/02', T).error && !!resolveHebrewDate('משהו', T).error);
    assert('Markdown → plain text', toPlainText('**דני** נרשם\n- שורה\n\n\n\nסוף') === 'דני נרשם\n• שורה\n\nסוף');
    assert('Batch envelope unpacked', messageEvents({ batch: true, data: [event('a'), event('b')] }).length === 2);
    assert('Quick-reply button text read', messageText({ type: 'button', button: { text: 'פירוט' } }) === 'פירוט');
  }

  const login = await req('POST', '/auth/login', { name: process.env.TEST_USER || 'test-runner', password: process.env.TEST_PASSWORD || 'test' });
  AUTH = `Bearer ${login.data?.token}`;
  assert('Logged in', !!login.data?.token);
  const st = await req('GET', '/integrations/whatsapp/status');
  assert('Status: configured (mock), secret + admin phone present', st.data?.configured && st.data.mock && st.data.has_webhook_secret && st.data.has_admin_phone, JSON.stringify(st.data));

  // ── Briefs before any admin message: window closed → template + "פירוט" ──
  console.log('── briefs (window closed) ──');
  const dani = (await req('POST', '/clients', { full_name: 'דני כהן', phone: '0527800001', start_date: israelDay(-30) })).data;
  const shira = (await req('POST', '/clients', { full_name: 'שירה לוי', phone: '0527800002', start_date: israelDay(-30) })).data;
  const s1 = (await req('POST', `/clients/${shira.id}/sessions`, { session_date: israelDay(-20), weight: 70 })).data;
  const s2 = (await req('POST', `/clients/${shira.id}/sessions`, { session_date: israelDay(-6), weight: 69 })).data;
  await req('PUT', `/sessions/${s1.id}`, { tasks: [{ id: 'ts-1', text: 'הליכה 20 דקות', status: 'pending' }] });
  await req('PUT', `/sessions/${s2.id}`, { tasks: [
    { id: 'ts-2', text: 'בישול ארוחות בבית פעמיים בשבוע', status: 'pending' },
    { id: 'ts-3', text: 'הליכה 20 דקות', status: 'pending', carried_over_from_session: 1 },
    { id: 'ts-4', text: 'הליכה ארוכה בשבת', status: 'pending' },
  ] });

  const tpl = await req('POST', '/integrations/whatsapp/briefs/daily/run');
  assert('Daily brief outside the 24h window → template', tpl.data?.via === 'template' && tpl.data.ok, JSON.stringify(tpl.data));
  const tplMsg = (await messages()).find((m) => m.kind === 'template');
  assert('Template carries a one-line summary and stores the full text', tplMsg && !tplMsg.body.includes('\n') && /ללא פגישה עתידית/.test(tplMsg.body) && tplMsg.meta.pending_detail.includes('דני כהן'), JSON.stringify(tplMsg));

  // ── Webhook security ──
  console.log('── webhook security ──');
  const before = await outCount();
  assert('Missing signature → 401', await webhook(event('עזרה'), { signature: '' }) === 401);
  assert('Wrong signature → 401', await webhook(event('עזרה'), { secret: 'not-the-secret' }) === 401);
  assert('Another sender → 200 but ignored', await webhook(event('עזרה', { from: '972500000000', id: 'wamid.stranger' })) === 200);
  assert('No sender field → 200 but ignored', await webhook(event('עזרה', { from: null, id: 'wamid.nosender' })) === 200);
  assert('Another phone number of the project → ignored', await webhook(event('עזרה', { numberId: '111', id: 'wamid.othernumber' })) === 200);
  assert('Other event types ignored', await webhook(event('עזרה', { id: 'wamid.delivered' }), { eventName: 'whatsapp.message.delivered' }) === 200);
  await sleep(700);
  const log = await messages();
  assert('Nothing was answered to them', await outCount() === before);
  assert('Strangers are counted but their content is not stored', log.filter((m) => m.kind === 'ignored').length === 2 && log.filter((m) => m.kind === 'ignored').every((m) => m.body === null));
  assert('Other number / event not even logged', !log.some((m) => ['wamid.othernumber', 'wamid.delivered'].includes(m.provider_id)));

  // ── Commands ──
  console.log('── commands ──');
  const help = await say('עזרה');
  assert('Admin "עזרה" → help reply', help.status === 200 && /שקילה/.test(help.reply || ''), help.reply);
  const detail = await say('פירוט');
  assert('"פירוט" returns the full brief text', (detail.reply || '').startsWith('תדריך בוקר') && detail.reply.includes('דני כהן'), detail.reply);
  const dupId = 'wamid.duplicate';
  await say('עזרה', { id: dupId });
  const afterFirst = await outCount();
  await webhook(event('עזרה', { id: dupId }));
  await sleep(700);
  assert('Re-delivered message processed once', await outCount() === afterFirst);
  const batchIds = [`wamid.b${++seq}`, `wamid.b${++seq}`];
  await webhook({ type: 'whatsapp.message.received', batch: true, data: batchIds.map((id) => event('עזרה', { id })) });
  const both = await waitFor(async () => { const l = await messages(); return batchIds.every((id) => l.some((m) => m.meta?.in_reply_to === id)); });
  assert('Batched delivery: every message handled', !!both);
  const btn = await say('עזרה', { type: 'button' });
  assert('Quick-reply button handled like text', /שקילה/.test(btn.reply || ''));

  // ── Weigh-ins through the agent (mock: #tool directives) ──
  console.log('── weigh-ins ──');
  const yesterday = israelDay(-1);
  const w1 = await say(`#tool:log_weight ${JSON.stringify({ client_id: dani.id, weight: 84.2, date_text: 'אתמול' })}`);
  let wl = (await req('GET', `/weight/${dani.id}`)).data;
  const rows = (x) => x?.logs || [];
  const logged = rows(wl).find((r) => r.weigh_date === yesterday);
  assert('"אתמול" → logged on yesterday (Israel date)', logged?.weight === 84.2, JSON.stringify(wl).slice(0, 200));
  assert('Agent replied in plain text', !!w1.reply && !/\*\*/.test(w1.reply));
  await say(`#tool:log_weight ${JSON.stringify({ client_id: dani.id, weight: 85, date_text: 'אתמול' })}`);
  wl = (await req('GET', `/weight/${dani.id}`)).data;
  assert('Same date again → replaced (85)', rows(wl).find((r) => r.weigh_date === yesterday)?.weight === 85);
  const fut = await say(`#tool:log_weight ${JSON.stringify({ client_id: dani.id, weight: 80, date_text: 'מחר' })}`);
  wl = (await req('GET', `/weight/${dani.id}`)).data;
  assert('Future date refused, nothing written', !rows(wl).some((r) => r.weight === 80) && !!fut.reply);

  const u1 = await say('בטל');
  wl = (await req('GET', `/weight/${dani.id}`)).data;
  assert('"בטל" restores the replaced value (84.2)', /בוטל/.test(u1.reply || '') && rows(wl).find((r) => r.weigh_date === yesterday)?.weight === 84.2, u1.reply);
  const u2 = await say('בטל');
  wl = (await req('GET', `/weight/${dani.id}`)).data;
  assert('"בטל" again removes the first weigh-in', /בוטל/.test(u2.reply || '') && !rows(wl).some((r) => r.weigh_date === yesterday));
  const u3 = await say('בטל');
  assert('Nothing left to undo → explained', /אין פעולה לביטול/.test(u3.reply || ''));

  // ── Tasks ──
  console.log('── tasks ──');
  await say(`#tool:complete_task ${JSON.stringify({ client_id: shira.id, task_query: 'בישול' })}`);
  const tasksOf = async (sid) => (await req('GET', `/sessions/${sid}`)).data.tasks;
  assert('"בישול" → the cooking task marked done', (await tasksOf(s2.id)).find((t) => t.id === 'ts-2')?.status === 'done');
  await say(`#tool:complete_task ${JSON.stringify({ client_id: shira.id, task_query: 'הליכה' })}`);
  assert('Ambiguous "הליכה" → nothing changed', (await tasksOf(s2.id)).filter((t) => /הליכה/.test(t.text)).every((t) => t.status === 'pending'));
  await say(`#tool:complete_task ${JSON.stringify({ client_id: shira.id, task_id: 'ts-3' })}`);
  assert('Picked by task_id → carried-over copies done in both sessions',
    (await tasksOf(s2.id)).find((t) => t.id === 'ts-3').status === 'done' && (await tasksOf(s1.id)).find((t) => t.id === 'ts-1').status === 'done'
    && (await tasksOf(s2.id)).find((t) => t.id === 'ts-4').status === 'pending');
  await say('בטל');
  assert('"בטל" reopens both copies', (await tasksOf(s2.id)).find((t) => t.id === 'ts-3').status === 'pending' && (await tasksOf(s1.id)).find((t) => t.id === 'ts-1').status === 'pending');

  // ── Briefs inside the window ──
  console.log('── briefs (window open) ──');
  await say(`#tool:log_weight ${JSON.stringify({ client_id: dani.id, weight: 83.9, date_text: '' })}`);
  const daily = await req('POST', '/integrations/whatsapp/briefs/daily/run');
  const dailyMsg = (await messages()).find((m) => m.meta?.brief === 'daily' && m.kind === 'text');
  assert('Daily brief inside the window → full text', daily.data?.via === 'text' && /ללא פגישה עתידית/.test(dailyMsg?.body || '') && dailyMsg.body.includes('דני כהן'), dailyMsg?.body);
  assert('Daily brief: client never met → "טרם התקיימה פגישה"; overdue marked', /דני כהן: טרם התקיימה פגישה/.test(dailyMsg.body) && /מעל 14 יום/.test(dailyMsg.body));
  const wr = await req('POST', '/integrations/whatsapp/briefs/weigh_in/run');
  const wrMsg = (await messages()).find((m) => m.meta?.brief === 'weigh_in');
  assert('Weigh-in report: who weighed today with the value', wr.data?.ok && /שקלו \(\d+ מתוך \d+\):\n[^]*דני כהן: 83\.9/.test(wrMsg?.body || ''), wrMsg?.body);
  assert('Weigh-in report: who did not, and open tasks', /לא שקלו[^]*שירה לוי/.test(wrMsg.body) && /משימות והרגלים פתוחים[^]*שירה לוי: [^\n]*הליכה/.test(wrMsg.body));
  assert('Unknown brief → 404', (await req('POST', '/integrations/whatsapp/briefs/nope/run')).status === 404);

  await req('DELETE', `/clients/${dani.id}`);
  await req('DELETE', `/clients/${shira.id}`);
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
