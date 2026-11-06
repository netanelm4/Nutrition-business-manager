const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { generateStructured } = require('./ai.service');
const kb = require('../knowledge-base.service');
const {
  BARRIER_TYPES, buildTranscript, buildKbContext, quoteStatus, transcriptWarnings, clientContext, norm, FREE_MEAL_RE,
} = require('./session-analysis.service');
const { nowUtcISO } = require('../../utils/dates');

// ─── Phase 10b: follow-up session analysis ───────────────────────────────────
// Session 2+ (or a client that already has a menu): no anamnesis, no menu from
// scratch. Progress, friction, requests, previous-habit status, and specific
// changes ON the active menu (by item / meal id), plus the next habits.

const FOLLOWUP_PROMPT = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'session-followup.md'), 'utf8');

const CHANGE_TYPES = ['portion', 'timing', 'swap_option', 'add_option', 'remove_option', 'add_item', 'basket_variety', 'weekend', 'other'];
const ITEM_TYPES = ['protein', 'carb', 'fat', 'vegetable', 'fruit', 'daily_basket', 'custom'];
const HABIT_STATUS = ['kept', 'partial', 'not_kept', 'not_discussed'];
const ITEM_CHANGES = new Set(['portion', 'swap_option', 'add_option', 'remove_option']);

const Quoted = z.object({ text: z.string(), quote: z.string() });

// Flat on purpose (the API compiles the schema into a grammar with a size limit)
const FollowUpModelSchema = z.object({
  speaker_labels_ok: z.boolean(),
  speaker_note: z.string(),
  summary: z.string().describe('סיכום הפגישה בשלושה עד חמישה משפטים'),
  what_worked: z.array(Quoted),
  difficulties: z.array(Quoted),
  client_requests: z.array(Quoted),
  reported_weight_kg: z.number(),
  previous_habits: z.array(z.object({ habit: z.string(), status: z.enum(HABIT_STATUS), quote: z.string() })),
  barriers: z.array(z.object({ type: z.enum(BARRIER_TYPES), description: z.string(), quote: z.string() })),
  menu_changes: z.array(z.object({
    change_type: z.enum(CHANGE_TYPES),
    meal_id: z.number().int(),
    item_id: z.number().int(),
    item_type: z.enum(ITEM_TYPES),
    current: z.string(),
    proposed: z.string(),
    proposed_portions: z.number(),
    proposed_time: z.string(),
    reason: z.string(),
    quote: z.string(),
  })),
  new_clinical_info: z.array(Quoted),
  habits: z.array(z.object({ habit: z.string(), target: z.string(), quote: z.string() })),
  open_questions: z.array(z.string()),
});

// Internal draft (stored / edited): model shape + review fields kept on edits
const FollowUpSchema = FollowUpModelSchema.extend({
  menu_changes: z.array(FollowUpModelSchema.shape.menu_changes.element.extend({ approved: z.boolean().optional() })),
});

// ── Context ──

/** The client's active menu: the newest final menu, otherwise the newest draft. */
function activeMenu(db, clientId) {
  const menu = db.prepare(`
    SELECT * FROM menus WHERE client_id = ?
    ORDER BY CASE status WHEN 'final' THEN 0 ELSE 1 END, datetime(created_at) DESC, id DESC LIMIT 1
  `).get(clientId);
  if (!menu) return null;
  const meals = db.prepare('SELECT * FROM menu_meals WHERE menu_id = ? ORDER BY meal_order, id').all(menu.id);
  for (const meal of meals) {
    meal.items = db.prepare('SELECT * FROM menu_items WHERE meal_id = ? ORDER BY sort_order, id').all(meal.id);
  }
  return { menu, meals };
}

/** A specific menu with its meals and items (the base menu of an analysis). */
function menuById(db, menuId) {
  const menu = menuId ? db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId) : null;
  if (!menu) return null;
  const meals = db.prepare('SELECT * FROM menu_meals WHERE menu_id = ? ORDER BY meal_order, id').all(menu.id);
  for (const meal of meals) {
    meal.items = db.prepare('SELECT * FROM menu_items WHERE meal_id = ? ORDER BY sort_order, id').all(meal.id);
  }
  return { menu, meals };
}

function compactMenu(active) {
  if (!active) return null;
  return {
    menu_id: active.menu.id,
    title: active.menu.title,
    calorie_target: active.menu.calorie_target,
    meals: active.meals.map((m) => ({
      meal_id: m.id, meal_name: m.meal_name, time: m.time_label || '',
      items: m.items.map((i) => ({ item_id: i.id, type: i.item_type, portions: i.portions, text: i.custom_text || '' })),
    })),
  };
}

function previousSession(db, session) {
  const prev = db.prepare(`
    SELECT * FROM sessions WHERE client_id = ? AND session_number < ? AND status != 'canceled'
    ORDER BY session_number DESC LIMIT 1
  `).get(session.client_id, session.session_number);
  if (!prev) return null;
  let tasks = [];
  try { tasks = JSON.parse(prev.tasks || '[]'); } catch { tasks = []; }
  let plan = '';
  try { plan = JSON.parse(prev.soap_notes || '{}')?.plan || ''; } catch { plan = ''; }
  return { session_number: prev.session_number, date: prev.session_date, tasks: tasks.map((t) => ({ text: t.text, status: t.status })), plan };
}

/** intake | follow_up — follow-up when this is not the first session or a menu already exists. */
function suggestedMode(db, session) {
  if (session.session_number > 1) return 'follow_up';
  return db.prepare('SELECT 1 FROM menus WHERE client_id = ? LIMIT 1').get(session.client_id) ? 'follow_up' : 'intake';
}

// ── Guardrails ──

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Enforce the method on a follow-up draft and resolve every change against the
 * active menu. Invalid changes are kept for review but marked and never applied.
 */
function applyFollowUpGuards(input, { clientText = '', menu = null } = {}) {
  const a = JSON.parse(JSON.stringify(input));
  const warnings = [];
  const clientNorm = norm(clientText);

  // 1. no free / cheat meal
  let removed = 0;
  const bad = (s) => FREE_MEAL_RE.test(String(s)) || kb.CHEAT_MEAL_RE.test(String(s));
  a.menu_changes = a.menu_changes.filter((c) => { if (bad(`${c.proposed} ${c.reason}`)) { removed++; return false; } return true; });
  a.habits = a.habits.filter((h) => { if (FREE_MEAL_RE.test(`${h.habit} ${h.target}`)) { removed++; return false; } return true; });
  if (removed) warnings.push(`הוסרו ${removed} הצעות של ארוחה חופשית / צ'יט (לא חלק מהשיטה).`);

  // 2. habits 2-4
  if (a.habits.length > 4) { warnings.push(`נשמרו 4 הרגלים מתוך ${a.habits.length}.`); a.habits = a.habits.slice(0, 4); }
  if (a.habits.length < 2) warnings.push('פחות משני הרגלים חדשים. כדאי להשלים לפני הייבוא.');

  // 3. resolve each change against the active menu
  const meals = new Map((menu?.meals || []).map((m) => [m.id, m]));
  const items = new Map();
  for (const m of menu?.meals || []) for (const i of m.items) items.set(i.id, { ...i, meal: m });
  const basketItem = [...items.values()].find((i) => i.item_type === 'daily_basket');
  const dayMeal = (text) => (menu?.meals || []).find((m) => (/שישי/.test(text) && /שישי/.test(m.meal_name)) || (/שבת/.test(text) && /שבת/.test(m.meal_name)));

  let invalid = 0;
  for (const c of a.menu_changes) {
    let problem = null;
    if (!menu) problem = 'אין תפריט פעיל ללקוח';
    else if (ITEM_CHANGES.has(c.change_type)) {
      if (!items.has(c.item_id)) problem = 'הפריט לא נמצא בתפריט הפעיל';
      else c.meal_id = items.get(c.item_id).meal.id;
    } else if (c.change_type === 'timing') {
      if (!meals.has(c.meal_id)) problem = 'הארוחה לא נמצאה בתפריט הפעיל';
      else if (!c.proposed_time.trim()) problem = 'חסרה שעה חדשה';
    } else if (c.change_type === 'add_item') {
      if (!meals.has(c.meal_id)) problem = 'הארוחה לא נמצאה בתפריט הפעיל';
    } else if (c.change_type === 'basket_variety') {
      if (!items.has(c.item_id) || items.get(c.item_id).item_type !== 'daily_basket') {
        if (basketItem) { c.item_id = basketItem.id; c.meal_id = basketItem.meal.id; } else problem = 'אין סל יומי בתפריט הפעיל';
      }
    } else if (c.change_type === 'weekend') {
      if (!meals.has(c.meal_id)) {
        const m = dayMeal(`${c.current} ${c.proposed} ${c.reason}`);
        if (m) c.meal_id = m.id; else problem = 'לא נמצא יום שישי / שבת בתפריט הפעיל';
      }
    }
    // portions: half steps 0.5-4 (0 = unchanged); basket 2-3 options
    if (c.proposed_portions) {
      c.proposed_portions = c.change_type === 'basket_variety' || (items.get(c.item_id)?.item_type === 'daily_basket')
        ? clamp(Math.round(c.proposed_portions), 2, 3)
        : clamp(Math.round(c.proposed_portions * 2) / 2, 0.5, 4);
    }
    if (c.change_type === 'portion' && !c.proposed_portions) problem = problem || 'חסר מספר מנות חדש';
    if (ITEM_CHANGES.has(c.change_type) && c.change_type !== 'portion' && !c.proposed.trim()) problem = problem || 'חסר הנוסח החדש של הפריט';
    // the real current text, from the menu (not the model's copy)
    if (items.has(c.item_id)) c.current = items.get(c.item_id).custom_text || c.current;
    else if (c.change_type === 'timing' && meals.has(c.meal_id)) c.current = meals.get(c.meal_id).time_label || c.current;

    c.valid = !problem && c.change_type !== 'other';
    c.problem = problem || (c.change_type === 'other' ? 'שינוי כללי: לא מוחל אוטומטית' : null);
    if (problem) invalid++;
    if (!c.valid) c.approved = false;
    else if (c.approved === undefined) c.approved = true;
  }
  if (invalid) warnings.push(`${invalid} שינויים לא תואמים לתפריט הפעיל (מסומנים ולא יוחלו).`);
  if (!menu) warnings.unshift('ללקוח אין תפריט פעיל: אפשר לעבור למצב אינטייק כדי לבנות תפריט ראשון.');

  // 4. quotes come from the client's own lines
  if (clientNorm) {
    let unverified = 0;
    for (const key of ['what_worked', 'difficulties', 'client_requests', 'new_clinical_info', 'barriers', 'previous_habits']) {
      for (const x of a[key]) {
        if (key === 'previous_habits' && x.status === 'not_discussed') continue;
        x.quote_status = quoteStatus(x.quote, clientNorm);
        if (x.quote_status === 'unverified' || x.quote_status === 'missing') unverified++;
      }
    }
    if (unverified) warnings.push(`${unverified} פריטים ללא ציטוט תואם מדברי המטופל (מסומנים לבדיקה).`);
  }

  if (a.reported_weight_kg && !(a.reported_weight_kg >= 30 && a.reported_weight_kg <= 300)) {
    warnings.push(`משקל מדווח ${a.reported_weight_kg} לא סביר, לא יובא.`);
    a.reported_weight_kg = 0;
  }
  if (a.speaker_labels_ok === false) warnings.push(`ייתכן שתפקידי הדוברים הפוכים: ${a.speaker_note || 'כדאי לבדוק ולהחליף.'}`);
  return { analysis: a, warnings };
}

// ── Run ──

async function analyzeFollowUp(db, sessionId) {
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
    const active = activeMenu(db, session.client_id);
    const context = {
      client: clientContext(db, session),
      previous_session: previousSession(db, session),
      active_menu: compactMenu(active),
    };

    const output = await generateStructured({
      task: 'session_analysis',
      system: [{ type: 'text', text: `${FOLLOWUP_PROMPT}\n\n${kbCtx.text}`, cache_control: { type: 'ephemeral' } }],
      prompt: `CONTEXT (from the CRM): ${JSON.stringify(context)}\n\nTRANSCRIPT${transcript.diarized ? '' : ' (no speaker labels: infer who speaks from content)'}:\n${transcript.text}`,
      schema: FollowUpModelSchema,
    });

    const { analysis, warnings } = applyFollowUpGuards(output, { clientText: transcript.clientText, menu: active });
    warnings.unshift(...transcriptWarnings(transcript.rawText));
    if (!kbCtx.loaded) warnings.unshift('מאגר הידע לא נטען: ההצעות לא הותאמו לשיטה.');
    set({
      status: 'draft',
      analysis: JSON.stringify(analysis),
      original: JSON.stringify(analysis),
      warnings: JSON.stringify(warnings),
      recording_ids: JSON.stringify(transcript.recordingIds),
      base_menu_id: active?.menu.id ?? null,
      error: null,
      analyzed_at: nowUtcISO(),
    });
    return { ok: true, warnings: warnings.length };
  } catch (err) {
    console.error(`[session-followup] session ${sessionId} failed:`, err.message);
    set({ status: 'failed', error: String(err.message || err).slice(0, 500) });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  FollowUpModelSchema, FollowUpSchema, CHANGE_TYPES, HABIT_STATUS,
  activeMenu, menuById, compactMenu, previousSession, suggestedMode, applyFollowUpGuards, analyzeFollowUp,
};
