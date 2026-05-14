const express = require('express');
const db = require('../database/db');

const router = express.Router();

// ─── In-memory rate limiter: 5 requests per IP per hour ───────────────────────

const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

// Clean up stale entries every hour to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// ─── POST /api/leads/public ───────────────────────────────────────────────────

router.post('/leads/public', (req, res) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({
      success: false,
      error: 'שלחת יותר מידי בקשות. נסה שוב מאוחר יותר.',
    });
  }

  const { full_name, phone, goal, notes } = req.body;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ success: false, error: 'שם מלא הוא שדה חובה.' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ success: false, error: 'טלפון הוא שדה חובה.' });
  }

  try {
    db.prepare(`
      INSERT INTO leads (full_name, phone, source, status, notes)
      VALUES (@full_name, @phone, @source, @status, @notes)
    `).run({
      full_name: full_name.trim(),
      phone: phone.trim(),
      source: 'landing_page',
      status: 'new',
      notes: goal
        ? `מטרה: ${goal}${notes?.trim() ? '\n' + notes.trim() : ''}`
        : notes?.trim() || null,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /leads/public]', err);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית. נסה שוב.' });
  }
});

// ─── Weight entry helpers (duplicated to keep this file self-contained) ───────

function getDayOfWeekPublic(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  if (day === 1) return 'monday';
  if (day === 4) return 'thursday';
  return null;
}

function getMondayOfWeekPublic(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function groupWeightRows(rows) {
  const weekMap = {};
  for (const row of rows) {
    const ws = getMondayOfWeekPublic(row.weigh_date);
    if (!weekMap[ws]) weekMap[ws] = { week_start: ws, monday_weight: null, monday_id: null, thursday_weight: null, thursday_id: null };
    if (row.day_of_week === 'monday')   { weekMap[ws].monday_weight = row.weight;   weekMap[ws].monday_id = row.id; }
    if (row.day_of_week === 'thursday') { weekMap[ws].thursday_weight = row.weight; weekMap[ws].thursday_id = row.id; }
  }
  return Object.values(weekMap)
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .map((w) => {
      const both = w.monday_weight !== null && w.thursday_weight !== null;
      const one  = w.monday_weight !== null || w.thursday_weight !== null;
      const avg  = both ? Math.round(((w.monday_weight + w.thursday_weight) / 2) * 10) / 10
                        : one ? (w.monday_weight ?? w.thursday_weight) : null;
      return { ...w, average: avg, average_approximate: !both && one };
    });
}

function buildWeightStats(clientId) {
  const rows = db.prepare(
    'SELECT id, weigh_date, weight, day_of_week FROM weight_logs WHERE client_id = ? ORDER BY weigh_date ASC'
  ).all(clientId);

  const allWeights  = rows.map((r) => r.weight);
  const firstWeight = allWeights.length > 0 ? allWeights[0] : null;
  const latestWeight = allWeights.length > 0 ? allWeights[allWeights.length - 1] : null;
  const totalChange  = firstWeight !== null && latestWeight !== null
    ? Math.round((latestWeight - firstWeight) * 10) / 10
    : null;

  // Newest-first for week views
  const rowsDesc = [...rows].reverse();
  const all_weeks    = groupWeightRows(rowsDesc);
  const recent_weeks = all_weeks.slice(0, 4);

  return { first_weight: firstWeight, latest_weight: latestWeight, total_change: totalChange, recent_weeks, all_weeks };
}

// ─── Ensure weight schema exists (in case migration didn't run on this volume) ─

function ensureWeightSchema() {
  try { db.exec('ALTER TABLE clients ADD COLUMN weight_token TEXT'); } catch {}
  try { db.exec('CREATE TABLE IF NOT EXISTS weight_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id), weigh_date TEXT NOT NULL, weight REAL NOT NULL, day_of_week TEXT CHECK (day_of_week IN (\'monday\',\'thursday\')), notes TEXT, created_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(client_id, weigh_date))'); } catch {}
  try { db.exec("UPDATE clients SET weight_token = hex(randomblob(8)) WHERE weight_token IS NULL"); } catch {}
}

// ─── GET /api/public/weight/:token ───────────────────────────────────────────

router.get('/public/weight/:token', (req, res) => {
  try {
    ensureWeightSchema();
    const client = db.prepare('SELECT id, full_name FROM clients WHERE weight_token = ?').get(req.params.token);
    if (!client) return res.status(404).json({ success: false, error: 'קישור לא תקין' });

    const stats = buildWeightStats(client.id);
    return res.json({ success: true, data: { client_name: client.full_name, ...stats } });
  } catch (err) {
    console.error('[GET /public/weight/:token]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── POST /api/public/weight/:token ──────────────────────────────────────────

router.post('/public/weight/:token', (req, res) => {
  try {
    ensureWeightSchema();
    const client = db.prepare('SELECT id FROM clients WHERE weight_token = ?').get(req.params.token);
    if (!client) return res.status(404).json({ success: false, error: 'קישור לא תקין' });

    const { date, weight } = req.body;
    if (!date || weight === undefined || weight === null) {
      return res.status(400).json({ success: false, error: 'date ו-weight הם שדות חובה' });
    }

    const w = Number(weight);
    if (isNaN(w) || w < 20 || w > 300) {
      return res.status(400).json({ success: false, error: 'משקל לא תקין — יש להזין ערך בין 20 ל-300 ק"ג' });
    }

    const dayOfWeek = getDayOfWeekPublic(date);
    if (!dayOfWeek) {
      return res.status(400).json({ success: false, error: 'ניתן להוסיף שקילה רק בימי שני וחמישי' });
    }

    db.prepare(`
      INSERT INTO weight_logs (client_id, weigh_date, weight, day_of_week)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(client_id, weigh_date) DO UPDATE SET weight = excluded.weight
    `).run(client.id, date, w, dayOfWeek);

    const stats = buildWeightStats(client.id);
    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[POST /public/weight/:token]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── TEMP DEBUG: GET /api/public/debug/weight-schema (no auth) ───────────────

router.get('/public/debug/weight-schema', (req, res) => {
  const result = {};

  try {
    result.clients_sql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='clients'"
    ).get();
  } catch (err) {
    result.clients_sql_error = err.message;
  }

  try {
    result.clients_sample = db.prepare('SELECT id, full_name FROM clients LIMIT 3').all();
  } catch (err) {
    result.clients_sample_error = err.message;
  }

  try {
    result.weight_token_sample = db.prepare('SELECT weight_token FROM clients LIMIT 1').get();
  } catch (err) {
    result.weight_token_error = err.message;
  }

  return res.json(result);
});

// ─── Food & Recipe public endpoints ──────────────────────────────────────────

const MACRO_LABELS = {
  protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירק', fruit: 'פרי',
};
const MACRO_CEILINGS = { protein: 140, carb: 100, fat: 60, vegetable: 40, fruit: 120 };

function findClientByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT id, full_name FROM clients WHERE weight_token = ?').get(token);
}

function calcNutritionPerServing(recipeId, servings) {
  const ingredients = db.prepare(
    'SELECT ri.amount_grams, fi.calories_per_half_portion, fi.protein_grams, fi.portion_grams ' +
    'FROM recipe_ingredients ri LEFT JOIN food_items fi ON fi.id = ri.food_item_id ' +
    'WHERE ri.recipe_id = ?'
  ).all(recipeId);

  let totalCal = 0, totalProt = 0;
  for (const ing of ingredients) {
    if (!ing.calories_per_half_portion || !ing.portion_grams || ing.portion_grams === 0) continue;
    const factor = ing.amount_grams / ing.portion_grams;
    totalCal  += ing.calories_per_half_portion * factor;
    totalProt += (ing.protein_grams || 0) * factor;
  }
  const s = servings || 1;
  return {
    calories_per_serving: Math.round(totalCal / s),
    protein_per_serving:  Math.round(totalProt / s * 10) / 10,
  };
}

function getRecipeWithDetails(recipeId) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  if (!recipe) return null;
  const ingredients = db.prepare(
    'SELECT ri.id, ri.food_item_id, ri.custom_food_name, ri.amount_grams, ri.notes, ' +
    'fi.name_he, fi.calories_per_half_portion, fi.protein_grams, fi.portion_grams ' +
    'FROM recipe_ingredients ri LEFT JOIN food_items fi ON fi.id = ri.food_item_id ' +
    'WHERE ri.recipe_id = ?'
  ).all(recipeId);
  const nutrition = calcNutritionPerServing(recipeId, recipe.servings);
  return { ...recipe, ingredients, ...nutrition };
}

// ─── GET /api/public/foods/search?q=&token= ───────────────────────────────────

router.get('/public/foods/search', (req, res) => {
  const { q, token } = req.query;
  if (!q || q.trim().length < 1) {
    return res.json({ success: true, data: [] });
  }
  try {
    const items = db.prepare(`
      SELECT fi.id, fi.name_he, fi.portion_description, fi.portion_grams,
             fi.calories_per_half_portion AS calories, fi.protein_grams,
             fc.nutrient_type AS macro_type, fc.name_he AS category_name
      FROM   food_items fi
      JOIN   food_categories fc ON fc.id = fi.category_id
      WHERE  fi.name_he LIKE ? AND fi.is_active = 1
        AND  (fi.submitted_by_client = 0 OR fi.approved = 1)
      ORDER  BY fi.name_he
      LIMIT  30
    `).all(`%${q.trim()}%`);

    const data = items.map((item) => ({
      ...item,
      menu_fit: item.macro_type
        ? `מנת ${MACRO_LABELS[item.macro_type] || item.macro_type} — ${item.calories ?? '?'} קק״ל`
        : null,
    }));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /public/foods/search]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── POST /api/public/foods/submit ───────────────────────────────────────────

router.post('/public/foods/submit', (req, res) => {
  const { token, name_he, calories_per_100g, protein_per_100g,
          fat_per_100g, carb_per_100g, category_id } = req.body;

  const client = findClientByToken(token);
  if (!client) return res.status(403).json({ success: false, error: 'טוקן לא תקין' });
  if (!name_he || !calories_per_100g) {
    return res.status(400).json({ success: false, error: 'שם המזון וקלוריות הם שדות חובה' });
  }

  try {
    const cal100  = Number(calories_per_100g);
    const prot100 = Number(protein_per_100g) || 0;

    // Determine macro type: use category if supplied, else auto-detect by density
    let macroType = null;
    let resolvedCategoryId = category_id ? Number(category_id) : null;

    if (resolvedCategoryId) {
      const cat = db.prepare('SELECT nutrient_type FROM food_categories WHERE id = ?').get(resolvedCategoryId);
      macroType = cat?.nutrient_type || null;
    }
    if (!macroType) {
      if (cal100 <= 40)        macroType = 'vegetable';
      else if (prot100 >= 15)  macroType = 'protein';
      else if (Number(fat_per_100g) >= 30) macroType = 'fat';
      else if (Number(carb_per_100g) >= 30) macroType = 'carb';
      else                     macroType = 'fruit';
    }

    // If no category_id, find the first matching category for this macro type
    if (!resolvedCategoryId) {
      const cat = db.prepare('SELECT id FROM food_categories WHERE nutrient_type = ? LIMIT 1').get(macroType);
      resolvedCategoryId = cat?.id || 1;
    }

    // Calculate portion_grams to hit the calorie ceiling for this macro type
    const ceiling      = MACRO_CEILINGS[macroType] || 100;
    const portionGrams = cal100 > 0 ? Math.round((ceiling / cal100) * 100) : 100;
    const calPerPortion  = Math.round(cal100 * portionGrams / 100);
    const protPerPortion = Math.round(prot100 * portionGrams / 100 * 10) / 10;

    db.prepare(`
      INSERT INTO food_items
        (category_id, name_he, portion_description, portion_grams,
         calories_per_half_portion, protein_grams, submitted_by_client, approved, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1)
    `).run(resolvedCategoryId, name_he.trim(), `${portionGrams} גרם`,
           portionGrams, calPerPortion, protPerPortion);

    // Notify Natanel via ai_recommendations
    try {
      db.prepare(`
        INSERT INTO ai_recommendations
          (client_id, type, priority, title, action_suggestion, expires_at)
        VALUES (?, 'new_food_submitted', 'low', ?, ?, datetime('now', '+7 days'))
      `).run(client.id, `מזון חדש הוגש: ${name_he.trim()}`, 'בדוק ואשר את המזון במאגר');
    } catch {}

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /public/foods/submit]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── GET /api/public/recipes?token= ──────────────────────────────────────────

router.get('/public/recipes', (req, res) => {
  try {
    const recipes = db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all();
    const data = recipes.map((r) => getRecipeWithDetails(r.id));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /public/recipes]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── GET /api/public/recipes/:id?token= ──────────────────────────────────────

router.get('/public/recipes/:id', (req, res) => {
  try {
    const recipe = getRecipeWithDetails(Number(req.params.id));
    if (!recipe) return res.status(404).json({ success: false, error: 'מתכון לא נמצא' });
    return res.json({ success: true, data: recipe });
  } catch (err) {
    console.error('[GET /public/recipes/:id]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

// ─── POST /api/public/recipes?token= ─────────────────────────────────────────

router.post('/public/recipes', (req, res) => {
  const { token, name, description, servings, ingredients = [] } = req.body;

  const client = findClientByToken(token);
  if (!client) return res.status(403).json({ success: false, error: 'טוקן לא תקין' });
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'שם המתכון הוא שדה חובה' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO recipes (name, description, servings, submitted_by_client) VALUES (?, ?, ?, 1)'
    ).run(name.trim(), description?.trim() || null, Number(servings) || 1);

    const recipeId = result.lastInsertRowid;

    const insertIng = db.prepare(
      'INSERT INTO recipe_ingredients (recipe_id, food_item_id, custom_food_name, amount_grams, notes) VALUES (?, ?, ?, ?, ?)'
    );
    for (const ing of ingredients) {
      if (!ing.amount_grams) continue;
      insertIng.run(
        recipeId,
        ing.food_item_id || null,
        ing.custom_food_name?.trim() || null,
        Number(ing.amount_grams),
        ing.notes?.trim() || null,
      );
    }

    return res.json({ success: true, data: getRecipeWithDetails(recipeId) });
  } catch (err) {
    console.error('[POST /public/recipes]', err.message);
    return res.status(500).json({ success: false, error: 'שגיאה פנימית' });
  }
});

module.exports = router;
