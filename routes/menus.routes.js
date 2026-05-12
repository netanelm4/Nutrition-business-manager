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
// DB columns: menu_meals(meal_name, meal_order, time_label, notes)
//             menu_items(item_type, portions, custom_text, sort_order, food_item_id, notes)

function getFullMenu(id) {
  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
  if (!menu) return null;

  const meals = db.prepare(
    'SELECT * FROM menu_meals WHERE menu_id = ? ORDER BY meal_order ASC, id ASC'
  ).all(id);

  for (const meal of meals) {
    meal.items = db.prepare(
      'SELECT * FROM menu_items WHERE meal_id = ? ORDER BY sort_order ASC, id ASC'
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
// Body: { name, time_label?, meal_order? }
router.post('/:id/meals', (req, res) => {
  try {
    const menu = db.prepare('SELECT id FROM menus WHERE id = ?').get(req.params.id);
    if (!menu) return fail(res, 404, 'Menu not found');
    const { name, time_label = null, meal_order = 0 } = req.body;
    if (!name) return fail(res, 400, 'name required');
    const result = db.prepare(
      'INSERT INTO menu_meals (menu_id, meal_name, time_label, meal_order) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, name, time_label, meal_order);
    const meal = db.prepare('SELECT * FROM menu_meals WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { meal });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 7. Update meal ───────────────────────────────────────────────────────────
// Body: { name?, time_label?, meal_order? }
router.put('/:id/meals/:mealId', (req, res) => {
  try {
    const meal = db.prepare('SELECT id FROM menu_meals WHERE id = ? AND menu_id = ?').get(req.params.mealId, req.params.id);
    if (!meal) return fail(res, 404, 'Meal not found');
    const { name, time_label, meal_order } = req.body;
    db.prepare(
      'UPDATE menu_meals SET meal_name = COALESCE(?, meal_name), time_label = COALESCE(?, time_label), meal_order = COALESCE(?, meal_order) WHERE id = ?'
    ).run(name ?? null, time_label ?? null, meal_order ?? null, req.params.mealId);
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
// Body: { item_type, portions?, custom_text, notes?, sort_order?, food_item_id? }
router.post('/:id/meals/:mealId/items', (req, res) => {
  try {
    const meal = db.prepare('SELECT id FROM menu_meals WHERE id = ? AND menu_id = ?').get(req.params.mealId, req.params.id);
    if (!meal) return fail(res, 404, 'Meal not found');
    const {
      item_type    = 'protein',
      portions     = 1,
      custom_text  = null,
      food_item_id = null,
      notes        = null,
      sort_order   = 0,
    } = req.body;
    const result = db.prepare(
      'INSERT INTO menu_items (meal_id, item_type, portions, custom_text, food_item_id, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.mealId, item_type, portions, custom_text, food_item_id, notes, sort_order);
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { item });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 10. Update item ──────────────────────────────────────────────────────────
// Body: { item_type?, portions?, custom_text?, notes?, sort_order?, food_item_id? }
router.put('/:id/meals/:mealId/items/:itemId', (req, res) => {
  try {
    const item = db.prepare(
      'SELECT mi.id FROM menu_items mi JOIN menu_meals mm ON mm.id = mi.meal_id WHERE mi.id = ? AND mm.id = ? AND mm.menu_id = ?'
    ).get(req.params.itemId, req.params.mealId, req.params.id);
    if (!item) return fail(res, 404, 'Item not found');

    const { item_type, portions, custom_text, food_item_id, notes, sort_order } = req.body;
    db.prepare(`
      UPDATE menu_items SET
        item_type    = COALESCE(?, item_type),
        portions     = COALESCE(?, portions),
        custom_text  = COALESCE(?, custom_text),
        food_item_id = COALESCE(?, food_item_id),
        notes        = COALESCE(?, notes),
        sort_order   = COALESCE(?, sort_order)
      WHERE id = ?
    `).run(
      item_type    ?? null,
      portions     ?? null,
      custom_text  ?? null,
      food_item_id ?? null,
      notes        ?? null,
      sort_order   ?? null,
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
    const item = db.prepare(
      'SELECT mi.id FROM menu_items mi JOIN menu_meals mm ON mm.id = mi.meal_id WHERE mi.id = ? AND mm.id = ? AND mm.menu_id = ?'
    ).get(req.params.itemId, req.params.mealId, req.params.id);
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

    const client     = db.prepare('SELECT full_name FROM clients WHERE id = ?').get(menu.client_id);
    const clientName = client ? client.full_name : `לקוח ${menu.client_id}`;

    const client_summary = `לקוח: ${clientName} | יעד קלורי: ${menu.calorie_target} קק״ל | תפריט: ${menu.title}`;

    const mealLines = meals.map(meal => {
      const itemLines = meal.items.map(item => {
        const name = item.custom_text || (item.food_item_id
          ? (db.prepare('SELECT name_he FROM food_items WHERE id = ?').get(item.food_item_id)?.name_he ?? `פריט ${item.food_item_id}`)
          : 'פריט לא ידוע');
        const parts = [name];
        if (item.portions) parts.push(`${item.portions} מנות`);
        if (item.notes)    parts.push(`(${item.notes})`);
        return parts.join(' · ');
      });
      const header = meal.time_label ? `${meal.meal_name} (${meal.time_label})` : meal.meal_name;
      return `${header}:\n${itemLines.map(l => `  - ${l}`).join('\n')}`;
    });
    const menu_summary = mealLines.join('\n\n');

    const exResult = db.prepare(
      'INSERT INTO menu_examples (menu_id, client_summary, menu_summary, calorie_target) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, client_summary, menu_summary, menu.calorie_target);

    db.prepare("UPDATE menus SET status = 'final' WHERE id = ?").run(req.params.id);

    try {
      db.prepare(
        "INSERT INTO ai_memory (client_id, memory_type, content, source_type, source_id) VALUES (?, 'menu_insight', ?, 'menu', ?)"
      ).run(menu.client_id, menu_summary, Number(req.params.id));
    } catch {}

    ok(res, { finalized: true, menu_example_id: exResult.lastInsertRowid });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ─── 13. Generate menu (AI) ───────────────────────────────────────────────────
router.post('/:id/generate', async (req, res) => {
  const menuId = req.params.id;

  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
  if (!menu) return fail(res, 404, 'Menu not found');

  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(menu.client_id);
    if (!client) return fail(res, 404, 'Client not found');

    // Load intake — session first, fall back to lead intake
    let intake = db.prepare(
      'SELECT * FROM session_intakes WHERE client_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(menu.client_id);

    if (!intake) {
      const lead = db.prepare('SELECT id FROM leads WHERE converted_client_id = ? LIMIT 1').get(menu.client_id);
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

    // Few-shot examples within ±200 kcal
    const target   = menu.calorie_target;
    const examples = db.prepare(
      'SELECT client_summary, menu_summary, calorie_target FROM menu_examples WHERE calorie_target BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 3'
    ).all(target - 200, target + 200);

    // Food bank summary
    const fbRows = db.prepare("SELECT nutrient_type, COUNT(*) as cnt FROM food_categories GROUP BY nutrient_type").all();
    const fbSummary = fbRows.map(r => `${r.nutrient_type}: ${r.cnt} קטגוריות`).join(' | ');

    // Build system prompt
    const systemPrompt = `אתה נתנאל מלכה, דיאטן קליני מוסמך. אתה בונה תפריטים תזונתיים מותאמים אישית לכל לקוח לפי האנמנזה התזונתית שלו.

עקרונות הבנייה שלך:

1. גיוון — כל מנה מוצגת כרשימת אופציות המופרדות ב-\\
   לדוגמה: "ביצה \\ 2 פרוסות גבינה צהובה 9% \\ 3 כפות קוטג׳ \\ יוגורט חלבון"

2. התאמה אישית — אתה לומד מהאנמנזה התזונתית מה הלקוח אוהב, מה הוא רגיל לאכול,
   ומשמר את המבנה שלו תוך תיקון הכמויות.
   אתה מזכיר מאכלים ספציפיים שהלקוח ציין שהוא אוהב.

3. מבנה ארוחות:
   - כל ארוחה חייבת לכלול לפחות מנת חלבון אחת
   - סדר המנות: ירק → פחמימה → שומן
   - יעד קלורי: ${target} קק"ל ביום
   - מספר ארוחות: לפי האנמנזה של הלקוח

4. סל יומי:
   - 2 אופציות אם יעד >= 1350 קק"ל, אחרת אופציה אחת
   - לכלול נשנושים שהלקוח אוהב (גלידות, שוקולדים באריזות אישיות, פירות וכו׳)
   - אין צורך לרשום ערכים תזונתיים לאופציות הסל

5. ימי שישי ושבת — חלק חובה בכל תפריט:
   - מבוסס על מה שהלקוח עושה בפועל בימים אלו (לפי האנמנזה)
   - מטרה: מאזן קלורי נטרלי (לא גרעון, לא עודף)
   - לשמר את האוכל שהלקוח נהנה ממנו בסוף שבוע
   - לתת הנחיות ברורות לטיפול בארוחות המשפחתיות/חגיגיות

6. הערות התנהלות — חלק חובה בכל תפריט:
   - כתוב בגוף שני אישי ("אתה/את") המותאם למגדר הלקוח
   - לכלול:
     * התנהלות במסעדות (איך לבנות צלחת, מה להזמין)
     * התנהלות בארוחות חג/אירועים (איך להתכונן מראש)
     * התנהלות בימים עמוסים כשקשה להתארגן עם אוכל
     * הערות אישיות לפי דפוסי האכילה שזוהו באנמנזה
   - הטון צריך להיות חם, מעודד, לא שיפוטי

7. דגשים — חלק חובה:
   - שתייה (מים, קפה)
   - אלכוהול אם רלוונטי
   - הסברים על כפות/כוסות לפי הנחיות המידה

פורמט תגובה — JSON בלבד:
{
  "meals": [
    {
      "meal_name": "ארוחת בוקר",
      "meal_order": 1,
      "notes": "",
      "items": [
        {
          "item_type": "protein",
          "portions": 1,
          "custom_text": "ביצה \\\\ 2 פרוסות גבינה צהובה 9% \\\\ 3 כפות קוטג׳ עד 5%",
          "notes": ""
        }
      ]
    },
    {
      "meal_name": "סל יומי",
      "meal_order": 99,
      "notes": "בחירה של 2 אופציות",
      "items": [
        {
          "item_type": "daily_basket",
          "portions": 1,
          "custom_text": "מנת פרי \\\\ גלידות (מופיעות בדף האחרון) \\\\ שוקולדים באריזות אישיות",
          "notes": ""
        }
      ]
    },
    {
      "meal_name": "יום שישי",
      "meal_order": 97,
      "notes": "הנחיות לשישי ושבת",
      "items": [
        {
          "item_type": "custom",
          "portions": 1,
          "custom_text": "הנחיות מפורטות לפי האנמנזה...",
          "notes": ""
        }
      ]
    },
    {
      "meal_name": "הערות התנהלות",
      "meal_order": 98,
      "notes": "",
      "items": [
        {
          "item_type": "custom",
          "portions": 1,
          "custom_text": "הערות אישיות מפורטות...",
          "notes": ""
        }
      ]
    }
  ]
}`;

    // Build user message
    const genderLabel = client.gender === 'female' ? 'נקבה' : client.gender === 'male' ? 'זכר' : client.gender || 'לא צוין';
    let userMsg = `נתוני לקוח:\nשם: ${client.full_name} | גיל: ${client.age || 'לא צוין'} | מגדר: ${genderLabel} | משקל: ${client.initial_weight || 'לא צוין'} ק"ג | יעד קלורי: ${target} קק"ל\n`;

    if (intake) {
      if (intake.nutrition_anamnesis) userMsg += `\nאנמנזה תזונתית — יום שגרתי:\n${intake.nutrition_anamnesis}\n`;
      if (intake.friday_saturday)    userMsg += `\nשישי ושבת:\n${intake.friday_saturday}\n`;

      if (intake.diet_type)          userMsg += `\nסוג תזונה: ${intake.diet_type}\n`;

      if (intake.eating_patterns) {
        let ep = intake.eating_patterns;
        try {
          const parsed = JSON.parse(ep);
          ep = Array.isArray(parsed) ? parsed.join(', ') : JSON.stringify(parsed);
        } catch {}
        userMsg += `\nדפוסי אכילה: ${ep}\n`;
      }

      if (intake.favorite_snacks)    userMsg += `\nנשנושים אהובים: ${intake.favorite_snacks}\n`;
      if (intake.favorite_foods)     userMsg += `\nמאכלים אהובים: ${intake.favorite_foods}\n`;
      if (intake.water_intake)       userMsg += `\nשתייה: ${intake.water_intake}\n`;
      if (intake.coffee_per_day)     userMsg += `\nקפה ביום: ${intake.coffee_per_day}\n`;
      if (intake.alcohol_per_week)   userMsg += `\nאלכוהול בשבוע: ${intake.alcohol_per_week}\n`;
    }

    if (Object.keys(mb).length > 0) {
      userMsg += `\nהעדפות:\n`;
      if (mb.meals_per_day)                           userMsg += `- כמות ארוחות: ${mb.meals_per_day}\n`;
      if (mb.eats_breakfast)                          userMsg += `- ארוחת בוקר: ${mb.eats_breakfast}\n`;
      if (mb.has_midday_snack)                        userMsg += `- ביניים בבוקר: ${mb.has_midday_snack}\n`;
      if (mb.kashrut)                                 userMsg += `- כשרות: ${mb.kashrut}\n`;
      if (mb.vegetarian && mb.vegetarian !== 'no')    userMsg += `- צמחוני/טבעוני: ${mb.vegetarian}\n`;
      if (mb.cooks_at_home)                           userMsg += `- מבשל בבית: ${mb.cooks_at_home}\n`;
      if (mb.eats_lunch_outside)                      userMsg += `- אוכל צהריים בחוץ: ${mb.eats_lunch_outside}\n`;
      if (mb.disliked_foods)                          userMsg += `- מזונות שלא אוהב: ${mb.disliked_foods}\n`;
      if (mb.liked_foods)                             userMsg += `- מזונות שאוהב: ${mb.liked_foods}\n`;
      if (mb.allergies)                               userMsg += `- אלרגיות: ${mb.allergies}\n`;
    }

    if (fbSummary) userMsg += `\nסל המזון הזמין: ${fbSummary}\n`;

    if (examples.length > 0) {
      userMsg += `\nדוגמאות מתפריטים קודמים שאישרת:\n`;
      examples.forEach((ex, i) => {
        userMsg += `\n--- דוגמה ${i + 1}${ex.calorie_target ? ` (${ex.calorie_target} קק"ל)` : ''} ---\n`;
        userMsg += `${ex.client_summary}\n${ex.menu_summary}\n`;
      });
    }

    userMsg += `\nבנה תפריט יומי מלא.`;

    // Call Claude
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

    // Parse JSON
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

    // Write to DB atomically — correct column names throughout
    db.transaction(() => {
      db.prepare('DELETE FROM menu_meals WHERE menu_id = ?').run(menuId);

      for (const meal of parsed.meals) {
        const mealResult = db.prepare(
          'INSERT INTO menu_meals (menu_id, meal_name, meal_order, notes) VALUES (?, ?, ?, ?)'
        ).run(menuId, meal.meal_name || 'ארוחה', meal.meal_order ?? 0, meal.notes || null);

        const mealId = mealResult.lastInsertRowid;

        (Array.isArray(meal.items) ? meal.items : []).forEach((item, idx) => {
          db.prepare(
            'INSERT INTO menu_items (meal_id, item_type, portions, custom_text, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            mealId,
            item.item_type  || 'protein',
            item.portions   ?? 1,
            item.custom_text || item.item_type || 'פריט',
            item.notes      || null,
            idx
          );
        });
      }
    })();

    ok(res, getFullMenu(menuId));

  } catch (err) {
    fail(res, 500, err.message);
  }
});

module.exports = router;
