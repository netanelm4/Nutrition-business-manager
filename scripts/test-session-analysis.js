/**
 * Phase 10: clinical session analysis → guardrails → review edits → import.
 * Runs against a live server started with AI_MOCK=1 on a scratch database
 * (mock transcription + mock model; the realistic draft is PUT as a "manual edit"
 * so every guardrail and import path is exercised deterministically).
 *
 *   node scripts/test-session-analysis.js
 */

const { applyGuards, quoteStatus, transcriptWarnings, applyWeekendDefaults } = require('../services/ai/session-analysis.service');

const BASE = process.env.TEST_BASE || 'http://localhost:3099/api';
let AUTH = '';
let passed = 0;
let failed = 0;

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

async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(300); }
}

// The mock transcript (services/ai/transcription.service.js) — client = דובר 2:
// "היה טוב, הקפדתי על ארוחת בוקר עם חלבון וירדתי חצי קילו."
const fact = (f, quote) => ({ fact: f, quote });
const DRAFT = {
  speaker_check: { labels_look_correct: true, note: '' },
  anamnesis: {
    summary: 'מטופל עם התמדה טובה בארוחת הבוקר וירידה של חצי קילו בשבוע האחרון.',
    medical_history: [fact('ללא רקע רפואי משמעותי', 'זה ציטוט שלא נאמר בפגישה בכלל')],
    medications: [fact('אומגה 3', '')],
    work_routine: [fact('עובד במשרד 9 עד 17', 'הקפדתי על ארוחת בוקר')],
    activity: [fact('הליכה שלוש פעמים בשבוע', 'ירדתי חצי קילו')],
    digestive: [], sleep: [],
    food_likes: [fact('יוגורט', 'ארוחת בוקר עם חלבון')],
    food_dislikes: [fact('לא אוהב קינואה', 'הקפדתי על ארוחת בוקר')],
    allergies_intolerances: [],
  },
  barriers: [{ type: 'late_night_eating', description: 'נשנוש בערב אחרי העבודה', quote: 'הקפדתי על ארוחת בוקר עם חלבון' }],
  meal_plan: {
    calorie_target_estimate: 500,
    calorie_rationale: 'ירידה הדרגתית',
    meals: [
      { meal: 'dinner', time_hint: '20:00', note: '', slots: [
        { slot: 'protein', portions: 2, note: '', options: [{ amount: '', food: 'ביצה' }, { amount: '2 משולשים', food: 'פיצה' }] },
        { slot: 'carb', portions: 0.5, note: '', options: [{ amount: '1', food: 'פיתה כוסמין' }, { amount: '4 כפות', food: 'קינואה' }] },
      ] },
      { meal: 'breakfast', time_hint: '08:00', note: '', slots: [
        { slot: 'protein', portions: 1, note: '', options: [{ amount: 'גביע', food: 'יוגורט' }] },
        { slot: 'carb', portions: 7, note: '', options: [{ amount: '2 פרוסות', food: 'לחם קל' }, { amount: '1', food: 'עוגת שמרים מיוחדת' }] },
      ] },
    ],
    daily_basket: { options_per_day: 5, kcal_per_option: 300, suggested_items: ['מנת פרי', 'פיצה משולש'], note: '' },
    friday: { guidelines: ['כף מכל סלט', 'ארוחה חופשית בערב שישי'] },
    saturday: { guidelines: ['חמין: 3 כפות פחמימה ומנת בשר'] },
    general_notes: ['לשתות 2.5 ליטר מים'],
  },
  habits: [
    { habit: 'שקילה פעם בשבוע', target: 'יום ראשון בבוקר', quote: '' },
    { habit: 'ארוחה חופשית פעם בשבוע', target: 'שבת', quote: '' },
    { habit: 'ארוחת בוקר עם חלבון', target: '5 ימים בשבוע', quote: '' },
    { habit: 'מנת ירק בצהריים', target: 'כל יום', quote: '' },
    { habit: 'הליכה', target: '3 פעמים בשבוע', quote: '' },
    { habit: 'שתייה', target: '2.5 ליטר', quote: '' },
  ],
  open_questions: ['האם יש רגישות ללקטוז?'],
};

async function run() {
  console.log('\n══ Phase 10: session analysis ══\n');

  // ── Pure guardrails (no server) ──
  console.log('── guardrails (unit) ──');
  {
    const { analysis: g, warnings } = applyGuards(DRAFT, {
      clientText: 'היה טוב, הקפדתי על ארוחת בוקר עם חלבון וירדתי חצי קילו.',
      kbIndex: { protein: ['ביצה', 'יוגורט'], carb: ['פיתה כוסמין', 'לחם קל', 'קינואה'] },
      fallbackCalories: 1800,
    });
    const text = JSON.stringify(g.meal_plan) + JSON.stringify(g.habits);
    assert('Free meal removed from plan, basket, weekend and habits', !/פיצה|ארוחה חופשית/.test(text), text.match(/פיצה|ארוחה חופשית/)?.[0]);
    assert('"שקילה פעם בשבוע" kept (not a free meal)', g.habits.some((h) => h.habit === 'שקילה פעם בשבוע'));
    assert('Habits capped at 4', g.habits.length === 4, String(g.habits.length));
    assert('Daily basket clamped to 3 × 120 kcal', g.meal_plan.daily_basket.options_per_day === 3 && g.meal_plan.daily_basket.kcal_per_option === 120);
    assert('Calorie target out of range → fallback 1800', g.meal_plan.calorie_target_estimate === 1800);
    assert('Meals sorted breakfast → dinner', g.meal_plan.meals[0].meal === 'breakfast' && g.meal_plan.meals[1].meal === 'dinner');
    assert('Slot portions clamped to 4', g.meal_plan.meals[0].slots[1].portions === 4);
    const opts = g.meal_plan.meals[0].slots[1].options;
    assert('Foods marked in / outside the knowledge base', opts[0].in_kb === true && opts[1].in_kb === false);
    assert('Quote check: exact / unverified / missing',
      g.anamnesis.work_routine[0].quote_status === 'exact' && g.anamnesis.medical_history[0].quote_status === 'unverified' && g.anamnesis.medications[0].quote_status === 'missing');
    assert('Warnings explain every correction', warnings.some((w) => /ארוחה חופשית/.test(w)) && warnings.some((w) => /הסל היומי/.test(w))
      && warnings.some((w) => /4 הרגלים/.test(w)) && warnings.some((w) => /קינואה/.test(w)) && warnings.some((w) => /ציטוט/.test(w)), JSON.stringify(warnings));
    const garble = transcriptWarnings('דובר 2: דגים אני לא אוהב בכלל וגם qwtgxd7xb3 לא.');
    assert('Garbled transcript token flagged with context', garble.length === 1 && garble[0].includes('"qwtgxd7xb3"') && garble[0].includes('אוהב בכלל וגם qwtgxd7xb3 לא'), JSON.stringify(garble));
    assert('Allowed Latin words and numbers are not flagged', transcriptWarnings('אוכל Fitbar, 2 כוסות, שולח ב-WhatsApp, 120 kcal').length === 0);
    // Weekend default from a knowledge base (in-memory stand-in for the knowledge_base row)
    const kbDoc = { recurring_sections: { saturday: { recurring_lines: [
      { text: 'יום שבת - אין סל יומי', clients: 53 }, { text: 'יום שבת - אופציה אחת מהסל היומי', clients: 23 },
      { text: 'בוקר : קפה + חתיכת עוגה בעובי ואורך של אצבע', clients: 4 }, { text: 'צהריים : כמו ארוחת שישי', clients: 8 },
      { text: 'ערב*2 : מנות חלבון 2-3 + מנות ירק', clients: 5 }, { text: 'ערב : כמו ערב רגיל שכתוב בתפריט', clients: 4 },
      { text: 'ארוחה חופשית בשבת', clients: 9 },
    ] } } };
    const fakeDb = { prepare: () => ({ get: () => ({ content: JSON.stringify(kbDoc) }) }) };
    const plan = { meal_plan: { friday: { guidelines: ['כף מכל סלט'] }, saturday: { guidelines: [] } } };
    const w = applyWeekendDefaults(fakeDb, plan);
    assert('Saturday not discussed → method default, clearly marked',
      JSON.stringify(plan.meal_plan.saturday.guidelines) === JSON.stringify(['(ברירת מחדל מהשיטה, לא נדון בפגישה)', 'אין סל יומי',
        'בוקר: קפה + חתיכת עוגה בעובי ואורך של אצבע', 'צהריים: כמו ארוחת שישי', 'ערב: כמו ערב רגיל שכתוב בתפריט']),
      JSON.stringify(plan.meal_plan.saturday.guidelines));
    assert('Discussed Friday untouched; warning names Saturday', plan.meal_plan.friday.guidelines.length === 1 && w.length === 1 && w[0].includes('שבת') && !w[0].includes('שישי'));
    assert('quoteStatus tolerates punctuation', quoteStatus('הקפדתי, על ארוחת בוקר!', 'היה טוב הקפדתי על ארוחת בוקר עם חלבון') === 'exact');
  }

  const login = await req('POST', '/auth/login', { name: process.env.TEST_USER || 'test-runner', password: process.env.TEST_PASSWORD || 'test' });
  AUTH = `Bearer ${login.data?.token}`;
  assert('Logged in', !!login.data?.token);

  // ── Setup: client, session 1 with an intake that already has work_hours, a transcribed recording ──
  const client = (await req('POST', '/clients', { full_name: 'מטופל ניתוח', phone: '0527400001', start_date: '2026-11-01' })).data;
  const session = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-11-01', weight: 82 })).data;
  await req('POST', `/sessions/${session.id}/intake`, { work_hours: '8-16 (הוזן ידנית)' });

  console.log('── run ──');
  let g = await req('GET', `/sessions/${session.id}/analysis`);
  assert('No transcript yet → cannot analyze', g.success && g.data.can_analyze === false && g.data.analysis === null);
  assert('POST without transcript → 409', (await req('POST', `/sessions/${session.id}/analysis`)).status === 409);

  const form = new FormData();
  form.append('audio', new Blob([Buffer.alloc(4096, 1)], { type: 'audio/webm' }), 'blob');
  const rec = (await fetch(`${BASE}/sessions/${session.id}/recording`, { method: 'POST', headers: { Authorization: AUTH }, body: form }).then((r) => r.json())).data;
  await waitFor(async () => (await req('GET', `/sessions/${session.id}/recording`)).data.find((r) => r.id === rec.id)?.transcript_status === 'done');

  const recs = (await req('GET', `/sessions/${session.id}/recording`)).data;
  assert('Recording exposes the dietitian speaker (default דובר 1)', recs[0].dietitian_speaker === 'דובר 1');
  assert('Speaker swap validation (400)', (await req('PUT', `/sessions/${session.id}/recording/${rec.id}/speakers`, { dietitian: 'x' })).status === 400);
  const sw = await req('PUT', `/sessions/${session.id}/recording/${rec.id}/speakers`, { dietitian: 'דובר 2' });
  assert('Speaker swap saved', sw.success && (await req('GET', `/sessions/${session.id}/recording`)).data[0].dietitian_speaker === 'דובר 2');
  await req('PUT', `/sessions/${session.id}/recording/${rec.id}/speakers`, { dietitian: 'דובר 1' });

  const start = await req('POST', `/sessions/${session.id}/analysis`);
  assert('Analysis starts asynchronously (202 running)', start.status === 202 && start.data.status === 'running', JSON.stringify(start));
  assert('Second start while running → 409', (await req('POST', `/sessions/${session.id}/analysis`)).status === 409);
  const done = await waitFor(async () => { const r = await req('GET', `/sessions/${session.id}/analysis`); return r.data.analysis?.status !== 'running' && r.data.analysis; });
  assert('Analysis finished as a draft', done?.status === 'draft' && !!done.analysis?.meal_plan, JSON.stringify(done).slice(0, 200));
  assert('Model output passed the guardrails (basket corrected)', done.analysis.meal_plan.daily_basket.options_per_day >= 2 && done.warnings.length > 0);

  // ── Review edits (the realistic draft), guardrails re-applied on save ──
  console.log('── review ──');
  assert('Invalid draft shape → 400', (await req('PUT', `/sessions/${session.id}/analysis`, { analysis: { hello: 1 } })).status === 400);
  const saved = await req('PUT', `/sessions/${session.id}/analysis`, { analysis: DRAFT });
  const a = saved.data?.analysis;
  assert('Edited draft saved and guarded', saved.success && saved.data.edited === true && !/פיצה|ארוחה חופשית/.test(JSON.stringify(a.meal_plan) + JSON.stringify(a.habits)), JSON.stringify(saved).slice(0, 300));
  assert('Quotes checked against the real client lines', a.anamnesis.work_routine[0].quote_status === 'exact' && a.anamnesis.medical_history[0].quote_status === 'unverified');
  assert('Knowledge-base check uses the loaded KB', a.meal_plan.meals[0].slots[1].options.some((o) => o.food === 'לחם קל' && o.in_kb === true));

  // ── Import ──
  console.log('── import ──');
  const imp = await req('POST', `/sessions/${session.id}/analysis/import`, { targets: ['notes'] });
  assert('Import notes', imp.success && imp.data.results.notes?.tasks_added === 4, JSON.stringify(imp).slice(0, 200));
  let s = (await req('GET', `/sessions/${session.id}`)).data;
  assert('SOAP S has the summary and anamnesis', s.soap_notes.subjective.includes('התמדה טובה') && s.soap_notes.subjective.includes('שגרת עבודה'));
  assert('SOAP A has the barriers, P has habits + open questions', s.soap_notes.assessment.includes('אכילה בשעות הלילה') && s.soap_notes.plan.includes('שקילה פעם בשבוע') && s.soap_notes.plan.includes('לקטוז'));
  assert('Habits added as pending session tasks', s.tasks.filter((t) => t.status === 'pending' && /שקילה פעם בשבוע|ארוחת בוקר עם חלבון/.test(t.text)).length === 2);
  assert('Empty highlights filled with the summary', s.highlights.includes('התמדה טובה'));

  const again = await req('POST', `/sessions/${session.id}/analysis/import`, { targets: ['notes'] });
  s = (await req('GET', `/sessions/${session.id}`)).data;
  assert('Importing notes again is skipped (no duplicate tasks)', again.data.skipped.includes('notes') && s.tasks.length === 4);

  const intake = await req('POST', `/sessions/${session.id}/analysis/import`, { targets: ['intake'] });
  const ir = intake.data?.results?.intake;
  assert('Intake: empty fields filled', ir && ir.filled.includes('activity_type') && ir.filled.includes('favorite_foods') && ir.filled.includes('medications'), JSON.stringify(ir));
  assert('Intake: manual value kept, reported as conflict', ir.conflicts.some((c) => c.field === 'work_hours'));
  const intakeRow = (await req('GET', `/sessions/${session.id}/intake`)).data;
  assert('Intake row: manual work_hours untouched, activity filled', intakeRow.work_hours === '8-16 (הוזן ידנית)' && intakeRow.activity_type.includes('הליכה'), JSON.stringify({ w: intakeRow.work_hours, a: intakeRow.activity_type }));

  const menuImp = await req('POST', `/sessions/${session.id}/analysis/import`, { targets: ['menu'] });
  const menuId = menuImp.data?.results?.menu?.menuId;
  assert('Menu draft created', !!menuId && menuImp.data.analysis.menu_id === menuId, JSON.stringify(menuImp).slice(0, 200));
  const menu = await fetch(`${BASE}/menus/${menuId}`, { headers: { Authorization: AUTH } }).then((r) => r.json());
  const names = menu.meals.map((m) => m.meal_name);
  assert('Menu: draft status, calorie target from the plan', menu.menu.status === 'draft' && menu.menu.calorie_target === 1600 && menu.menu.title.includes('פגישה'), JSON.stringify(menu.menu));
  assert('Menu meals: breakfast, dinner, daily basket, Friday, Saturday', JSON.stringify(names) === JSON.stringify(['ארוחת בוקר', 'ארוחת ערב', 'סל יומי', 'יום שישי', 'יום שבת']), JSON.stringify(names));
  const items = menu.meals.flatMap((m) => m.items);
  assert('Slot items carry type, portions and alternatives', items.some((i) => i.item_type === 'carb' && i.portions === 4 && i.custom_text.includes('2 פרוסות לחם קל')));
  assert('Daily basket: 3 options, 120 kcal each (meal note)', items.some((i) => i.item_type === 'daily_basket' && i.portions === 3)
    && menu.meals.find((m) => m.meal_name === 'סל יומי')?.notes.includes('3 אופציות, כ-120'));
  assert('Weekend guidelines as custom items, no free meal', items.filter((i) => i.item_type === 'custom').length === 2 && !items.some((i) => /ארוחה חופשית|פיצה/.test(i.custom_text)));
  const list = await fetch(`${BASE}/menus?client_id=${client.id}`, { headers: { Authorization: AUTH } }).then((r) => r.json());
  assert('Menu listed under the client (תפריטים)', list.menus.some((m) => m.id === menuId));

  // ── Re-run / discard ──
  console.log('── re-run and discard ──');
  assert('Re-run after import without force → 409', (await req('POST', `/sessions/${session.id}/analysis`)).status === 409);
  const forced = await req('POST', `/sessions/${session.id}/analysis`, { force: true });
  assert('Re-run with force → 202, import flags reset', forced.status === 202 && forced.data.imported.menu === null);
  await waitFor(async () => (await req('GET', `/sessions/${session.id}/analysis`)).data.analysis?.status === 'draft');
  const menuStill = await fetch(`${BASE}/menus/${menuId}`, { headers: { Authorization: AUTH } }).then((r) => r.json());
  assert('Previously imported menu kept after re-run', menuStill.menu?.id === menuId);
  const del = await req('DELETE', `/sessions/${session.id}/analysis`);
  assert('Discard draft', del.success && (await req('GET', `/sessions/${session.id}/analysis`)).data.analysis === null);
  assert('Import with no draft → 404', (await req('POST', `/sessions/${session.id}/analysis/import`, { targets: ['notes'] })).status === 404);

  await req('DELETE', `/clients/${client.id}`);
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });

module.exports = { DRAFT };
