/**
 * Smoke test — runs API routes end-to-end against a live server.
 *
 * ALWAYS run against a throwaway DB copy, never the real one:
 *   cp data/nutrition.db /tmp/test.db
 *   DB_PATH=/tmp/test.db PORT=3099 \
 *   BOOKING_LINK_FOLLOWUP=https://calendar.app.google/test-followup \
 *   node server.js
 * The DB needs a user matching TEST_USER / TEST_PASSWORD (defaults below).
 * Then run: node scripts/test-routes.js
 */


const BASE          = process.env.TEST_BASE     || 'http://localhost:3099/api';
const TEST_USER     = process.env.TEST_USER     || 'test-runner';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'test';
const FOLLOWUP_LINK = process.env.BOOKING_LINK_FOLLOWUP || 'https://calendar.app.google/test-followup';

let AUTH = '';
let passed = 0;
let failed = 0;
let leadId, clientId, sessionId, windowId;

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON response */ }
  return { status: res.status, ...json };
}

async function raw(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  return res.status;
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function isoDaysFromToday(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Nutrition CRM — API Smoke Test');
  console.log('══════════════════════════════════════════\n');

  // ── Auth ──────────────────────────────────────────────────────────────────
  console.log('── Auth ──');
  {
    const r = await req('POST', '/auth/login', { name: TEST_USER, password: TEST_PASSWORD });
    assert('Login returns a session token', r.success && typeof r.data?.token === 'string', JSON.stringify(r));
    AUTH = `Bearer ${r.data?.token}`;
  }
  {
    const r = await req('GET', '/clients');
    assert('Auth passes with session token', r.success === true);
  }
  {
    const res = await fetch(`${BASE}/clients`, { headers: { Authorization: 'Bearer wrong' } });
    assert('Auth rejects invalid token', res.status === 401);
  }

  // ── Phase 0: removed / locked endpoints ─────────────────────────────────────
  console.log('\n── Phase 0: unauthenticated endpoints ──');
  assert('GET /admin/diagnose-leads without auth → 401', (await raw('GET', '/admin/diagnose-leads')) === 401);
  assert('GET /admin/repair-now without auth → 401',     (await raw('GET', '/admin/repair-now')) === 401);
  assert('GET /public/debug/weight-schema without auth → 401', (await raw('GET', '/public/debug/weight-schema')) === 401);

  // ── Legacy Meta WhatsApp bot decommissioned (Kapso admin channel only) ─────
  console.log('\n── Legacy WhatsApp webhook removed ──');
  {
    const verify = await fetch(`${BASE}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=echo123`);
    assert('Meta verification endpoint gone (no challenge echo)', verify.status === 401 && !(await verify.text()).includes('echo123'));
    assert('Meta webhook POST → 401 (behind auth, no public handler)',
      (await raw('POST', '/whatsapp/webhook', { body: JSON.stringify({ entry: [] }), headers: { 'Content-Type': 'application/json' } })) === 401);
    const test = await req('POST', '/whatsapp/test', { phone: '0521234567', message: 'hi' });
    assert('Bot simulator /whatsapp/test gone', test.status === 404, JSON.stringify(test));
  }
  assert('Calendly webhook removed (no public endpoint)',
    (await raw('POST', '/calendly/webhook', { body: '{}', headers: { 'Content-Type': 'application/json' } })) === 401);

  // ── Phase 0: rate limiting on public lead form (5/hour per IP) ──────────────
  console.log('\n── Phase 0: public rate limit ──');
  {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(await raw('POST', '/leads/public', {
        body: JSON.stringify({ full_name: `בדיקת עומס ${i}`, phone: `05000000${i}` }),
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    assert('First 5 public lead submissions accepted', statuses.slice(0, 5).every((s) => s === 200), statuses.join(','));
    assert('6th public lead submission → 429', statuses[5] === 429, statuses.join(','));
  }

  // ── Leads ──────────────────────────────────────────────────────────────────
  console.log('\n── Leads ──');
  {
    const r = await req('POST', '/leads', {
      full_name: 'ישראל ישראלי',
      phone: '0501234567',
      source: 'referral',
      notes: 'הופנה על ידי חבר',
    });
    assert('Create lead', r.success && r.data.id, JSON.stringify(r));
    leadId = r.data?.id;
  }
  {
    const r = await req('GET', '/leads');
    assert('List leads', r.success && Array.isArray(r.data));
  }
  {
    const r = await req('GET', `/leads/${leadId}`);
    assert('Get single lead', r.success && r.data.full_name === 'ישראל ישראלי');
  }
  {
    const r = await req('PUT', `/leads/${leadId}`, { status: 'contacted', notes: 'שוחחנו בטלפון' });
    assert('Update lead status', r.success && r.data.status === 'contacted');
  }

  // ── Phase 1: Kanban drop (PUT status=became_client) runs full conversion ────
  console.log('\n── Phase 1: lead → client conversion ──');
  let convertedClientId;
  {
    const r = await req('PUT', `/leads/${leadId}`, { status: 'became_client' });
    assert('PUT became_client succeeds', r.success && r.data.status === 'became_client', JSON.stringify(r));
    assert('PUT became_client returns converted_client_id', !!r.data?.converted_client_id);
    convertedClientId = r.data?.converted_client_id;
  }
  {
    const r = await req('GET', `/clients/${convertedClientId}`);
    const c = r.data || {};
    assert('Converted client exists', r.success && c.converted_from_lead_id === leadId, JSON.stringify(r));
    assert('process_end_date = start_date + 90 days',
      !!c.start_date && c.process_end_date === new Date(Date.parse(c.start_date) + 90 * 864e5).toISOString().slice(0, 10),
      `${c.start_date} → ${c.process_end_date}`);
    assert('weight_token generated', typeof c.weight_token === 'string' && c.weight_token.length >= 16);
    assert('6 session windows created', c.session_windows?.length === 6);
  }
  {
    const r = await req('GET', `/engagements/client/${convertedClientId}`);
    const active = (r.data || []).filter((e) => e.status === 'active');
    assert('Engagement #1 active', active.length === 1 && active[0].number === 1, JSON.stringify(r.data));
    const s = await req('GET', `/clients/${convertedClientId}/sessions`);
    const s1 = (s.data || []).find((x) => x.session_number === 1);
    assert('Session 1 created and linked to engagement', !!s1 && s1.engagement_id === active[0]?.id, JSON.stringify(s1));
  }
  {
    const r = await req('POST', `/leads/${leadId}/convert`);
    assert('Re-convert is idempotent (same client)', r.success && r.data.clientId === convertedClientId, JSON.stringify(r));
  }

  // ── Phase 1: menu finalize marks menu_sent ──────────────────────────────────
  console.log('\n── Phase 1: menu finalize → menu_sent ──');
  {
    const created = await fetch(`${BASE}/menus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: AUTH },
      body: JSON.stringify({ client_id: convertedClientId, title: 'תפריט בדיקה', calorie_target: 1800 }),
    }).then((x) => x.json());
    assert('Create menu draft', created.ok && created.menu?.id, JSON.stringify(created));
    const before = await req('GET', `/clients/${convertedClientId}`);
    assert('menu_sent is 0 before finalize', before.data.menu_sent === 0);
    const fin = await fetch(`${BASE}/menus/${created.menu?.id}/finalize`, {
      method: 'POST', headers: { Authorization: AUTH },
    }).then((x) => x.json());
    assert('Finalize menu', fin.ok && fin.finalized, JSON.stringify(fin));
    const after = await req('GET', `/clients/${convertedClientId}`);
    assert('menu_sent = 1 after finalize', after.data.menu_sent === 1);
    assert('menu_sent_date set', !!after.data.menu_sent_date);
    assert('menu alert cleared', after.data.alerts?.menuAlert === false);
  }

  // ── Clients ────────────────────────────────────────────────────────────────
  console.log('\n── Clients ──');
  {
    const r = await req('POST', '/clients', {
      full_name: 'לקוח בדיקה',
      phone: '0507654321',
      age: 35,
      gender: 'male',
      start_date: '2026-03-01',
      goal: 'ירידה במשקל',
      initial_weight: 90.5,
    });
    assert('Create client', r.success && r.data.id, JSON.stringify(r));
    assert('process_end_date auto-calculated', r.data.process_end_date === '2026-05-30');
    assert('Alerts object present', r.data.alerts !== undefined);
    assert('weight_token set on manual create', !!r.data.weight_token);
    clientId = r.data?.id;
  }
  {
    const r = await req('GET', `/engagements/client/${clientId}`);
    assert('Manual client has engagement #1', r.success && r.data.length === 1 && r.data[0].status === 'active');
  }
  {
    const r = await req('GET', `/clients/${clientId}/windows`);
    assert('6 session windows created', r.success && r.data.length === 6);
    windowId = r.data?.[2]?.id;
    assert('Window 1 expected_date is start_date', r.data[0].expected_date === '2026-03-01');
    assert('Window 2 expected_date is +14 days', r.data[1].expected_date === '2026-03-15');
    assert('Window 3 expected_date is +28 days', r.data[2].expected_date === '2026-03-29');
  }
  {
    const r = await req('GET', '/clients');
    assert('List clients', r.success && Array.isArray(r.data));
  }
  {
    const r = await req('GET', `/clients/${clientId}`);
    assert('Get client detail', r.success && r.data.session_windows?.length === 6);
  }
  {
    const r = await req('PUT', `/clients/${clientId}`, { goal: 'ירידה במשקל ושיפור אנרגיה' });
    assert('Update client', r.success && r.data.goal === 'ירידה במשקל ושיפור אנרגיה');
  }

  // ── Session windows override ───────────────────────────────────────────────
  console.log('\n── Session windows ──');
  {
    const r = await req('PUT', `/session-windows/${windowId}`, {
      expected_date: '2026-04-05',
      override_note: 'הלקוח נוסע לחו"ל',
    });
    assert('Override session window', r.success && r.data.manually_overridden === 1);
    assert('Override note saved', r.data.override_note === 'הלקוח נוסע לחו"ל');
    assert('New expected_date saved', r.data.expected_date === '2026-04-05');
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  console.log('\n── Sessions ──');
  {
    const r = await req('POST', `/clients/${clientId}/sessions`, {
      session_date: '2026-03-01',
      weight: 90.5,
      highlights: 'לקוח מוטיבציה גבוהה, מתקשה עם ארוחות הביניים',
    });
    assert('Create session 1', r.success && r.data.session_number === 1, JSON.stringify(r));
    assert('Session tasks start empty', Array.isArray(r.data.tasks) && r.data.tasks.length === 0);
    assert('Session ai_insights starts as array', Array.isArray(r.data.ai_insights));
    assert('Session linked to engagement', !!r.data.engagement_id);
    sessionId = r.data?.id;
  }
  {
    const r = await req('PUT', `/sessions/${sessionId}`, {
      tasks: [
        { id: 'task-1', text: 'לשתות 2 ליטר מים ביום', status: 'pending', carried_over_from_session: null },
        { id: 'task-2', text: 'לאכול ארוחת בוקר עד 9:00', status: 'pending', carried_over_from_session: null },
      ],
    });
    assert('Update session tasks', r.success && r.data.tasks.length === 2);
  }
  {
    const r = await req('PUT', `/sessions/${sessionId}`, {
      ai_insights: [{ text: 'לעבוד על תכנון ארוחות בשבוע הקרוב', saved_for_next: true }],
      ai_flags: [{ text: 'קושי רגשי בסוף שבוע, לבדוק בפגישה הבאה', saved_for_next: false }],
    });
    assert('Update session insights', r.success && r.data.ai_insights.length === 1);
    assert('Insight saved_for_next is true', r.data.ai_insights[0].saved_for_next === true);
  }
  {
    const r = await req('GET', `/sessions/${sessionId}`);
    assert('Get session', r.success && r.data.session_number === 1);
  }

  // ── Task + insight carry-over ──────────────────────────────────────────────
  console.log('\n── Carry-over ──');
  {
    const r = await req('POST', `/clients/${clientId}/sessions`, { session_date: '2026-03-15', weight: 89.8 });
    assert('Create session 2', r.success && r.data.session_number === 2);
    assert('Tasks carried over from session 1', r.data.tasks.length === 2);
    assert('Carried task has carried_over_from_session=1', r.data.tasks[0].carried_over_from_session === 1);
    assert('Saved insight carried to session 2', r.data.ai_insights.length === 1);
    assert('Carried insight text correct', r.data.ai_insights[0].text.includes('תכנון'));
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  console.log('\n── Templates ──');
  {
    const r = await req('GET', '/templates');
    assert('List templates', r.success && r.data.length > 0);
    const welcomeTemplate = r.data.find((t) => t.trigger_event === 'welcome');
    assert('Welcome template exists', !!welcomeTemplate);
    const render = await req('POST', '/templates/render', { templateId: welcomeTemplate?.id, clientId });
    assert('Render template', render.success && render.data.rendered_text.includes('לקוח בדיקה'), JSON.stringify(render));
    assert('whatsapp_link returned', render.data?.whatsapp_link?.startsWith('https://wa.me/'));
  }

  // ── Phase 1: dashboard excludes frozen clients ──────────────────────────────
  console.log('\n── Phase 1: dashboard filters ──');
  let overdueId;
  {
    // start 60 days ago, no sessions → past windows are RED
    const r = await req('POST', '/clients', {
      full_name: 'לקוח באיחור', phone: '0509990000', start_date: isoDaysFromToday(-60),
    });
    overdueId = r.data?.id;
    const d1 = await req('GET', '/dashboard');
    assert('Dashboard returns success', d1.success === true);
    assert('Has alerts array', Array.isArray(d1.data.alerts));
    assert('Has counters', typeof d1.data.counters === 'object');
    assert('Overdue active client appears in alerts', d1.data.alerts.some((a) => a.client_id === overdueId));

    await req('POST', `/clients/${overdueId}/freeze`, { days: 14 });
    const d2 = await req('GET', '/dashboard');
    assert('Frozen client removed from alerts', !d2.data.alerts.some((a) => a.client_id === overdueId));
    assert('Frozen client removed from retention alerts',
      !(d2.data.retention_alerts || []).some((a) => a.id === overdueId));
  }

  // ── Recommendations moved to the inbox (Phase 4); legacy endpoint still answers ──
  {
    const r = await req('GET', '/ai-recommendations');
    assert('Legacy ai-recommendations endpoint responds', r.success && Array.isArray(r.data));
  }

  // ── Phase 1: stop closes the engagement ─────────────────────────────────────
  console.log('\n── Phase 1: stop process ──');
  {
    const r = await req('POST', `/clients/${clientId}/stop`, { reason: 'goal_achieved' });
    assert('Stop process', r.success && r.data.status === 'ended');
    const e = await req('GET', `/engagements/client/${clientId}`);
    assert('Engagement completed on stop', e.data.every((x) => x.status === 'completed'), JSON.stringify(e.data));
  }

  // ── Phase 2: meeting instants stored as canonical UTC ISO ──────────────────
  console.log('\n── Phase 2: time normalization ──');
  let tzLeadId;
  {
    const lead = await req('POST', '/leads', { full_name: 'בדיקת אזור זמן', phone: '0521230000' });
    tzLeadId = lead.data?.id;
    await req('POST', `/leads/${tzLeadId}/meeting`, { date: '2027-07-15', time: '10:00', event_type: 'first_meeting' });
    const summer = await req('GET', `/leads/${tzLeadId}/meeting`);
    assert('Summer 10:00 Israel → 07:00Z', summer.data?.start_time === '2027-07-15T07:00:00.000Z', summer.data?.start_time);
    assert('End time = start + 1h', summer.data?.end_time === '2027-07-15T08:00:00.000Z', summer.data?.end_time);

    const moved = await req('PUT', `/meetings/events/${summer.data?.id}`, { date: '2027-12-15', time: '10:00', event_type: 'first_meeting' });
    assert('Reschedule (winter) 10:00 Israel → 08:00Z', moved.data?.start_time === '2027-12-15T08:00:00.000Z', JSON.stringify(moved));
    const up = await req('GET', '/meetings/upcoming');
    assert('Upcoming meetings uses UTC comparison', (up.data || []).some((m) => m.id === summer.data?.id));
  }
  {
    // A meeting ~24h from now must be picked up by the reminder window
    const target = new Date(Date.now() + 24 * 3600 * 1000);
    const date = target.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const time = target.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });
    const lead = await req('POST', '/leads', { full_name: 'בדיקת תזכורת', phone: '0521240000' });
    await req('POST', `/leads/${lead.data?.id}/meeting`, { date, time, event_type: 'first_meeting' });
    const r = await req('POST', '/meetings/check-reminders');
    assert('Reminder generated for meeting in 24h', r.success && r.data.count >= 1, JSON.stringify(r));
    const m = await req('GET', `/leads/${lead.data?.id}/meeting`);
    // Deeplink mode: queued for one-click sending, confirmed only once approved (Phase 4)
    assert('Confirmation link is wa.me', (m.data?.confirmation_link || '').startsWith('https://wa.me/'));
    assert('Not marked sent before approval', m.data?.confirmation_sent === 0);
  }

  // ── Phase 3: session lifecycle ─────────────────────────────────────────────
  console.log('\n── Phase 3: session status model ──');
  {
    // Lead with a FUTURE meeting, converted before the meeting → session 1 scheduled
    const lead = await req('POST', '/leads', { full_name: 'בדיקת סטטוס', phone: '0521250000' });
    const futureDate = isoDaysFromToday(5);
    await req('POST', `/leads/${lead.data?.id}/meeting`, { date: futureDate, time: '11:00', event_type: 'first_meeting' });
    const meeting = (await req('GET', `/leads/${lead.data?.id}/meeting`)).data;
    const conv = await req('POST', `/leads/${lead.data?.id}/convert`);
    const cid = conv.data?.clientId;
    let s1 = (await req('GET', `/clients/${cid}/sessions`)).data.find((x) => x.session_number === 1);
    assert('Future meeting → session 1 scheduled', s1?.status === 'scheduled', JSON.stringify(s1));
    assert('Session 1 linked to its meeting', s1?.meeting_id === meeting?.id);
    assert('Session date = Israel date of meeting', s1?.session_date === futureDate);
    let c = (await req('GET', `/clients/${cid}`)).data;
    assert('Scheduled session not counted as done', c.sessions_recorded.length === 0 && c.sessions_scheduled.includes(1));

    // Reschedule the meeting → session date follows
    const newDate = isoDaysFromToday(6);
    await req('PUT', `/meetings/events/${meeting.id}`, { date: newDate, time: '12:00', event_type: 'first_meeting' });
    s1 = (await req('GET', `/sessions/${s1.id}`)).data;
    assert('Reschedule moves the linked session', s1.session_date === newDate, s1.session_date);

    // Meeting completed → session held
    await req('PUT', `/meetings/events/${meeting.id}/complete`);
    s1 = (await req('GET', `/sessions/${s1.id}`)).data;
    assert('Completed meeting → session held', s1.status === 'held');
    c = (await req('GET', `/clients/${cid}`)).data;
    assert('Held session counted as done', c.sessions_recorded.includes(1));

    // Recording a future session → scheduled; status actions
    const s2 = (await req('POST', `/clients/${cid}/sessions`, { session_date: isoDaysFromToday(10) })).data;
    assert('Future session recorded as scheduled', s2?.status === 'scheduled', JSON.stringify(s2));
    const ns = (await req('PUT', `/sessions/${s2.id}/status`, { status: 'no_show' })).data;
    assert('Status action: no_show', ns?.status === 'no_show');
    const bad = await req('PUT', `/sessions/${s2.id}/status`, { status: 'completed' });
    assert('Invalid status rejected (400)', bad.status === 400);

    // Scheduled session 3 days ago, no meeting, no notes → auto-held by lifecycle job
    await req('PUT', `/sessions/${s2.id}/status`, { status: 'scheduled' });
    await req('PUT', `/sessions/${s2.id}`, { session_date: isoDaysFromToday(-3) });
    const run = await req('POST', '/sessions/lifecycle/run');
    assert('Lifecycle job ran', run.success && run.data.held >= 1, JSON.stringify(run));
    const s2b = (await req('GET', `/sessions/${s2.id}`)).data;
    assert('Past scheduled session auto-held after 24h', s2b.status === 'held');

    // Saving notes on a scheduled session whose day has come → held
    const s3 = (await req('POST', `/clients/${cid}/sessions`, { session_date: isoDaysFromToday(2) })).data;
    await req('PUT', `/sessions/${s3.id}`, { session_date: isoDaysFromToday(0) });
    const s3b = (await req('PUT', `/sessions/${s3.id}`, { highlights: 'התקדמות טובה' })).data;
    assert('Notes on today\'s scheduled session → held', s3b.status === 'held', s3b.status);

    // Cancel a booked meeting: session 1 of a converted client is kept as canceled
    // (sessions 2–6 placeholders are deleted — covered by scripts/test-google-sync.js)
    const lead2 = await req('POST', '/leads', { full_name: 'בדיקת ביטול', phone: '0521260000' });
    await req('POST', `/leads/${lead2.data?.id}/meeting`, { date: isoDaysFromToday(4), time: '09:30', event_type: 'first_meeting' });
    const m2 = (await req('GET', `/leads/${lead2.data?.id}/meeting`)).data;
    const cid2 = (await req('POST', `/leads/${lead2.data?.id}/convert`)).data?.clientId;
    const before = (await req('GET', `/clients/${cid2}/sessions`)).data;
    assert('Converted with future meeting → 1 scheduled session', before.length === 1 && before[0].status === 'scheduled');
    const cancel = await req('PUT', `/meetings/events/${m2.id}/cancel`);
    assert('Cancel meeting succeeds', cancel.success && cancel.data.sessions.canceled === 1, JSON.stringify(cancel));
    const after = (await req('GET', `/clients/${cid2}/sessions`)).data;
    assert('Session 1 kept as canceled (not deleted)', after.length === 1 && after[0].status === 'canceled', JSON.stringify(after));
  }

  // ── Leads: meeting_held is now a valid status ──────────────────────────────
  {
    const r = await req('PUT', `/leads/${tzLeadId}`, { status: 'meeting_held' });
    assert('Lead status meeting_held accepted by DB', r.success && r.data.status === 'meeting_held', JSON.stringify(r));
  }

  // ── Booking-link template (Calendly removed) ───────────────────────────────
  {
    const t = await req('GET', '/templates');
    const booking = (t.data || []).find((x) => x.trigger_event === 'booking_link');
    assert('booking_link template exists', !!booking && !(t.data || []).some((x) => x.trigger_event === 'calendly_link'));
    assert('Template body uses {{booking_link}}', booking?.body_template.includes('{{booking_link}}'));
    const cfg = await req('GET', '/meetings/config');
    assert('Booking links served from env', cfg.data?.followupLink === FOLLOWUP_LINK, JSON.stringify(cfg));
  }

  // ── Client completion: API (rule details: scripts/test-auto-complete.js) ──
  console.log('\n── Client completion ──');
  {
    const ilDay = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const cid = (await req('POST', '/clients', { full_name: 'סיום אוטומטי', phone: '0521330001', start_date: ilDay(-100) })).data.id;
    for (let n = 1; n <= 6; n++) {
      await req('POST', `/clients/${cid}/sessions`, { session_date: ilDay(-100 + n * 12), status: 'held', weight: 70 });
    }
    // 6th held 28 days ago; push the end date before it → completeAt = 6th + 14 (passed)
    await req('PUT', `/clients/${cid}`, { process_end_date: ilDay(-40) });
    const preview = await req('GET', '/clients/auto-complete/preview');
    assert('Preview lists the client as due without changing it', preview.data?.some((p) => p.id === cid && p.eligible)
      && (await req('GET', `/clients/${cid}`)).data.status === 'active');
    const ev = await req('GET', `/clients/${cid}/completion`);
    assert('Completion status: 6 held, due', ev.data?.heldCount === 6 && ev.data?.eligible === true && ev.data?.completeAt === ilDay(-14), JSON.stringify(ev.data));
    await req('POST', '/inbox/refresh');
    const run = await req('POST', '/clients/auto-complete/run');
    assert('Auto-complete run completes the client', run.success && run.data.completed.some((c) => c.clientId === cid), JSON.stringify(run.data));
    const c = (await req('GET', `/clients/${cid}`)).data;
    assert('Client moved to ended (out of the active tab)', c.status === 'ended' && c.completed_automatically === 1, c.status);
    const active = (await req('GET', '/clients')).data.filter((x) => x.status === 'active');
    assert('Not listed among active clients', !active.some((x) => x.id === cid));
    const open = (await req('GET', '/inbox')).data.items.filter((i) => i.client_id === cid && ['session_due', 'process_ended', 'process_ending'].includes(i.kind));
    assert('No open scheduling items for the client', open.length === 0, JSON.stringify(open));

    // Manual stop goes through the same cleanup
    const m = (await req('POST', '/clients', { full_name: 'עצירה ידנית', phone: '0521330002', start_date: ilDay(-60) })).data.id;
    await req('POST', '/inbox/refresh');
    const before = (await req('GET', '/inbox')).data.items.some((i) => i.client_id === m && i.kind === 'session_due');
    const stop = await req('POST', `/clients/${m}/stop`, { reason: 'cant_continue' });
    const after = (await req('GET', '/inbox')).data.items.some((i) => i.client_id === m && i.kind === 'session_due');
    assert('Stop → ended and its session_due item closed immediately', before && stop.success && stop.data.status === 'ended' && !after, JSON.stringify({ before, after, stop: stop.data?.status }));
  }

  // ── Session date editing + rolling 14-day SLA ─────────────────────────────
  console.log('\n── Session dates and rolling SLA ──');
  {
    // Israel calendar day (the server counts SLA days in Israel time)
    const ilDay = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const inboxItems = async () => (await req('GET', '/inbox')).data.items;
    const dueFor = async (cid) => (await inboxItems()).filter((i) => i.client_id === cid && i.kind === 'session_due');
    const clientAlerts = async (cid) => (await req('GET', `/clients/${cid}`)).data.alerts;
    const sessionsOf = async (cid) => (await req('GET', `/clients/${cid}/sessions`)).data;

    // The reported case: session 2 held today, outside its theoretical window
    const cid = (await req('POST', '/clients', { full_name: 'SLA בדיקה', phone: '0521320001', start_date: ilDay(-40) })).data.id;
    const s2 = (await req('POST', `/clients/${cid}/sessions`, { session_date: ilDay(0), status: 'held', weight: 70 })).data;
    let alerts = await clientAlerts(cid);
    assert('Held session outside its window → badge green (not "ממתין")',
      alerts.windowAlerts.find((w) => w.session_number === s2.session_number)?.state === 'green', JSON.stringify(alerts.windowAlerts));

    // Editing the date of a held session updates session_date itself
    const newDate = ilDay(-3);
    const upd = await req('PUT', `/sessions/${s2.id}`, { session_date: newDate });
    assert('Edit held session date → session_date saved', upd.success && upd.data.session_date === newDate && upd.data.status === 'held', JSON.stringify(upd));
    const reread = (await sessionsOf(cid)).find((s) => s.id === s2.id);
    assert('Edited date visible on re-read', reread?.session_date === newDate);
    const future = await req('PUT', `/sessions/${s2.id}`, { session_date: ilDay(5) });
    assert('Held session cannot move to a future date (400)', future.status === 400, JSON.stringify(future));

    // Rolling SLA: last held 3 days ago → not stale, no item, no red slot
    await req('POST', '/inbox/refresh');
    alerts = await clientAlerts(cid);
    assert('Last held 3 days ago → SLA not stale', alerts.sessionSla.stale === false && alerts.sessionSla.lastHeldDate === newDate, JSON.stringify(alerts.sessionSla));
    assert('No red/yellow slot from the theoretical schedule', !alerts.windowAlerts.some((w) => w.state === 'red' || w.state === 'yellow'), JSON.stringify(alerts.windowAlerts));
    assert('No session_due item within 14 days', (await dueFor(cid)).length === 0);

    // Retroactive edit to 20 days ago → stale → urgent item keyed by that date
    const oldDate = ilDay(-20);
    await req('PUT', `/sessions/${s2.id}`, { session_date: oldDate });
    await req('POST', '/inbox/refresh');
    alerts = await clientAlerts(cid);
    const due = await dueFor(cid);
    assert('20 days since last held, nothing booked → stale', alerts.sessionSla.stale === true && alerts.sessionSla.daysSinceHeld === 20, JSON.stringify(alerts.sessionSla));
    assert('Stale → exactly one urgent session_due item', due.length === 1 && due[0].priority === 'urgent' && due[0].dedupe_key === `session_due:client:${cid}:after:${oldDate}`, JSON.stringify(due));
    assert('Only the next open slot turns red', alerts.windowAlerts.filter((w) => w.state === 'red').length === 1, JSON.stringify(alerts.windowAlerts));

    // Retroactive edit back inside 14 days → item auto-resolves
    await req('PUT', `/sessions/${s2.id}`, { session_date: ilDay(-2) });
    await req('POST', '/inbox/refresh');
    assert('Date edited back within 14 days → item auto-resolved', (await dueFor(cid)).length === 0);

    // Stale again, but an upcoming scheduled session suppresses the alert
    await req('PUT', `/sessions/${s2.id}`, { session_date: oldDate });
    await req('POST', `/clients/${cid}/sessions`, { session_date: ilDay(4), status: 'scheduled' });
    await req('POST', '/inbox/refresh');
    alerts = await clientAlerts(cid);
    assert('Upcoming session booked → not stale, no item', alerts.sessionSla.stale === false && alerts.sessionSla.hasUpcoming === true && (await dueFor(cid)).length === 0, JSON.stringify(alerts.sessionSla));
  }

  // ── Phase 4: inbox (action_queue), jobs, SSE ──────────────────────────────
  console.log('\n── Phase 4: inbox ──');
  {
    const overdue = async (name, phone) =>
      (await req('POST', '/clients', { full_name: name, phone, start_date: isoDaysFromToday(-60) })).data.id;
    const inbox = async () => (await req('GET', '/inbox')).data;
    const itemFor = (data, clientId, kind) => data.items.find((i) => i.client_id === clientId && i.kind === kind);

    // Rule → item, with a booking-link draft
    const c1 = await overdue('תיבה אחת', '0521310001');
    await req('POST', '/inbox/refresh');
    let box = await inbox();
    let it = itemFor(box, c1, 'session_due');
    assert('Overdue window → session_due inbox item', !!it && it.priority === 'urgent', JSON.stringify(box.items.slice(0, 3)));
    assert('Message draft carries the booking link', it?.category === 'message' && it.message?.includes(FOLLOWUP_LINK));
    assert('wa.me link prepared', (it?.whatsapp_link || '').startsWith('https://wa.me/972'));

    // Dedupe: refreshing again does not duplicate
    const dueIdsBefore = box.items.filter((i) => i.kind === 'session_due').map((i) => i.id).sort().join(',');
    await req('POST', '/inbox/refresh');
    box = await inbox();
    const dueIdsAfter = box.items.filter((i) => i.kind === 'session_due').map((i) => i.id).sort().join(',');
    assert('Refresh is idempotent (no duplicates)', dueIdsBefore === dueIdsAfter && box.items.filter((i) => i.client_id === c1 && i.kind === 'session_due').length === 1, `${dueIdsBefore} vs ${dueIdsAfter}`);

    // Approve (deeplink mode) → manual link returned, item leaves the inbox and never returns
    const ap = await req('POST', `/inbox/${it.id}/approve`);
    assert('Approve message → sent with manual wa.me link', ap.data?.status === 'sent' && ap.data?.delivered === 'manual' && ap.data?.whatsapp_link?.startsWith('https://wa.me/'), JSON.stringify(ap));
    await req('POST', '/inbox/refresh');
    box = await inbox();
    assert('Handled item is not recreated', !itemFor(box, c1, 'session_due'));

    // Dismiss
    const c2 = await overdue('תיבה שתיים', '0521310002');
    await req('POST', '/inbox/refresh');
    const it2 = itemFor(await inbox(), c2, 'session_due');
    await req('POST', `/inbox/${it2.id}/dismiss`);
    await req('POST', '/inbox/refresh');
    assert('Dismissed item stays dismissed', !itemFor(await inbox(), c2, 'session_due'));

    // Snooze hides the item until the time passes
    const c3 = await overdue('תיבה שלוש', '0521310003');
    await req('POST', '/inbox/refresh');
    const it3 = itemFor(await inbox(), c3, 'session_due');
    const sn = await req('POST', `/inbox/${it3.id}/snooze`, { hours: 24 });
    assert('Snooze accepted', sn.success && !!sn.data.snoozed_until);
    assert('Snoozed item hidden from the inbox', !itemFor(await inbox(), c3, 'session_due'));

    // Batch approve
    const c4 = await overdue('תיבה ארבע', '0521310004');
    const c5 = await overdue('תיבה חמש', '0521310005');
    await req('POST', '/inbox/refresh');
    box = await inbox();
    const ids = [itemFor(box, c4, 'session_due').id, itemFor(box, c5, 'session_due').id];
    const batch = await req('POST', '/inbox/batch', { ids, action: 'approve' });
    assert('Batch approve sends both', batch.data?.results?.length === 2 && batch.data.results.every((r) => r.status === 'sent' && r.whatsapp_link), JSON.stringify(batch));
    const badBatch = await req('POST', '/inbox/batch', { ids: [], action: 'approve' });
    assert('Empty batch rejected (400)', badBatch.status === 400);

    // Auto-resolve: the condition disappears → the pending item closes itself
    const c6 = await overdue('תיבה שש', '0521310006');
    await req('POST', '/inbox/refresh');
    assert('Item created for c6', !!itemFor(await inbox(), c6, 'session_due'));
    await req('POST', `/clients/${c6}/freeze`, { days: 30 });
    await req('POST', '/inbox/refresh');
    assert('Frozen client → pending item auto-resolved', !itemFor(await inbox(), c6, 'session_due'));

    // 24h reminder job → inbox (deeplink mode: no auto-send) → approve marks the meeting confirmed
    const target = new Date(Date.now() + 23 * 3600 * 1000);
    const date = target.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const time = target.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });
    const lead = await req('POST', '/leads', { full_name: 'בדיקת תזכורת אוטומטית', phone: '0521310007' });
    await req('POST', `/leads/${lead.data.id}/meeting`, { date, time, event_type: 'first_meeting' });
    const meeting = (await req('GET', `/leads/${lead.data.id}/meeting`)).data;
    const run = await req('POST', '/meetings/check-reminders');
    assert('Reminder job ran', run.success && run.data.count >= 1, JSON.stringify(run));
    const rem = (await inbox()).items.find((i) => i.kind === 'meeting_reminder' && i.meeting_id === meeting.id);
    assert('Reminder queued in inbox (no auto-send in deeplink mode)', !!rem && rem.priority === 'urgent');
    await req('POST', `/inbox/${rem.id}/approve`);
    const m2 = (await req('GET', `/leads/${lead.data.id}/meeting`)).data;
    assert('Approving the reminder marks the meeting confirmed', m2.confirmation_sent === 1);
    const run2 = await req('POST', '/meetings/check-reminders');
    assert('No second reminder for a confirmed meeting', run2.data.count === 0 && !(await inbox()).items.some((i) => i.meeting_id === meeting.id));

    const dash = await req('GET', '/dashboard');
    assert('Dashboard counter = open inbox items', dash.data.counters.inbox_open === (await inbox()).open);
  }

  // ── Phase 4: SSE stream pushes mutations ──────────────────────────────────
  {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/stream`, { headers: { Authorization: AUTH }, signal: ctrl.signal });
    assert('SSE stream opens (text/event-stream)', res.ok && (res.headers.get('content-type') || '').includes('text/event-stream'));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const got = new Promise((resolve) => {
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            if (buf.includes('event: mutation') && buf.includes('/leads')) { resolve(true); break; }
          }
        } catch { /* aborted */ }
        resolve(false);
      })();
    });
    await req('POST', '/leads', { full_name: 'בדיקת SSE', phone: '0521310008' });
    const received = await Promise.race([got, new Promise((r) => setTimeout(() => r(false), 3000))]);
    ctrl.abort();
    assert('Mutation broadcast received over SSE', received === true, buf.slice(0, 200));
    const noAuth = await fetch(`${BASE}/stream`);
    assert('SSE requires auth (401)', noAuth.status === 401);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──');
  {
    const r = await req('DELETE', `/clients/${clientId}`);
    assert('Delete client', r.success && r.data.id === clientId, JSON.stringify(r));
  }
  {
    const r = await req('DELETE', `/leads/${leadId}`);
    assert('Delete lead', r.success && r.data.id === leadId);
  }

  // ── 404 checks ────────────────────────────────────────────────────────────
  console.log('\n── 404 checks ──');
  {
    const r = await req('GET', '/clients/99999');
    assert('GET non-existent client returns 404', r.success === false);
  }
  {
    const r = await req('GET', '/leads/99999');
    assert('GET non-existent lead returns 404', r.success === false);
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
