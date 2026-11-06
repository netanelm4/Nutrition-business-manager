const fs = require('fs');
const path = require('path');
const { nowUtcISO } = require('../utils/dates');

// ─── Dietitian knowledge base ────────────────────────────────────────────────
// Aggregated, anonymized patterns from real meal plans (scripts/build-knowledge-base.js).
// Stored in the database (table knowledge_base) so production has it without
// committing client-derived data: imported locally from data/ at startup, and
// uploaded to production through PUT /api/knowledge-base.
//
// Clinical policy enforced on every import: no weekly free / cheat meal.
// Flexibility comes from the daily basket and the Friday/Saturday pattern.

const KB_ID = 'dietitian';
const DEFAULT_FILE = process.env.KNOWLEDGE_BASE_PATH
  || path.join(__dirname, '..', 'data', 'dietitian-knowledge-base.json');

const CHEAT_MEAL_RE = /פעם בשבוע|ארוחה חופשית|ארוחת צ'יט|צ'יט מיל|cheat|סושי|פיצה|המבורגר [\d]+ ?גר'? בלחמני|fresh-?B|פנקו/i;
const REQUIRED_KEYS = ['meta', 'foods_by_slot', 'meal_structures', 'portion_definitions', 'recurring_sections'];

let cache = null;

/** Throws a 400-style error when the document is not a knowledge base. */
function validate(kb) {
  if (!kb || typeof kb !== 'object' || Array.isArray(kb)) throw Object.assign(new Error('Knowledge base must be a JSON object.'), { status: 400 });
  const missing = REQUIRED_KEYS.filter((k) => !(k in kb));
  if (missing.length) throw Object.assign(new Error(`Not a knowledge base (missing: ${missing.join(', ')}).`), { status: 400 });
}

/** Remove the retired weekly free meal wherever it appears. Pure. */
function sanitize(kb) {
  const out = JSON.parse(JSON.stringify(kb));
  delete out.recurring_sections?.weekly_meal;
  delete out.meal_structures?.weekly_meal;
  delete out.calories?.weekly_meal;
  for (const sec of Object.values(out.recurring_sections || {})) {
    for (const key of ['recurring_lines', 'recurring_items']) {
      if (Array.isArray(sec[key])) sec[key] = sec[key].filter((x) => !CHEAT_MEAL_RE.test(x.text || ''));
    }
  }
  out.policy = {
    weekly_free_meal: false,
    note: 'אין ארוחה חופשית שבועית. הגמישות מגיעה מהסל היומי (2-3 פריטים של כ-100-120 קק"ל) ומהתנהלות גמישה בשישי ובשבת.',
  };
  return out;
}

function importKnowledgeBase(db, kb, source = 'upload') {
  validate(kb);
  const clean = sanitize(kb);
  db.prepare(`
    INSERT INTO knowledge_base (id, content, generated_at, imported_at, source)
    VALUES (@id, @content, @generated_at, @imported_at, @source)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, generated_at = excluded.generated_at,
      imported_at = excluded.imported_at, source = excluded.source
  `).run({
    id: KB_ID,
    content: JSON.stringify(clean),
    generated_at: clean.meta?.generated_at || null,
    imported_at: nowUtcISO(),
    source,
  });
  cache = null;
  return summary(db);
}

/** Startup: import data/dietitian-knowledge-base.json when it is newer than the stored copy. */
function importFromFileIfNewer(db, file = DEFAULT_FILE) {
  if (!fs.existsSync(file)) return { skipped: 'no_file' };
  let kb;
  try { kb = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return { skipped: `invalid_json: ${err.message}` }; }
  const row = db.prepare('SELECT generated_at FROM knowledge_base WHERE id = ?').get(KB_ID);
  if (row && row.generated_at && kb.meta?.generated_at && kb.meta.generated_at <= row.generated_at) return { skipped: 'up_to_date' };
  importKnowledgeBase(db, kb, 'file');
  return { imported: true };
}

function getKnowledgeBase(db) {
  if (cache) return cache;
  const row = db.prepare('SELECT content FROM knowledge_base WHERE id = ?').get(KB_ID);
  cache = row ? JSON.parse(row.content) : null;
  return cache;
}

// ─── Structured accessors (Phase 10 agent tools) ─────────────────────────────

const SLOT_ALIASES = { protein: 'protein', carb: 'carb', carbs: 'carb', fat: 'fat', vegetable: 'vegetable', vegetables: 'vegetable', fruit: 'fruit' };

/** Foods for a slot, most common first. Vegetables / fruit come from the portion definitions. */
function foodsForSlot(db, slot, { limit = 25 } = {}) {
  const kb = getKnowledgeBase(db);
  if (!kb) return null;
  const s = SLOT_ALIASES[slot];
  if (s === 'vegetable') return (kb.portion_definitions?.vegetable_portion || []).slice(0, limit);
  if (s === 'fruit') return (kb.portion_definitions?.fruit_portion || []).slice(0, limit);
  return (kb.foods_by_slot?.[s] || []).slice(0, limit).map((f) => ({
    food: f.food,
    clients: f.clients,
    portion: f.portion ? {
      quantity: f.portion.median_per_portion, unit: f.portion.unit_he,
      common: f.portion.common_per_portion, grams: f.portion.grams_median,
    } : null,
    meals: f.meals?.slice(0, 3).map((m) => m.meal),
    example: f.examples?.[0] || null,
  }));
}

/** Daily basket: how many options, kcal per option, typical items. */
function dailyBasket(db) {
  const kb = getKnowledgeBase(db);
  if (!kb) return null;
  const sec = kb.recurring_sections?.daily_basket || { recurring_lines: [], recurring_items: [] };
  const choose = {};
  for (const x of [...(sec.recurring_lines || []), ...(sec.recurring_items || [])]) {
    const m = /בחירה של (\d)/.exec(x.text);
    if (m) choose[m[1]] = Math.max(choose[m[1]] || 0, x.clients);
  }
  const isHeader = (t) => /^סל יומי|בחירה של \d/.test(t);
  return {
    options_per_day: Object.entries(choose).sort((a, b) => b[1] - a[1]).map(([n, clients]) => ({ options: Number(n), clients })),
    kcal_per_option: kb.calories?.daily_basket || null,
    items: (sec.recurring_items || []).filter((x) => !isHeader(x.text)).slice(0, 25),
    menus_with_basket: sec.menus_with_section ?? null,
  };
}

/** Friday / Saturday realistic structure (recurring lines and items). */
function weekendPattern(db) {
  const kb = getKnowledgeBase(db);
  if (!kb) return null;
  const pick = (key) => {
    const sec = kb.recurring_sections?.[key];
    if (!sec) return null;
    return { menus: sec.menus_with_section, lines: sec.recurring_lines.slice(0, 15), items: sec.recurring_items.slice(0, 20) };
  };
  return { friday: pick('friday'), saturday: pick('saturday') };
}

function mealStructures(db) {
  return getKnowledgeBase(db)?.meal_structures || null;
}

function portionDefinitions(db) {
  return getKnowledgeBase(db)?.portion_definitions || null;
}

function guidelines(db) {
  const sec = getKnowledgeBase(db)?.recurring_sections?.guidelines;
  return sec ? sec.recurring_lines.filter((l) => l.text !== 'דגשים').slice(0, 25) : null;
}

function summary(db) {
  const row = db.prepare('SELECT generated_at, imported_at, source FROM knowledge_base WHERE id = ?').get(KB_ID);
  const kb = getKnowledgeBase(db);
  if (!row || !kb) return { loaded: false };
  return {
    loaded: true,
    generated_at: row.generated_at,
    imported_at: row.imported_at,
    source: row.source,
    distinct_clients: kb.meta?.distinct_clients ?? null,
    parsed_menus: kb.meta?.parsed_menus ?? null,
    foods: Object.fromEntries(Object.entries(kb.foods_by_slot || {}).map(([k, v]) => [k, v.length])),
    policy: kb.policy || null,
  };
}

module.exports = {
  KB_ID, validate, sanitize, importKnowledgeBase, importFromFileIfNewer, getKnowledgeBase, summary,
  foodsForSlot, dailyBasket, weekendPattern, mealStructures, portionDefinitions, guidelines,
};
