const express = require('express');
const db = require('../database/db');

const router = express.Router();

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── GET /api/food-bank/categories ────────────────────────────────────────────

router.get('/categories', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT fc.id, fc.nutrient_type, fc.name_he, fc.sort_order,
             COUNT(fi.id) AS item_count
      FROM food_categories fc
      LEFT JOIN food_items fi ON fi.category_id = fc.id AND fi.is_active = 1
      GROUP BY fc.id
      ORDER BY fc.sort_order
    `).all();
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /food-bank/categories]', err);
    return fail(res, 500, 'Failed to fetch categories.');
  }
});

// ─── GET /api/food-bank/items/:categoryId ─────────────────────────────────────

router.get('/items/:categoryId', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM food_items
      WHERE category_id = ? AND is_active = 1
      ORDER BY sort_order, name_he
    `).all(req.params.categoryId);
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /food-bank/items/:categoryId]', err);
    return fail(res, 500, 'Failed to fetch items.');
  }
});

// ─── POST /api/food-bank/items ────────────────────────────────────────────────

router.post('/items', (req, res) => {
  try {
    const { category_id, name_he, portion_description, portion_grams,
            calories_per_half_portion, protein_grams, notes } = req.body;

    if (!category_id || !name_he?.trim()) {
      return fail(res, 400, 'category_id and name_he are required.');
    }

    const result = db.prepare(`
      INSERT INTO food_items
        (category_id, name_he, portion_description, portion_grams,
         calories_per_half_portion, protein_grams, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      category_id,
      name_he.trim(),
      portion_description?.trim() || null,
      portion_grams    != null ? Number(portion_grams)              : null,
      calories_per_half_portion != null ? Number(calories_per_half_portion) : null,
      protein_grams    != null ? Number(protein_grams)              : null,
      notes?.trim()    || null,
    );

    const row = db.prepare('SELECT * FROM food_items WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, row);
  } catch (err) {
    console.error('[POST /food-bank/items]', err);
    return fail(res, 500, 'Failed to create item.');
  }
});

// ─── PUT /api/food-bank/items/:id ─────────────────────────────────────────────

router.put('/items/:id', (req, res) => {
  try {
    const { name_he, portion_description, portion_grams,
            calories_per_half_portion, protein_grams, notes } = req.body;

    if (!name_he?.trim()) return fail(res, 400, 'name_he is required.');

    db.prepare(`
      UPDATE food_items
      SET name_he = ?, portion_description = ?, portion_grams = ?,
          calories_per_half_portion = ?, protein_grams = ?, notes = ?
      WHERE id = ? AND is_active = 1
    `).run(
      name_he.trim(),
      portion_description?.trim() || null,
      portion_grams    != null ? Number(portion_grams)              : null,
      calories_per_half_portion != null ? Number(calories_per_half_portion) : null,
      protein_grams    != null ? Number(protein_grams)              : null,
      notes?.trim()    || null,
      req.params.id,
    );

    const row = db.prepare('SELECT * FROM food_items WHERE id = ?').get(req.params.id);
    if (!row) return fail(res, 404, 'Item not found.');
    return ok(res, row);
  } catch (err) {
    console.error('[PUT /food-bank/items/:id]', err);
    return fail(res, 500, 'Failed to update item.');
  }
});

// ─── GET /api/food-bank/macro/:nutrientType ──────────────────────────────────

const ALLOWED_TYPES = ['protein', 'carb', 'fat', 'vegetable', 'fruit'];

router.get('/macro/:nutrientType', (req, res) => {
  try {
    const { nutrientType } = req.params;
    if (!ALLOWED_TYPES.includes(nutrientType)) {
      return fail(res, 400, 'Invalid nutrient type.');
    }

    const cats = db.prepare(
      'SELECT id, name_he FROM food_categories WHERE nutrient_type = ? ORDER BY sort_order'
    ).all(nutrientType);

    const categories = cats.map((cat) => {
      const items = db.prepare(
        'SELECT * FROM food_items WHERE category_id = ? AND is_active = 1 ORDER BY sort_order, name_he'
      ).all(cat.id);
      return { ...cat, items };
    });

    return ok(res, { categories });
  } catch (err) {
    console.error('[GET /food-bank/macro/:nutrientType]', err);
    return fail(res, 500, 'Failed to fetch macro data.');
  }
});

// ─── DELETE /api/food-bank/items/:id ─────────────────────────────────────────

router.delete('/items/:id', (req, res) => {
  try {
    db.prepare('UPDATE food_items SET is_active = 0 WHERE id = ?').run(req.params.id);
    return ok(res, { id: Number(req.params.id) });
  } catch (err) {
    console.error('[DELETE /food-bank/items/:id]', err);
    return fail(res, 500, 'Failed to delete item.');
  }
});

module.exports = router;
