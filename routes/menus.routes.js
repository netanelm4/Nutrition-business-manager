const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

const ok   = (res, data)         => res.json({ ok: true, ...data });
const fail = (res, status, msg)  => res.status(status).json({ ok: false, error: msg });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFullMenu(id) {
  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
  if (!menu) return null;

  const meals = db.prepare(
    'SELECT * FROM menu_meals WHERE menu_id = ? ORDER BY order_index ASC, id ASC'
  ).all(id);

  for (const meal of meals) {
    meal.items = db.prepare(
      'SELECT * FROM menu_items WHERE meal_id = ? ORDER BY order_index ASC, id ASC'
    ).all(meal.id);
  }

  return { menu, meals };
}

// ─── 1. List menus ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { client_id, engagement_id } = req.query;
    let sql    = 'SELECT * FROM menus';
    const args = [];
    const conds = [];
    if (client_id)     { conds.push('client_id = ?');     args.push(client_id); }
    if (engagement_id) { conds.push('engagement_id = ?'); args.push(engagement_id); }
    if (conds.length)  sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const menus = db.prepare(sql).all(...args);
    ok(res, { menus });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 2. Get full menu ─────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const data = getFullMenu(req.params.id);
    if (!data) return fail(res, 404, 'Menu not found');
    ok(res, data);
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 3. Create menu ───────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { client_id, engagement_id = null, title, calorie_target, notes = null } = req.body;
    if (!client_id || !title || !calorie_target) return fail(res, 400, 'client_id, title, calorie_target required');
    const result = db.prepare(
      'INSERT INTO menus (client_id, engagement_id, title, calorie_target, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(client_id, engagement_id, title, calorie_target, notes);
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { menu });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 4. Update menu metadata ──────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { title, calorie_target, notes } = req.body;
    const menu = db.prepare('SELECT id FROM menus WHERE id = ?').get(req.params.id);
    if (!menu) return fail(res, 404, 'Menu not found');
    db.prepare(
      'UPDATE menus SET title = COALESCE(?, title), calorie_target = COALESCE(?, calorie_target), notes = COALESCE(?, notes) WHERE id = ?'
    ).run(title ?? null, calorie_target ?? null, notes ?? null, req.params.id);
    const updated = db.prepare('SELECT * FROM menus WHERE id = ?').get(req.params.id);
    ok(res, { menu: updated });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 5. Delete menu ───────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const menu = db.prepare('SELECT id FROM menus WHERE id = ?').get(req.params.id);
    if (!menu) return fail(res, 404, 'Menu not found');
    db.prepare('DELETE FROM menus WHERE id = ?').run(req.params.id);
    ok(res, { deleted: true });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 6. Add meal ──────────────────────────────────────────────────────────────
router.post('/:id/meals', (req, res) => {
  try {
    const menu = db.prepare('SELECT id FROM menus WHERE id = ?').get(req.params.id);
    if (!menu) return fail(res, 404, 'Menu not found');
    const { name, time_label = null, order_index = 0 } = req.body;
    if (!name) return fail(res, 400, 'name required');
    const result = db.prepare(
      'INSERT INTO menu_meals (menu_id, name, time_label, order_index) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, name, time_label, order_index);
    const meal = db.prepare('SELECT * FROM menu_meals WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { meal });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 7. Update meal ───────────────────────────────────────────────────────────
router.put('/:id/meals/:mealId', (req, res) => {
  try {
    const meal = db.prepare('SELECT id FROM menu_meals WHERE id = ? AND menu_id = ?').get(req.params.mealId, req.params.id);
    if (!meal) return fail(res, 404, 'Meal not found');
    const { name, time_label, order_index } = req.body;
    db.prepare(
      'UPDATE menu_meals SET name = COALESCE(?, name), time_label = COALESCE(?, time_label), order_index = COALESCE(?, order_index) WHERE id = ?'
    ).run(name ?? null, time_label ?? null, order_index ?? null, req.params.mealId);
    const updated = db.prepare('SELECT * FROM menu_meals WHERE id = ?').get(req.params.mealId);
    ok(res, { meal: updated });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 8. Delete meal ───────────────────────────────────────────────────────────
router.delete('/:id/meals/:mealId', (req, res) => {
  try {
    const meal = db.prepare('SELECT id FROM menu_meals WHERE id = ? AND menu_id = ?').get(req.params.mealId, req.params.id);
    if (!meal) return fail(res, 404, 'Meal not found');
    db.prepare('DELETE FROM menu_meals WHERE id = ?').run(req.params.mealId);
    ok(res, { deleted: true });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 9. Add item to meal ──────────────────────────────────────────────────────
router.post('/:id/meals/:mealId/items', (req, res) => {
  try {
    const meal = db.prepare('SELECT id FROM menu_meals WHERE id = ? AND menu_id = ?').get(req.params.mealId, req.params.id);
    if (!meal) return fail(res, 404, 'Meal not found');
    const {
      food_item_id = null, custom_name = null,
      portion_grams = null, portion_description = null,
      calories = null, protein = null, carbs = null, fat = null,
      notes = null, order_index = 0,
    } = req.body;
    const result = db.prepare(`
      INSERT INTO menu_items
        (meal_id, food_item_id, custom_name, portion_grams, portion_description, calories, protein, carbs, fat, notes, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.mealId, food_item_id, custom_name, portion_grams, portion_description, calories, protein, carbs, fat, notes, order_index);
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { item });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 10. Update item ──────────────────────────────────────────────────────────
router.put('/:id/meals/:mealId/items/:itemId', (req, res) => {
  try {
    const item = db.prepare('SELECT mi.id FROM menu_items mi JOIN menu_meals mm ON mm.id = mi.meal_id WHERE mi.id = ? AND mm.id = ? AND mm.menu_id = ?')
      .get(req.params.itemId, req.params.mealId, req.params.id);
    if (!item) return fail(res, 404, 'Item not found');
    const {
      food_item_id, custom_name, portion_grams, portion_description,
      calories, protein, carbs, fat, notes, order_index,
    } = req.body;
    db.prepare(`
      UPDATE menu_items SET
        food_item_id        = COALESCE(?, food_item_id),
        custom_name         = COALESCE(?, custom_name),
        portion_grams       = COALESCE(?, portion_grams),
        portion_description = COALESCE(?, portion_description),
        calories            = COALESCE(?, calories),
        protein             = COALESCE(?, protein),
        carbs               = COALESCE(?, carbs),
        fat                 = COALESCE(?, fat),
        notes               = COALESCE(?, notes),
        order_index         = COALESCE(?, order_index)
      WHERE id = ?
    `).run(
      food_item_id ?? null, custom_name ?? null, portion_grams ?? null,
      portion_description ?? null, calories ?? null, protein ?? null,
      carbs ?? null, fat ?? null, notes ?? null, order_index ?? null,
      req.params.itemId
    );
    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.itemId);
    ok(res, { item: updated });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 11. Delete item ──────────────────────────────────────────────────────────
router.delete('/:id/meals/:mealId/items/:itemId', (req, res) => {
  try {
    const item = db.prepare('SELECT mi.id FROM menu_items mi JOIN menu_meals mm ON mm.id = mi.meal_id WHERE mi.id = ? AND mm.id = ? AND mm.menu_id = ?')
      .get(req.params.itemId, req.params.mealId, req.params.id);
    if (!item) return fail(res, 404, 'Item not found');
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.itemId);
    ok(res, { deleted: true });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 12. Finalize menu ────────────────────────────────────────────────────────
router.post('/:id/finalize', (req, res) => {
  try {
    const data = getFullMenu(req.params.id);
    if (!data) return fail(res, 404, 'Menu not found');
    const { menu, meals } = data;

    const client = db.prepare('SELECT full_name FROM clients WHERE id = ?').get(menu.client_id);
    const clientName = client ? client.full_name : `לקוח ${menu.client_id}`;

    const client_summary = `לקוח: ${clientName} | יעד קלורי: ${menu.calorie_target} קק״ל | תפריט: ${menu.title}`;

    const mealLines = meals.map(meal => {
      const itemLines = meal.items.map(item => {
        const name = item.custom_name || (item.food_item_id
          ? (db.prepare('SELECT name_he FROM food_items WHERE id = ?').get(item.food_item_id)?.name_he ?? `פריט ${item.food_item_id}`)
          : 'פריט לא ידוע');
        const parts = [name];
        if (item.portion_description) parts.push(item.portion_description);
        else if (item.portion_grams)  parts.push(`${item.portion_grams}g`);
        if (item.calories) parts.push(`${item.calories} קק״ל`);
        if (item.notes)    parts.push(`(${item.notes})`);
        return parts.join(' · ');
      });
      const header = meal.time_label ? `${meal.name} (${meal.time_label})` : meal.name;
      return `${header}:\n${itemLines.map(l => `  - ${l}`).join('\n')}`;
    });
    const menu_summary = mealLines.join('\n\n');

    const exResult = db.prepare(
      'INSERT INTO menu_examples (client_summary, menu_summary, calorie_target) VALUES (?, ?, ?)'
    ).run(client_summary, menu_summary, menu.calorie_target);

    db.prepare("UPDATE menus SET status = 'final' WHERE id = ?").run(req.params.id);

    ok(res, { finalized: true, menu_example_id: exResult.lastInsertRowid });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 13. Generate menu (Phase 3 stub) ────────────────────────────────────────
router.post('/:id/generate', (req, res) => {
  res.status(501).json({ ok: false, error: 'Not implemented — Phase 3' });
});

module.exports = router;
