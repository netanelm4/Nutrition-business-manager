/**
 * Smoke test — runs API routes end-to-end against a live server.
 *
 * ALWAYS run against a throwaway DB copy, never the real one:
 *   cp data/nutrition.db /tmp/test.db
 *   DB_PATH=/tmp/test.db PORT=3099 \
 *   WHATSAPP_APP_SECRET=test-meta-secret BOOKING_LINK_FOLLOWUP=https://calendar.app.google/test-followup \
 *   node server.js
 * The DB needs a user matching TEST_USER / TEST_PASSWORD (defaults below).
 * Then run: node scripts/test-routes.js
 */

const crypto = require('crypto');

const BASE          = process.env.TEST_BASE     || 'http://localhost:3099/api';
const TEST_USER     = process.env.TEST_USER     || 'test-runner';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'test';
const META_SECRET     = process.env.WHATSAPP_APP_SECRET          || 'test-meta-secret';
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

  // ── Phase 0: webhook signatures ─────────────────────────────────────────────
  console.log('\n── Phase 0: webhook signatures ──');
  {
    const body = JSON.stringify({ entry: [] });
    const good = 'sha256=' + crypto.createHmac('sha256', META_SECRET).update(body).digest('hex');
    const json = { 'Content-Type': 'application/json' };
    assert('WhatsApp webhook without signature → 401',
      (await raw('POST', '/whatsapp/webhook', { body, headers: json })) === 401);
    assert('WhatsApp webhook with wrong signature → 401',
      (await raw('POST', '/whatsapp/webhook', { body, headers: { ...json, 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) } })) === 401);
    assert('WhatsApp webhook with valid signature → 200',
      (await raw('POST', '/whatsapp/webhook', { body, headers: { ...json, 'X-Hub-Signature-256': good } })) === 200);
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

  // ── Phase 1: handled recommendations disappear ──────────────────────────────
  console.log('\n── Phase 1: recommendations ──');
  {
    const r1 = await req('GET', '/ai-recommendations');
    const rec = (r1.data || []).find((x) => x.client_id === overdueId && x.type === 'freeze_reminder');
    assert('Freeze reminder visible for frozen client', !!rec);
    await req('POST', `/ai-recommendations/${rec?.id}/sent`);
    const r2 = await req('GET', '/ai-recommendations');
    assert('Sent recommendation no longer listed', !(r2.data || []).some((x) => x.id === rec?.id));
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
    assert('confirmation_sent = 1', m.data?.confirmation_sent === 1);
    assert('Confirmation link is wa.me', (m.data?.confirmation_link || '').startsWith('https://wa.me/'));
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
