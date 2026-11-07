/**
 * Phase 6 + 7 tests: centralized AI generators and the AI agent (tools, proposals,
 * approvals, history, morning brief). Runs against a live server started with
 * AI_MOCK=1 (deterministic local model, no API calls, no cost):
 *
 *   DB_PATH=/tmp/copy.db AI_MOCK=1 PORT=3099 node server.js
 *   node scripts/test-agent.js
 */

const BASE = process.env.TEST_BASE || 'http://localhost:3099/api';
let AUTH = '';
let passed = 0;
let failed = 0;

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, ...json };
}

function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

/** One agent turn; returns parsed SSE events. */
async function chat(message, conversationId) {
  const res = await fetch(`${BASE}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({ message, ...(conversationId ? { conversation_id: conversationId } : {}) }),
  });
  const raw = await res.text();
  const events = raw.split('\n\n').filter(Boolean).map((frame) => {
    const type = /event: (.*)/.exec(frame)?.[1];
    const data = /data: (.*)/.exec(frame)?.[1];
    return { type, data: data ? JSON.parse(data) : null };
  });
  const by = (t) => events.filter((e) => e.type === t).map((e) => e.data);
  return {
    status: res.status, events,
    conversationId: by('conversation')[0]?.id,
    text: by('text').map((d) => d.text).join(''),
    results: by('tool_result'),
    errors: by('error'),
    done: by('done')[0],
  };
}

const dir = (name, input) => `#tool:${name} ${JSON.stringify(input)}`;

async function run() {
  console.log('\n══ Phase 6 + 7: AI layer and agent (AI_MOCK) ══\n');
  const login = await req('POST', '/auth/login', { name: process.env.TEST_USER || 'test-runner', password: process.env.TEST_PASSWORD || 'test' });
  AUTH = `Bearer ${login.data?.token}`;
  assert('Logged in', !!login.data?.token);

  // ── fixtures through the API ──
  const client = (await req('POST', '/clients', { full_name: 'מטופלת סוכן', phone: '0527100001', start_date: '2026-10-01', package_price: 1500 })).data;
  const sess = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-10-01', weight: 80, highlights: 'מוטיבציה גבוהה, קושי בערבים' })).data;
  const lead = (await req('POST', '/leads', { full_name: 'ליד סוכן', phone: '0527100002' })).data;
  const lead2 = (await req('POST', '/leads', { full_name: 'ליד סוכן שני', phone: '0527100003' })).data;
  const protocols = (await req('GET', '/protocols')).data || [];

  // ── Phase 6: generators through their routes (structured outputs) ──
  console.log('── Phase 6: generators ──');
  {
    const r = await req('POST', `/sessions/${sess.id}/insights`);
    assert('Session insights: structured, stored shape', r.success && Array.isArray(r.data.insights) && r.data.insights[0]?.saved_for_next === false, JSON.stringify(r));
    const c = await req('POST', `/sessions/${sess.id}/checkin-message`);
    assert('Check-in message generated', c.success && typeof c.data.message === 'string' && c.data.message.length > 0, JSON.stringify(c));
    const s = await req('POST', `/clients/${client.id}/ai-summary`);
    assert('Client summary: fields + tasks', s.success && typeof s.data.summary.clinical_summary === 'string' && Array.isArray(s.data.tasks), JSON.stringify(s).slice(0, 200));
    const p = await req('POST', `/clients/${client.id}/process-summary`);
    assert('Process summary (shared generator)', p.success && typeof p.data.headline === 'string', JSON.stringify(p));
    if (protocols[0]) {
      const pp = await req('POST', `/protocols/${protocols[0].id}/personalize`, { clientId: client.id });
      assert('Protocol personalization', pp.success && Array.isArray(pp.data.personalized_highlights), JSON.stringify(pp).slice(0, 200));
    }
    const menuRes = await fetch(`${BASE}/menus`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: AUTH }, body: JSON.stringify({ client_id: client.id, title: 'תפריט AI', calorie_target: 1600 }) }).then((x) => x.json());
    const gen = await fetch(`${BASE}/menus/${menuRes.menu.id}/generate`, { method: 'POST', headers: { Authorization: AUTH } }).then((x) => x.json());
    assert('Menu generation writes meals', gen.ok !== false && JSON.stringify(gen).includes('meal'), JSON.stringify(gen).slice(0, 200));
    const pay = await req('POST', `/clients/${client.id}/payments`, { amount: 500, paid_at: '2026-10-02' });
    assert('Payment route no longer 500s (syncPaymentStatus fix)', pay.success && pay.data.payment_status === 'partial', JSON.stringify(pay));
  }

  // ── Phase 7: read tools ──
  console.log('── Phase 7: read tools ──');
  {
    const t = await chat([
      'סקירה', dir('search_entities', { query: 'סוכן' }), dir('get_client_snapshot', { client_id: client.id }),
      dir('get_client_timeline', { client_id: client.id }), dir('get_stale_leads', {}), dir('get_schedule', {}),
      dir('get_inbox', {}), dir('search_food_bank', { query: 'ביצ' }), dir('get_protocol', {}),
      dir('recall_memory', { client_id: client.id }),
    ].join('\n'));
    const names = t.results.map((r) => r.name);
    assert('All 9 read tools ran', ['search_entities', 'get_client_snapshot', 'get_client_timeline', 'get_stale_leads', 'get_schedule', 'get_inbox', 'search_food_bank', 'get_protocol', 'recall_memory'].every((n) => names.includes(n)), names.join(','));
    assert('Read tools succeeded', t.results.every((r) => !r.is_error && r.kind === 'read'), JSON.stringify(t.results.filter((r) => r.is_error)));
    assert('Agent answered after tools (2nd round)', t.text.includes('סיכום הפעולות'), t.text.slice(0, 120));
    assert('Turn completed', !!t.done && t.errors.length === 0, JSON.stringify(t.errors));

    const bad = await chat(dir('get_client_snapshot', { client_id: -5 }));
    assert('Invalid tool input → is_error result (model can retry)', bad.results[0]?.is_error === true, JSON.stringify(bad.results));
    const unknown = await chat(dir('get_client_snapshot', { client_id: 999999 }));
    assert('Missing entity → is_error result', unknown.results[0]?.is_error === true && /not found/i.test(unknown.results[0]?.summary || ''));
  }

  // ── Phase 7: proposals → Inbox → approval executes ──
  console.log('── Phase 7: proposals and approvals ──');
  {
    const today = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const t = await chat([
      'הצעות',
      dir('convert_lead_to_client', { lead_id: lead.id, reason: 'סיים פגישה ראשונה' }),
      dir('update_lead_status', { lead_id: lead2.id, status: 'contacted', note: 'דיברנו', reason: 'שיחה' }),
      dir('schedule_meeting', { lead_id: lead2.id, date: today, time: '10:30', event_type: 'first_meeting', reason: 'תיאום' }),
      dir('draft_whatsapp_message', { client_id: client.id, message: 'היי, רציתי לבדוק איך השבוע עובר', reason: 'צ\'ק-אין' }),
      dir('schedule_followup', { client_id: client.id, due_date: today, title: 'לבדוק ארוחות ערב', reason: 'מעקב' }),
      dir('log_session_notes', { session_id: sess.id, highlights: 'נוסף ע"י הסוכן', tasks: ['לשתות 2 ליטר'], reason: 'תיעוד' }),
      ...(protocols[0] ? [dir('assign_protocol', { client_id: client.id, protocol_id: protocols[0].id, reason: 'מתאים' })] : []),
      dir('create_menu_draft', { client_id: client.id, title: 'טיוטה מהסוכן', calorie_target: 1700, reason: 'תפריט ראשון' }),
      dir('record_payment', { client_id: client.id, amount: 1000, paid_at: '2026-10-05', reason: 'העברה בנקאית' }),
    ].join('\n'));
    const proposals = Object.fromEntries(t.results.filter((r) => r.kind === 'propose').map((r) => [r.name, r.proposal_id]));
    const expected = ['convert_lead_to_client', 'update_lead_status', 'schedule_meeting', 'draft_whatsapp_message', 'schedule_followup', 'log_session_notes', 'create_menu_draft', 'record_payment', ...(protocols[0] ? ['assign_protocol'] : [])];
    assert('Every write tool created a proposal', expected.every((n) => proposals[n]), JSON.stringify(t.results.filter((r) => r.is_error)));

    // Nothing changed before approval
    const leadBefore = (await req('GET', `/leads/${lead.id}`)).data;
    assert('Proposal changes nothing before approval', leadBefore.status !== 'became_client');
    const inbox = (await req('GET', '/inbox')).data.items;
    assert('Proposals are in the Inbox (source agent)', expected.every((n) => inbox.some((i) => i.id === proposals[n] && i.source === 'agent')));

    const approve = async (name) => (await req('POST', `/inbox/${proposals[name]}/approve`)).data;
    let r = await approve('convert_lead_to_client');
    assert('Approve → lead converted', r.status === 'done' && r.result?.clientId > 0, JSON.stringify(r));
    r = await approve('update_lead_status');
    assert('Approve → lead status updated', (await req('GET', `/leads/${lead2.id}`)).data.status === 'contacted', JSON.stringify(r));
    r = await approve('schedule_meeting');
    const meeting = (await req('GET', `/leads/${lead2.id}/meeting`)).data;
    assert('Approve → meeting created (UTC instant)', r.status === 'done' && meeting && /T07:30:00\.000Z|T08:30:00\.000Z/.test(meeting.start_time), JSON.stringify(meeting));
    r = await approve('draft_whatsapp_message');
    assert('Approve draft → sent via wa.me (deeplink mode)', r.status === 'sent' && r.whatsapp_link?.startsWith('https://wa.me/'), JSON.stringify(r));
    r = await approve('schedule_followup');
    assert('Approve → follow-up task created', r.status === 'done' && r.result?.dailyTaskId > 0, JSON.stringify(r));
    r = await approve('log_session_notes');
    const s2 = (await req('GET', `/sessions/${sess.id}`)).data;
    assert('Approve → session notes + task added', s2.highlights.includes('נוסף ע"י הסוכן') && s2.tasks.some((x) => x.text === 'לשתות 2 ליטר'));
    if (protocols[0]) {
      await approve('assign_protocol');
      assert('Approve → protocol assigned', (await req('GET', `/clients/${client.id}`)).data.protocol_id === protocols[0].id);
    }
    r = await approve('create_menu_draft');
    assert('Approve → menu draft created', r.result?.menuId > 0, JSON.stringify(r));
    r = await approve('record_payment');
    assert('Approve → payment recorded, status paid', r.result?.paymentStatus === 'paid', JSON.stringify(r));

    // A failing executor leaves the item pending with the error
    // (the session is deleted after the proposal; the item survives — it is tied to the client)
    const extra = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-10-15' })).data;
    const ghost = await chat(dir('log_session_notes', { session_id: extra.id, highlights: 'x', reason: 'בדיקה' }));
    await req('DELETE', `/sessions/${extra.id}`);
    const gr = (await req('POST', `/inbox/${ghost.results[0].proposal_id}/approve`)).data;
    assert('Executor failure → item stays pending with error', gr.status === 'pending' && !!gr.error, JSON.stringify(gr));
  }

  // ── Phase 7: autonomous write (audit-logged) ──
  console.log('── Phase 7: update_weight ──');
  {
    const t = await chat(dir('update_weight', { client_id: client.id, weight: 78.4, date: '2026-10-08' }));
    assert('update_weight ran autonomously', t.results[0]?.kind === 'auto' && !t.results[0]?.is_error, JSON.stringify(t.results));
    const w = await req('GET', `/weight/${client.id}`);
    assert('Weight stored', JSON.stringify(w.data).includes('78.4'), JSON.stringify(w).slice(0, 200));
    const implausible = await chat(dir('update_weight', { client_id: client.id, weight: 7.8, date: '2026-10-09' }));
    assert('Implausible weight rejected', implausible.results[0]?.is_error === true);
  }

  // ── Phase 7: server-side history ──
  console.log('── Phase 7: history ──');
  {
    const first = await chat('שלום');
    const second = await chat('ומה עוד?', first.conversationId);
    assert('Second turn continues the same conversation', second.conversationId === first.conversationId);
    const tr = await req('GET', `/agent/conversations/${first.conversationId}`);
    const roles = (tr.data?.messages || []).map((m) => m.role);
    assert('Transcript has both user turns and replies', roles.filter((r) => r === 'user').length === 2 && roles.includes('assistant'), JSON.stringify(roles));
    assert('Context prefix hidden from transcript', !(tr.data?.messages || []).some((m) => m.text?.startsWith('[הקשר')));
    const list = await req('GET', '/agent/conversations');
    assert('Conversation list', Array.isArray(list.data) && list.data.some((c) => c.id === first.conversationId));
    const nf = await req('GET', '/agent/conversations/999999');
    assert('Unknown conversation → 404', nf.status === 404);
    const empty = await req('POST', '/agent/chat', { message: '   ' });
    assert('Empty message → 400', empty.status === 400);
    const del = await req('DELETE', `/agent/conversations/${first.conversationId}`);
    assert('Delete conversation', del.success);
  }

  // ── Phase 7: morning brief ──
  console.log('── Phase 7: morning brief ──');
  {
    const r = await req('POST', '/agent/morning-brief/run');
    assert('Morning brief ran', r.success && typeof r.data.meetings === 'number', JSON.stringify(r));
    const inbox = (await req('GET', '/inbox')).data.items;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    assert('Brief item in the Inbox', inbox.some((i) => i.kind === 'morning_brief' && i.dedupe_key === `morning_brief:${today}`));
    const again = await req('POST', '/agent/morning-brief/run');
    const count = (await req('GET', '/inbox')).data.items.filter((i) => i.kind === 'morning_brief').length;
    assert('Re-running the brief does not duplicate it', again.success && count === 1);
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
