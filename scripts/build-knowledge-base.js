/**
 * Build a dietitian knowledge base from real client meal-plan PDFs.
 *
 *   node scripts/build-knowledge-base.js "<pdf folder>" [output.json]
 *
 * Fully local: text is extracted with `pdftotext` (poppler) and parsed
 * deterministically. Nothing is sent to any service.
 *
 * Privacy: client names (from file names) are used only to group several
 * versions of the same client's menu, and are never written to the output.
 * Free-text patterns (recurring meals, guidelines) are kept only when they
 * recur across several different clients, so one-off personal notes drop out.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'data', 'dietitian-knowledge-base.json');

// Free text must appear in at least this many different clients' menus
const MIN_CLIENTS_FREE_TEXT = 3;
// A food must appear for at least this many clients to be listed
const MIN_CLIENTS_FOOD = 3;

// ─── Extraction ───────────────────────────────────────────────────────────────

function listPdfs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listPdfs(p));
    else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

/**
 * pdftotext emits Hebrew in logical order wrapped in bidi controls, with
 * parentheses mirrored. Strip the controls, un-mirror the brackets.
 */
function cleanText(raw) {
  return raw
    .replace(/\u202c/g, ' ')        // end of an embedded run: keep a word gap ("1<PDF>כוסות" → "1 כוסות")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[()]/g, (c) => (c === '(' ? ')' : '('))
    .replace(/\u05f3/g, "'").replace(/\u05f4/g, '"')        // ׳ ״ → ' "
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\t/g, ' ');
}

function extract(file) {
  const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 64 << 20 }).toString();
  return cleanText(raw);
}

/** Client key from the file name (internal only, never output). */
function clientKey(file) {
  const base = path.basename(file, path.extname(file));
  const folder = path.basename(path.dirname(file));
  const name = base
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/תפריט|מעודכן|מעודכנת|עדכון|סופי|חדש|לאחר.*$|סדר ארוחות|\(.*?\)|\d+([./]\d+)*/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const top = path.relative(SRC, path.dirname(file)) ? folder : '';
  return crypto.createHash('sha1').update((top && !/פסח/.test(top) ? top : name) || base).digest('hex').slice(0, 12);
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const MEAL_PATTERNS = [
  ['breakfast', /^ארוחת בוקר|^בוקר(?![\u05d0-\u05ea])/],
  ['ten_oclock', /^ארוחת עשר/],
  ['lunch', /^ארוחת צהריים|^ארוחת צהרים/],
  ['snack', /^ארוחת ביניים|^ביניים/],
  ['pre_workout', /^לפני אימון|^ארוחה לפני אימון/],
  ['post_workout', /^אחרי אימון|^ארוחה אחרי אימון/],
  ['dinner', /^ארוחת ערב/],
  ['night', /^ארוחת לילה/],
  ['drinks', /^שתייה/],
  ['daily_basket', /^סל יומי/],
  // Detected only so its lines do not leak into other sections; excluded from the output
  // (the practice no longer uses a weekly free / cheat meal — daily baskets replace it).
  ['weekly_meal', /^ארוחה של פעם בשבוע|^ארוחה חופשית|^ארוחת צ'יט|^ארוחה שבועית/],
  ['friday', /^יום שישי/],
  ['saturday', /^יום שבת/],
  ['guidelines', /^דגשים/],
];

const SLOT_TYPES = [
  ['protein', 'חלבון'], ['carb', 'פחמימה'], ['fat', 'שומן'], ['vegetable', 'ירק'], ['fruit', 'פרי'], ['dairy', 'חלב'],
];

// "1.5 מנות חלבון", "חצי מנת פחמימה", "מנת חלבון *2", "3-4 מנות ירק"
const SLOT_RE = /^(?:(חצי|רבע|שתי|שלוש|[\d.]+(?:-[\d.]+)?)\s*)?(?:מנת|מנות)\s+(חלבון|פחמימה|שומן|ירק|פרי|חלב)(?![\u05d0-\u05ea])/;

const WORD_NUM = { חצי: 0.5, רבע: 0.25, שתי: 2, שלוש: 3 };

function slotTypeOf(word) {
  return SLOT_TYPES.find(([, he]) => he === word)?.[0] || null;
}

function detectSection(line) {
  const l = line.trim();
  if (l.length > 70) return null;
  for (const [key, re] of MEAL_PATTERNS) if (re.test(l)) return key;
  return null;
}

/** Split into blocks: section header lines + content lines (wrapped lines joined). */
function toLogicalLines(text) {
  const physical = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const lines = [];
  let cur = '';
  const startsNew = (l) => SLOT_RE.test(l) || /^[-•*]\s/.test(l) || detectSection(l) || /^(מנת|מנות) (פרי|ירק) ?=/.test(l)
    || /^(בוקר|צהריים|ערב|בין לבין|ביניים)\s*:/.test(l);
  for (const l of physical) {
    if (!l) { if (cur) lines.push(cur); cur = ''; continue; }
    if (!cur) { cur = l; continue; }
    if (startsNew(l)) { lines.push(cur); cur = l; } else cur += ` ${l}`;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Split alternatives on "\" (and " / " between options), not inside parentheses. */
function splitOptions(s) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '\\' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((o) => o.replace(/^[\s\-–,.:;]+|[\s\-–,.:;]+$/g, '')).filter((o) => o.length > 1);
}

/** Parse "מנת פחמימה 6 : כפות בורגול \ 4 כפות קינואה" → slot + options. */
function parseSlotLine(line) {
  const m = SLOT_RE.exec(line);
  if (!m) return null;
  const type = slotTypeOf(m[2]);
  let amount = 1;
  // 'prefix'  → the quantities written cover all portions ("2 מנות פחמימה: 11 כפות אורז")
  // 'per_portion' → each option is one portion ("מנת חלבון *2: ביצה")
  let amountKind = 'prefix';
  if (m[1]) amount = WORD_NUM[m[1]] ?? Number(m[1].split('-')[0]);
  let rest = line.slice(m[0].length);

  // multiplier written "*2" (displaced: "* :2")
  const mult = /^\s*\*\s*:?\s*([\d.]+(?:-[\d.]+)?)/.exec(rest);
  if (mult) { amount *= Number(mult[1].split('-')[0]); amountKind = 'per_portion'; rest = rest.slice(mult[0].length); }

  // a parenthetical note before the colon, e.g. "(לבחור 2 מהאופציות)"
  let note = null;
  const pn = /^\s*\(([^)]*)\)/.exec(rest);
  if (pn) { note = pn[1].trim(); rest = rest.slice(pn[0].length); }

  // qualifiers before the colon: "מנת חלבון בשרית 2-3 : …", "(התייחסות) לאחר בישול (והכנה) 4 : …"
  const qual = /^\s*((?:התייחסות\s+)?לאחר בישול(?:\s+והכנה)?|בשרית|חלבית|צמחית|פרווה|חמה|קרה)\s*\*?/.exec(rest);
  if (qual) { note = [note, qual[1]].filter(Boolean).join(' · '); rest = rest.slice(qual[0].length); }

  // number displaced before the colon belongs to the first option: "6 : כפות בורגול"
  const lead = /^\s*([\d.]+(?:-[\d.]+)?)\s*:\s*/.exec(rest);
  if (lead) rest = `${lead[1]} ${rest.slice(lead[0].length)}`;
  else rest = rest.replace(/^\s*[:\-–]\s*/, '');

  return { type, amount: Number.isFinite(amount) ? amount : 1, amountKind, note, options: splitOptions(rest) };
}

// ─── Food option normalization ────────────────────────────────────────────────

const UNITS = [
  ['כפות', 'tbsp'], ['כף', 'tbsp'], ['כפיות', 'tsp'], ['כפית', 'tsp'], ['פרוסות', 'slice'], ['פרוסה', 'slice'], ['פרוסת', 'slice'],
  ['יחידות', 'unit'], ["יח'", 'unit'], ['יח', 'unit'], ['כוסות', 'cup'], ['כוס', 'cup'], ['גביע', 'cup_container'], ['גביעים', 'cup_container'],
  ['פחית', 'can'], ['פחיות', 'can'], ['קופסת', 'can'], ['קופסה', 'can'], ['חבילת', 'package'], ['חבילה', 'package'],
  ['גרם', 'g'], ["גר'", 'g'], ['גר', 'g'], ['משולשים', 'slice'], ['משולש', 'slice'], ['חתיכות', 'piece'], ['חתיכה', 'piece'], ['חתיכת', 'piece'],
  ['פיתות', 'unit'], ['פריכיות', 'unit'], ['קערת', 'bowl'], ['קערה', 'bowl'], ['צלחת', 'plate'], ['מנות', 'portion'],
];
const UNIT_RE = new RegExp(`^(${UNITS.map(([u]) => u.replace(/'/g, "'")).join('|')})(?=\\s|$)`);
const UNIT_KEY = Object.fromEntries(UNITS);

/** "4 כפות אורז (150 גרם)" → { qty: 4, unit: 'tbsp', food: 'אורז', grams: 150 } */
function parseOption(text) {
  let s = text.replace(/\s+/g, ' ').trim()
    .replace(/^[*:\s]+/, '')
    .replace(/^(?:\(?\s*)?(?:התייחסות\s+)?לאחר בישול(?:\s+והכנה)?\s*\)?\s*/, '')
    // displaced "N : rest" at the start → "N rest"
    .replace(/^([\d.]+(?:-[\d.]+)?)\s*:\s*/, '$1 ')
    // "גבינה בולגרית 3( 5% כפות)" → "גבינה בולגרית (3 כפות)": fat % is not part of the food or the amount
    .replace(/(\d+(?:-\d+)?)\s*\(\s*(?:[\d.]+%\s*-?\s*)+/g, '($1 ')
    .replace(/[\d.]+(?:\s*-\s*[\d.]+)?\s*%/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // "פרוסה וחצי", "כף וחצי", "2 וחצי"
  const half = /^(פרוסה|כף|כפית|יחידה|פחית|כוס|פיתה|[\d]+)\s+וחצי\s*/.exec(s);
  let halfBonus = 0;
  if (half) {
    halfBonus = 0.5;
    s = /^\d/.test(half[1]) ? `${half[1]} ${s.slice(half[0].length)}` : `1 ${half[1]} ${s.slice(half[0].length)}`;
  }
  let grams = null;
  const g = /\(?\s*~?\s*([\d.]+)\s*(?:-\s*[\d.]+)?\s*(?:גרם|גר'|גר)\s*\)?/.exec(s);
  if (g) grams = Number(g[1]);
  const notes = [...s.matchAll(/\(([^)]*)\)/g)].map((x) => x[1].trim()).filter(Boolean);
  // a quantity written only inside parentheses: "גבינה לבנה (2 כפות)"
  const inParens = notes.map((n) => /^([\d.]+(?:-[\d.]+)?)\s*(כפות|כפיות|כף|כפית|פרוסות|יח'|יחידות)\s*$/.exec(n)).find(Boolean);
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  let qty = null;
  let qtyText = null;
  const q = /^(\d+\/\d+|חצי|רבע|שליש|שלם|שלמה|\d[\d.]*(?:\s*-\s*\d[\d.]*)?)\s*/.exec(s);
  if (q) {
    qtyText = q[1].replace(/\s/g, '');
    qty = WORD_NUM[q[1]] ?? (q[1] === 'שליש' ? 1 / 3 : /שלם/.test(q[1]) ? 1 : q[1].includes('/') ? eval(q[1]) : Number(q[1].split('-')[0])); // eslint-disable-line no-eval
    s = s.slice(q[0].length);
  }
  let unit = null;
  const u = UNIT_RE.exec(s);
  if (u) {
    unit = UNIT_KEY[u[1]] || null;
    if (!['פיתות', 'פריכיות', 'משולשים', 'משולש'].includes(u[1])) s = s.slice(u[0].length).trim();
  }
  // trailing quantity ("טופו חצי חבילה", "קוטג' 2 כפות")
  if (qty === null) {
    const tq = /\s(חצי|רבע|\d[\d.]*(?:-\d[\d.]*)?)\s*(כפות|כפיות|כף|כפית|פרוסות|חבילה|פחית|יח'|כוס|גרם|גר'|גר)?\s*$/.exec(s);
    if (tq) {
      qtyText = tq[1];
      qty = WORD_NUM[tq[1]] ?? Number(tq[1].split('-')[0]);
      if (tq[2]) unit = UNIT_KEY[tq[2]] || unit;
      s = s.slice(0, tq.index).trim();
    }
  }
  if (qty === null && inParens) {
    qtyText = inParens[1];
    qty = Number(inParens[1].split('-')[0]);
    unit = UNIT_KEY[inParens[2]] || unit;
  }
  if (qty !== null && halfBonus) { qty += halfBonus; qtyText = String(qty); }
  const food = normalizeFood(s);
  // no number written → one ("ביצה", "פחית טונה במים", "פיתה כוסמין")
  if (qty === null && food) { qty = 1; qtyText = qtyText || '1'; }
  return { raw: text.trim(), qty: Number.isFinite(qty) ? qty : null, qtyText, unit: unit || 'unit', food, grams, notes };
}

const FOOD_ALIASES = [
  [/^פית(ה|ת|תה) כוסמין/, 'פיתה כוסמין'], [/^פרגיות|^פרגית/, 'פרגית'], [/^טורטי(י)?ה/, 'טורטיה'], [/^גבנ"צ/, 'גבינה צהובה'],
  [/^כרע/, 'כרע עוף'], [/^מעדן פרו/, 'מעדן פרו'], [/^קציצת המבורגר|^המבורגר/, 'המבורגר'], [/^אנטריקוט|^סטייק/, 'סטייק'],
  [/^שוקיים/, 'שוקיים של עוף'], [/^בשר בקר טחון|^בשר טחון/, 'בשר טחון'], [/^ספגטי/, 'פסטה'], [/^פתית(?![\u05d0-\u05ea])/, 'פתיתים'],
  [/^לחמני(י)?ה/, 'לחמניה'], [/^קורנפלקס/, 'קורנפלקס'], [/^פיתות כוסמין/, 'פיתה כוסמין'], [/^לחם קל/, 'לחם קל'], [/^לחם מלא/, 'לחם מלא'],
  [/^טונה במים|^פחית טונה במים|^טונה במים/, 'טונה במים'], [/^טונה בשמן|^פחית טונה בשמן/, 'טונה בשמן'],
  [/^ביצים?(?![\u05d0-\u05ea])|^ביצה(?![\u05d0-\u05ea])/, 'ביצה'], [/^קוטג'/, "קוטג'"], [/^גבינה לבנה/, 'גבינה לבנה'], [/^גבינה צהובה/, 'גבינה צהובה'],
  [/^גבינת סקי|^סקי(?![\u05d0-\u05ea])/, 'גבינת סקי'], [/^יוגורט/, 'יוגורט'], [/^חזה עוף/, 'חזה עוף'], [/^פרגית/, 'פרגית'], [/^שניצל/, 'שניצל'],
  [/^סלמון|^פילה סלמון/, 'סלמון'], [/^פסטרמה/, 'פסטרמה'], [/^טופו/, 'טופו'], [/^אורז/, 'אורז'], [/^קינואה/, 'קינואה'],
  [/^בורגול/, 'בורגול'], [/^פתיתים/, 'פתיתים'], [/^שיבולת שועל|^שיבולת/, 'שיבולת שועל'], [/^פריכיות/, 'פריכיות'],
  [/^טורטיה/, 'טורטיה'], [/^אבוקדו/, 'אבוקדו'], [/^טחינה גולמית/, 'טחינה גולמית'], [/^(כף )?סלט טחינה/, 'סלט טחינה'],
  [/^זיתים/, 'זיתים'], [/^שמן זית/, 'שמן זית'], [/^שקדים/, 'שקדים'], [/^אגוזי? מלך/, 'אגוזי מלך'], [/^גרנולה/, 'גרנולה'],
  [/^בטטה/, 'בטטה'], [/^תפוח אדמה|^תפו"א/, 'תפוח אדמה'], [/^פסטה/, 'פסטה'], [/^קציצות/, 'קציצות'], [/^משקה חלבון/, 'משקה חלבון'],
  [/^מעדן חלבון/, 'מעדן חלבון'], [/^חלב שיבולת/, 'חלב שיבולת'], [/^חלב(?![\u05d0-\u05ea])/, 'חלב'], [/^כנפיים/, 'כנפיים'], [/^בשר טחון/, 'בשר טחון'],
  [/^דג לבן/, 'דג לבן'], [/^עדשים/, 'עדשים'], [/^חומוס/, 'חומוס'], [/^אטריות/, 'אטריות'], [/^גבינת נפוליאון/, 'גבינת נפוליאון'],
];

const LEADING_UNIT_WORDS = /^(?:חתיכות|חתיכה|חתיכת|פרוסות|פרוסה|פרוסת|כפות|כפיות|כף|כפית|יח'|יחידות|קופסת|פחית|חבילת|של)\s+/;

function normalizeFood(s) {
  let f = s
    .replace(/^[\s\-–*:.,=()\d/]+(?=[\u05d0-\u05ea])/, '')       // leftovers: ": ביצים", "*1.5 כפות", "- כפות"
    .replace(/^(של|מ|עם)\s+/, '');
  for (let i = 0; i < 3 && LEADING_UNIT_WORDS.test(f); i++) f = f.replace(LEADING_UNIT_WORDS, '');
  f = f
    .replace(/\s*\d[\d.]*\s*(?:-\s*\d[\d.]*)?\s*(?:גרם|גר'|גר|קק"ל|קל')?\s*$/, '')   // "סינטה 120 גרם", "סטייק 200"
    .replace(/\s*\(?=?\d*$/, '')
    .replace(/[.,:;!(]+$/g, '').replace(/\s+/g, ' ').trim();
  for (const [re, name] of FOOD_ALIASES) if (re.test(f)) return name;
  // keep the head of the phrase (drop trailing qualifiers after a comma / dash)
  f = f.split(/\s[-–]\s|,|\s\+\s/)[0].trim();
  return f.split(' ').slice(0, 4).join(' ');
}

// ─── Section-specific parsing ────────────────────────────────────────────────

function parseMenu(text) {
  const lines = toLogicalLines(text);
  const menu = { meals: {}, sections: {}, kcal: [], water: [], alcohol: [], fruitPortion: [], vegPortion: [] };
  let section = null;
  for (const line of lines) {
    const sec = detectSection(line);
    if (sec) {
      section = sec;
      const kcal = /([\d]{2,4})\s*-?\s*קק"ל/.exec(line);
      if (kcal) menu.kcal.push({ section, kcal: Number(kcal[1]) });
      // header line may carry content after it ("יום שבת - אין סל יומי.")
      (menu.sections[section] ||= []).push(line);
      continue;
    }
    if (!section) continue;

    const def = /^(?:-\s*)?(מנת|מנות) (פרי|ירק)\s*=\s*(.*)$/.exec(line);
    if (def) {
      const items = def[3].split(/\\|\//).map((x) => parseOption(x)).filter((o) => o.food && o.food.length > 1);
      (def[2] === 'פרי' ? menu.fruitPortion : menu.vegPortion).push(...items);
      continue;
    }
    const water = /(?:לשתות|שתיית).{0,40}?([\d.]+(?:-[\d.]+)?)\s*(?:ליטר)/.exec(line) || /([\d.]+(?:-[\d.]+)?)\s*ליטר/.exec(line);
    if (water && /מים|לשתות|שתי/.test(line)) menu.water.push(Number(water[1].split('-')[0]));
    if (/אלכוהול|יין|בירה/.test(line) && section === 'guidelines') menu.alcohol.push(line);

    const slot = parseSlotLine(line);
    if (slot && ['breakfast', 'ten_oclock', 'lunch', 'snack', 'pre_workout', 'post_workout', 'dinner', 'night'].includes(section)) {
      (menu.meals[section] ||= []).push(slot);
      continue;
    }
    (menu.sections[section] ||= []).push(line);
  }
  return menu;
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

class Counter {
  constructor() { this.m = new Map(); }
  add(key, client, extra) {
    if (!key) return;
    const e = this.m.get(key) || { clients: new Set(), occurrences: 0, extras: [] };
    e.clients.add(client);
    e.occurrences++;
    if (extra !== undefined) e.extras.push(extra);
    this.m.set(key, e);
  }
  top(minClients = 1, limit = 50) {
    return [...this.m.entries()]
      .filter(([, e]) => e.clients.size >= minClients)
      .sort((a, b) => b[1].clients.size - a[1].clients.size || b[1].occurrences - a[1].occurrences)
      .slice(0, limit);
  }
}

const pct = (n, total) => Math.round((n / total) * 1000) / 10;

function mode(values) {
  const c = new Map();
  for (const v of values) c.set(v, (c.get(v) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]);
}

function median(nums) {
  const a = nums.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const UNIT_HE = { tbsp: 'כפות', tsp: 'כפיות', slice: 'פרוסות', unit: "יח'", cup: 'כוס', cup_container: 'גביע', can: 'פחית', package: 'חבילה', g: 'גרם', piece: 'חתיכות', bowl: 'קערה', plate: 'צלחת', portion: 'מנות' };

// References to the retired weekly free meal, wherever they appear
// (also its typical items, which some menus list without the section header)
const CHEAT_MEAL_RE = /פעם בשבוע|ארוחה חופשית|ארוחת צ'יט|צ'יט מיל|cheat|סושי|פיצה|המבורגר [\d]+ ?גר'? בלחמני|fresh-?B|פנקו/i;

/** Normalize a free-text line for recurrence counting. */
function normLine(l) {
  return l.replace(/^[-•*\s]+/, '').replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  if (!SRC || !fs.existsSync(SRC)) {
    console.error('Usage: node scripts/build-knowledge-base.js "<pdf folder>" [output.json]');
    process.exit(1);
  }
  const files = listPdfs(SRC);
  const menus = [];
  const failures = [];
  for (const f of files) {
    try {
      const text = extract(f);
      if (text.replace(/\s/g, '').length < 200) { failures.push('no_text'); continue; }
      menus.push({ client: clientKey(f), year: fs.statSync(f).mtime.getFullYear(), menu: parseMenu(text) });
    } catch {
      failures.push('extract_error');
    }
  }
  const clients = new Set(menus.map((m) => m.client));
  const C = clients.size;

  // Foods per slot type, with portions normalized to one full portion
  const foodBySlot = Object.fromEntries(SLOT_TYPES.map(([t]) => [t, new Counter()]));
  const mealStructures = {};
  const mealFoods = {};
  for (const { client, menu } of menus) {
    for (const [meal, slots] of Object.entries(menu.meals)) {
      const sig = slots.map((s) => `${s.amount === 1 ? '' : `${s.amount}×`}${s.type}`).sort().join(' + ');
      ((mealStructures[meal] ||= new Counter())).add(sig, client);
      for (const slot of slots) {
        if (slot.type === 'vegetable') continue; // free text ("3-4 מנות ירק (עלים ללא הגבלה)…"); items come from "מנת ירק =" definitions
        for (const optText of slot.options) {
          const o = parseOption(optText);
          if (!o.food || o.food.length < 2 || /^\d+$/.test(o.food)) continue;
          foodBySlot[slot.type]?.add(o.food, client, { ...o, slotAmount: slot.amount, amountKind: slot.amountKind, meal });
          ((mealFoods[meal] ||= new Counter())).add(`${slot.type}:${o.food}`, client);
        }
      }
    }
  }

  const portionSummary = (extras) => {
    const byUnit = {};
    for (const x of extras) {
      if (x.qty === null || !x.unit) continue;
      const divisor = x.amountKind === 'per_portion' ? 1 : (x.slotAmount || 1);
      const perPortion = x.qty / divisor;
      (byUnit[x.unit] ||= []).push(Math.round(perPortion * 100) / 100);
    }
    const units = Object.entries(byUnit).sort((a, b) => b[1].length - a[1].length);
    if (!units.length) return null;
    const [unit, values] = units[0];
    const common = mode(values).slice(0, 3).map(([v, n]) => ({ quantity: v, count: n }));
    return {
      unit, unit_he: UNIT_HE[unit] || unit,
      median_per_portion: median(values),
      common_per_portion: common,
      samples: values.length,
      grams_median: median(extras.map((x) => x.grams)),
    };
  };

  const foods = {};
  for (const [type, counter] of Object.entries(foodBySlot)) {
    if (!counter.m.size) continue; // vegetables / fruit: see portion_definitions
    foods[type] = counter.top(MIN_CLIENTS_FOOD, 60).map(([food, e]) => {
      const meals = mode(e.extras.map((x) => x.meal)).map(([m, n]) => ({ meal: m, count: n }));
      const examples = mode(e.extras.map((x) => x.raw.replace(/\s+/g, ' '))).slice(0, 3).map(([r]) => r);
      return {
        food,
        clients: e.clients.size,
        clients_pct: pct(e.clients.size, C),
        occurrences: e.occurrences,
        portion: portionSummary(e.extras),
        meals,
        examples,
      };
    });
  }

  const structures = Object.fromEntries(Object.entries(mealStructures).map(([meal, counter]) => [
    meal,
    {
      menus_with_meal: new Set(menus.filter((m) => m.menu.meals[meal]).map((m) => m.client)).size,
      common_structures: counter.top(2, 8).map(([sig, e]) => ({ structure: sig, clients: e.clients.size, clients_pct: pct(e.clients.size, C) })),
      top_foods: mealFoods[meal].top(MIN_CLIENTS_FOOD, 15).map(([k, e]) => {
        const [slot, food] = k.split(':');
        return { slot, food, clients: e.clients.size };
      }),
    },
  ]));

  // Recurring free text per section (daily basket, weekly meal, weekend, guidelines, drinks)
  const recurring = {};
  for (const sec of ['drinks', 'daily_basket', 'friday', 'saturday', 'guidelines']) {
    const lineCounter = new Counter();
    const itemCounter = new Counter();
    for (const { client, menu } of menus) {
      for (const line of menu.sections[sec] || []) {
        const n = normLine(line);
        if (n.length < 4 || n.length > 220) continue;
        if (CHEAT_MEAL_RE.test(n)) continue; // never surface the retired weekly free meal
        lineCounter.add(n, client);
        for (const part of n.split(/\s-\s|\\|\s\+\s/)) {
          const p = normLine(part);
          if (p.length >= 3 && p.length <= 60) itemCounter.add(p, client);
        }
      }
    }
    recurring[sec] = {
      menus_with_section: new Set(menus.filter((m) => m.menu.sections[sec]).map((m) => m.client)).size,
      recurring_lines: lineCounter.top(MIN_CLIENTS_FREE_TEXT, 25).map(([text, e]) => ({ text, clients: e.clients.size })),
      recurring_items: itemCounter.top(MIN_CLIENTS_FREE_TEXT, 30).map(([text, e]) => ({ text, clients: e.clients.size })),
    };
  }

  // Portion definitions (מנת פרי = ..., מנת ירק = ...)
  const defs = (key) => {
    const counter = new Counter();
    for (const { client, menu } of menus) for (const o of menu[key]) counter.add(o.food, client, o);
    return counter.top(MIN_CLIENTS_FOOD, 30).map(([food, e]) => ({
      food,
      clients: e.clients.size,
      common_amount: mode(e.extras.map((x) => [x.qtyText, x.unit && UNIT_HE[x.unit]].filter(Boolean).join(' ') || 'יחידה אחת')).slice(0, 2).map(([a]) => a),
    }));
  };

  // Calorie anchors and hydration
  const kcalBySection = {};
  for (const { menu } of menus) for (const k of menu.kcal) (kcalBySection[k.section] ||= []).push(k.kcal);
  const water = menus.map((m) => m.menu.water[0]).filter(Number.isFinite);

  const kb = {
    meta: {
      generated_at: new Date().toISOString(),
      generator: 'scripts/build-knowledge-base.js',
      source: 'Client meal-plan PDFs (local, anonymized: no names or file names stored)',
      pdf_files: files.length,
      parsed_menus: menus.length,
      distinct_clients: C,
      failed: failures.length,
      years: mode(menus.map((m) => m.year)).map(([y, n]) => ({ year: y, menus: n })).sort((a, b) => a.year - b.year),
      notes: [
        'Frequencies are counted per distinct client (several versions of one client menu count once).',
        'portion.median_per_portion is normalized to ONE full portion of the slot (e.g. a "חצי מנת פחמימה" option is doubled).',
        'Vegetables and fruit are listed under portion_definitions (the "מנת ירק =" / "מנת פרי =" definitions), not foods_by_slot.',
        'The weekly free ("once-a-week") meal is intentionally excluded: the practice uses flexible daily baskets and a Friday/Saturday maintenance pattern instead.',
        `Free text is kept only when it recurs in at least ${MIN_CLIENTS_FREE_TEXT} different clients' menus.`,
      ],
    },
    slot_types: Object.fromEntries(SLOT_TYPES.map(([k, he]) => [k, `מנת ${he}`])),
    foods_by_slot: foods,
    meal_structures: structures,
    portion_definitions: {
      fruit_portion: defs('fruitPortion'),
      vegetable_portion: defs('vegPortion'),
    },
    recurring_sections: recurring,
    calories: Object.fromEntries(Object.entries(kcalBySection).map(([s, v]) => [s, { samples: v.length, median: median(v), min: Math.min(...v), max: Math.max(...v) }])),
    hydration: { menus_with_water_target: water.length, median_liters: median(water), common_liters: mode(water).slice(0, 4).map(([l, n]) => ({ liters: l, menus: n })) },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(kb, null, 2));
  console.log(`Parsed ${menus.length}/${files.length} PDFs (${C} distinct clients) → ${OUT}`);
  for (const [t, list] of Object.entries(foods)) console.log(`  ${t}: ${list.length} foods; top: ${list.slice(0, 6).map((f) => `${f.food} (${f.clients})`).join(', ')}`);
}

if (require.main === module) main();

module.exports = { cleanText, toLogicalLines, parseSlotLine, parseOption, parseMenu, splitOptions };
