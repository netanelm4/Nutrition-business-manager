/**
 * Phase 9: knowledge base storage, sanitizing (no weekly free meal) and views.
 * Runs against a live server on a scratch database:
 *
 *   node scripts/test-knowledge-base.js
 *
 * Ends by re-uploading data/dietitian-knowledge-base.json (if present) so the
 * server is left with the real knowledge base.
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE || 'http://localhost:3099/api';
const REAL_FILE = path.join(__dirname, '..', 'data', 'dietitian-knowledge-base.json');
let AUTH = '';
let passed = 0;
let failed = 0;

function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const SOCKET_ERRORS = ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'];

async function req(method, p, body, raw = false, { closeConnection = false } = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH, ...(closeConnection ? { Connection: 'close' } : {}) },
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
  };
  let res;
  try {
    res = await fetch(`${BASE}${p}`, init);
  } catch (err) {
    // a pooled keep-alive socket killed by an earlier oversized upload → retry once on a new one
    if (closeConnection || !SOCKET_ERRORS.includes(err.cause?.code)) throw err;
    res = await fetch(`${BASE}${p}`, { ...init, headers: { ...init.headers, Connection: 'close' } });
  }
  let json = {};
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, ...json };
}

const FIXTURE = {
  meta: { generated_at: '2026-01-01T00:00:00.000Z', distinct_clients: 3, parsed_menus: 3 },
  foods_by_slot: {
    protein: [{ food: 'ביצה', clients: 3, portion: { median_per_portion: 1, unit_he: "יח'", common_per_portion: [{ quantity: 1, count: 3 }] }, meals: [{ meal: 'dinner', count: 3 }], examples: ['ביצה'] }],
    carb: [{ food: 'אורז', clients: 3, portion: { median_per_portion: 4, unit_he: 'כפות', common_per_portion: [{ quantity: 4, count: 3 }], grams_median: 75 }, meals: [{ meal: 'lunch', count: 3 }], examples: ['4 כפות אורז'] }],
  },
  meal_structures: { lunch: { menus_with_meal: 3, common_structures: [{ structure: '2×vegetable + carb + protein', clients: 3 }] }, weekly_meal: { menus_with_meal: 3 } },
  portion_definitions: { fruit_portion: [{ food: 'תפוח קטן', clients: 3, common_amount: ["1 יח'"] }], vegetable_portion: [{ food: 'מלפפון', clients: 3, common_amount: ["1 יח'"] }] },
  recurring_sections: {
    daily_basket: {
      menus_with_section: 3,
      recurring_lines: [{ text: 'סל יומי – בחירה של 2 אופציות', clients: 3 }, { text: 'פיצה 2-3 משולשים', clients: 3 }],
      recurring_items: [{ text: 'מנת פרי', clients: 3 }, { text: 'סושי 2 רולים', clients: 3 }, { text: 'פתיבר', clients: 3 }],
    },
    weekly_meal: { menus_with_section: 3, recurring_lines: [{ text: 'ארוחה של פעם בשבוע', clients: 3 }], recurring_items: [] },
    friday: { menus_with_section: 3, recurring_lines: [{ text: 'ערב : ארוחת שישי', clients: 3 }], recurring_items: [{ text: 'קפה במהלך היום', clients: 3 }] },
    saturday: { menus_with_section: 3, recurring_lines: [{ text: 'אין סל יומי', clients: 3 }], recurring_items: [] },
    guidelines: { menus_with_section: 3, recurring_lines: [{ text: 'דגשים', clients: 3 }, { text: 'כף גדושה ~ 20 גרם פחמימה', clients: 3 }], recurring_items: [] },
  },
  calories: { daily_basket: { samples: 3, median: 120, min: 100, max: 130 }, weekly_meal: { median: 700 } },
};

async function run() {
  console.log('\n══ Phase 9: knowledge base ══\n');
  const login = await req('POST', '/auth/login', { name: process.env.TEST_USER || 'test-runner', password: process.env.TEST_PASSWORD || 'test' });
  AUTH = `Bearer ${login.data?.token}`;
  assert('Logged in', !!login.data?.token);

  const before = await req('GET', '/knowledge-base');
  assert('Status endpoint answers', before.success && typeof before.data.loaded === 'boolean', JSON.stringify(before));
  if (fs.existsSync(REAL_FILE)) {
    // fresh DB → imported from the file; reused DB → already holds the same version (startup skips it)
    const fileVersion = JSON.parse(fs.readFileSync(REAL_FILE, 'utf8')).meta?.generated_at;
    assert('Real knowledge base present at startup (same version as the file)', before.data.loaded === true && before.data.generated_at === fileVersion, JSON.stringify(before.data));
  }

  // ── Upload + sanitize ──
  const up = await req('PUT', '/knowledge-base', FIXTURE);
  assert('Upload accepted', up.success && up.data.loaded === true && up.data.source === 'upload', JSON.stringify(up));
  const full = (await req('GET', '/knowledge-base?full=1')).data;
  const text = JSON.stringify(full);
  assert('Weekly free meal removed (sections, structures, calories)', !full.recurring_sections.weekly_meal && !full.meal_structures.weekly_meal && !full.calories.weekly_meal);
  assert('Cheat-meal items filtered from other sections', !/סושי|פיצה|פעם בשבוע/.test(text), text.match(/סושי|פיצה|פעם בשבוע/)?.[0]);
  assert('Policy recorded: no weekly free meal', full.policy?.weekly_free_meal === false && /סל היומי/.test(full.policy.note));

  // ── Views ──
  const protein = await req('GET', '/knowledge-base/view/foods/protein');
  assert('Foods by slot: protein', protein.success && protein.data[0]?.food === 'ביצה' && protein.data[0].portion.quantity === 1);
  const carb = await req('GET', '/knowledge-base/view/foods/carb');
  assert('Foods by slot: carb with grams', carb.data[0]?.portion?.grams === 75);
  const veg = await req('GET', '/knowledge-base/view/foods/vegetable');
  assert('Vegetables come from portion definitions', veg.data[0]?.food === 'מלפפון');
  const basket = await req('GET', '/knowledge-base/view/daily-basket');
  assert('Daily basket: options per day + kcal + items (no headers / cheat items)',
    basket.data.options_per_day[0]?.options === 2 && basket.data.kcal_per_option.median === 120
    && basket.data.items.map((i) => i.text).join('|') === 'מנת פרי|פתיבר', JSON.stringify(basket.data));
  const weekend = await req('GET', '/knowledge-base/view/weekend');
  assert('Weekend pattern: Friday and Saturday', weekend.data.friday.lines[0].text === 'ערב : ארוחת שישי' && !!weekend.data.saturday);
  const structures = await req('GET', '/knowledge-base/view/meal-structures');
  assert('Meal structures', structures.data.lunch.common_structures[0].structure.includes('protein'));
  const guide = await req('GET', '/knowledge-base/view/guidelines');
  assert('Guidelines without the bare heading', guide.data.length === 1 && guide.data[0].text.includes('כף גדושה'));
  assert('Unknown view → 404', (await req('GET', '/knowledge-base/view/nothing')).status === 404);

  // ── Validation ──
  assert('Not a knowledge base → 400', (await req('PUT', '/knowledge-base', { hello: 'world' })).status === 400);
  assert('Invalid JSON → 400', (await req('PUT', '/knowledge-base', '{"meta":', true)).status === 400);
  const huge = JSON.stringify({ ...FIXTURE, padding: 'x'.repeat(5.5 * 1024 * 1024) });
  // The server may close the socket after answering 413 while the body is still being sent;
  // fetch then reports a connection reset instead of the status — both mean "rejected".
  let hugeStatus;
  try { hugeStatus = (await req('PUT', '/knowledge-base', huge, true, { closeConnection: true })).status; }
  catch (err) { hugeStatus = SOCKET_ERRORS.includes(err.cause?.code) ? 'reset' : err.message; }
  assert('Over 5MB → rejected (413)', hugeStatus === 413 || hugeStatus === 'reset', String(hugeStatus));
  const noAuth = await fetch(`${BASE}/knowledge-base`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(FIXTURE) });
  assert('Upload without login → 401', noAuth.status === 401);
  let leadStatus;
  try { leadStatus = (await req('POST', '/leads', JSON.stringify({ full_name: 'x'.repeat(200 * 1024) }), true, { closeConnection: true })).status; }
  catch (err) { leadStatus = SOCKET_ERRORS.includes(err.cause?.code) ? 'reset' : err.message; }
  assert('Other routes keep the 100KB JSON limit', leadStatus === 413 || leadStatus === 'reset', String(leadStatus));

  // ── Restore the real knowledge base, then check it is clean ──
  if (fs.existsSync(REAL_FILE)) {
    const real = await req('PUT', '/knowledge-base', fs.readFileSync(REAL_FILE, 'utf8'), true);
    assert('Real knowledge base re-uploaded', real.success && real.data.distinct_clients > 0, JSON.stringify(real.data));
    const { policy, ...realContent } = (await req('GET', '/knowledge-base?full=1')).data; // policy note itself says "no free meal"
    const realText = JSON.stringify(realContent);
    assert('Real knowledge base has no weekly free meal', !/פעם בשבוע|ארוחה חופשית|סושי|פיצה/.test(realText));
    const realBasket = (await req('GET', '/knowledge-base/view/daily-basket')).data;
    assert('Real daily basket: 2-3 options of ~120 kcal', realBasket.options_per_day.some((o) => o.options === 2) && realBasket.kcal_per_option?.median === 120, JSON.stringify(realBasket.options_per_day));
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
