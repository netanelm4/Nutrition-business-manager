const { z } = require('zod');
const { generateStructured, withVoice } = require('./ai.service');
const { formatDateHebrew } = require('../../utils/dates');

// ─── Clinical generators: schemas + prompts in one place ─────────────────────
// Every generator returns schema-validated JSON (structured outputs) — no regex
// stripping of code fences, no JSON.parse of free text. Outputs are mapped to the
// exact shapes the existing code stores, so stored records keep their format.
// Length limits live in the prompt and are enforced with slice(): structured
// outputs do not support every JSON-Schema constraint.

const EVIDENCE = 'Base everything on current scientific consensus (WHO, AND, AHA, EASD, peer-reviewed meta-analyses). Do not make medical diagnoses or prescribe medication. Respond in Hebrew only.';
const textList = z.array(z.string());

function safeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// ── 1. Initial clinical assessment (intake → session 1 / lead) ───────────────

const AssessmentSchema = z.object({
  clinical_profile:  textList.describe('קליני-תזונתי ראשוני: BMI, צרכי אנרגיה, שיקולים תזונתיים מרכזיים (3-4 נקודות)'),
  attention_points:  textList.describe('נקודות לתשומת לב: דגלים מההיסטוריה הרפואית, דפוסי אכילה או אורח חיים (3-4 נקודות)'),
  initial_direction: textList.describe('כיוון טיפולי ראשוני לפי המטרה, הרקע הרפואי ואורח החיים (3-4 נקודות)'),
});

const ASSESSMENT_SYSTEM = `You are a clinical nutrition assistant helping a licensed dietitian prepare for a first session with a new client.
From the intake data, write an initial clinical assessment in three sections. Keep each section to 3-4 short points.
If BMI, TDEE or adjusted weight are given, use them as context; do not suggest calculating them again.
${EVIDENCE}`;

function buildAssessmentPrompt(intake, client = {}) {
  const conds = safeJson(intake.medical_conditions, {});
  const meds = safeJson(intake.medications, []);
  const activeConds = Object.entries(conds || {}).filter(([, v]) => v).map(([k]) => k);
  const weight = intake.weight ?? client.initial_weight;
  const bmi = weight && intake.height ? (weight / ((Number(intake.height) / 100) ** 2)).toFixed(1) : 'לא חושב';
  return `פרטי הלקוח:
גיל: ${intake.age ?? 'לא ידוע'} | מגדר: ${intake.gender ?? 'לא ידוע'} | גובה: ${intake.height ?? 'לא ידוע'} ס״מ | משקל: ${weight ?? 'לא ידוע'} ק״ג | BMI: ${bmi} | משקל מתוקנן: ${intake.adjusted_weight ?? 'לא נדרש'}
הוצאה קלורית יומית: ${intake.tdee ? Math.round(intake.tdee) : 'לא חושב'} קק״ל
מטרה: ${intake.goal ?? client.goal ?? 'לא צוין'}
מצבים רפואיים: ${activeConds.length ? activeConds.join(', ') : 'אין'}
תרופות: ${Array.isArray(meds) && meds.length ? meds.join(', ') : 'אין'}
סוג תזונה: ${intake.diet_type ?? 'לא צוין'}
פעילות גופנית: ${intake.physical_activity ? `${intake.activity_type ?? ''} ${intake.activity_frequency ?? ''}`.trim() : 'לא פעיל'}
שינה: ${intake.sleep_hours ?? 'לא ידוע'} שעות, איכות: ${intake.sleep_quality ?? 'לא ידוע'}

צור הערכה ראשונית קלינית.`;
}

function renderAssessment(a) {
  const section = (title, items) => `${title}\n${items.slice(0, 4).map((t) => `• ${t}`).join('\n')}`;
  return [
    section('קליני-תזונתי ראשוני:', a.clinical_profile),
    section('נקודות לתשומת לב:', a.attention_points),
    section('כיוון טיפולי ראשוני:', a.initial_direction),
  ].join('\n\n');
}

/** @returns {Promise<string>} assessment text, in the format stored in ai_insights / lead_intakes */
async function assessIntake(intake, client = {}, { task = 'intake_assessment' } = {}) {
  const a = await generateStructured({
    task, system: ASSESSMENT_SYSTEM, prompt: buildAssessmentPrompt(intake, client), schema: AssessmentSchema,
  });
  return renderAssessment(a);
}

// ── 2. Session insights & flags ──────────────────────────────────────────────

const InsightsSchema = z.object({
  insights: z.array(z.object({ text: z.string() })).describe('עד 4 המלצות קליניות: במה להתקדם ועל מה להתמקד בפגישה הבאה'),
  flags:    z.array(z.object({ text: z.string() })).describe('עד 3 דגלים: חסמים רגשיים, ירידה במוטיבציה, נושאים חוזרים, נושאים לבדיקה'),
});

function buildSessionHistory(previousSessions) {
  if (!previousSessions?.length) return 'אין פגישות קודמות.';
  return previousSessions.map((s) => {
    const tasks = Array.isArray(s.tasks) ? s.tasks : safeJson(s.tasks, []);
    const taskLines = tasks.length ? tasks.map((t) => `  - [${t.status}] ${t.text}`).join('\n') : '  אין משימות.';
    return `פגישה ${s.session_number} (${formatDateHebrew(s.session_date)}):\nדגשים: ${s.highlights || 'לא תועד'}\nמשימות:\n${taskLines}`;
  }).join('\n\n');
}

function buildSoapSection(soap) {
  if (!soap) return null;
  const parts = [
    soap.subjective?.trim() && `סובייקטיבי: ${soap.subjective.trim()}`,
    soap.objective?.trim()  && `אובייקטיבי: ${soap.objective.trim()}`,
    soap.assessment?.trim() && `הערכה: ${soap.assessment.trim()}`,
    soap.plan?.trim()       && `תוכנית: ${soap.plan.trim()}`,
  ].filter(Boolean);
  return parts.length ? `תיעוד SOAP מהפגישה:\n${parts.join('\n')}` : null;
}

function buildClientProfile(c) {
  return [
    `שם: ${c.full_name}`, c.age && `גיל: ${c.age}`, c.gender && `מין: ${c.gender}`, c.goal && `מטרה: ${c.goal}`,
    c.medical_notes && `הערות רפואיות: ${c.medical_notes}`, c.initial_weight && `משקל התחלתי: ${c.initial_weight} ק"ג`,
  ].filter(Boolean).join('\n');
}

/** @returns {Promise<{insights: Array, flags: Array}>} in the stored ai_insights / ai_flags shape */
async function sessionInsights(client, previousSessions, highlights, soapNotes) {
  if (!highlights?.trim()) throw new Error('highlights are required to generate insights.');
  const soap = buildSoapSection(soapNotes);
  const out = await generateStructured({
    task: 'session_insights',
    system: `You are a clinical assistant to a licensed dietitian. Read the session data and give professional insights. If SOAP notes exist, treat them as the primary source. ${EVIDENCE}`,
    prompt: `## פרופיל לקוח\n${buildClientProfile(client)}\n\n## היסטוריית פגישות\n${buildSessionHistory(previousSessions)}\n\n## דגשים מהפגישה הנוכחית\n${highlights}${soap ? `\n\n## ${soap}` : ''}`,
    schema: InsightsSchema,
  });
  return {
    insights: out.insights.slice(0, 4).map((i) => ({ text: i.text, saved_for_next: false })),
    flags: out.flags.slice(0, 3).map((f) => ({ text: f.text, saved_for_next: false })),
  };
}

// ── 3. Post-session WhatsApp check-in (client-facing → voice rules) ──────────

const MessageSchema = z.object({ message: z.string().describe('ההודעה ללקוח, מוכנה לשליחה בוואטסאפ') });

async function checkinMessage(client, session, { task = 'checkin_message' } = {}) {
  const soap = safeJson(session.soap_notes, null);
  const summary = [
    session.highlights && `דגשים: ${session.highlights}`,
    soap?.plan?.trim() && `תוכנית: ${soap.plan.trim()}`,
    soap?.assessment?.trim() && `הערכה: ${soap.assessment.trim()}`,
  ].filter(Boolean).join('\n') || 'פגישה בלי תיעוד מפורט';
  const out = await generateStructured({
    task,
    system: withVoice('Write a warm WhatsApp check-in message from the dietitian to the client after a session, 3-5 sentences, addressing the client directly. Reinforce and encourage only: do not give specific nutrition recommendations.'),
    prompt: `לקוח: ${client.full_name}, פגישה ${session.session_number}.\n${summary}\nכתוב הודעת צ'ק-אין.`,
    schema: MessageSchema,
  });
  return out.message.trim();
}

// ── 4. Process summary (ended process) ───────────────────────────────────────

const ProcessSummarySchema = z.object({
  headline:        z.string(),
  journey:         z.string().describe('תיאור המסע לאורך התהליך'),
  achievements:    z.string().describe('הישגים עיקריים'),
  recommendations: z.string().describe('המלצות להמשך'),
  closing:         z.string().describe('משפט סיום'),
});

function buildProcessPrompt(client, sessions) {
  const lines = [`שם: ${client.full_name}`];
  if (client.goal)           lines.push(`מטרה: ${client.goal}`);
  if (client.initial_weight) lines.push(`משקל התחלתי: ${client.initial_weight} ק"ג`);
  if (client.start_date)     lines.push(`תחילת טיפול: ${client.start_date}`);
  lines.push(`מספר פגישות: ${sessions.length}`);
  const last = sessions.at(-1);
  if (last?.weight) lines.push(`משקל בפגישה אחרונה: ${last.weight} ק"ג`);
  for (const s of sessions) {
    lines.push(`\nפגישה ${s.session_number} (${s.session_date || 'לא ידוע'})`);
    if (s.highlights) lines.push(`דגשים: ${s.highlights}`);
    const done = safeJson(s.tasks, []).filter((t) => t.status === 'done').map((t) => t.text);
    if (done.length) lines.push(`משימות שהושלמו: ${done.join(', ')}`);
  }
  return `${lines.join('\n')}\n\nכתוב סיכום תהליך.`;
}

/**
 * Generate and store clients.process_summary. Single implementation used by the
 * route, the stop/ended triggers and the backfill job.
 */
async function generateProcessSummary(database, clientId, { task = 'process_summary' } = {}) {
  const client = database.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) throw Object.assign(new Error('Client not found.'), { status: 404 });
  const sessions = database.prepare(
    "SELECT * FROM sessions WHERE client_id = ? AND (status IS NULL OR status = 'held') ORDER BY session_number"
  ).all(clientId);
  const summary = await generateStructured({
    task,
    system: withVoice('You are a clinical dietitian summarizing a treatment process that has ended. Write a professional, warm and useful summary the client can read.'),
    prompt: buildProcessPrompt(client, sessions),
    schema: ProcessSummarySchema,
  });
  database.prepare('UPDATE clients SET process_summary = ? WHERE id = ?').run(JSON.stringify(summary), clientId);
  return summary;
}

// ── Schemas used directly by routes (data gathering stays in the route) ──────

const ClientSummarySchema = z.object({
  clinical_summary: z.string().describe('סיכום קליני קצר: פרופיל תזונתי, BMI, TDEE, מצבים רפואיים ותרופות'),
  focus_points:     z.string().describe('נקודות מיקוד לפגישה הבאה, עד 4'),
  flags:            z.string().describe('דגלים לתשומת לב, עד 3'),
  recommendations:  z.string().describe('המלצות טיפוליות, עד 4'),
  tasks: z.array(z.object({
    text: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })).describe('עד 5 משימות קליניות מוצעות'),
});

const ProtocolPersonalizationSchema = z.object({
  personalized_highlights: textList,
  personalized_tasks:      textList,
  clinical_notes:          z.string().describe('הערות קליניות חשובות, או מחרוזת ריקה'),
});

const MenuSchema = z.object({
  meals: z.array(z.object({
    meal_name:  z.string(),
    meal_order: z.number().int(),
    notes:      z.string(),
    items: z.array(z.object({
      item_type:   z.enum(['protein', 'carb', 'fat', 'vegetable', 'fruit', 'daily_basket', 'custom']),
      portions:    z.number(),
      custom_text: z.string(),
      notes:       z.string(),
    })),
  })),
});

const DailyTasksSchema = z.object({
  tasks: z.array(z.object({
    text:        z.string(),
    quadrant:    z.number().int().describe('1-4 לפי מטריצת אייזנהאואר'),
    client_id:   z.number().int().nullable(),
    client_name: z.string(),
  })).describe('עד 15 משימות'),
});

// Client analysis checks (background, ai-intelligence.service)
const RecommendationSchema = z.object({
  recommend:         z.boolean(),
  message_draft:     z.string().describe('הודעה ללקוח, או מחרוזת ריקה'),
  action_suggestion: z.string().describe('מה כדאי לנתנאל לעשות קלינית'),
});

module.exports = {
  EVIDENCE,
  safeJson,
  assessIntake,
  buildAssessmentPrompt,
  sessionInsights,
  checkinMessage,
  generateProcessSummary,
  ClientSummarySchema,
  ProtocolPersonalizationSchema,
  MenuSchema,
  DailyTasksSchema,
  RecommendationSchema,
  MessageSchema,
};
