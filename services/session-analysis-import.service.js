const { v4: uuidv4 } = require('uuid');
const { nowUtcISO } = require('../utils/dates');
const { publish } = require('./event-bus.service');

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

const TARGETS = {
  notes: { run: importNotes, column: 'imported_notes_at' },
  intake: { run: importIntake, column: 'imported_intake_at' },
  menu: { run: importMenu, column: 'imported_menu_at' },
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
  const run = db.transaction(() => {
    for (const target of targets) {
      const t = TARGETS[target];
      if (!t) throw Object.assign(new Error(`Unknown target: ${target}`), { status: 400 });
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

module.exports = { importAnalysis, MEAL_LABELS, SLOT_LABELS, BARRIER_LABELS, ANAMNESIS_LABELS };
