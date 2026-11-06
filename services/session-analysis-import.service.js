const { v4: uuidv4 } = require('uuid');
const { nowUtcISO } = require('../utils/dates');
const { publish } = require('./event-bus.service');
const { menuById } = require('./ai/session-followup.service');

// ─── Phase 10: import a reviewed analysis into the CRM ───────────────────────
// Three independent targets, each once per analysis (force re-imports):
//   notes  → session SOAP (S/A/P appended), habits → session tasks, summary → highlights
//   intake → the client's first-session intake: ONLY empty free-text fields
//   menu   → a new draft menu (menus / menu_meals / menu_items) in the active process

const MEAL_LABELS = {
  breakfast: 'ארוחת בוקר', ten_oclock: 'ארוחת עשר', lunch: 'ארוחת צהריים',
  snack: 'ארוחת ביניים', dinner: 'ארוחת ערב', night: 'ארוחת לילה',
};
const SLOT_LABELS = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירק', fruit: 'פרי' };
const BARRIER_LABELS = {
  emotional_eating: 'אכילה רגשית', schedule: 'סדר יום ולוח זמנים', late_night_eating: 'אכילה בשעות הלילה',
  weekend_social: 'סופי שבוע ואירועים', other: 'אחר',
};
const ANAMNESIS_LABELS = {
  medical_history: 'רקע רפואי', medications: 'תרופות', work_routine: 'שגרת עבודה', activity: 'פעילות גופנית',
  digestive: 'עיכול', sleep: 'שינה', food_likes: 'מזונות אהובים', food_dislikes: 'מזונות לא אהובים',
  allergies_intolerances: 'אלרגיות ורגישויות',
};

const facts = (list) => (list || []).map((f) => f.fact).filter((x) => x && x.trim());
const joinFacts = (list) => facts(list).join('; ');
const appendText = (existing, addition) => [existing, addition].filter((x) => x && String(x).trim()).join('\n\n');

function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

// ── notes ──
function importNotes(db, row, analysis) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(row.session_id);
  const soap = parseJson(s.soap_notes, {}) || {};
  const a = analysis.anamnesis;

  const subjective = [
    a.summary,
    ...Object.entries(ANAMNESIS_LABELS)
      .filter(([k]) => facts(a[k]).length)
      .map(([k, label]) => `${label}: ${joinFacts(a[k])}`),
  ].filter(Boolean).join('\n');
  const assessment = analysis.barriers.length
    ? `חסמים שזוהו:\n${analysis.barriers.map((b) => `• ${BARRIER_LABELS[b.type] || b.type}: ${b.description}`).join('\n')}`
    : '';
  const plan = [
    analysis.habits.length ? `הרגלים שסוכמו:\n${analysis.habits.map((h) => `• ${h.habit} (${h.target})`).join('\n')}` : '',
    analysis.open_questions?.length ? `לבירור בפגישה הבאה:\n${analysis.open_questions.map((q) => `• ${q}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const nextSoap = {
    subjective: appendText(soap.subjective, subjective),
    objective: soap.objective || '',
    assessment: appendText(soap.assessment, assessment),
    plan: appendText(soap.plan, plan),
  };
  const tasks = parseJson(s.tasks, []) || [];
  const existingTexts = new Set(tasks.map((t) => t.text));
  for (const h of analysis.habits) {
    const text = `${h.habit}: ${h.target}`;
    if (!existingTexts.has(text)) tasks.push({ id: uuidv4(), text, status: 'pending', carried_over_from_session: null });
  }
  const highlights = s.highlights && s.highlights.trim() ? s.highlights : (a.summary || s.highlights);

  db.prepare('UPDATE sessions SET soap_notes = ?, tasks = ?, highlights = ? WHERE id = ?')
    .run(JSON.stringify(nextSoap), JSON.stringify(tasks), highlights, s.id);
  return { sessionId: s.id, tasks_added: analysis.habits.length };
}

// ── intake: only empty free-text fields; conflicts reported, never overwritten ──
function importIntake(db, row, analysis) {
  const first = db.prepare('SELECT id FROM sessions WHERE client_id = ? ORDER BY session_number LIMIT 1').get(row.client_id);
  const sessionId = first?.id || row.session_id;
  let intake = db.prepare('SELECT * FROM session_intakes WHERE session_id = ?').get(sessionId);
  if (!intake) {
    const id = db.prepare('INSERT INTO session_intakes (session_id, client_id) VALUES (?, ?)').run(sessionId, row.client_id).lastInsertRowid;
    intake = db.prepare('SELECT * FROM session_intakes WHERE id = ?').get(id);
  }
  const a = analysis.anamnesis;
  const proposals = {
    work_hours: joinFacts(a.work_routine),
    activity_type: joinFacts(a.activity),
    favorite_foods: joinFacts(a.food_likes),
  };
  const meds = facts(a.medications);
  const empty = (v) => v === null || v === undefined || String(v).trim() === '' || v === '[]';

  const filled = [];
  const conflicts = [];
  const updates = {};
  for (const [field, value] of Object.entries(proposals)) {
    if (!value) continue;
    if (empty(intake[field])) { updates[field] = value; filled.push(field); }
    else if (String(intake[field]).trim() !== value) conflicts.push({ field, current: intake[field], suggested: value });
  }
  if (meds.length) {
    if (empty(intake.medications)) { updates.medications = JSON.stringify(meds); filled.push('medications'); }
    else conflicts.push({ field: 'medications', current: intake.medications, suggested: meds.join('; ') });
  }
  if (facts(a.activity).length && (intake.physical_activity === null || intake.physical_activity === undefined)) {
    updates.physical_activity = 1;
    filled.push('physical_activity');
  }
  if (Object.keys(updates).length) {
    db.prepare(`UPDATE session_intakes SET ${Object.keys(updates).map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...updates, updated_at: nowUtcISO(), id: intake.id });
  }
  return { intakeId: intake.id, filled, conflicts };
}

// ── menu: a new draft menu in the active process ──
function importMenu(db, row, analysis) {
  const plan = analysis.meal_plan;
  const session = db.prepare('SELECT session_number FROM sessions WHERE id = ?').get(row.session_id);
  const eng = db.prepare("SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1").get(row.client_id);
  const notes = [
    `טיוטה מניתוח פגישה ${session?.session_number ?? ''}. יעד קלורי משוער, לבדיקה: ${plan.calorie_rationale || ''}`.trim(),
    ...plan.general_notes,
  ].filter(Boolean).join('\n');

  const menuId = db.prepare(`
    INSERT INTO menus (client_id, engagement_id, title, calorie_target, status, notes)
    VALUES (?, ?, ?, ?, 'draft', ?)
  `).run(row.client_id, eng?.id ?? null, `טיוטת תפריט · פגישה ${session?.session_number ?? ''}`.trim(), plan.calorie_target_estimate, notes).lastInsertRowid;

  const addMeal = db.prepare('INSERT INTO menu_meals (menu_id, meal_name, meal_order, notes, time_label) VALUES (?, ?, ?, ?, ?)');
  const addItem = db.prepare('INSERT INTO menu_items (meal_id, item_type, portions, custom_text, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  let order = 0;

  for (const meal of plan.meals) {
    const mealId = addMeal.run(menuId, MEAL_LABELS[meal.meal] || meal.meal, ++order, meal.note || null, meal.time_hint || null).lastInsertRowid;
    meal.slots.forEach((slot, i) => {
      const options = slot.options.map((o) => `${o.amount} ${o.food}`.trim()).join(' \\ ');
      addItem.run(mealId, slot.slot, slot.portions, options || SLOT_LABELS[slot.slot], slot.note || null, i);
    });
  }

  const b = plan.daily_basket;
  const basketId = addMeal.run(menuId, 'סל יומי', ++order, `בחירה של ${b.options_per_day} אופציות, כ-${b.kcal_per_option} קק"ל לאופציה${b.note ? `. ${b.note}` : ''}`, null).lastInsertRowid;
  addItem.run(basketId, 'daily_basket', b.options_per_day, b.suggested_items.join(' \\ ') || 'מנת פרי', null, 0); // kcal is in the meal note

  for (const [key, label] of [['friday', 'יום שישי'], ['saturday', 'יום שבת']]) {
    const lines = plan[key]?.guidelines || [];
    if (!lines.length) continue;
    const dayId = addMeal.run(menuId, label, ++order, null, null).lastInsertRowid;
    lines.forEach((text, i) => addItem.run(dayId, 'custom', 1, text, null, i));
  }
  return { menuId: Number(menuId) };
}

// ── follow-up: notes ──
const HABIT_STATUS_LABELS = { kept: 'נשמר', partial: 'נשמר חלקית', not_kept: 'לא נשמר', not_discussed: 'לא נדון' };
const CHANGE_LABELS = {
  portion: 'מספר מנות', timing: 'שעת ארוחה', swap_option: 'החלפת חלופה', add_option: 'הוספת חלופה',
  remove_option: 'הסרת חלופה', add_item: 'פריט חדש', basket_variety: 'גיוון בסל היומי', weekend: 'סוף שבוע', other: 'אחר',
};
const bullets = (title, list) => (list?.length ? `${title}:\n${list.map((x) => `• ${x}`).join('\n')}` : '');

const splitOptions = (t) => String(t || '').split('\\').map((x) => x.trim()).filter(Boolean);

/** One readable log line; option edits show only what was added / removed. */
function describeChange(c) {
  const label = CHANGE_LABELS[c.change_type] || c.change_type;
  if (c.change_type === 'timing') return `${label}: ${c.proposed_time}${c.current ? ` (במקום: ${c.current})` : ''}`;
  if (c.change_type === 'portion') return `${label}: ${c.proposed_portions} מנות (${c.current})`;
  if (['swap_option', 'add_option', 'remove_option', 'basket_variety'].includes(c.change_type) && c.current) {
    const before = splitOptions(c.current);
    const after = splitOptions(c.proposed);
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    const parts = [added.length ? `נוסף: ${added.join(', ')}` : '', removed.length ? `הוסר: ${removed.join(', ')}` : ''].filter(Boolean);
    const portions = c.proposed_portions ? ` (${c.proposed_portions} ${c.change_type === 'basket_variety' ? 'אופציות' : 'מנות'})` : '';
    return `${label}: ${parts.join('; ') || c.proposed}${portions}`;
  }
  return `${label}: ${c.proposed}`;
}

function importFollowUpNotes(db, row, a) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(row.session_id);
  const soap = parseJson(s.soap_notes, {}) || {};
  const subjective = [
    a.summary,
    bullets('מה עבד', a.what_worked.map((x) => x.text)),
    bullets('נקודות קושי', a.difficulties.map((x) => x.text)),
    bullets('בקשות המטופל', a.client_requests.map((x) => x.text)),
    bullets('מידע קליני חדש', a.new_clinical_info.map((x) => x.text)),
  ].filter(Boolean).join('\n\n');
  const assessment = [
    bullets('הרגלים מהפגישה הקודמת', a.previous_habits.filter((h) => h.status !== 'not_discussed').map((h) => `${h.habit}: ${HABIT_STATUS_LABELS[h.status]}`)),
    bullets('חסמים', a.barriers.map((b) => `${BARRIER_LABELS[b.type] || b.type}: ${b.description}`)),
  ].filter(Boolean).join('\n\n');
  const approved = a.menu_changes.filter((c) => c.valid && c.approved);
  const plan = [
    bullets('הרגלים לפגישה הבאה', a.habits.map((h) => `${h.habit} (${h.target})`)),
    bullets('שינויים בתפריט', approved.map(describeChange)),
    bullets('לבירור בפגישה הבאה', a.open_questions),
  ].filter(Boolean).join('\n\n');

  const tasks = parseJson(s.tasks, []) || [];
  const existing = new Set(tasks.map((t) => t.text));
  for (const h of a.habits) {
    const text = `${h.habit}: ${h.target}`;
    if (!existing.has(text)) tasks.push({ id: uuidv4(), text, status: 'pending', carried_over_from_session: null });
  }
  const weight = (s.weight === null || s.weight === undefined || s.weight === '') && a.reported_weight_kg > 0 ? a.reported_weight_kg : s.weight;
  const highlights = s.highlights && s.highlights.trim() ? s.highlights : (a.summary || s.highlights);
  db.prepare('UPDATE sessions SET soap_notes = ?, tasks = ?, highlights = ?, weight = ? WHERE id = ?').run(
    JSON.stringify({ subjective: appendText(soap.subjective, subjective), objective: soap.objective || '', assessment: appendText(soap.assessment, assessment), plan: appendText(soap.plan, plan) }),
    JSON.stringify(tasks), highlights, weight, s.id,
  );
  return { sessionId: s.id, tasks_added: a.habits.length, weight_recorded: weight !== s.weight };
}

// ── follow-up: a new menu version cloned from the base menu, approved changes applied ──
function importFollowUpMenu(db, row, a) {
  const base = menuById(db, row.base_menu_id);
  if (!base) throw Object.assign(new Error('התפריט שעליו התבסס הניתוח לא נמצא.'), { status: 409 });
  const session = db.prepare('SELECT session_number FROM sessions WHERE id = ?').get(row.session_id);
  const approved = a.menu_changes.filter((c) => c.valid && c.approved);
  const log = approved.map((c) => `• ${describeChange(c)}`);
  const notes = [
    base.menu.notes,
    `יומן שינויים, פגישה ${session.session_number} (מבוסס על "${base.menu.title}"):\n${log.join('\n') || '• ללא שינויים'}`,
  ].filter(Boolean).join('\n\n');

  const menuId = Number(db.prepare(`
    INSERT INTO menus (client_id, engagement_id, title, calorie_target, status, notes) VALUES (?, ?, ?, ?, 'draft', ?)
  `).run(base.menu.client_id, base.menu.engagement_id, `עדכון מפגישה ${session.session_number}`, base.menu.calorie_target, notes).lastInsertRowid);

  const mealMap = new Map();
  const itemMap = new Map();
  const addMeal = db.prepare('INSERT INTO menu_meals (menu_id, meal_name, meal_order, notes, time_label) VALUES (?, ?, ?, ?, ?)');
  const addItem = db.prepare('INSERT INTO menu_items (meal_id, item_type, portions, food_item_id, custom_text, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const m of base.meals) {
    const newMeal = Number(addMeal.run(menuId, m.meal_name, m.meal_order, m.notes, m.time_label).lastInsertRowid);
    mealMap.set(m.id, newMeal);
    for (const i of m.items) {
      itemMap.set(i.id, Number(addItem.run(newMeal, i.item_type, i.portions, i.food_item_id, i.custom_text, i.notes, i.sort_order).lastInsertRowid));
    }
  }

  const setItem = db.prepare('UPDATE menu_items SET custom_text = COALESCE(@text, custom_text), portions = COALESCE(@portions, portions) WHERE id = @id');
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM menu_items WHERE meal_id = ?');
  for (const c of approved) {
    const portions = c.proposed_portions > 0 ? c.proposed_portions : null;
    const text = c.proposed && c.proposed.trim() ? c.proposed.trim() : null;
    switch (c.change_type) {
      case 'portion':
        setItem.run({ id: itemMap.get(c.item_id), text: null, portions });
        break;
      case 'swap_option': case 'add_option': case 'remove_option': case 'basket_variety':
        setItem.run({ id: itemMap.get(c.item_id), text, portions });
        break;
      case 'timing':
        db.prepare('UPDATE menu_meals SET time_label = ? WHERE id = ?').run(c.proposed_time.trim(), mealMap.get(c.meal_id));
        break;
      case 'add_item': case 'weekend': {
        const mealId = mealMap.get(c.meal_id);
        const type = c.change_type === 'weekend' ? 'custom' : c.item_type;
        addItem.run(mealId, type, portions ?? 1, null, text, null, nextOrder.get(mealId).n);
        break;
      }
      default: break;
    }
  }
  return { menuId, baseMenuId: base.menu.id, applied: approved.length, skipped: a.menu_changes.length - approved.length };
}

const TARGETS = {
  notes: { run: importNotes, column: 'imported_notes_at' },
  intake: { run: importIntake, column: 'imported_intake_at' },
  menu: { run: importMenu, column: 'imported_menu_at' },
};
const FOLLOWUP_TARGETS = {
  notes: { run: importFollowUpNotes, column: 'imported_notes_at' },
  menu: { run: importFollowUpMenu, column: 'imported_menu_at' },
};

/**
 * Import the current draft into the chosen targets (atomic).
 * @returns {{ results: object, skipped: string[] }}
 */
function importAnalysis(db, row, { targets = ['notes', 'intake', 'menu'], force = false } = {}) {
  const analysis = parseJson(row.analysis, null);
  if (!analysis) throw Object.assign(new Error('אין טיוטה לייבוא.'), { status: 409 });
  const results = {};
  const skipped = [];
  const followUp = row.mode === 'follow_up';
  const available = followUp ? FOLLOWUP_TARGETS : TARGETS;
  const run = db.transaction(() => {
    for (const target of targets) {
      const t = available[target];
      if (!t) {
        throw Object.assign(new Error(followUp && target === 'intake'
          ? 'בפגישת מעקב טופס האנמנזה לא מתעדכן.'
          : `Unknown target: ${target}`), { status: 400 });
      }
      if (row[t.column] && !force) { skipped.push(target); continue; }
      results[target] = t.run(db, row, analysis);
      const sets = [`${t.column} = @now`, 'updated_at = @now'];
      if (target === 'menu') sets.push('menu_id = @menu_id');
      db.prepare(`UPDATE session_ai_analyses SET ${sets.join(', ')} WHERE id = @id`)
        .run({ now: nowUtcISO(), id: row.id, menu_id: results.menu?.menuId ?? null });
    }
  });
  run();
  if (Object.keys(results).length) {
    publish(db, 'session.analysis_imported', { entityType: 'session', entityId: row.session_id, payload: { targets: Object.keys(results) } });
    if (results.menu) publish(db, 'menu.created', { entityType: 'client', entityId: row.client_id, payload: { menuId: results.menu.menuId } });
  }
  return { results, skipped };
}

module.exports = { importAnalysis, describeChange, MEAL_LABELS, SLOT_LABELS, BARRIER_LABELS, ANAMNESIS_LABELS, CHANGE_LABELS };
