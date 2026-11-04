const express = require('express');
const db = require('../database/db');
const { runAgentTurn, conversationTranscript } = require('../services/agent/agent.service');
const { runMorningBrief } = require('../services/agent/morning-brief.service');

// ─── AI agent ─── mounted at /api/agent, after requireAuth ──────────────────

const router = express.Router();
const MAX_MESSAGE_CHARS = 4000;

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

function ownConversation(req, id) {
  return db.prepare('SELECT * FROM agent_conversations WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .get(id, req.user?.id ?? null);
}

// POST /api/agent/chat — body { message, conversation_id? } → text/event-stream
// events: conversation, text, tool_start, tool_result, error, done
router.post('/chat', async (req, res) => {
  const text = String(req.body?.message || '').trim();
  if (!text) return fail(res, 400, 'message is required.');
  if (text.length > MAX_MESSAGE_CHARS) return fail(res, 400, `message is limited to ${MAX_MESSAGE_CHARS} characters.`);
  const conversationId = req.body?.conversation_id ? Number(req.body.conversation_id) : null;
  if (conversationId && !ownConversation(req, conversationId)) return fail(res, 404, 'Conversation not found.');

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  // Client went away mid-turn → stop the model. (req 'close' fires once the request
  // body is consumed in Node ≥16, so watch the response instead.)
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const send = (type, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAgentTurn(db, {
      conversationId, userId: req.user?.id, userName: req.user?.name, text, onEvent: send, signal: controller.signal,
    });
  } catch (err) {
    console.error('[POST /agent/chat]', err);
    const refusal = err.name === 'AIRefusalError';
    send('error', { code: refusal ? 'refusal' : 'server_error', message: refusal ? 'הבקשה נדחתה על ידי המודל.' : 'שגיאה בשיחה עם העוזר.' });
    send('done', { conversationId });
  }
  res.end();
});

// GET /api/agent/conversations — the user's recent conversations
router.get('/conversations', (req, res) => {
  try {
    return ok(res, db.prepare(`
      SELECT id, title, created_at, updated_at FROM agent_conversations
      WHERE user_id = ? OR user_id IS NULL ORDER BY updated_at DESC LIMIT 30
    `).all(req.user?.id ?? null));
  } catch (err) {
    console.error('[GET /agent/conversations]', err);
    return fail(res, 500, 'Failed to load conversations.');
  }
});

// GET /api/agent/conversations/:id — transcript for the drawer
router.get('/conversations/:id', (req, res) => {
  try {
    const conv = ownConversation(req, Number(req.params.id));
    if (!conv) return fail(res, 404, 'Conversation not found.');
    return ok(res, { conversation: conv, messages: conversationTranscript(db, conv.id) });
  } catch (err) {
    console.error('[GET /agent/conversations/:id]', err);
    return fail(res, 500, 'Failed to load conversation.');
  }
});

// DELETE /api/agent/conversations/:id
router.delete('/conversations/:id', (req, res) => {
  try {
    const conv = ownConversation(req, Number(req.params.id));
    if (!conv) return fail(res, 404, 'Conversation not found.');
    db.prepare('DELETE FROM agent_conversations WHERE id = ?').run(conv.id);
    return ok(res, { id: conv.id });
  } catch (err) {
    console.error('[DELETE /agent/conversations/:id]', err);
    return fail(res, 500, 'Failed to delete conversation.');
  }
});

// POST /api/agent/morning-brief/run — build today's brief now (normally 08:00 job)
router.post('/morning-brief/run', async (req, res) => {
  try {
    return ok(res, await runMorningBrief(db, { force: true }));
  } catch (err) {
    console.error('[POST /agent/morning-brief/run]', err);
    return fail(res, err.status || 500, err.message || 'Failed to build the morning brief.');
  }
});

module.exports = router;
