const express = require('express');
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const db = require('../database/db');

const router = express.Router();

// Resolve chromium path: explicit env var first, then PATH discovery (Railway nixpkg).
function getChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { return execSync('which chromium').toString().trim(); } catch { return null; }
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(categoryName, items, nutrientType) {
  const rows = items.map((item, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#fdf7fb';
    return `
      <tr style="background:${bg};">
        <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;">${item.name_he ?? ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;">${item.portion_description ?? '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;text-align:center;">${item.portion_grams ?? '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;text-align:center;font-weight:600;">${item.calories_per_half_portion ?? '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;text-align:center;">${item.protein_grams ?? '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;color:#888;font-size:12px;">${item.notes ?? ''}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #fcf4f9;
    color: #1a1a1a;
    direction: rtl;
    padding: 28px 32px 24px;
    font-size: 14px;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #567DBF;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-logo {
    width: 44px; height: 44px;
    background: #567DBF;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 18px; font-weight: 900;
  }
  .brand-text { line-height: 1.3; }
  .brand-name  { font-size: 16px; font-weight: 700; color: #1a1a1a; }
  .brand-sub   { font-size: 12px; color: #567DBF; }
  .contact     { font-size: 12px; color: #555; text-align: left; line-height: 1.6; }

  /* ── Title bar ── */
  .title-bar {
    background: #567DBF;
    color: white;
    padding: 12px 20px;
    border-radius: 8px 8px 0 0;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .subtitle {
    background: #eef3fb;
    color: #567DBF;
    padding: 8px 20px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 2px solid #d0dff5;
    margin-bottom: 2px;
  }

  /* ── Table ── */
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 0 0 8px 8px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  thead tr {
    background: #F5DBEA;
  }
  th {
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 700;
    color: #5a2040;
    text-align: right;
    border-bottom: 2px solid #e8c4d8;
  }
  th.center { text-align: center; }
  td { font-size: 13px; color: #222; }

  /* ── Footer ── */
  .footer {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #888;
    border-top: 1px solid #e8d4e8;
    padding-top: 10px;
  }
  .footer-brand { font-weight: 700; color: #567DBF; }
</style>
</head>
<body>

  <div class="header">
    <div class="brand">
      <div class="brand-logo">נת</div>
      <div class="brand-text">
        <div class="brand-name">נתנאל מלכה</div>
        <div class="brand-sub">קלינאי תזונה מוסמך</div>
      </div>
    </div>
    <div class="contact">
      nm.nutritionist1@gmail.com
    </div>
  </div>

  <div class="title-bar">${categoryName}</div>
  <div class="subtitle">${MACRO_SUBTITLES[nutrientType] ?? ''}</div>

  <table>
    <thead>
      <tr>
        <th>שם</th>
        <th>כמות (מנה)</th>
        <th class="center">גרמים</th>
        <th class="center">קק״ל</th>
        <th class="center">חלבון (ג׳)</th>
        <th>הערות</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:#aaa;">אין פריטים</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <div class="footer-brand">נתנאל מלכה • קלינאי תזונה</div>
    <div>התפריט אינו מחליף ייעוץ תזונתי מקצועי</div>
  </div>

</body>
</html>`;
}

// ── GET /api/food-bank/pdf/:categoryId ────────────────────────────────────────

router.get('/pdf/:categoryId', async (req, res) => {
  const chromiumPath = getChromiumPath();
  if (!chromiumPath) return fail(res, 503, 'PDF generation is only available in production');

  let browser = null;
  try {
    const category = db
      .prepare('SELECT * FROM food_categories WHERE id = ?')
      .get(req.params.categoryId);

    if (!category) return fail(res, 404, 'Category not found.');

    const items = db
      .prepare('SELECT * FROM food_items WHERE category_id = ? AND is_active = 1 ORDER BY sort_order, name_he')
      .all(req.params.categoryId);

    const html = buildHtml(category.name_he, items, category.nutrient_type);

    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    const filename = encodeURIComponent(`${category.name_he}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(pdf);

  } catch (err) {
    console.error('[GET /food-bank/pdf/:categoryId]', err);
    return fail(res, 500, 'Failed to generate PDF.');
  } finally {
    if (browser) await browser.close();
  }
});

// ── GET /api/food-bank/pdf/macro/:nutrientType ───────────────────────────────

const MACRO_LABELS_HE = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירקות', fruit: 'פירות' };
const MACRO_SUBTITLES = {
  protein:   'מנה = 100–140 קק״ל  ·  לפחות 6 גרם חלבון למנה',
  carb:      'מנה = 70–100 קק״ל',
  fat:       'מנה = 45–60 קק״ל',
  vegetable: 'מנה = עד 40 קק״ל',
  fruit:     'מנה = עד 120 קק״ל',
};
const ALLOWED_NUTRIENT_TYPES = ['protein', 'carb', 'fat', 'vegetable', 'fruit'];

function buildMacroHtml(macroLabel, categories, nutrientType) {
  const sections = categories.map(({ name_he, items }) => {
    if (!items.length) return '';
    const rows = items.map((item, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#fdf7fb';
      return `
        <tr style="background:${bg};">
          <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;">${item.name_he ?? ''}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;">${item.portion_description ?? '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;text-align:center;">${item.portion_grams ?? '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;text-align:center;font-weight:600;">${item.calories_per_half_portion ?? '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;text-align:center;">${item.protein_grams ?? '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0e6f0;color:#888;font-size:12px;">${item.notes ?? ''}</td>
        </tr>`;
    }).join('');
    return `
      <tr>
        <td colspan="6" style="padding:10px 12px 6px;background:#eef3fb;font-weight:700;font-size:13px;color:#567DBF;border-bottom:2px solid #d0dff5;">
          ${name_he}
        </td>
      </tr>
      ${rows}`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #fcf4f9;
    color: #1a1a1a;
    direction: rtl;
    padding: 28px 32px 24px;
    font-size: 14px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #567DBF;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-logo {
    width: 44px; height: 44px;
    background: #567DBF;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 18px; font-weight: 900;
  }
  .brand-text { line-height: 1.3; }
  .brand-name  { font-size: 16px; font-weight: 700; color: #1a1a1a; }
  .brand-sub   { font-size: 12px; color: #567DBF; }
  .contact     { font-size: 12px; color: #555; text-align: left; line-height: 1.6; }
  .title-bar {
    background: #567DBF;
    color: white;
    padding: 12px 20px;
    border-radius: 8px 8px 0 0;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .subtitle {
    background: #eef3fb;
    color: #567DBF;
    padding: 8px 20px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 2px solid #d0dff5;
    margin-bottom: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 0 0 8px 8px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  thead tr { background: #F5DBEA; }
  th {
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 700;
    color: #5a2040;
    text-align: right;
    border-bottom: 2px solid #e8c4d8;
  }
  th.center { text-align: center; }
  td { font-size: 13px; color: #222; }
  .footer {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #888;
    border-top: 1px solid #e8d4e8;
    padding-top: 10px;
  }
  .footer-brand { font-weight: 700; color: #567DBF; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="brand-logo">נת</div>
      <div class="brand-text">
        <div class="brand-name">נתנאל מלכה</div>
        <div class="brand-sub">קלינאי תזונה מוסמך</div>
      </div>
    </div>
    <div class="contact">nm.nutritionist1@gmail.com</div>
  </div>

  <div class="title-bar">מאגר ${macroLabel} — כל הקטגוריות</div>
  <div class="subtitle">${MACRO_SUBTITLES[nutrientType] ?? ''}</div>

  <table>
    <thead>
      <tr>
        <th>שם</th>
        <th>כמות (מנה)</th>
        <th class="center">גרמים</th>
        <th class="center">קק״ל</th>
        <th class="center">חלבון (ג׳)</th>
        <th>הערות</th>
      </tr>
    </thead>
    <tbody>
      ${sections || '<tr><td colspan="6" style="padding:20px;text-align:center;color:#aaa;">אין פריטים</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <div class="footer-brand">נתנאל מלכה • קלינאי תזונה</div>
    <div>התפריט אינו מחליף ייעוץ תזונתי מקצועי</div>
  </div>
</body>
</html>`;
}

router.get('/pdf/macro/:nutrientType', async (req, res) => {
  const chromiumPath = getChromiumPath();
  if (!chromiumPath) return fail(res, 503, 'PDF generation is only available in production');

  let browser = null;
  try {
    const { nutrientType } = req.params;
    if (!ALLOWED_NUTRIENT_TYPES.includes(nutrientType)) {
      return fail(res, 400, 'Invalid nutrient type.');
    }

    const cats = db.prepare(
      'SELECT id, name_he FROM food_categories WHERE nutrient_type = ? ORDER BY sort_order'
    ).all(nutrientType);

    const categories = cats.map((cat) => ({
      ...cat,
      items: db.prepare(
        'SELECT * FROM food_items WHERE category_id = ? AND is_active = 1 ORDER BY sort_order, name_he'
      ).all(cat.id),
    }));

    const macroLabel = MACRO_LABELS_HE[nutrientType] ?? nutrientType;
    const html = buildMacroHtml(macroLabel, categories, nutrientType);

    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    const filename = encodeURIComponent(`מאגר ${macroLabel}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(pdf);

  } catch (err) {
    console.error('[GET /food-bank/pdf/macro/:nutrientType]', err);
    return fail(res, 500, 'Failed to generate macro PDF.');
  } finally {
    if (browser) await browser.close();
  }
});

module.exports = router;
