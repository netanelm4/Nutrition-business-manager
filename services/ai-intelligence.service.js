const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database/db');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 600;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const STYLE_SYSTEM = `אתה נתנאל מלכה, דיאטן קליני מוסמך. כשאתה כותב הודעות ללקוחות:
- טון חם, לא רשמי, מעודד ואנרגטי
- כפל אותיות להדגשה: "מעולהה", "יופיי", "כן כן", "בדיוקק"
- השתמש רק באימוג'ים הבאים: 💪🏽 🙏🏽 🙌🏼
- כתיבה בגוף שני זכר
- תגובות קצרות — עד 2-3 משפטים
- עברית בלבד`;

// ─── Claude helper ────────────────────────────────────────────────────────────

async function callClaude(userPrompt) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: STYLE_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = message.content[0]?.text || '';
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 200)}`);
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function saveRecommendation(clientId, type, priority, title, messageDraft, actionSuggestion) {
  db.prepare(
    'DELETE FROM ai_recommendations WHERE client_id = ? AND type = ? AND is_dismissed = 0'
  ).run(clientId, type);

  db.prepare(`
    INSERT INTO ai_recommendations
      (client_id, type, priority, title, message_draft, action_suggestion, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))
  `).run(clientId, type, priority, title, messageDraft || null, actionSuggestion || null);

  console.log(`[ai-intelligence] saved rec type=${type} for client_id=${clientId}`);
}

// ─── Client context loader ────────────────────────────────────────────────────

function getClientContext(clientId) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return null;

  const sessions = db.prepare(`
    SELECT s.id, s.session_number, s.session_date, s.weight, s.highlights,
           si.sleep_quality, si.sleep_hours
    FROM sessions s
    LEFT JOIN session_intakes si ON si.session_id = s.id
    WHERE s.client_id = ?
    ORDER BY s.session_number ASC
  `).all(clientId);

  const latestIntake = db.prepare(`
    SELECT si.*
    FROM session_intakes si
    JOIN sessions s ON s.id = si.session_id
    WHERE si.client_id = ?
    ORDER BY s.session_number DESC
    LIMIT 1
  `).get(clientId);

  const nextMeeting = db.prepare(`
    SELECT start_time FROM calendly_events
    WHERE client_id = ? AND start_time > datetime('now') AND start_time < datetime('now', '+48 hours')
    ORDER BY start_time ASC LIMIT 1
  `).get(clientId);

  const latestMenu = db.prepare(`
    SELECT created_at FROM menus
    WHERE client_id = ? AND status = 'final'
    ORDER BY created_at DESC LIMIT 1
  `).get(clientId);

  return { client, sessions, latestIntake, nextMeeting, latestMenu };
}

// ─── Check 1: weight_missing ──────────────────────────────────────────────────

function checkWeightMissing(client, sessions) {
  if (sessions.length === 0) return;

  const hasRecentWeight = sessions.some((s) => {
    if (!s.weight || !s.session_date) return false;
    const sessionMs = new Date(s.session_date).getTime();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return sessionMs >= cutoff;
  });

  if (!hasRecentWeight) {
    saveRecommendation(
      client.id,
      'weight_missing',
      'medium',
      `חסר משקל עדכני — ${client.full_name}`,
      null,
      'בקש מהלקוח לשלוח משקל עדכני לפני הפגישה הבאה'
    );
  }
}

// ─── Check 2: weight_not_progressing ─────────────────────────────────────────

async function checkWeightNotProgressing(client, sessions) {
  const withWeight = sessions.filter((s) => s.weight && s.session_date);
  if (withWeight.length < 3) return;

  const weightHistory = withWeight.map((s) => `פגישה ${s.session_number} (${s.session_date}): ${s.weight} ק"ג`).join('\n');

  const result = await callClaude(`
לקוח: ${client.full_name}, מטרה: ${client.goal || 'לא צוין'}
משקל התחלתי: ${client.initial_weight || 'לא צוין'} ק"ג

היסטוריית משקל:
${weightHistory}

האם יש קיפאון במשקל בשלושת הפגישות האחרונות? ענה ב-JSON בלבד:
{
  "recommend": true/false,
  "message_draft": "הודעה ללקוח בסגנונך (עד 2 משפטים)",
  "action_suggestion": "מה כדאי לך לעשות קלינית"
}
`);

  if (result?.recommend) {
    saveRecommendation(
      client.id,
      'weight_not_progressing',
      'medium',
      `קיפאון במשקל — ${client.full_name}`,
      result.message_draft,
      result.action_suggestion
    );
  }
}

// ─── Check 3: no_contact ──────────────────────────────────────────────────────

async function checkNoContact(client, sessions) {
  const sessionsWithDate = sessions.filter((s) => s.session_date);
  if (sessionsWithDate.length === 0) return;

  const lastSession = sessionsWithDate[sessionsWithDate.length - 1];
  const daysSince = Math.floor(
    (Date.now() - new Date(lastSession.session_date).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince < 21) return;

  const result = await callClaude(`
לקוח: ${client.full_name}
עברו ${daysSince} ימים מאז הפגישה האחרונה (${lastSession.session_date})
מטרה: ${client.goal || 'לא צוין'}

כתוב הודעת ווצאפ קצרה לחידוש קשר. ענה ב-JSON בלבד:
{
  "message_draft": "הודעה לשליחה בווצאפ",
  "action_suggestion": "מה כדאי לתאם"
}
`);

  saveRecommendation(
    client.id,
    'no_contact',
    daysSince > 45 ? 'urgent' : 'medium',
    `אין קשר — ${daysSince} ימים — ${client.full_name}`,
    result?.message_draft,
    result?.action_suggestion
  );
}

// ─── Check 4: upcoming_meeting ────────────────────────────────────────────────

async function checkUpcomingMeeting(client, sessions, nextMeeting) {
  if (!nextMeeting) return;

  const lastSession = sessions.filter((s) => s.highlights).pop();
  const highlights = lastSession?.highlights || 'אין תיעוד מהפגישה הקודמת';

  const result = await callClaude(`
לקוח: ${client.full_name} — פגישה מחר/בקרוב (${nextMeeting.start_time})
דגשים מהפגישה הקודמת: ${highlights}

כתוב הודעת הכנה קצרה ללקוח לפני הפגישה. ענה ב-JSON בלבד:
{
  "message_draft": "הודעת הכנה",
  "action_suggestion": "מה לבדוק/להכין לפגישה"
}
`);

  saveRecommendation(
    client.id,
    'upcoming_meeting',
    'urgent',
    `פגישה קרובה — ${client.full_name}`,
    result?.message_draft,
    result?.action_suggestion
  );
}

// ─── Check 5: blood_test_due ──────────────────────────────────────────────────

function checkBloodTestDue(client, sessions, latestIntake) {
  if (!latestIntake?.medical_conditions && !latestIntake?.lab_results_pdf_path) return;

  const sessionsWithDate = sessions.filter((s) => s.session_date);
  if (sessionsWithDate.length === 0) return;

  const firstSession = sessionsWithDate[0];
  const daysSinceFirst = Math.floor(
    (Date.now() - new Date(firstSession.session_date).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceFirst < 90) return;

  const alreadyHasLab = !!latestIntake?.lab_results_pdf_path;
  const title = alreadyHasLab
    ? `בדיקות דם — עדכון מומלץ — ${client.full_name}`
    : `בדיקות דם — לא בוצעו — ${client.full_name}`;

  saveRecommendation(
    client.id,
    'blood_test_due',
    'low',
    title,
    null,
    alreadyHasLab
      ? 'שקול לבקש עדכון בדיקות דם — עברו יותר מ-3 חודשים'
      : 'שקול להזמין בדיקות דם — הלקוח לא שלח תוצאות'
  );
}

// ─── Check 6: motivation_drop ─────────────────────────────────────────────────

async function checkMotivationDrop(client, sessions) {
  const withHighlights = sessions.filter((s) => s.highlights).slice(-3);
  if (withHighlights.length < 2) return;

  const history = withHighlights
    .map((s) => `פגישה ${s.session_number}: ${s.highlights}`)
    .join('\n\n');

  const result = await callClaude(`
לקוח: ${client.full_name}
דגשים מהפגישות האחרונות:
${history}

האם יש סימנים לירידה במוטיבציה, חוסר עמידה ביעדים, או קושי? ענה ב-JSON בלבד:
{
  "recommend": true/false,
  "message_draft": "הודעת עידוד ללקוח",
  "action_suggestion": "גישה קלינית מומלצת לפגישה הבאה"
}
`);

  if (result?.recommend) {
    saveRecommendation(
      client.id,
      'motivation_drop',
      'medium',
      `ירידה במוטיבציה — ${client.full_name}`,
      result.message_draft,
      result.action_suggestion
    );
  }
}

// ─── Check 7: menu_update_needed ─────────────────────────────────────────────

function checkMenuUpdateNeeded(client, sessions, latestMenu) {
  if (sessions.length < 2) return;

  if (!latestMenu) {
    saveRecommendation(
      client.id,
      'menu_update_needed',
      'low',
      `אין תפריט מאושר — ${client.full_name}`,
      null,
      'בנה תפריט מותאם ושלח ללקוח'
    );
    return;
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(latestMenu.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince >= 45) {
    saveRecommendation(
      client.id,
      'menu_update_needed',
      'low',
      `תפריט ישן — ${daysSince} ימים — ${client.full_name}`,
      null,
      'שקול לעדכן את התפריט בהתאם להתקדמות'
    );
  }
}

// ─── Per-client analysis ──────────────────────────────────────────────────────

async function analyzeClient(clientId) {
  const ctx = getClientContext(clientId);
  if (!ctx) return;

  const { client, sessions, latestIntake, nextMeeting, latestMenu } = ctx;

  try { checkWeightMissing(client, sessions); } catch (e) {
    console.error(`[ai-intelligence] checkWeightMissing error client=${clientId}:`, e.message);
  }

  try { await checkWeightNotProgressing(client, sessions); } catch (e) {
    console.error(`[ai-intelligence] checkWeightNotProgressing error client=${clientId}:`, e.message);
  }

  try { await checkNoContact(client, sessions); } catch (e) {
    console.error(`[ai-intelligence] checkNoContact error client=${clientId}:`, e.message);
  }

  try { await checkUpcomingMeeting(client, sessions, nextMeeting); } catch (e) {
    console.error(`[ai-intelligence] checkUpcomingMeeting error client=${clientId}:`, e.message);
  }

  try { checkBloodTestDue(client, sessions, latestIntake); } catch (e) {
    console.error(`[ai-intelligence] checkBloodTestDue error client=${clientId}:`, e.message);
  }

  try { await checkMotivationDrop(client, sessions); } catch (e) {
    console.error(`[ai-intelligence] checkMotivationDrop error client=${clientId}:`, e.message);
  }

  try { checkMenuUpdateNeeded(client, sessions, latestMenu); } catch (e) {
    console.error(`[ai-intelligence] checkMenuUpdateNeeded error client=${clientId}:`, e.message);
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function runAnalysis() {
  console.log('[ai-intelligence] Starting analysis run...');
  const clients = db.prepare("SELECT id FROM clients WHERE status = 'active'").all();
  console.log(`[ai-intelligence] Analyzing ${clients.length} active client(s)`);

  for (const { id } of clients) {
    try {
      await analyzeClient(id);
    } catch (e) {
      console.error(`[ai-intelligence] analyzeClient error for client_id=${id}:`, e.message);
    }
  }

  console.log('[ai-intelligence] Analysis run complete.');
}

module.exports = { runAnalysis };
