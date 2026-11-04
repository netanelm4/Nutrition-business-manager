const db = require('../database/db');

const { nowUtcISO, addHoursUtcISO, isoWeekKey } = require('../utils/dates');
const { upsertAction } = require('./action-queue.service');
const { generateStructured, withVoice } = require('./ai/ai.service');
const { RecommendationSchema } = require('./ai/generators');

// Background triage (Haiku, task client_analysis). Drafts follow prompts/voice.md
// (replaces the old style prompt that asked for emojis and masculine forms).
const ANALYSIS_SYSTEM = withVoice(`You assist Netanel Malka, a licensed clinical dietitian, by reviewing one client's recent data.
Decide whether action is needed (recommend), draft a short message to the client when relevant (message_draft, or an empty string), and suggest what Netanel should do clinically (action_suggestion).`);

async function callClaude(userPrompt) {
  return generateStructured({ task: 'client_analysis', system: ANALYSIS_SYSTEM, prompt: userPrompt, schema: RecommendationSchema });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

// A recommendation the nutritionist already sent or dismissed is not raised
// again for this many days — this is what stops the endless alert loop.
const HANDLED_COOLDOWN_DAYS = 7;

// Handled = sent / done / dismissed in the inbox (or in the legacy table, for
// recommendations handled before the inbox existed).
function wasHandledRecently(clientId, type) {
  const since = addHoursUtcISO(-24 * HANDLED_COOLDOWN_DAYS);
  const inInbox = db.prepare(`
    SELECT 1 FROM action_queue
    WHERE client_id = ? AND kind = ? AND status IN ('sent', 'done', 'dismissed')
      AND resolved_by NOT IN ('superseded', 'auto_resolved') AND resolved_at > ?
    LIMIT 1
  `).get(clientId, `ai_${type}`, since);
  if (inInbox) return true;
  const legacy = db.prepare(`
    SELECT 1 FROM ai_recommendations
    WHERE client_id = ? AND type = ? AND (is_sent = 1 OR is_dismissed = 1)
      AND COALESCE(handled_at, created_at) > datetime('now', ?)
    LIMIT 1
  `).get(clientId, type, `-${HANDLED_COOLDOWN_DAYS} days`);
  return !!legacy;
}

// Recommendations land in the inbox (action_queue). One item per client, type
// and ISO week; a newer week supersedes the previous pending one.
function saveRecommendation(clientId, type, priority, title, messageDraft, actionSuggestion) {
  if (wasHandledRecently(clientId, type)) return;
  const client = db.prepare('SELECT phone FROM clients WHERE id = ?').get(clientId);
  upsertAction(db, {
    kind: `ai_${type}`,
    dedupeKey: `ai:${type}:client:${clientId}:${isoWeekKey()}`,
    supersedePrefix: `ai:${type}:client:${clientId}:`,
    title,
    body: actionSuggestion || null,
    clientId,
    phone: messageDraft ? client?.phone : null,
    message: messageDraft || null,
    priority,
    source: 'ai',
  });
  console.log(`[ai-intelligence] inbox item type=${type} for client_id=${clientId}`);
}

// ─── Week helpers ─────────────────────────────────────────────────────────────

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function buildWeeklyAverages(weightRows) {
  // weightRows: [{ weigh_date, weight }] ordered newest first → reverse to oldest first
  const byWeek = {};
  for (const row of [...weightRows].reverse()) {
    const week = getMondayOfWeek(row.weigh_date);
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(row.weight);
  }
  return Object.entries(byWeek)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, weights]) => ({
      week,
      avg: Math.round((weights.reduce((s, w) => s + w, 0) / weights.length) * 10) / 10,
    }));
}

// ─── Client context loader ────────────────────────────────────────────────────

function getClientContext(clientId) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return null;

  const sessions = db.prepare(`
    SELECT s.id, s.session_number, s.session_date, s.highlights,
           si.sleep_quality, si.sleep_hours
    FROM sessions s
    LEFT JOIN session_intakes si ON si.session_id = s.id
    WHERE s.client_id = ? AND s.status = 'held'   -- only sessions that took place
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
    SELECT start_time FROM meetings
    WHERE client_id = ? AND status = 'active' AND start_time > ? AND start_time < ?
    ORDER BY start_time ASC LIMIT 1
  `).get(clientId, nowUtcISO(), addHoursUtcISO(48));

  const latestMenu = db.prepare(`
    SELECT created_at FROM menus
    WHERE client_id = ? AND status = 'final'
    ORDER BY created_at DESC LIMIT 1
  `).get(clientId);

  // Last 6 weight_logs entries (newest first)
  const recentWeights = db.prepare(`
    SELECT weigh_date, weight, day_of_week
    FROM weight_logs
    WHERE client_id = ?
    ORDER BY weigh_date DESC
    LIMIT 6
  `).all(clientId);

  return { client, sessions, latestIntake, nextMeeting, latestMenu, recentWeights };
}

// ─── Check 1: weight_missing ──────────────────────────────────────────────────

function checkWeightMissing(client, recentWeights) {
  // Fire if no weight_logs at all, or latest weigh_date is > 4 days ago
  const latest = recentWeights.length > 0 ? recentWeights[0] : null;

  if (!latest) {
    saveRecommendation(
      client.id,
      'weight_missing',
      'medium',
      `חסר משקל עדכני — ${client.full_name}`,
      null,
      'בקש מהלקוח לשלוח משקל עדכני — עדיין לא נרשמה שקילה במערכת'
    );
    return;
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(latest.weigh_date + 'T12:00:00Z').getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince > 4) {
    saveRecommendation(
      client.id,
      'weight_missing',
      'medium',
      `חסר משקל עדכני — ${client.full_name}`,
      null,
      `עברו ${daysSince} ימים מהשקילה האחרונה (${latest.weigh_date}) — בקש עדכון`
    );
  }
}

// ─── Check 2: weight_not_progressing ─────────────────────────────────────────

async function checkWeightNotProgressing(client, recentWeights) {
  if (wasHandledRecently(client.id, 'weight_not_progressing')) return; // no Claude call
  if (recentWeights.length < 3) return;

  const weeklyAvgs = buildWeeklyAverages(recentWeights);
  if (weeklyAvgs.length < 3) return;

  const last3 = weeklyAvgs.slice(-3);
  const weightTrendLines = last3.map((w) => `שבוע ${w.week}: ממוצע ${w.avg} ק"ג`).join('\n');

  // Quick structural check: if each avg >= previous, likely stagnant — pass to Claude
  const noProgress = last3.every((w, i) => i === 0 || w.avg >= last3[i - 1].avg);
  if (!noProgress) return; // improving — skip Claude call

  const result = await callClaude(`
לקוח: ${client.full_name}, מטרה: ${client.goal || 'לא צוין'}
משקל התחלתי: ${client.initial_weight || 'לא צוין'} ק"ג

ממוצעי משקל שבועיים (3 שבועות אחרונים):
${weightTrendLines}

יש קיפאון לכאורה. האם מדובר בקיפאון משמעותי קלינית? ענה ב-JSON בלבד:
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
  if (wasHandledRecently(client.id, 'no_contact')) return; // no Claude call
  const upcoming = db.prepare(
    "SELECT 1 FROM meetings WHERE client_id = ? AND status = 'active' AND start_time > ? LIMIT 1"
  ).get(client.id, nowUtcISO());
  if (upcoming) return; // already booked — not a lost-contact case
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
  if (wasHandledRecently(client.id, 'upcoming_meeting')) return; // no Claude call
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
  saveRecommendation(
    client.id,
    'blood_test_due',
    'low',
    alreadyHasLab
      ? `בדיקות דם — עדכון מומלץ — ${client.full_name}`
      : `בדיקות דם — לא בוצעו — ${client.full_name}`,
    null,
    alreadyHasLab
      ? 'שקול לבקש עדכון בדיקות דם — עברו יותר מ-3 חודשים'
      : 'שקול להזמין בדיקות דם — הלקוח לא שלח תוצאות'
  );
}

// ─── Check 6: motivation_drop ─────────────────────────────────────────────────

async function checkMotivationDrop(client, sessions, recentWeights) {
  if (wasHandledRecently(client.id, 'motivation_drop')) return; // no Claude call
  const withHighlights = sessions.filter((s) => s.highlights).slice(-3);
  if (withHighlights.length < 2) return;

  const history = withHighlights
    .map((s) => `פגישה ${s.session_number}: ${s.highlights}`)
    .join('\n\n');

  // Build weight trend context from weight_logs
  let weightContext = '';
  if (recentWeights.length >= 2) {
    const weeklyAvgs = buildWeeklyAverages(recentWeights);
    if (weeklyAvgs.length >= 2) {
      weightContext = '\n\nממוצעי משקל שבועיים אחרונים:\n' +
        weeklyAvgs.slice(-3).map((w) => `שבוע ${w.week}: ${w.avg} ק"ג`).join('\n');
    }
  }

  const result = await callClaude(`
לקוח: ${client.full_name}
דגשים מהפגישות האחרונות:
${history}${weightContext}

האם יש סימנים לירידה במוטיבציה, חוסר עמידה ביעדים, קיפאון, או קושי? ענה ב-JSON בלבד:
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

  const { client, sessions, latestIntake, nextMeeting, latestMenu, recentWeights } = ctx;

  try { checkWeightMissing(client, recentWeights); } catch (e) {
    console.error(`[ai-intelligence] checkWeightMissing error client=${clientId}:`, e.message);
  }

  try { await checkWeightNotProgressing(client, recentWeights); } catch (e) {
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

  try { await checkMotivationDrop(client, sessions, recentWeights); } catch (e) {
    console.error(`[ai-intelligence] checkMotivationDrop error client=${clientId}:`, e.message);
  }

  try { checkMenuUpdateNeeded(client, sessions, latestMenu); } catch (e) {
    console.error(`[ai-intelligence] checkMenuUpdateNeeded error client=${clientId}:`, e.message);
  }
}

// ─── Freeze expiry check (no Claude call — pure date logic) ──────────────────

function checkFreezeExpired(clientId) {
  const client = db.prepare('SELECT id, full_name, frozen_until FROM clients WHERE id = ?').get(clientId);
  if (!client || !client.frozen_until) return;

  const today = new Date().toISOString().slice(0, 10);
  if (client.frozen_until <= today) {
    saveRecommendation(
      clientId,
      'freeze_expired',
      'urgent',
      `ההקפאה של ${client.full_name} הסתיימה (${client.frozen_until})`,
      null,
      'בדוק אם הלקוח מעוניין לחזור לתהליך'
    );
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

  // Check frozen clients for expired freezes
  const frozenClients = db.prepare("SELECT id FROM clients WHERE status = 'frozen'").all();
  for (const { id } of frozenClients) {
    try {
      checkFreezeExpired(id);
    } catch (e) {
      console.error(`[ai-intelligence] checkFreezeExpired error for client_id=${id}:`, e.message);
    }
  }

  console.log('[ai-intelligence] Analysis run complete.');
}

module.exports = { runAnalysis };
