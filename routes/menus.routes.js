const express    = require('express');
const router     = express.Router();
const db         = require('../database/db');
const Anthropic  = require('@anthropic-ai/sdk');

let _ai = null;
function getAI() {
  if (!_ai) _ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _ai;
}

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

// ─── 13. Generate menu (AI) ───────────────────────────────────────────────────
router.post('/:id/generate', async (req, res) => {
  const menuId = req.params.id;

  // 1. Load menu
  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
  if (!menu) return fail(res, 404, 'Menu not found');

  try {
    // 2. Load client
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(menu.client_id);
    if (!client) return fail(res, 404, 'Client not found');

    // 3. Load intake — prefer most-recent session intake, fall back to lead intake
    let intake = db.prepare(
      'SELECT * FROM session_intakes WHERE client_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(menu.client_id);

    if (!intake) {
      const lead = db.prepare(
        'SELECT id FROM leads WHERE converted_client_id = ? LIMIT 1'
      ).get(menu.client_id);
      if (lead) {
        intake = db.prepare(
          'SELECT * FROM lead_intakes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(lead.id);
      }
    }

    let mb = {};
    if (intake?.menu_building) {
      try { mb = JSON.parse(intake.menu_building) || {}; } catch {}
    }

    // 4. Load few-shot examples
    const target = menu.calorie_target;
    const examples = db.prepare(
      'SELECT client_summary, menu_summary, calorie_target FROM menu_examples WHERE calorie_target BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 3'
    ).all(target - 200, target + 200);

    // 5. Food bank summary
    const fbRows = db.prepare(
      "SELECT nutrient_type, COUNT(*) as cnt FROM food_items GROUP BY nutrient_type"
    ).all();
    const fbSummary = fbRows
      .map(r => `${r.nutrient_type}: ${r.cnt} פריטים`)
      .join(' | ');

    // 6. Build system prompt
    const dailyOptions = target >= 1350 ? '2 אופציות' : 'אופציה אחת';
    const systemPrompt = `אתה דיאטן קליני שעוזר לבנות תפריטים תזונתיים מותאמים אישית.
אתה בונה תפריטים לפי הלוגיקה הבאה:
- כל ארוחה חייבת להכיל לפחות מנת חלבון אחת
- סדר המנות בארוחה: קודם ירק, אחר כך פחמימה, בסוף שומן
- יעד קלורי יומי: ${target} קק"ל
- סל יומי: ${dailyOptions}
- מנת חלבון = 100-140 קק"ל
- מנת פחמימה = 70-100 קק"ל
- מנת שומן = 45-60 קק"ל
- מנת ירק = עד 40 קק"ל
- התפריט מבוסס על האנמנזה התזונתית של הלקוח — שמור על המבנה שלו ותקן את הכמויות
- החזר JSON בלבד ללא טקסט נוסף
- פורמט JSON:
{
  "meals": [
    {
      "meal_name": "ארוחת בוקר",
      "meal_order": 1,
      "notes": "",
      "items": [
        { "item_type": "protein", "portions": 2, "custom_text": "ביצים", "notes": "" }
      ]
    }
  ]
}`;

    // 7. Build user message
    const genderLabel = client.gender === 'female' ? 'נקבה' : client.gender === 'male' ? 'זכר' : client.gender || 'לא צוין';
    let userMsg = `נתוני לקוח:
שם: ${client.full_name} | גיל: ${client.age || 'לא צוין'} | מגדר: ${genderLabel} | משקל: ${client.initial_weight || 'לא צוין'} ק"ג | יעד קלורי: ${target} קק"ל\n`;

    if (intake) {
      if (intake.nutrition_anamnesis) {
        userMsg += `\nאנמנזה תזונתית — יום שגרתי:\n${intake.nutrition_anamnesis}\n`;
      }
      if (intake.friday_saturday) {
        userMsg += `\nשישי ושבת:\n${intake.friday_saturday}\n`;
      }
    }

    if (Object.keys(mb).length > 0) {
      userMsg += `\nהעדפות:\n`;
      if (mb.meals_per_day)       userMsg += `- כמות ארוחות: ${mb.meals_per_day}\n`;
      if (mb.eats_breakfast)      userMsg += `- ארוחת בוקר: ${mb.eats_breakfast}\n`;
      if (mb.has_midday_snack)    userMsg += `- ביניים בבוקר: ${mb.has_midday_snack}\n`;
      if (mb.kashrut)             userMsg += `- כשרות: ${mb.kashrut}\n`;
      if (mb.vegetarian && mb.vegetarian !== 'no') userMsg += `- צמחוני/טבעוני: ${mb.vegetarian}\n`;
      if (mb.cooks_at_home)       userMsg += `- מבשל בבית: ${mb.cooks_at_home}\n`;
      if (mb.eats_lunch_outside)  userMsg += `- אוכל צהריים בחוץ: ${mb.eats_lunch_outside}\n`;
      if (mb.disliked_foods)      userMsg += `- מזונות שלא אוהב: ${mb.disliked_foods}\n`;
      if (mb.liked_foods)         userMsg += `- מזונות שאוהב: ${mb.liked_foods}\n`;
      if (mb.allergies)           userMsg += `- אלרגיות: ${mb.allergies}\n`;
    }

    if (fbSummary) {
      userMsg += `\nסל המזון הזמין: ${fbSummary}\n`;
    }

    if (examples.length > 0) {
      userMsg += `\nדוגמאות מתפריטים קודמים שאישרת:\n`;
      examples.forEach((ex, i) => {
        userMsg += `\n--- דוגמה ${i + 1} (${ex.calorie_target} קק"ל) ---\n`;
        userMsg += `${ex.client_summary}\n${ex.menu_summary}\n`;
      });
    }

    userMsg += `\nבנה תפריט יומי מלא.`;

    // 8. Call Claude
    let rawResponse;
    try {
      const msg = await getAI().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      });
      rawResponse = msg.content[0]?.text ?? '';
    } catch (apiErr) {
      return res.status(502).json({ ok: false, error: 'Claude API error', details: apiErr.message });
    }

    // 9. Parse JSON
    let parsed;
    try {
      const jsonText = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(jsonText);
    } catch {
      return res.status(500).json({ ok: false, error: 'JSON parse failed', raw: rawResponse });
    }

    if (!parsed?.meals || !Array.isArray(parsed.meals)) {
      return res.status(500).json({ ok: false, error: 'Unexpected AI response shape', raw: rawResponse });
    }

    // 10. Write to DB atomically
    db.transaction(() => {
      db.prepare('DELETE FROM menu_meals WHERE menu_id = ?').run(menuId);

      for (const meal of parsed.meals) {
        const mealResult = db.prepare(
          'INSERT INTO menu_meals (menu_id, name, order_index, notes) VALUES (?, ?, ?, ?)'
        ).run(menuId, meal.meal_name || 'ארוחה', meal.meal_order ?? 0, meal.notes || null);

        const mealId = mealResult.lastInsertRowid;

        const items = Array.isArray(meal.items) ? meal.items : [];
        items.forEach((item, idx) => {
          const customName = item.custom_text || item.item_type || 'פריט';
          const portionDesc = item.portions ? `${item.portions} מנות` : null;
          db.prepare(
            'INSERT INTO menu_items (meal_id, custom_name, portion_description, notes, order_index) VALUES (?, ?, ?, ?, ?)'
          ).run(mealId, customName, portionDesc, item.notes || null, idx);
        });
      }
    })();

    // 11. Return full updated menu
    const updated = getFullMenu(menuId);
    ok(res, updated);

  } catch (err) {
    fail(res, 500, err.message);
  }
});

module.exports = router;
