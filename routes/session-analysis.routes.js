const express = require('express');
const db = require('../database/db');
const {
  SessionAnalysisSchema, analyzeSession, applyGuards, buildTranscript, kbFoodIndex, expireStale, clientContext, speakerMap,
  transcriptWarnings,
} = require('../services/ai/session-analysis.service');
const { importAnalysis } = require('../services/session-analysis-import.service');
const { publish } = require('../services/event-bus.service');
const { nowUtcISO } = require('../utils/dates');

// ─── Phase 10: clinical analysis of a session ─── mounted at /api, after requireAuth
//   GET    /api/sessions/:id/analysis                  current analysis (or null)
//   POST   /api/sessions/:id/analysis                  run "נתח פגישה" (async → 202, poll GET)
//   PUT    /api/sessions/:id/analysis                  save edits { analysis } (guardrails re-applied)
//   POST   /api/sessions/:id/analysis/import           { targets: ['notes','intake','menu'], force? }
//   DELETE /api/sessions/:id/analysis                  discard the draft
//   PUT    /api/sessions/:id/recording/:recordingId/speakers   { dietitian: 'דובר 1' | 'דובר 2' }

const router = express.Router();
const running = new Set(); // session ids with an analysis in flight (this process)

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

const getRow = (sessionId) => db.prepare('SELECT * FROM session_ai_analyses WHERE session_id = ?').get(sessionId);
const parse = (t, fb) => { try { return t ? JSON.parse(t) : fb; } catch { return fb; } };

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    status: row.status,
    analysis: parse(row.analysis, null),
    warnings: parse(row.warnings, []),
    recording_ids: parse(row.recording_ids, []),
    error: row.error,
    menu_id: row.menu_id,
    imported: { notes: row.imported_notes_at, intake: row.imported_intake_at, menu: row.imported_menu_at },
    edited: !!row.analysis && row.analysis !== row.original,
    analyzed_at: row.analyzed_at,
    updated_at: row.updated_at,
  };
}

// GET /api/sessions/:id/analysis
router.get('/sessions/:id/analysis', (req, res) => {
  try {
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');
    const transcript = buildTranscript(db, session.id);
    return ok(res, {
      analysis: serialize(expireStale(db, getRow(session.id))),
      can_analyze: !!transcript.text,
      transcribed_recordings: transcript.recordingIds.length,
    });
  } catch (err) {
    console.error('[GET /sessions/:id/analysis]', err);
    return fail(res, 500, 'Failed to load the analysis.');
  }
});

// POST /api/sessions/:id/analysis — { force? } (force: replace a draft that was already imported)
router.post('/sessions/:id/analysis', (req, res) => {
  try {
    const session = db.prepare('SELECT id, client_id FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return fail(res, 404, 'Session not found.');
    if (!process.env.ANTHROPIC_API_KEY && process.env.AI_MOCK !== '1') return fail(res, 503, 'ה-AI לא מוגדר (חסר ANTHROPIC_API_KEY).');
    if (!buildTranscript(db, session.id).text) return fail(res, 409, 'אין עדיין תמלול לפגישה. יש להקליט או להעלות הקלטה ולחכות לתמלול.');
    const existing = expireStale(db, getRow(session.id));
    if (running.has(session.id) || existing?.status === 'running') return fail(res, 409, 'הניתוח כבר רץ.');
    const anyImported = existing && (existing.imported_notes_at || existing.imported_intake_at || existing.imported_menu_at);
    if (anyImported && req.body?.force !== true) return fail(res, 409, 'הטיוטה הקודמת כבר יובאה. ניתוח חדש יחליף אותה.');

    const now = nowUtcISO();
    if (existing) {
      db.prepare(`
        UPDATE session_ai_analyses SET status = 'running', error = NULL, analysis = NULL, original = NULL, warnings = NULL,
          menu_id = NULL, imported_notes_at = NULL, imported_intake_at = NULL, imported_menu_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO session_ai_analyses (session_id, client_id, status, created_at, updated_at) VALUES (?, ?, 'running', ?, ?)
      `).run(session.id, session.client_id, now, now);
    }
    running.add(session.id);
    analyzeSession(db, session.id)
      .then((r) => publish(db, 'session.analysis_ready', { entityType: 'session', entityId: session.id, payload: { ok: r.ok } }))
      .finally(() => running.delete(session.id));
    return res.status(202).json({ success: true, data: serialize(getRow(session.id)) });
  } catch (err) {
    console.error('[POST /sessions/:id/analysis]', err);
    return fail(res, 500, 'Failed to start the analysis.');
  }
});

// PUT /api/sessions/:id/analysis — { analysis }
router.put('/sessions/:id/analysis', (req, res) => {
  try {
    const row = getRow(req.params.id);
    if (!row || row.status !== 'draft') return fail(res, 404, 'אין טיוטה לעריכה.');
    const parsed = SessionAnalysisSchema.safeParse(req.body?.analysis);
    if (!parsed.success) return fail(res, 400, `מבנה הטיוטה אינו תקין: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(row.session_id);
    const ctx = clientContext(db, session);
    const transcript = buildTranscript(db, row.session_id);
    const { analysis, warnings } = applyGuards(parsed.data, {
      clientText: transcript.clientText,
      kbIndex: kbFoodIndex(db),
      fallbackCalories: ctx.tdee ? ctx.tdee - 400 : null,
    });
    const allWarnings = [...transcriptWarnings(transcript.text), ...warnings];
    db.prepare('UPDATE session_ai_analyses SET analysis = ?, warnings = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(analysis), JSON.stringify(allWarnings), nowUtcISO(), row.id);
    return ok(res, serialize(getRow(row.session_id)));
  } catch (err) {
    console.error('[PUT /sessions/:id/analysis]', err);
    return fail(res, 500, 'Failed to save the analysis.');
  }
});

// POST /api/sessions/:id/analysis/import — { targets, force }
router.post('/sessions/:id/analysis/import', (req, res) => {
  try {
    const row = getRow(req.params.id);
    if (!row || row.status !== 'draft') return fail(res, 404, 'אין טיוטה לייבוא.');
    const targets = Array.isArray(req.body?.targets) && req.body.targets.length ? req.body.targets : ['notes', 'intake', 'menu'];
    const result = importAnalysis(db, row, { targets, force: req.body?.force === true });
    return ok(res, { ...result, analysis: serialize(getRow(row.session_id)) });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error('[POST /sessions/:id/analysis/import]', err);
    return fail(res, 500, 'Failed to import the analysis.');
  }
});

// DELETE /api/sessions/:id/analysis
router.delete('/sessions/:id/analysis', (req, res) => {
  try {
    const row = getRow(req.params.id);
    if (!row) return fail(res, 404, 'Analysis not found.');
    if (row.status === 'running') return fail(res, 409, 'הניתוח עדיין רץ.');
    db.prepare('DELETE FROM session_ai_analyses WHERE id = ?').run(row.id);
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[DELETE /sessions/:id/analysis]', err);
    return fail(res, 500, 'Failed to discard the analysis.');
  }
});

// PUT /api/sessions/:id/recording/:recordingId/speakers — who is the dietitian in this recording
router.put('/sessions/:id/recording/:recordingId/speakers', (req, res) => {
  try {
    const rec = db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(req.params.recordingId);
    if (!rec || String(rec.session_id) !== String(req.params.id)) return fail(res, 404, 'Recording not found.');
    const dietitian = req.body?.dietitian;
    if (!/^דובר \d+$/.test(dietitian || '')) return fail(res, 400, 'dietitian must be like "דובר 1".');
    db.prepare('UPDATE session_recordings SET speaker_map = ? WHERE id = ?').run(JSON.stringify({ ...speakerMap(rec), dietitian }), rec.id);
    publish(db, 'session.recording_speakers', { entityType: 'session', entityId: rec.session_id, payload: { recordingId: rec.id, dietitian } });
    return ok(res, { recordingId: rec.id, dietitian });
  } catch (err) {
    console.error('[PUT /sessions/:id/recording/:recordingId/speakers]', err);
    return fail(res, 500, 'Failed to update speaker roles.');
  }
});

module.exports = router;
