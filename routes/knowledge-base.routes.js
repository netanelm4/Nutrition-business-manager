const express = require('express');
const db = require('../database/db');
const kb = require('../services/knowledge-base.service');

// ─── Dietitian knowledge base ─── mounted at /api/knowledge-base, after requireAuth
//   GET  /api/knowledge-base                 status summary (loaded, dates, counts, policy)
//   GET  /api/knowledge-base?full=1          the whole document
//   GET  /api/knowledge-base/view/:part      foods/:slot | daily-basket | weekend | meal-structures | portions | guidelines
//   PUT  /api/knowledge-base                 replace it (body: the JSON built by scripts/build-knowledge-base.js)

const router = express.Router();

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// The document is larger than the global 100KB JSON limit (server.js skips this path)
const bigJson = express.json({ limit: '5mb' });

router.get('/', (req, res) => {
  try {
    if (req.query.full === '1') {
      const doc = kb.getKnowledgeBase(db);
      return doc ? ok(res, doc) : fail(res, 404, 'Knowledge base not loaded.');
    }
    return ok(res, kb.summary(db));
  } catch (err) {
    console.error('[GET /knowledge-base]', err);
    return fail(res, 500, 'Failed to read the knowledge base.');
  }
});

router.get('/view/:part/:slot?', (req, res) => {
  try {
    const views = {
      foods: () => kb.foodsForSlot(db, req.params.slot || 'protein', { limit: Number(req.query.limit) || 25 }),
      'daily-basket': () => kb.dailyBasket(db),
      weekend: () => kb.weekendPattern(db),
      'meal-structures': () => kb.mealStructures(db),
      portions: () => kb.portionDefinitions(db),
      guidelines: () => kb.guidelines(db),
    };
    const view = views[req.params.part];
    if (!view) return fail(res, 404, 'Unknown view.');
    const data = view();
    return data === null || data === undefined ? fail(res, 404, 'Knowledge base not loaded.') : ok(res, data);
  } catch (err) {
    console.error('[GET /knowledge-base/view]', err);
    return fail(res, 500, 'Failed to read the knowledge base.');
  }
});

router.put('/', bigJson, (req, res) => {
  try {
    return ok(res, kb.importKnowledgeBase(db, req.body, 'upload'));
  } catch (err) {
    if (err.status === 400) return fail(res, 400, err.message);
    console.error('[PUT /knowledge-base]', err);
    return fail(res, 500, 'Failed to import the knowledge base.');
  }
});

// Body-parser errors for this router (e.g. > 5MB)
router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return fail(res, 413, 'Knowledge base file is too large (max 5MB).');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON.');
  return next(err);
});

module.exports = router;
