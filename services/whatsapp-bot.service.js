const db        = require('../database/db');
const Anthropic  = require('@anthropic-ai/sdk');

const ai = new Anthropic();

// ─── Phone normalization ──────────────────────────────────────────────────────
// Converts any format to local Israeli format: 05XXXXXXXX

function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-\(\)\.]/g, '');
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  else if (p.startsWith('972'))  p = '0' + p.slice(3);
  return p;
}

// ─── Client context helpers ───────────────────────────────────────────────────

function loadClientContext(clientId) {
  const latestMenu = db.prepare(`
    SELECT title, calorie_target
    FROM   menus
    WHERE  client_id = ? AND status = 'final'
    ORDER  BY created_at DESC LIMIT 1
  `).get(clientId);

  const latestIntake = db.prepare(`
    SELECT si.nutrition_anamnesis, si.menu_building
    FROM   session_intakes si
    JOIN   sessions s ON s.id = si.session_id
    WHERE  si.client_id = ?
    ORDER  BY s.session_number DESC LIMIT 1
  `).get(clientId);

  const recentWeights = db.prepare(`
    SELECT weight, weigh_date
    FROM   weight_logs
    WHERE  client_id = ?
    ORDER  BY weigh_date DESC LIMIT 3
  `).all(clientId);

  const protocol = db.prepare(`
    SELECT p.name
    FROM   protocols p
    JOIN   clients   c ON c.protocol_id = p.id
    WHERE  c.id = ?
  `).get(clientId);

  let menuBuilding = {};
  try { menuBuilding = JSON.parse(latestIntake?.menu_building || '{}'); } catch {}

  return { latestMenu, menuBuilding, recentWeights, protocol };
}

// ─── Claude classification ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `אתה עוזר לדיאטן נתנאל מלכה לסווג הודעות מלקוחות.

סווג כל הודעה לאחת מ-3 קטגוריות:

1. "auto_reply" — שאלות פשוטות על התפריט, כמויות, מזונות מותרים
2. "draft_for_approval" — שאלות על מסעדות/אירועים/חגים, עדכונים רגשיים, מצבים מורכבים
3. "forward" — בקשות לשינוי תפריט, שאלות רפואיות, תיאום פגישות

החזר JSON בלבד:
{
  "type": "auto_reply" | "draft_for_approval" | "forward",
  "response": "תגובה בעברית בסגנון נתנאל (חמה, לא רשמית, 1-2 אמוג׳י)",
  "reason": "הסבר קצר למה סווג כך"
}

סגנון נתנאל:
- כפל אותיות: "מעולהה", "סגוררר"
- מילות מפתח: "סגור", "יאללה", "אליפות", "מדהים"
- אמוג׳י: 💪🏽 🙏🏽 🙌🏼 — לא יותר מ-2
- קצר וממוקד
- לא שיפוטי`;

async function classifyMessage(client, messageText, context) {
  const { latestMenu, menuBuilding, recentWeights, protocol } = context;

  const menuSummary   = latestMenu
    ? `${latestMenu.title} (${latestMenu.calorie_target} קק"ל)`
    : 'אין תפריט סופי';
  const protocolName  = protocol?.name || 'לא שויך';
  const kashrut       = menuBuilding.kashrut       || 'לא צוין';
  const vegetarian    = menuBuilding.vegetarian     ? 'כן' : 'לא';
  const dislikedFoods = menuBuilding.disliked_foods || 'לא צוין';

  const userContent = `לקוח: ${client.full_name}
הודעה: ${messageText}

תפריט נוכחי: ${menuSummary}
פרוטוקול: ${protocolName}
העדפות: כשרות=${kashrut}, צמחוני=${vegetarian}, מזונות לא מועדפים=${dislikedFoods}`;

  const aiResponse = await ai.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 512,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userContent }],
  });

  const raw     = aiResponse.content[0]?.text?.trim() || '';
  const jsonStr = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/, '').trim();
  return JSON.parse(jsonStr);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function processIncomingMessage({ from_phone, message_text, timestamp }) {
  // Step 1 — identify client
  const normalized = normalizePhone(from_phone);
  if (!normalized) return { action: 'ignore' };

  const activeClients = db.prepare("SELECT * FROM clients WHERE status = 'active'").all();
  const client = activeClients.find((c) => normalizePhone(c.phone) === normalized);
  if (!client) return { action: 'ignore' };

  // Step 2 — load context
  const context = loadClientContext(client.id);

  // Step 3 — classify
  let classification;
  try {
    classification = await classifyMessage(client, message_text, context);
  } catch (err) {
    console.error('[whatsapp-bot] classification failed:', err.message);
    classification = { type: 'forward', response: '', reason: 'classification error' };
  }

  const { type, response, reason } = classification;
  const natanelPhone = process.env.NATANEL_PHONE || '';

  // Step 4 — build result
  let result;
  if (type === 'auto_reply') {
    result = {
      action:   'send_to_client',
      to_phone: from_phone,
      message:  response,
    };
  } else if (type === 'draft_for_approval') {
    const approvalMsg =
      `📝 טיוטה ל${client.full_name}:\n\n${response}\n\n─────\n` +
      `לשליחה השב: שלח ${client.id}\nלעריכה השב: ערוך ${client.id}`;
    result = {
      action:    'send_to_natanel',
      to_phone:  natanelPhone,
      message:   approvalMsg,
      draft:     response,
      client_id: client.id,
    };
  } else {
    result = {
      action:   'forward_to_natanel',
      to_phone: natanelPhone,
      message:  `📨 הודעה מ${client.full_name} (לטיפול ידני):\n\n${message_text}`,
    };
  }

  // Step 5 — log
  try {
    db.prepare(`
      INSERT INTO whatsapp_log (client_id, rendered_message, direction, message_type, status)
      VALUES (?, ?, 'incoming', ?, 'processed')
    `).run(client.id, message_text, type);
  } catch (err) {
    console.error('[whatsapp-bot] log insert failed:', err.message);
  }

  return { ...result, classification_reason: reason };
}

module.exports = { processIncomingMessage, normalizePhone };
