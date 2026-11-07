const fs = require('fs');
const path = require('path');
const { getClient, requestParams, logUsage } = require('../ai/ai.service');
const { toolDefinitions, executeTool } = require('./tools');
const { countOpen } = require('../action-queue.service');
const { nowUtcISO, israelDateTimeParts } = require('../../utils/dates');
require('./proposals'); // registers the Inbox approval executors

// ─── AI agent runtime ────────────────────────────────────────────────────────
// Manual streaming tool loop (Sonnet, task "agent"):
//   - static system prompt + deterministic tool list → prompt-cache friendly and
//     required by preserved thinking (system/tools must not change between turns)
//   - per-turn context (date, time, open Inbox count) travels in the user turn,
//     stored with it, so history stays append-only
//   - every message is persisted exactly as sent/received (thinking blocks
//     included) and replayed unchanged on the next turn
//   - writes are proposals in the Inbox; only update_weight writes directly

const MAX_TOOL_ROUNDS = 8;
const MAX_STORED_MESSAGES = 120; // history can't be trimmed (thinking binding) → start a new conversation

const VOICE = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'voice.md'), 'utf8');

const SYSTEM_PROMPT = `You are the AI assistant built into the CRM of Netanel Malka, a licensed clinical dietitian in Israel. You talk with Netanel (or his team) in Hebrew, concisely and practically.

You can read the whole CRM with your tools: clients, leads, sessions, meetings (Google Calendar), the Inbox of pending actions, the food database, protocols and long-term clinical memory. Look data up with tools instead of guessing; never invent clients, numbers or dates. Use search_entities to find ids.

Changing anything in the CRM is done by proposal: tools marked "needs approval" create an item in the Inbox and change nothing until Netanel approves it there. Tell him clearly what you proposed and that it waits in the Inbox. The only direct write is update_weight. Do not claim an action was done when you only proposed it.

Clinical boundaries: base recommendations on current scientific consensus (WHO, AND, AHA, EASD); no medical diagnoses, no medication changes.

Dates and times are Israel time; tool dates use YYYY-MM-DD and times HH:MM.

Any text you draft for a client (draft_whatsapp_message) must follow these rules:
${VOICE}`;

const CHANNEL_HINT = {
  whatsapp: 'ערוץ: WhatsApp. תשובה קצרה בטקסט פשוט, בלי markdown, בלי טבלאות. בפעולת כתיבה: אשר בשורה אחת מה נרשם (מטופל, תאריך, ערך).',
};

function nowContext(db, channel = 'web') {
  const p = israelDateTimeParts(nowUtcISO());
  const weekday = new Date().toLocaleDateString('he-IL', { weekday: 'long', timeZone: 'Asia/Jerusalem' });
  let open = '?';
  try { open = countOpen(db); } catch { /* table missing in edge setups */ }
  const hint = CHANNEL_HINT[channel] ? ` · ${CHANNEL_HINT[channel]}` : '';
  return `[הקשר: ${weekday} ${p.date} ${p.time} · ${open} פריטים פתוחים בתיבת הפעולות${hint}]`;
}

function ensureConversation(db, { conversationId, userId, text, channel = 'web' }) {
  if (conversationId) {
    const conv = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(conversationId);
    if (conv) return conv;
  }
  const now = nowUtcISO();
  const res = db.prepare('INSERT INTO agent_conversations (user_id, title, created_at, updated_at, channel) VALUES (?, ?, ?, ?, ?)')
    .run(userId || null, text.slice(0, 60), now, now, channel);
  return db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(res.lastInsertRowid);
}

function loadHistory(db, conversationId) {
  return db.prepare('SELECT role, content FROM agent_messages WHERE conversation_id = ? ORDER BY id')
    .all(conversationId)
    .map((m) => ({ role: m.role, content: JSON.parse(m.content) }));
}

function appendMessage(db, conversationId, message) {
  const now = nowUtcISO();
  db.prepare('INSERT INTO agent_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, message.role, JSON.stringify(message.content), now);
  db.prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
}

function summarizeResult(name, kind, output, isError) {
  if (isError) return output?.error || 'שגיאה';
  if (kind === 'propose') return 'הצעה נוספה לתיבת הפעולות';
  if (kind === 'auto') return 'נשמר';
  const firstArray = Object.values(output || {}).find(Array.isArray);
  return firstArray ? `${firstArray.length} תוצאות` : 'בוצע';
}

/**
 * Run one user turn. Events: conversation, text, tool_start, tool_result, error, done.
 * @param {object} opts { conversationId?, userId?, userName?, text, onEvent(type, data), signal? }
 */
/**
 * @param {object} opts
 * @param {'web'|'whatsapp'} [opts.channel]  shapes the reply style (via the turn context)
 * @param {string} [opts.actionGroup]        groups autonomous writes for "בטל" (undo)
 */
async function runAgentTurn(db, { conversationId, userId, userName, text, onEvent, signal, channel = 'web', actionGroup = null }) {
  const conv = ensureConversation(db, { conversationId, userId, text, channel });
  onEvent('conversation', { id: conv.id, title: conv.title });

  const history = loadHistory(db, conv.id);
  if (history.length >= MAX_STORED_MESSAGES) {
    onEvent('error', { code: 'conversation_full', message: 'השיחה ארוכה מדי. יש לפתוח שיחה חדשה.' });
    onEvent('done', { conversationId: conv.id });
    return;
  }

  const userMessage = { role: 'user', content: [{ type: 'text', text: `${nowContext(db, channel)}\n${text}` }] };
  history.push(userMessage);
  appendMessage(db, conv.id, userMessage);

  const tools = toolDefinitions();
  const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  const ctxBase = { conversationId: conv.id, userName, channel, actionGroup };
  const proposals = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) break;
    const stream = getClient().beta.messages.stream({
      ...requestParams('agent'),
      system,
      tools,
      tool_choice: { type: 'auto' },
      cache_control: { type: 'ephemeral' }, // also cache the growing conversation
      messages: history,
    });
    if (signal) signal.addEventListener('abort', () => stream.abort?.(), { once: true });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        onEvent('text', { text: event.delta.text });
      }
    }
    const message = await stream.finalMessage();
    logUsage('agent', message);

    const assistantMessage = { role: 'assistant', content: message.content };
    history.push(assistantMessage);
    appendMessage(db, conv.id, assistantMessage);

    if (message.stop_reason === 'refusal') {
      onEvent('error', { code: 'refusal', message: 'הבקשה נדחתה על ידי המודל.', category: message.stop_details?.category || null });
      break;
    }
    if (message.stop_reason === 'max_tokens') {
      onEvent('error', { code: 'max_tokens', message: 'התשובה נקטעה. אפשר לבקש להמשיך.' });
      break;
    }
    if (message.stop_reason !== 'tool_use') break;
    if (round === MAX_TOOL_ROUNDS) {
      onEvent('error', { code: 'too_many_steps', message: 'יותר מדי צעדים בפנייה אחת. אפשר לפרק את הבקשה.' });
      break;
    }

    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    const results = [];
    for (const use of toolUses) {
      onEvent('tool_start', { id: use.id, name: use.name, input: use.input });
      const r = executeTool(db, use.name, use.input, { ...ctxBase, toolUseId: use.id });
      if (r.kind === 'propose' && !r.isError) proposals.push({ tool: use.name, proposal_id: r.output.proposal_id });
      onEvent('tool_result', {
        id: use.id, name: use.name, kind: r.kind, is_error: r.isError,
        summary: summarizeResult(use.name, r.kind, r.output, r.isError),
        proposal_id: r.kind === 'propose' && !r.isError ? r.output.proposal_id : null,
      });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(r.output), ...(r.isError ? { is_error: true } : {}) });
    }
    const toolMessage = { role: 'user', content: results }; // all results in ONE message
    history.push(toolMessage);
    appendMessage(db, conv.id, toolMessage);
  }

  onEvent('done', { conversationId: conv.id, proposals });
}

/** UI-friendly transcript: user texts, assistant texts and tool calls (no thinking, no raw results). */
function conversationTranscript(db, conversationId) {
  const out = [];
  for (const m of loadHistory(db, conversationId)) {
    for (const block of m.content) {
      if (m.role === 'user' && block.type === 'text') {
        out.push({ role: 'user', text: block.text.replace(/^\[הקשר:[^\]]*\]\n/, '') });
      } else if (m.role === 'assistant' && block.type === 'text' && block.text.trim()) {
        out.push({ role: 'assistant', text: block.text });
      } else if (m.role === 'assistant' && block.type === 'tool_use') {
        out.push({ role: 'tool', name: block.name });
      }
    }
  }
  return out;
}

module.exports = { runAgentTurn, conversationTranscript, SYSTEM_PROMPT, MAX_TOOL_ROUNDS };
