const db = require('../database/db');
const Anthropic = require('@anthropic-ai/sdk');

const ai = new Anthropic();

// ─── Phone normalization ──────────────────────────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-\(\)\.]/g, '');
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  else if (p.startsWith('972')) p = '0' + p.slice(3);
  return p;
}

// ─── Day-of-week helper (for weight_logs) ────────────────────────────────────

function getDayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  if (day === 1) return 'monday';
  if (day === 4) return 'thursday';
  return null;
}

// ─── Client context loader ────────────────────────────────────────────────────

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

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'send_auto_reply',
    description: 'שלח תגובה אוטומטית ישירות ללקוח — לשאלות פשוטות על התפריט, כמויות, מזונות מותרים',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'התגובה בעברית בסגנון נתנאל' },
      },
      required: ['message'],
    },
  },
  {
    name: 'send_draft_for_approval',
    description: 'שלח טיוטה לאישור נתנאל — לשאלות על מסעדות/אירועים/חגים, עדכונים רגשיים, מצבים מורכבים',
    input_schema: {
      type: 'object',
      properties: {
        draft_message: { type: 'string', description: 'הטיוטה בעברית בסגנון נתנאל' },
        reason:        { type: 'string', description: 'למה זה דורש אישור' },
      },
      required: ['draft_message', 'reason'],
    },
  },
  {
    name: 'forward_to_natanel',
    description: 'העבר את ההודעה לנתנאל לטיפול ידני — לבקשות שינוי תפריט, שאלות רפואיות, תיאום פגישות',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'למה זה צריך טיפול ידני' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'update_weight',
    description: 'עדכן משקל של לקוח — כשהלקוח שולח מספר שנראה כמשקל',
    input_schema: {
      type: 'object',
      properties: {
        weight: { type: 'number', description: 'המשקל בקילוגרמים' },
        date:   { type: 'string', description: 'תאריך השקילה YYYY-MM-DD' },
      },
      required: ['weight', 'date'],
    },
  },
  {
    name: 'flag_for_attention',
    description: 'סמן הודעה זו לתשומת לב דחופה של נתנאל — השתמש כשאתה מזהה: מצוקה רגשית, תלונות רפואיות, כאב, עייפות קיצונית, ביטויים של ייאוש, שאלות שאתה לא בטוח לגביהן, או כל מצב שדורש התערבות אנושית מיידית',
    input_schema: {
      type: 'object',
      properties: {
        reason:            { type: 'string', description: 'תיאור קצר למה זה דורש תשומת לב' },
        urgency:           { type: 'string', enum: ['high', 'medium'], description: 'רמת הדחיפות' },
        suggested_response: { type: 'string', description: 'תגובה מוצעת אופציונלית' },
      },
      required: ['reason', 'urgency'],
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `אתה עוזר לדיאטן נתנאל מלכה לטפל בהודעות מלקוחות.
השתמש בכלים המתאימים לפי סוג ההודעה.

סגנון נתנאל לתגובות:
- כפל אותיות: "מעולהה", "סגוררר"
- מילות מפתח: "סגור", "יאללה", "אליפות", "מדהים"
- אמוג׳י: 💪🏽 🙏🏽 🙌🏼 — לא יותר מ-2
- קצר וממוקד
- לא שיפוטי

כשאתה לא בטוח — השתמש ב-flag_for_attention. עדיף לדגל יותר מדי מאשר פחות מדי.`;

// ─── Claude tool-use call ─────────────────────────────────────────────────────

async function callWithTools(client, messageText, context) {
  const { latestMenu, menuBuilding, protocol } = context;

  const menuSummary   = latestMenu
    ? `${latestMenu.title} (${latestMenu.calorie_target} קק"ל)`
    : 'אין תפריט סופי';
  const protocolName  = protocol?.name        || 'לא שויך';
  const kashrut       = menuBuilding.kashrut  || 'לא צוין';
  const vegetarian    = menuBuilding.vegetarian ? 'כן' : 'לא';
  const dislikedFoods = menuBuilding.disliked_foods || 'לא צוין';

  const userContent =
    `לקוח: ${client.full_name}\n` +
    `הודעה: ${messageText}\n\n` +
    `תפריט נוכחי: ${menuSummary}\n` +
    `פרוטוקול: ${protocolName}\n` +
    `העדפות: כשרות=${kashrut}, צמחוני=${vegetarian}, מזונות לא מועדפים=${dislikedFoods}`;

  const aiResponse = await ai.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  1024,
    system:      SYSTEM_PROMPT,
    tools:       TOOLS,
    tool_choice: { type: 'auto' },
    messages:    [{ role: 'user', content: userContent }],
  });

  const toolUse = aiResponse.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { tool: 'forward_to_natanel', input: { reason: 'no tool selected by model' } };
  }
  return { tool: toolUse.name, input: toolUse.input };
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

  // Step 3 — call Claude with tools
  let tool, input;
  try {
    ({ tool, input } = await callWithTools(client, message_text, context));
  } catch (err) {
    console.error('[whatsapp-bot] tool call failed:', err.message);
    tool  = 'forward_to_natanel';
    input = { reason: 'tool call error' };
  }

  const natanelPhone = process.env.NATANEL_PHONE || '';

  // Step 4 — act on tool selection
  let result;
  let logType;

  if (tool === 'send_auto_reply') {
    result  = { action: 'send_to_client', to_phone: from_phone, message: input.message };
    logType = 'auto_reply';

  } else if (tool === 'send_draft_for_approval') {
    const approvalMsg =
      `📝 טיוטה ל${client.full_name}:\n\n${input.draft_message}\n\n─────\n` +
      `לשליחה השב: שלח ${client.id}\nלעריכה השב: ערוך ${client.id}`;
    result = {
      action:    'send_to_natanel',
      to_phone:  natanelPhone,
      message:   approvalMsg,
      draft:     input.draft_message,
      client_id: client.id,
      reason:    input.reason,
    };
    logType = 'draft_for_approval';

  } else if (tool === 'flag_for_attention') {
    const title = `🚨 דגל אדום — ${client.full_name}: ${input.reason}`;
    try {
      db.prepare(`
        INSERT INTO ai_recommendations
          (client_id, type, priority, title, message_draft, action_suggestion, expires_at)
        VALUES (?, 'whatsapp_flag', ?, ?, ?, ?, datetime('now', '+24 hours'))
      `).run(
        client.id,
        input.urgency === 'high' ? 'urgent' : 'medium',
        title,
        input.suggested_response || null,
        `בדוק את השיחה עם ${client.full_name} ודאג לחזור אליו`,
      );
    } catch (err) {
      console.error('[whatsapp-bot] flag insert failed:', err.message);
    }
    result = {
      action:   'flagged',
      to_phone: natanelPhone,
      message:  `🚨 ${title}\n\nהודעה מקורית:\n${message_text}`,
      reason:   input.reason,
      urgency:  input.urgency,
    };
    logType = 'flagged';

  } else if (tool === 'update_weight') {
    const dayOfWeek = getDayOfWeek(input.date);
    try {
      db.prepare(`
        INSERT INTO weight_logs (client_id, weigh_date, weight, day_of_week)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id, weigh_date) DO UPDATE SET weight = excluded.weight
      `).run(client.id, input.date, input.weight, dayOfWeek);
    } catch (err) {
      console.error('[whatsapp-bot] weight insert failed:', err.message);
    }
    const confirmMsg = `מעולה! שקילה של ${input.weight} ק״ג נרשמה 💪🏽`;
    result  = { action: 'send_to_client', to_phone: from_phone, message: confirmMsg };
    logType = 'auto_reply';

  } else {
    // forward_to_natanel (default / fallback)
    result = {
      action:   'forward_to_natanel',
      to_phone: natanelPhone,
      message:  `📨 הודעה מ${client.full_name} (לטיפול ידני):\n\n${message_text}`,
      reason:   input.reason,
    };
    logType = 'forward';
  }

  // Step 5 — log incoming message
  try {
    db.prepare(`
      INSERT INTO whatsapp_log (client_id, rendered_message, direction, message_type, status)
      VALUES (?, ?, 'incoming', ?, 'processed')
    `).run(client.id, message_text, logType);
  } catch (err) {
    console.error('[whatsapp-bot] log insert failed:', err.message);
  }

  return { ...result, tool_used: tool };
}

module.exports = { processIncomingMessage, normalizePhone };
