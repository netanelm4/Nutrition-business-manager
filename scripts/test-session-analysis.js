/**
 * Phase 10: clinical session analysis → guardrails → review edits → import.
 * Runs against a live server started with AI_MOCK=1 on a scratch database
 * (mock transcription + mock model; the realistic draft is PUT as a "manual edit"
 * so every guardrail and import path is exercised deterministically).
 *
 *   node scripts/test-session-analysis.js
 */

const { applyGuards, quoteStatus, transcriptWarnings, applyWeekendDefaults } = require('../services/ai/session-analysis.service');
const { applyFollowUpGuards } = require('../services/ai/session-followup.service');

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
  assert('Our DIETITIAN / CLIENT labels never flagged as transcription errors', !done.warnings.some((w) => /DIETITIAN|CLIENT|SPEAKER/.test(w)), JSON.stringify(done.warnings));
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

  await followUpSuite();

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

// ─── Follow-up sessions ──────────────────────────────────────────────────────

const menuApi = (method, p, body) => fetch(`${BASE}/menus${p}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: AUTH }, body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());

async function followUpSuite() {
  console.log('── follow-up: guardrails (unit) ──');
  {
    const menu = { menu: { id: 1 }, meals: [
      { id: 10, meal_name: 'ארוחת ערב', time_label: '20:00', items: [{ id: 100, item_type: 'carb', portions: 1, custom_text: '4 כפות אורז \\ פיתה כוסמין' }] },
      { id: 11, meal_name: 'סל יומי', items: [{ id: 110, item_type: 'daily_basket', portions: 2, custom_text: 'מנת פרי \\ שוקולד אישי' }] },
      { id: 12, meal_name: 'יום שבת', items: [] },
    ] };
    const ch = (o) => ({ change_type: 'portion', meal_id: 0, item_id: 0, item_type: 'custom', current: '', proposed: '', proposed_portions: 0, proposed_time: '', reason: 'r', quote: '', ...o });
    const draft = {
      speaker_labels_ok: true, speaker_note: '', summary: 's', what_worked: [], difficulties: [], client_requests: [], reported_weight_kg: 500,
      previous_habits: [], barriers: [], new_clinical_info: [], open_questions: [],
      habits: [{ habit: 'ארוחה חופשית בשבת', target: 'x', quote: '' }, { habit: 'שקילה פעם בשבוע', target: 'ראשון', quote: '' }],
      menu_changes: [
        ch({ change_type: 'portion', item_id: 100, proposed_portions: 1.3, current: 'הועתק לא נכון' }),
        ch({ change_type: 'basket_variety', item_id: 0, proposed: 'מנת פרי \\ פתיבר', proposed_portions: 5 }),
        ch({ change_type: 'swap_option', item_id: 999, proposed: 'x' }),
        ch({ change_type: 'timing', meal_id: 10, proposed_time: '19:00' }),
        ch({ change_type: 'weekend', meal_id: 0, proposed: 'בשבת: כף מכל סלט' }),
        ch({ change_type: 'add_option', item_id: 100, proposed: 'פיצה 2 משולשים' }),
        ch({ change_type: 'other', proposed: 'לשקול תוסף' }),
      ],
    };
    const { analysis: g, warnings } = applyFollowUpGuards(draft, { clientText: '', menu });
    const by = (t) => g.menu_changes.find((c) => c.change_type === t);
    assert('FU: cheat proposal and free-meal habit removed', !JSON.stringify(g).includes('פיצה') && g.habits.length === 1 && g.habits[0].habit === 'שקילה פעם בשבוע');
    assert('FU: portion resolved, half-step rounded, current text from the menu', by('portion').valid && by('portion').proposed_portions === 1.5 && by('portion').current.startsWith('4 כפות אורז') && by('portion').meal_id === 10);
    assert('FU: basket change finds the basket item, options clamped to 3', by('basket_variety').valid && by('basket_variety').item_id === 110 && by('basket_variety').proposed_portions === 3);
    assert('FU: unknown item → invalid, not approved', by('swap_option').valid === false && by('swap_option').approved === false && /לא נמצא/.test(by('swap_option').problem));
    assert('FU: weekend change attached to the Saturday meal', by('weekend').valid && by('weekend').meal_id === 12);
    assert('FU: timing valid, current time from the menu', by('timing').valid && by('timing').current === '20:00');
    assert('FU: "other" kept for review but never applied', by('other').valid === false && by('other').approved === false);
    assert('FU: implausible reported weight dropped', g.reported_weight_kg === 0 && warnings.some((w) => /משקל/.test(w)));
    assert('FU: no menu → every change invalid with a hint', applyFollowUpGuards(draft, { menu: null }).analysis.menu_changes.every((c) => !c.valid));
  }

  console.log('── follow-up: flow ──');
  const client = (await req('POST', '/clients', { full_name: 'מטופל מעקב', phone: '0527400002', start_date: '2026-10-01' })).data;
  const s1 = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-10-01', weight: 84 })).data;
  await req('PUT', `/sessions/${s1.id}`, { tasks: [{ id: 't1', text: 'ארוחת בוקר עם חלבון', status: 'pending' }] });
  // the active menu (as created in the menu editor)
  const m = (await menuApi('POST', '', { client_id: client.id, title: 'תפריט ראשון', calorie_target: 1800 })).menu;
  const lunch = (await menuApi('POST', `/${m.id}/meals`, { name: 'ארוחת צהריים', time_label: '13:00', meal_order: 1 })).meal;
  const dinner = (await menuApi('POST', `/${m.id}/meals`, { name: 'ארוחת ערב', time_label: '20:00', meal_order: 2 })).meal;
  const basket = (await menuApi('POST', `/${m.id}/meals`, { name: 'סל יומי', meal_order: 3 })).meal;
  const sat = (await menuApi('POST', `/${m.id}/meals`, { name: 'יום שבת', meal_order: 4 })).meal;
  const protein = (await menuApi('POST', `/${m.id}/meals/${lunch.id}/items`, { item_type: 'protein', portions: 1, custom_text: '2 חתיכות חזה עוף \\ 3 קציצות' })).item;
  const carb = (await menuApi('POST', `/${m.id}/meals/${dinner.id}/items`, { item_type: 'carb', portions: 1, custom_text: '4 כפות אורז \\ פיתה כוסמין' })).item;
  await menuApi('POST', `/${m.id}/meals/${basket.id}/items`, { item_type: 'daily_basket', portions: 2, custom_text: 'מנת פרי \\ שוקולד אישי' });
  const before = JSON.stringify((await menuApi('GET', `/${m.id}`)).meals);

  const s2 = (await req('POST', `/clients/${client.id}/sessions`, { session_date: '2026-10-15' })).data;
  const form = new FormData();
  form.append('audio', new Blob([Buffer.alloc(4096, 1)], { type: 'audio/webm' }), 'blob');
  const rec = (await fetch(`${BASE}/sessions/${s2.id}/recording`, { method: 'POST', headers: { Authorization: AUTH }, body: form }).then((r) => r.json())).data;
  await waitFor(async () => (await req('GET', `/sessions/${s2.id}/recording`)).data.find((r) => r.id === rec.id)?.transcript_status === 'done');

  const info = (await req('GET', `/sessions/${s2.id}/analysis`)).data;
  assert('Session 2 → suggested mode follow_up, active menu found', info.suggested_mode === 'follow_up' && info.active_menu?.id === m.id, JSON.stringify(info));
  assert('Invalid mode → 400', (await req('POST', `/sessions/${s2.id}/analysis`, { mode: 'x' })).status === 400);
  const start = await req('POST', `/sessions/${s2.id}/analysis`);
  assert('Run defaults to follow-up mode', start.status === 202 && start.data.mode === 'follow_up');
  const done = await waitFor(async () => { const r = (await req('GET', `/sessions/${s2.id}/analysis`)).data.analysis; return r?.status === 'draft' && r; });
  assert('Follow-up: role labels not flagged as transcription errors', !done.warnings.some((w) => /DIETITIAN|CLIENT/.test(w)), JSON.stringify(done.warnings));
  assert('Follow-up draft: no anamnesis / meal plan, has menu_changes, base menu recorded',
    done && !done.analysis.anamnesis && !done.analysis.meal_plan && Array.isArray(done.analysis.menu_changes) && done.base_menu_id === m.id, JSON.stringify(done).slice(0, 200));

  const ch = (o) => ({ change_type: 'portion', meal_id: 0, item_id: 0, item_type: 'custom', current: '', proposed: '', proposed_portions: 0, proposed_time: '', reason: 'סוכם בפגישה', quote: '', ...o });
  const FU = {
    speaker_labels_ok: true, speaker_note: '',
    summary: 'שבוע טוב עם הקפדה על ארוחת בוקר. קושי בערבים.',
    what_worked: [{ text: 'ארוחת בוקר עם חלבון', quote: 'הקפדתי על ארוחת בוקר עם חלבון' }],
    difficulties: [{ text: 'נשנושים בערב', quote: 'זה לא נאמר' }],
    client_requests: [{ text: 'לאכול ארוחת ערב מוקדם יותר', quote: '' }],
    reported_weight_kg: 83.5,
    previous_habits: [{ habit: 'ארוחת בוקר עם חלבון', status: 'kept', quote: 'הקפדתי על ארוחת בוקר' }],
    barriers: [{ type: 'late_night_eating', description: 'נשנוש בערב', quote: 'הקפדתי' }],
    menu_changes: [
      ch({ change_type: 'portion', item_id: carb.id, proposed_portions: 1.5 }),
      ch({ change_type: 'timing', meal_id: dinner.id, proposed_time: '19:00' }),
      ch({ change_type: 'swap_option', item_id: protein.id, proposed: '2 חתיכות חזה עוף \\ 2 חתיכות פרגית' }),
      ch({ change_type: 'add_item', meal_id: lunch.id, item_type: 'vegetable', proposed: 'סלט ירקות גדול', proposed_portions: 2 }),
      ch({ change_type: 'basket_variety', proposed: 'מנת פרי \\ פתיבר \\ גלידה אישית', proposed_portions: 3 }),
      ch({ change_type: 'weekend', meal_id: sat.id, proposed: 'בשבת: כף מכל סלט', approved: false }),
      ch({ change_type: 'swap_option', item_id: 999999, proposed: 'לא קיים' }),
      ch({ change_type: 'add_option', item_id: carb.id, proposed: 'פיצה 2 משולשים' }),
    ],
    new_clinical_info: [], open_questions: ['איך היה השבוע בעבודה?'],
    habits: [
      { habit: 'ארוחת ערב עד 19:30', target: '5 ערבים', quote: '' },
      { habit: 'ארוחה חופשית בשבת', target: 'שבת', quote: '' },
      { habit: 'מתוק רק מהסל היומי', target: 'כל יום', quote: '' },
    ],
  };
  const saved = await req('PUT', `/sessions/${s2.id}/analysis`, { analysis: FU });
  const sa = saved.data?.analysis;
  assert('Follow-up edit saved with follow-up schema', saved.success && sa.menu_changes.length === 7, JSON.stringify(saved).slice(0, 300));
  assert('Cheat change and free-meal habit removed', !JSON.stringify(sa).includes('פיצה') && sa.habits.length === 2);
  assert('Unknown item flagged invalid; rejected change stays unapproved',
    sa.menu_changes.find((c) => c.item_id === 999999).valid === false && sa.menu_changes.find((c) => c.change_type === 'weekend').approved === false);
  assert('Quotes checked against client lines', sa.what_worked[0].quote_status === 'exact' && sa.difficulties[0].quote_status === 'unverified');

  assert('Intake import refused in follow-up mode (400)', (await req('POST', `/sessions/${s2.id}/analysis/import`, { targets: ['intake'] })).status === 400);
  const notes = await req('POST', `/sessions/${s2.id}/analysis/import`, { targets: ['notes'] });
  assert('Import follow-up notes', notes.success && notes.data.results.notes.tasks_added === 2, JSON.stringify(notes).slice(0, 200));
  const s2r = (await req('GET', `/sessions/${s2.id}`)).data;
  assert('SOAP: progress in S, previous habits in A, approved changes + habits in P',
    s2r.soap_notes.subjective.includes('מה עבד') && s2r.soap_notes.assessment.includes('ארוחת בוקר עם חלבון: נשמר')
    && s2r.soap_notes.plan.includes('שעת ארוחה: 19:00 (במקום: 20:00)') && s2r.soap_notes.plan.includes('נוסף: 2 חתיכות פרגית; הוסר: 3 קציצות') && !s2r.soap_notes.plan.includes('סוף שבוע') && s2r.soap_notes.plan.includes('ארוחת ערב עד 19:30'), JSON.stringify(s2r.soap_notes));
  assert('Reported weight recorded on the session', s2r.weight === 83.5);

  const mi = await req('POST', `/sessions/${s2.id}/analysis/import`, { targets: ['menu'] });
  const newId = mi.data?.results?.menu?.menuId;
  assert('New menu version created (5 applied, 2 skipped)', newId && newId !== m.id && mi.data.results.menu.applied === 5 && mi.data.results.menu.skipped === 2, JSON.stringify(mi.data?.results));
  assert('Original menu untouched', JSON.stringify((await menuApi('GET', `/${m.id}`)).meals) === before);
  const nm = await menuApi('GET', `/${newId}`);
  const items = nm.meals.flatMap((x) => x.items);
  const mealNamed = (n) => nm.meals.find((x) => x.meal_name === n);
  assert('Version title, draft status, same calorie target', nm.menu.title === 'עדכון מפגישה 2' && nm.menu.status === 'draft' && nm.menu.calorie_target === 1800);
  assert('Portion change applied', items.find((i) => i.custom_text.startsWith('4 כפות אורז')).portions === 1.5);
  assert('Timing change applied', mealNamed('ארוחת ערב').time_label === '19:00');
  assert('Swap applied', items.some((i) => i.custom_text.includes('2 חתיכות פרגית')));
  assert('New item added to lunch', mealNamed('ארוחת צהריים').items.some((i) => i.item_type === 'vegetable' && i.custom_text === 'סלט ירקות גדול' && i.portions === 2));
  assert('Basket variety applied (3 options)', items.some((i) => i.item_type === 'daily_basket' && i.custom_text.includes('פתיבר') && i.portions === 3));
  assert('Rejected weekend change not applied', mealNamed('יום שבת').items.length === 0);
  assert('Change log in the new version notes', nm.menu.notes.includes('יומן שינויים, פגישה 2') && nm.menu.notes.includes('מבוסס על "תפריט ראשון"') && nm.menu.notes.includes('19:00'), nm.menu.notes);

  const again = await req('PUT', `/sessions/${s2.id}/analysis`, { analysis: sa });
  const afterImport = (await req('GET', `/sessions/${s2.id}/analysis`)).data;
  assert('GET reports the base menu (not the newer version)', afterImport.base_menu?.id === m.id && afterImport.active_menu?.id !== undefined);
  assert('Edits after import still resolve against the base menu', again.success && again.data.analysis.menu_changes.filter((c) => c.valid).length === 6, JSON.stringify(again.data?.analysis?.menu_changes?.map((c) => c.valid)));

  const asIntake = await req('POST', `/sessions/${s2.id}/analysis`, { mode: 'intake', force: true });
  assert('Mode can be overridden to intake', asIntake.status === 202 && asIntake.data.mode === 'intake');
  await waitFor(async () => (await req('GET', `/sessions/${s2.id}/analysis`)).data.analysis?.status === 'draft');
  assert('Intake-mode draft produced for the same session', !!(await req('GET', `/sessions/${s2.id}/analysis`)).data.analysis.analysis.meal_plan);

  await req('DELETE', `/clients/${client.id}`);
}

if (require.main === module) run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });

module.exports = { DRAFT };
