const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../database/db');

const router   = express.Router();
const AI_MODEL = 'claude-sonnet-4-20250514';

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function ok(res, data)              { return res.json({ success: true, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, error: message }); }

// ─── POST /api/assistant/chat ─────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return fail(res, 400, 'Message required.');

    // ── Fetch system context ──────────────────────────────────────────────────
    const clients = db.prepare(`
      SELECT c.id, c.full_name, c.phone, c.status,
             c.start_date, c.goal, c.medical_notes,
             c.payment_status, c.package_price,
             c.protocol_id, p.name AS protocol_name,
             (SELECT COUNT(*) FROM sessions s
              WHERE s.client_id = c.id) AS sessions_done,
             (SELECT session_date FROM sessions s
              WHERE s.client_id = c.id
              ORDER BY session_number DESC LIMIT 1) AS last_session_date,
             (SELECT highlights FROM sessions s
              WHERE s.client_id = c.id
              ORDER BY session_number DESC LIMIT 1) AS last_session_highlights
      FROM clients c
      LEFT JOIN protocols p ON p.id = c.protocol_id
      WHERE c.status = 'active'
    `).all();

    const leads = db.prepare(`
      SELECT id, full_name, phone, status, source,
             follow_up_date, notes, created_at
      FROM leads
      WHERE status NOT IN ('became_client', 'not_relevant')
      ORDER BY created_at DESC
    `).all();

    const todayTasks = db.prepare(`
      SELECT dt.*, c.full_name AS client_name
      FROM daily_tasks dt
      LEFT JOIN clients c ON c.id = dt.client_id
      WHERE dt.date = date('now')
        AND dt.completed = 0
      ORDER BY dt.quadrant ASC
    `).all();

    const upcomingSessions = db.prepare(`
      SELECT ce.*,
             c.full_name AS client_name,
             l.full_name AS lead_name
      FROM calendly_events ce
      LEFT JOIN clients c ON c.id = ce.client_id
      LEFT JOIN leads   l ON l.id = ce.lead_id
      WHERE ce.status = 'active'
        AND ce.start_time > datetime('now')
      ORDER BY ce.start_time ASC
      LIMIT 10
    `).all();

    // ── Build system prompt ───────────────────────────────────────────────────
    const today = new Date().toLocaleDateString('he-IL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const clientsText = clients.length === 0
      ? 'אין לקוחות פעילים'
      : clients.map((c) => {
          const highlights = c.last_session_highlights
            ? `\n    סיכום אחרון: ${String(c.last_session_highlights).slice(0, 200)}`
            : '';
          return `- ${c.full_name} | ${c.sessions_done}/6 פגישות | פגישה אחרונה: ${c.last_session_date || 'טרם נערכה'}
    מטרה: ${c.goal || 'לא צוין'} | פרוטוקול: ${c.protocol_name || 'לא שויך'} | תשלום: ${c.payment_status || 'לא ידוע'}${highlights}`;
        }).join('\n');

    const leadsText = leads.length === 0
      ? 'אין לידים פעילים'
      : leads.map((l) =>
          `- ${l.full_name} | סטטוס: ${l.status} | פולואו-אפ: ${l.follow_up_date || 'לא נקבע'}`
        ).join('\n');

    const tasksText = todayTasks.length === 0
      ? 'אין משימות פעילות היום'
      : todayTasks.map((t) =>
          `Q${t.quadrant}: ${t.text}${t.client_name ? ` [${t.client_name}]` : ''}`
        ).join('\n');

    const sessionsText = upcomingSessions.length === 0
      ? 'אין פגישות קרובות'
      : upcomingSessions.map((s) => {
          const name = s.client_name || s.lead_name || 'לא ידוע';
          const time = new Date(s.start_time).toLocaleString('he-IL', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit',
          });
          return `- ${name} | ${time}`;
        }).join('\n');

    const systemPrompt = `You are a personal AI assistant for Netanel Malka, a licensed clinical nutritionist. You have full access to his client management system.

Your role:
- Answer questions about specific clients, leads, and tasks
- Help prepare for upcoming sessions
- Suggest follow-up actions based on client data
- Draft WhatsApp messages when asked
- Provide clinical context when relevant
- Be concise and practical — this is a working tool, not a conversation

Current date: ${today}

ACTIVE CLIENTS (${clients.length}):
${clientsText}

ACTIVE LEADS (${leads.length}):
${leadsText}

TODAY'S TASKS (${todayTasks.length}):
${tasksText}

UPCOMING SESSIONS (${upcomingSessions.length}):
${sessionsText}

Communication rules:
- Always respond in Hebrew
- Be direct and practical
- When asked about a specific client, give specific details
- When drafting messages, use gender-neutral Hebrew
- Never make up data — only use what's provided above
- If you don't have enough information, say so clearly`;

    // ── Call Claude ───────────────────────────────────────────────────────────
    const response = await getClient().messages.create({
      model:      AI_MODEL,
      max_tokens: 1000,
      system:     systemPrompt,
      messages:   [...history, { role: 'user', content: message }],
    });

    const reply = response.content[0]?.text ?? '';
    return ok(res, { reply });
  } catch (err) {
    console.error('[POST /assistant/chat]', err);
    return fail(res, 500, 'שגיאה בשיחה עם העוזר AI.');
  }
});

module.exports = router;
