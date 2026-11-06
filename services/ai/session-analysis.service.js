const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { generateStructured } = require('./ai.service');
const kb = require('../knowledge-base.service');
const { nowUtcISO } = require('../../utils/dates');

// ─── Phase 10: clinical analysis of a session transcript ─────────────────────
// transcript (speaker roles) + compact knowledge base → Sonnet structured output
// → deterministic guardrails (no free meal, basket 2-3 × 100-120 kcal, 2-4 habits,
// quotes checked against the client's own lines, foods checked against the KB)
// → stored draft for review (session_ai_analyses).

const METHOD_PROMPT = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'session-analysis.md'), 'utf8');
const STALE_RUNNING_MS = 15 * 60 * 1000;

// ── Schema (model output) ──
// No min/max in zod: structured outputs do not support them; limits are enforced in code.

const Fact = z.object({
  fact: z.string().describe('עובדה קצרה בעברית'),
  quote: z.string().describe('ציטוט מדויק וקצר מדברי המטופל שתומך בעובדה'),
});

const MEALS = ['breakfast', 'ten_oclock', 'lunch', 'snack', 'dinner', 'night'];
const SLOTS = ['protein', 'carb', 'fat', 'vegetable', 'fruit'];
const BARRIER_TYPES = ['emotional_eating', 'schedule', 'late_night_eating', 'weekend_social', 'other'];

const SessionAnalysisSchema = z.object({
  speaker_check: z.object({
    labels_look_correct: z.boolean(),
    note: z.string().describe('הערה קצרה אם נראה שהתפקידים הפוכים, אחרת ריק'),
  }),
  anamnesis: z.object({
    summary: z.string().describe('סיכום אנמנזה של 3-6 משפטים'),
    medical_history: z.array(Fact),
    medications: z.array(Fact),
    work_routine: z.array(Fact),
    activity: z.array(Fact).describe('פעילות גופנית ואימונים: סוג, תדירות, שעות'),
    digestive: z.array(Fact),
    sleep: z.array(Fact),
    food_likes: z.array(Fact),
    food_dislikes: z.array(Fact),
    allergies_intolerances: z.array(Fact),
  }),
  barriers: z.array(z.object({
    type: z.enum(BARRIER_TYPES),
    description: z.string(),
    quote: z.string(),
  })),
  meal_plan: z.object({
    calorie_target_estimate: z.number().int(),
    calorie_rationale: z.string(),
    meals: z.array(z.object({
      meal: z.enum(MEALS),
      time_hint: z.string().describe('שעה משוערת לפי סדר היום, או ריק'),
      slots: z.array(z.object({
        slot: z.enum(SLOTS),
        portions: z.number(),
        options: z.array(z.object({
          food: z.string().describe('שם המזון'),
          amount: z.string().describe('כמות למנה אחת, למשל "4 כפות"'),
        })),
        note: z.string(),
      })),
      note: z.string(),
    })),
    daily_basket: z.object({
      options_per_day: z.number().int(),
      kcal_per_option: z.number().int(),
      suggested_items: z.array(z.string()),
      note: z.string(),
    }),
    friday: z.object({ guidelines: z.array(z.string()) }),
    saturday: z.object({ guidelines: z.array(z.string()) }),
    general_notes: z.array(z.string()),
  }),
  habits: z.array(z.object({
    habit: z.string(),
    target: z.string().describe('יעד מדיד: כמה, מתי'),
    quote: z.string().describe('ציטוט מהפגישה שבו ההרגל סוכם, או ריק'),
  })),
  open_questions: z.array(z.string()),
});

// ── Compact schema actually sent to the model ──
// The API compiles the schema into a grammar; deep nesting (9 fact arrays,
// option objects inside slots inside meals) exceeds its size limit. The model
// answers in this flatter shape and toInternal() maps it to SessionAnalysisSchema.

const FACT_CATEGORIES = ['medical_history', 'medications', 'work_routine', 'activity', 'digestive', 'sleep', 'food_likes', 'food_dislikes', 'allergies_intolerances'];

const ModelAnalysisSchema = z.object({
  speaker_labels_ok: z.boolean(),
  speaker_note: z.string(),
  summary: z.string().describe('סיכום אנמנזה של 3-6 משפטים'),
  facts: z.array(z.object({
    category: z.enum(FACT_CATEGORIES),
    fact: z.string(),
    quote: z.string().describe('ציטוט מדויק וקצר מדברי המטופל'),
  })),
  barriers: z.array(z.object({ type: z.enum(BARRIER_TYPES), description: z.string(), quote: z.string() })),
  calorie_target_estimate: z.number().int(),
  calorie_rationale: z.string(),
  meals: z.array(z.object({
    meal: z.enum(MEALS),
    time_hint: z.string(),
    slots: z.array(z.object({
      slot: z.enum(SLOTS),
      portions: z.number(),
      options: z.array(z.string()).describe('כל חלופה: כמות + מזון למנה אחת, למשל "4 כפות אורז"'),
    })),
  })),
  basket_options_per_day: z.number().int(),
  basket_kcal_per_option: z.number().int(),
  basket_items: z.array(z.string()),
  friday: z.array(z.string()),
  saturday: z.array(z.string()),
  general_notes: z.array(z.string()),
  habits: z.array(z.object({ habit: z.string(), target: z.string(), quote: z.string() })),
  open_questions: z.array(z.string()),
});

/** Model output (compact) → the internal draft shape used by guards, UI and import. */
function toInternal(m) {
  const anamnesis = { summary: m.summary };
  for (const c of FACT_CATEGORIES) anamnesis[c] = [];
  for (const f of m.facts) anamnesis[f.category]?.push({ fact: f.fact, quote: f.quote });
  return {
    speaker_check: { labels_look_correct: m.speaker_labels_ok, note: m.speaker_note },
    anamnesis,
    barriers: m.barriers,
    meal_plan: {
      calorie_target_estimate: m.calorie_target_estimate,
      calorie_rationale: m.calorie_rationale,
      meals: m.meals.map((meal) => ({
        meal: meal.meal,
        time_hint: meal.time_hint,
        note: '',
        slots: meal.slots.map((sl) => ({ slot: sl.slot, portions: sl.portions, note: '', options: sl.options.map((o) => ({ amount: '', food: o })) })),
      })),
      daily_basket: { options_per_day: m.basket_options_per_day, kcal_per_option: m.basket_kcal_per_option, suggested_items: m.basket_items, note: '' },
      friday: { guidelines: m.friday },
      saturday: { guidelines: m.saturday },
      general_notes: m.general_notes,
    },
    habits: m.habits,
    open_questions: m.open_questions,
  };
}

// ── Transcript with roles ──

const DEFAULT_DIETITIAN = 'דובר 1';

function speakerMap(row) {
  try { return { dietitian: DEFAULT_DIETITIAN, ...(row.speaker_map ? JSON.parse(row.speaker_map) : {}) }; } catch { return { dietitian: DEFAULT_DIETITIAN }; }
}

/**
 * Transcripts of the session's recordings (oldest first) → role-labeled text.
 * The transcript text is authoritative (it includes manual edits).
 */
function buildTranscript(db, sessionId) {
  const recs = db.prepare(`
    SELECT * FROM session_recordings
    WHERE session_id = ? AND transcript_status = 'done' AND transcript IS NOT NULL AND TRIM(transcript) <> ''
    ORDER BY created_at
  `).all(sessionId);
  const parts = [];
  const clientLines = [];
  let labeled = 0;
  for (const [i, r] of recs.entries()) {
    const { dietitian } = speakerMap(r);
    if (recs.length > 1) parts.push(`--- הקלטה ${i + 1} ---`);
    for (const para of r.transcript.split(/\n\s*\n/)) {
      const m = /^(דובר \d+):\s*([\s\S]*)$/.exec(para.trim());
      if (!m) { if (para.trim()) parts.push(`SPEAKER: ${para.trim()}`); continue; }
      labeled++;
      const role = m[1] === dietitian ? 'DIETITIAN' : 'CLIENT';
      parts.push(`${role}: ${m[2].trim()}`);
      if (role === 'CLIENT') clientLines.push(m[2].trim());
    }
  }
  return {
    text: parts.join('\n\n'),
    recordingIds: recs.map((r) => r.id),
    clientText: clientLines.join(' '),
    diarized: labeled > 0,
  };
}

// ── Knowledge base context (compact, static → cached) ──

function buildKbContext(db) {
  if (!kb.getKnowledgeBase(db)) return { text: 'KNOWLEDGE BASE: not loaded. Use common clinical portions conservatively.', loaded: false };
  const lines = ['KNOWLEDGE BASE (Netanel\'s own menus, aggregated; counts = number of clients):'];
  for (const slot of ['protein', 'carb', 'fat']) {
    const foods = kb.foodsForSlot(db, slot, { limit: 22 }) || [];
    lines.push(`\n${slot.toUpperCase()} options, one portion each:`);
    for (const f of foods) {
      const p = f.portion;
      lines.push(`- ${f.food}: ${p ? `${p.quantity} ${p.unit}${p.grams ? ` (~${p.grams} גרם)` : ''}` : '1'} [${f.clients}]`);
    }
  }
  const veg = kb.foodsForSlot(db, 'vegetable', { limit: 14 }) || [];
  const fruit = kb.foodsForSlot(db, 'fruit', { limit: 14 }) || [];
  lines.push(`\nONE VEGETABLE PORTION = ${veg.map((v) => `${v.common_amount?.[0] || ''} ${v.food}`.trim()).join(' / ')}`);
  lines.push(`ONE FRUIT PORTION = ${fruit.map((v) => `${v.common_amount?.[0] || ''} ${v.food}`.trim()).join(' / ')}`);

  const structures = kb.mealStructures(db) || {};
  lines.push('\nCOMMON MEAL STRUCTURES:');
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const s = structures[meal]?.common_structures?.slice(0, 3).map((x) => `${x.structure} [${x.clients}]`).join('; ');
    if (s) lines.push(`- ${meal}: ${s}`);
  }

  const basket = kb.dailyBasket(db);
  if (basket) {
    lines.push(`\nDAILY BASKET: ${basket.options_per_day.map((o) => `${o.options} options [${o.clients}]`).join(', ')}; kcal per option median ${basket.kcal_per_option?.median ?? 120}`);
    lines.push(`items: ${basket.items.slice(0, 16).map((i) => i.text).join(' / ')}`);
  }
  const weekend = kb.weekendPattern(db);
  for (const day of ['friday', 'saturday']) {
    const w = weekend?.[day];
    if (w) lines.push(`\n${day.toUpperCase()} patterns:\n${w.lines.slice(0, 10).map((l) => `- ${l.text}`).join('\n')}`);
  }
  const guide = kb.guidelines(db) || [];
  if (guide.length) lines.push(`\nGUIDELINES:\n${guide.slice(0, 10).map((g) => `- ${g.text}`).join('\n')}`);
  lines.push('\nPOLICY: no weekly free meal / cheat meal, ever.');
  return { text: lines.join('\n'), loaded: true };
}

// ── Guardrails (pure, also applied to manual edits) ──

const norm = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[^א-תA-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** exact | close | unverified — is the quote really from the client's lines? */
function quoteStatus(quote, clientNorm) {
  const q = norm(quote);
  if (!q) return 'missing';
  if (clientNorm.includes(q)) return 'exact';
  const words = q.split(' ').filter((w) => w.length > 1);
  if (!words.length) return 'unverified';
  const hits = words.filter((w) => clientNorm.includes(w)).length;
  return hits / words.length >= 0.8 ? 'close' : 'unverified';
}

function kbFoodIndex(db) {
  const idx = {};
  for (const slot of SLOTS) {
    const foods = (kb.foodsForSlot(db, slot, { limit: 200 }) || []).map((f) => norm(f.food)).filter(Boolean);
    idx[slot] = foods;
  }
  return idx;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Explicit free-meal wording (safe for habits / notes: "שקילה פעם בשבוע" is a valid habit)
const FREE_MEAL_RE = /ארוחה חופשית|ארוחה של פעם בשבוע|ארוחה שבועית חופשית|ארוחת צ'יט|צ'יט מיל|cheat/i;

/**
 * Enforce the method on an analysis (model output or a manual edit).
 * @returns {{ analysis, warnings: string[] }}
 */
function applyGuards(input, { clientText = '', kbIndex = {}, fallbackCalories = null } = {}) {
  const a = JSON.parse(JSON.stringify(input));
  const warnings = [];
  const clientNorm = norm(clientText);
  const plan = a.meal_plan;

  // 1. no free / cheat meal anywhere in the plan or the habits.
  //    Food lines also drop the typical free-meal foods (KB regex: sushi, pizza…).
  let removed = 0;
  const reject = (re) => (s) => { if (re.test(String(s)) || FREE_MEAL_RE.test(String(s))) { removed++; return false; } return true; };
  const keep = reject(FREE_MEAL_RE);
  const keepFood = reject(kb.CHEAT_MEAL_RE);
  for (const meal of plan.meals) {
    for (const slot of meal.slots) slot.options = slot.options.filter((o) => keepFood(`${o.amount} ${o.food}`));
    if (!keep(meal.note)) meal.note = '';
  }
  plan.daily_basket.suggested_items = plan.daily_basket.suggested_items.filter(keepFood);
  if (!keep(plan.daily_basket.note)) plan.daily_basket.note = '';
  plan.friday.guidelines = plan.friday.guidelines.filter(keepFood);
  plan.saturday.guidelines = plan.saturday.guidelines.filter(keepFood);
  plan.general_notes = plan.general_notes.filter(keep);
  a.habits = a.habits.filter((h) => keep(`${h.habit} ${h.target}`));
  if (removed) warnings.push(`הוסרו ${removed} הצעות של ארוחה חופשית / צ'יט (לא חלק מהשיטה).`);

  // 2. daily basket: 2-3 options of 100-120 kcal
  const b = plan.daily_basket;
  const opts = clamp(Math.round(b.options_per_day || 2), 2, 3);
  const kcal = clamp(Math.round(b.kcal_per_option || 120), 100, 120);
  if (opts !== b.options_per_day || kcal !== b.kcal_per_option) {
    warnings.push(`הסל היומי הותאם ל-${opts} אופציות של ${kcal} קק"ל.`);
  }
  b.options_per_day = opts;
  b.kcal_per_option = kcal;

  // 3. habits: 2-4
  if (a.habits.length > 4) { warnings.push(`נשמרו 4 הרגלים מתוך ${a.habits.length}.`); a.habits = a.habits.slice(0, 4); }
  if (a.habits.length < 2) warnings.push('פחות משני הרגלים מוסכמים. כדאי להשלים לפני הייבוא.');

  // 4. calorie target sanity
  let cal = Math.round(plan.calorie_target_estimate || 0);
  if (!(cal >= 1000 && cal <= 3500)) {
    const fallback = fallbackCalories && fallbackCalories >= 1000 && fallbackCalories <= 3500 ? Math.round(fallbackCalories) : 1600;
    warnings.push(`יעד קלורי ${cal || 'חסר'} מחוץ לטווח, הוחלף ב-${fallback} לבדיקה.`);
    cal = fallback;
  }
  plan.calorie_target_estimate = cal;

  // 5. meals in day order; slot portions 0.5-4 (half steps); options checked against the KB
  plan.meals.sort((x, y) => MEALS.indexOf(x.meal) - MEALS.indexOf(y.meal));
  let outsideKb = 0;
  for (const meal of plan.meals) {
    for (const slot of meal.slots) {
      slot.portions = clamp(Math.round((Number(slot.portions) || 1) * 2) / 2, 0.5, 4);
      slot.options = slot.options.filter((o) => String(o.food || '').trim()).slice(0, 6);
      const known = kbIndex[slot.slot] || [];
      for (const o of slot.options) {
        const f = norm(o.food);
        o.in_kb = known.length ? known.some((k) => f.includes(k) || k.includes(f)) : null;
        if (o.in_kb === false) outsideKb++;
      }
    }
  }
  if (outsideKb) warnings.push(`${outsideKb} חלופות אינן מהמאגר (מסומנות). כדאי לוודא שהמטופל הזכיר אותן.`);

  // 6. dislikes never in the plan
  const dislikes = a.anamnesis.food_dislikes.map((d) => norm(d.fact)).filter((d) => d.length > 2);
  for (const meal of plan.meals) {
    for (const slot of meal.slots) {
      for (const o of slot.options) {
        const f = norm(o.food);
        if (f && dislikes.some((d) => d.includes(f))) warnings.push(`"${o.food}" מופיע בתפריט אבל המטופל ציין שאינו אוהב אותו.`);
      }
    }
  }

  // 7. every fact / barrier must be backed by the client's own words
  let unverified = 0;
  if (clientNorm) {
    for (const key of Object.keys(a.anamnesis)) {
      if (!Array.isArray(a.anamnesis[key])) continue;
      for (const f of a.anamnesis[key]) { f.quote_status = quoteStatus(f.quote, clientNorm); if (f.quote_status === 'unverified' || f.quote_status === 'missing') unverified++; }
    }
    for (const bar of a.barriers) { bar.quote_status = quoteStatus(bar.quote, clientNorm); if (bar.quote_status === 'unverified' || bar.quote_status === 'missing') unverified++; }
    if (unverified) warnings.push(`${unverified} עובדות ללא ציטוט תואם מדברי המטופל (מסומנות לבדיקה).`);
  }

  if (a.speaker_check && a.speaker_check.labels_look_correct === false) {
    warnings.push(`ייתכן שתפקידי הדוברים הפוכים: ${a.speaker_check.note || 'כדאי לבדוק ולהחליף.'}`);
  }
  return { analysis: a, warnings };
}

// ── Transcription garble check ──
// Scribe occasionally emits junk tokens for words it could not decode (seen live:
// "קוטג'" → "qwtgxd7xb3"). Latin/alphanumeric tokens inside Hebrew speech are
// flagged with their context so they are verified before importing.

const ALLOWED_LATIN = new Set(['ok', 'kcal', 'whatsapp', 'fitbar', 'bmi', 'tdee', 'cm', 'kg']);

function transcriptWarnings(text) {
  const out = [];
  const seen = new Set();
  const re = /[A-Za-z0-9][A-Za-z0-9_-]*/g;
  let m;
  while ((m = re.exec(text)) && out.length < 5) {
    const tok = m[0];
    const hasLetter = /[A-Za-z]/.test(tok);
    const mixed = hasLetter && /\d/.test(tok);
    const latinWord = hasLetter && tok.length >= 3 && !ALLOWED_LATIN.has(tok.toLowerCase());
    if (!(mixed || latinWord) || seen.has(tok)) continue;
    seen.add(tok);
    const before = text.slice(0, m.index).trim().split(/\s+/).slice(-6).join(' ');
    const after = text.slice(m.index + tok.length).trim().split(/\s+/).slice(0, 4).join(' ');
    out.push(`ייתכן שגיאת תמלול: "${tok}" (…${before} ${tok}${after ? ` ${after}` : ''}…). כדאי לבדוק בהקלטה לפני הייבוא.`);
  }
  return out;
}

/** Fill a weekend day that was not discussed with the method's default, clearly marked. */
function applyWeekendDefaults(db, analysis) {
  const added = [];
  for (const [day, label] of [['saturday', 'שבת'], ['friday', 'שישי']]) {
    const g = analysis.meal_plan[day];
    if (g.guidelines.length) continue;
    const lines = kb.weekendDefault(db, day);
    if (!lines.length) continue;
    g.guidelines = [`(${kb.WEEKEND_DEFAULT_MARK})`, ...lines];
    added.push(label);
  }
  return added.length ? [`יום ${added.join(' ויום ')} לא נדון בפגישה: הוזן מהשיטה כברירת מחדל, לבדיקה.`] : [];
}

// ── Run ──

function clientContext(db, session) {
  const client = db.prepare('SELECT full_name, goal, start_date FROM clients WHERE id = ?').get(session.client_id) || {};
  const intake = db.prepare(`
    SELECT si.* FROM session_intakes si JOIN sessions s ON s.id = si.session_id
    WHERE si.client_id = ? ORDER BY s.session_number LIMIT 1
  `).get(session.client_id) || {};
  return {
    session_number: session.session_number,
    session_date: session.session_date,
    goal: client.goal || intake.goal || null,
    age: intake.age || null,
    gender: intake.gender || null,
    weight_kg: session.weight || intake.weight || null,
    height_cm: intake.height || null,
    tdee: intake.tdee || null,
  };
}

/**
 * Analyze a session (long-running). Writes the result to session_ai_analyses.
 * Never throws: failures are stored as status 'failed'.
 */
async function analyzeSession(db, sessionId) {
  const set = (fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE session_ai_analyses SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE session_id = @session_id`)
      .run({ ...fields, updated_at: nowUtcISO(), session_id: sessionId });
  };
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const transcript = buildTranscript(db, sessionId);
    if (!transcript.text) throw new Error('אין תמלול זמין לפגישה.');
    const kbCtx = buildKbContext(db);
    const ctx = clientContext(db, session);

    const output = toInternal(await generateStructured({
      task: 'session_analysis',
      // static method + knowledge base → cached prefix across sessions
      system: [{ type: 'text', text: `${METHOD_PROMPT}\n\n${kbCtx.text}`, cache_control: { type: 'ephemeral' } }],
      prompt: `CLIENT CONTEXT (from the CRM): ${JSON.stringify(ctx)}\n\nTRANSCRIPT${transcript.diarized ? '' : ' (no speaker labels: infer who speaks from content)'}:\n${transcript.text}`,
      schema: ModelAnalysisSchema,
    }));

    const { analysis, warnings } = applyGuards(output, {
      clientText: transcript.clientText, kbIndex: kbFoodIndex(db), fallbackCalories: ctx.tdee ? ctx.tdee - 400 : null,
    });
    warnings.push(...applyWeekendDefaults(db, analysis));
    warnings.unshift(...transcriptWarnings(transcript.text));
    if (!kbCtx.loaded) warnings.unshift('מאגר הידע לא נטען: המנות לא הותאמו לשיטה.');
    if (!transcript.diarized) warnings.unshift('התמלול ללא הפרדת דוברים: העובדות הוסקו מהתוכן.');
    set({
      status: 'draft',
      analysis: JSON.stringify(analysis),
      original: JSON.stringify(analysis),
      warnings: JSON.stringify(warnings),
      recording_ids: JSON.stringify(transcript.recordingIds),
      error: null,
      analyzed_at: nowUtcISO(),
    });
    return { ok: true, warnings: warnings.length };
  } catch (err) {
    console.error(`[session-analysis] session ${sessionId} failed:`, err.message);
    set({ status: 'failed', error: String(err.message || err).slice(0, 500) });
    return { ok: false, error: err.message };
  }
}

/** A run that never finished (server restarted mid-call) is reported as failed. */
function expireStale(db, row) {
  if (row?.status === 'running' && Date.now() - Date.parse(row.updated_at) > STALE_RUNNING_MS) {
    db.prepare("UPDATE session_ai_analyses SET status = 'failed', error = ? WHERE id = ?").run('הניתוח הופסק (השרת הופעל מחדש). אפשר להריץ שוב.', row.id);
    return db.prepare('SELECT * FROM session_ai_analyses WHERE id = ?').get(row.id);
  }
  return row;
}

module.exports = {
  SessionAnalysisSchema, ModelAnalysisSchema, toInternal, MEALS, SLOTS, BARRIER_TYPES, DEFAULT_DIETITIAN,
  speakerMap, buildTranscript, transcriptWarnings, applyWeekendDefaults, buildKbContext, applyGuards, quoteStatus, kbFoodIndex,
  analyzeSession, expireStale, clientContext,
};
