/**
 * Smoke test — runs every API route end-to-end against a live server.
 * Start the server first: AUTH_PASSWORD=test PORT=3099 node server.js
 * Then run: node scripts/test-routes.js
 */

const BASE = 'http://localhost:3099/api';
const AUTH = 'Bearer test';

let passed = 0;
let failed = 0;
let leadId, clientId, sessionId, windowId;

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, ...json };
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

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Nutrition CRM — API Smoke Test');
  console.log('══════════════════════════════════════════\n');

  // ── Auth ──────────────────────────────────────────────────────────────────
  console.log('── Auth ──');
  {
    const r = await req('GET', '/clients');
    assert('Auth passes with correct password', r.success === true);
  }
  {
    const res = await fetch(`${BASE}/clients`, { headers: { Authorization: 'Bearer wrong' } });
    assert('Auth rejects wrong password', res.status === 401);
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

  // ── Lead → Client conversion ───────────────────────────────────────────────
  console.log('\n── Lead conversion ──');
  {
    const r = await req('POST', `/leads/${leadId}/convert`);
    assert('Convert lead returns pre-fill data', r.success && r.data.full_name === 'ישראל ישראלי');
    assert('Convert sets converted_from_lead_id', r.data.converted_from_lead_id === leadId);

    // Confirm lead status updated
    const lead = await req('GET', `/leads/${leadId}`);
    assert('Lead status is became_client', lead.data.status === 'became_client');
  }
  {
    // Double-convert should fail
    const r = await req('POST', `/leads/${leadId}/convert`);
    assert('Double-convert returns 409', r.success === false);
  }

  // ── Clients ────────────────────────────────────────────────────────────────
  console.log('\n── Clients ──');
  {
    const r = await req('POST', '/clients', {
      full_name: 'ישראל ישראלי',
      phone: '0501234567',
      age: 35,
      gender: 'male',
      start_date: '2026-03-01',
      goal: 'ירידה במשקל',
      initial_weight: 90.5,
      converted_from_lead_id: leadId,
    });
    assert('Create client', r.success && r.data.id, JSON.stringify(r));
    assert('process_end_date auto-calculated', r.data.process_end_date === '2026-05-30');
    assert('Alerts object present', r.data.alerts !== undefined);
    clientId = r.data?.id;
  }
  {
    const r = await req('GET', `/clients/${clientId}/windows`);
    assert('6 session windows created', r.success && r.data.length === 6);
    windowId = r.data?.[2]?.id; // grab window 3 for override test
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
      ai_flags: [{ text: 'קושי רגשי בסוף שבוע — לבדוק בפגישה הבאה', saved_for_next: false }],
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
    const r = await req('POST', `/clients/${clientId}/sessions`, {
      session_date: '2026-03-15',
      weight: 89.8,
    });
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
    assert('List templates', r.success && r.data.length === 5);
  }
  {
    const r = await req('GET', '/templates');
    const welcomeTemplate = r.data.find((t) => t.trigger_event === 'welcome');
    const render = await req('POST', '/templates/render', {
      templateId: welcomeTemplate.id,
      clientId,
    });
    assert('Render template', render.success && render.data.rendered_text.includes('ישראל ישראלי'));
    assert('whatsapp_link returned', render.data.whatsapp_link.startsWith('https://wa.me/'));
    assert('whatsapp_mode returned', render.data.whatsapp_mode === 'deeplink');
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  console.log('\n── Dashboard ──');
  {
    const r = await req('GET', '/dashboard');
    assert('Dashboard returns success', r.success === true);
    assert('Has weekly_sessions array', Array.isArray(r.data.weekly_sessions));
    assert('Has alerts array', Array.isArray(r.data.alerts));
    assert('Has counters', typeof r.data.counters === 'object');
    assert('active_clients counter > 0', r.data.counters.active_clients > 0);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──');
  {
    const r = await req('DELETE', `/clients/${clientId}`);
    assert('Delete client', r.success && r.data.id === clientId);

    // Verify sessions and windows were cascade-deleted
    const sessCheck = await req('GET', `/sessions/${sessionId}`);
    assert('Sessions cascade-deleted', sessCheck.success === false);
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

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
