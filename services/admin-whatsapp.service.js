const kapso = require('./kapso.service');
const { runAgentTurn } = require('./agent/agent.service');
const { nowUtcISO } = require('../utils/dates');
const { publish } = require('./event-bus.service');

// ─── Admin WhatsApp channel (Kapso): Netanel → agent → reply ─────────────────
// Only ADMIN_WHATSAPP_PHONE is served; everything else is dropped without a
// reply (and without storing its content). Messages are processed one at a
// time so the conversation stays in order. Fixed commands:
//   בטל    undo the last write from WhatsApp (15 minutes)
//   פירוט  the full text of the last brief that went out as a template
//   עזרה   what the channel can do

const UNDO_WINDOW_MS = 15 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 100; // start a fresh WhatsApp conversation before the agent's cap

const HELP = [
  'מה אפשר לכתוב כאן:',
  '• שקילה: "דני כהן 84.2 אתמול", "שרה לוי 62.3 ב-04/11" (בלי תאריך = היום)',
  '• משימה: "סמן משימת בישול לשירה"',
  '• שאלות: "מה המצב של דני?", "אילו משימות פתוחות יש לשירה?"',
  '• בטל: ביטול הפעולה האחרונה (עד 15 דקות)',
  '• פירוט: הטקסט המלא של התדריך האחרון',
].join('\n');

let queue = Promise.resolve();

/** Markdown the model may still produce → WhatsApp-friendly plain text. */
function toPlainText(text) {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Undo ──

function revert(db, action) {
  const u = JSON.parse(action.undo);
  if (u.type === 'weight') {
    if (u.previous) {
      db.prepare('UPDATE weight_logs SET weight = ?, source = ?, day_of_week = ? WHERE client_id = ? AND weigh_date = ?')
        .run(u.previous.weight, u.previous.source, u.previous.day_of_week, u.client_id, u.date);
    } else {
      db.prepare('DELETE FROM weight_logs WHERE client_id = ? AND weigh_date = ?').run(u.client_id, u.date);
    }
  } else if (u.type === 'tasks') {
    for (const item of u.items) {
      const row = db.prepare('SELECT tasks FROM sessions WHERE id = ?').get(item.session_id);
      if (!row) continue;
      const tasks = JSON.parse(row.tasks || '[]');
      for (const t of tasks) {
        if (t.id === item.task_id) { t.status = item.previous_status; delete t.completed_at; }
      }
      db.prepare('UPDATE sessions SET tasks = ? WHERE id = ?').run(JSON.stringify(tasks), item.session_id);
    }
  }
}

/** Revert every action of the last WhatsApp message that wrote something (within 15 min). */
function undoLast(db) {
  const last = db.prepare(`
    SELECT * FROM admin_actions WHERE channel = 'whatsapp' AND undone_at IS NULL ORDER BY id DESC LIMIT 1
  `).get();
  if (!last || Date.now() - Date.parse(last.created_at) > UNDO_WINDOW_MS) {
    return 'אין פעולה לביטול (אפשר לבטל עד 15 דקות אחרי הרישום).';
  }
  const group = last.group_key
    ? db.prepare("SELECT * FROM admin_actions WHERE channel = 'whatsapp' AND group_key = ? AND undone_at IS NULL ORDER BY id DESC").all(last.group_key)
    : [last];
  const run = db.transaction(() => {
    for (const a of group) {
      revert(db, a);
      db.prepare('UPDATE admin_actions SET undone_at = ? WHERE id = ?').run(nowUtcISO(), a.id);
    }
  });
  run();
  publish(db, 'client.admin_undo', { entityType: 'client', entityId: null, payload: { actions: group.map((a) => a.id) } });
  return `בוטל:\n${group.map((a) => `• ${a.summary}`).join('\n')}`;
}

// ── Brief detail ("פירוט") ──

function lastBriefDetail(db) {
  const row = db.prepare(`
    SELECT meta FROM admin_whatsapp_messages
    WHERE direction = 'out' AND kind = 'template' AND meta LIKE '%pending_detail%' ORDER BY id DESC LIMIT 1
  `).get();
  try { return row ? JSON.parse(row.meta).pending_detail : null; } catch { return null; }
}

// ── Agent ──

function whatsappConversation(db) {
  const conv = db.prepare("SELECT id FROM agent_conversations WHERE channel = 'whatsapp' ORDER BY id DESC LIMIT 1").get();
  if (!conv) return null;
  const n = db.prepare('SELECT COUNT(*) AS n FROM agent_messages WHERE conversation_id = ?').get(conv.id).n;
  return n >= MAX_CONVERSATION_MESSAGES ? null : conv.id; // null → the agent opens a new one
}

async function askAgent(db, text, actionGroup) {
  if (!process.env.ANTHROPIC_API_KEY && process.env.AI_MOCK !== '1') return 'ה-AI לא מוגדר בשרת.';
  const owner = db.prepare('SELECT id, name FROM users ORDER BY id LIMIT 1').get();
  let reply = '';
  let error = null;
  await runAgentTurn(db, {
    conversationId: whatsappConversation(db),
    userId: owner?.id ?? null,
    userName: owner?.name ? `${owner.name} (WhatsApp)` : 'WhatsApp',
    text,
    channel: 'whatsapp',
    actionGroup,
    signal: AbortSignal.timeout(120000),
    onEvent: (type, data) => {
      if (type === 'text') reply += data.text;
      if (type === 'error') error = data.message;
    },
  });
  return toPlainText(reply) || error || 'בוצע.';
}

// ── Inbound ──

/**
 * Handle one inbound WhatsApp message (already signature-verified).
 * @returns {Promise<{ handled: boolean, reason?: string }>}
 */
function handleInbound(db, { providerId, from, text }) {
  const cfg = kapso.config();
  if (!cfg.adminPhone || kapso.normalizePhone(from) !== cfg.adminPhone) {
    kapso.logMessage(db, { direction: 'in', kind: 'ignored', body: null, meta: { reason: from ? 'other_sender' : 'no_sender' } });
    return Promise.resolve({ handled: false, reason: 'not_admin' });
  }
  if (!text || !text.trim()) return Promise.resolve({ handled: false, reason: 'empty' });
  try {
    kapso.logMessage(db, { direction: 'in', kind: 'text', provider_id: providerId || null, body: text });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return Promise.resolve({ handled: false, reason: 'duplicate' });
    throw err;
  }

  const job = queue.then(async () => {
    const t = text.trim();
    let reply;
    try {
      if (/^בטל$/.test(t)) reply = undoLast(db);
      else if (/^(פירוט|הצג)$/.test(t)) reply = lastBriefDetail(db) || 'אין תדריך שממתין לפירוט.';
      else if (/^(עזרה|help|\?)$/i.test(t)) reply = HELP;
      else reply = await askAgent(db, t, providerId || `msg:${Date.now()}`);
    } catch (err) {
      console.error('[admin-whatsapp] handling failed:', err.message);
      reply = 'אירעה שגיאה בטיפול בהודעה. אפשר לנסות שוב.';
    }
    await kapso.sendText(db, reply, { in_reply_to: providerId || null });
    return { handled: true };
  });
  queue = job.catch(() => {});
  return job;
}

module.exports = { handleInbound, undoLast, toPlainText, HELP, UNDO_WINDOW_MS };
