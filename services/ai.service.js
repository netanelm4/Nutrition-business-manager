const Anthropic = require('@anthropic-ai/sdk');
const { formatDateHebrew } = require('../utils/dates');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1500;

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────────────────────

function buildClientProfile(client) {
  const parts = [
    `שם: ${client.full_name}`,
    client.age ? `גיל: ${client.age}` : null,
    client.gender ? `מין: ${client.gender}` : null,
    client.goal ? `מטרה: ${client.goal}` : null,
    client.medical_notes ? `הערות רפואיות: ${client.medical_notes}` : null,
    client.initial_weight ? `משקל התחלתי: ${client.initial_weight} ק"ג` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

function buildSessionHistory(previousSessions) {
  if (!previousSessions || previousSessions.length === 0) {
    return 'אין פגישות קודמות.';
  }

  return previousSessions
    .map((s) => {
      const tasks = Array.isArray(s.tasks) ? s.tasks : JSON.parse(s.tasks || '[]');
      const taskLines =
        tasks.length > 0
          ? tasks.map((t) => `  - [${t.status}] ${t.text}`).join('\n')
          : '  אין משימות.';

      return [
        `פגישה ${s.session_number} (${formatDateHebrew(s.session_date)}):`,
        `דגשים: ${s.highlights || 'לא תועד'}`,
        `משימות:`,
        taskLines,
      ].join('\n');
    })
    .join('\n\n');
}

function buildSoapSection(soapNotes) {
  if (!soapNotes) return null;
  const parts = [
    soapNotes.subjective?.trim() ? `סובייקטיבי: ${soapNotes.subjective.trim()}` : null,
    soapNotes.objective?.trim()  ? `אובייקטיבי: ${soapNotes.objective.trim()}`  : null,
    soapNotes.assessment?.trim() ? `הערכה: ${soapNotes.assessment.trim()}`       : null,
    soapNotes.plan?.trim()       ? `תוכנית: ${soapNotes.plan.trim()}`            : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `תיעוד SOAP מהפגישה:\n${parts.join('\n')}`;
}

function buildPrompt(client, previousSessions, currentHighlights, soapNotes) {
  const soapSection = buildSoapSection(soapNotes);

  return `אתה עוזר קליני לתזונאי מוסמך. קרא את הנתונים הבאים ותן תובנות מקצועיות.
אם קיים תיעוד SOAP — השתמש בו כמקור עיקרי לניתוח הקליני; הוא מדויק ומובנה יותר מהדגשים החופשיים.

## פרופיל לקוח
${buildClientProfile(client)}

## היסטוריית פגישות
${buildSessionHistory(previousSessions)}

## דגשים מהפגישה הנוכחית
${currentHighlights}
${soapSection ? `\n## ${soapSection}` : ''}
---
ענה בעברית בלבד. החזר JSON בלבד — ללא טקסט נוסף לפני או אחרי — בפורמט הבא:
{
  "insights": [
    { "text": "הצעה קלינית ראשונה" },
    { "text": "הצעה קלינית שנייה" }
  ],
  "flags": [
    { "text": "דגל ראשון — חסם רגשי, דאגה, או נושא לחזור אליו" }
  ]
}

"insights" — עד 4 המלצות קליניות: מה להתקדם, מה להתמקד בו בפגישה הבאה.
"flags" — עד 3 דגלים: חסמים רגשיים, חוסר מוטיבציה, נושאים שחוזרים, נושאים שצריך לבדוק.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parser
// ─────────────────────────────────────────────────────────────────────────────

function parseInsightsResponse(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 200)}`);
  }

  const insights = (parsed.insights || []).map((item) => ({
    text: item.text || '',
    saved_for_next: false,
  }));

  const flags = (parsed.flags || []).map((item) => ({
    text: item.text || '',
    saved_for_next: false,
  }));

  return { insights, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate clinical insights and flags for a session.
 *
 * @param {object}   client             - Full clients row
 * @param {object[]} previousSessions   - All sessions for this client (parsed tasks JSON)
 * @param {string}   currentHighlights  - The highlights text just written for the current session
 * @returns {Promise<{ insights: Array, flags: Array }>}
 */
async function generateInsights(client, previousSessions, currentHighlights) {
  if (!currentHighlights || !currentHighlights.trim()) {
    throw new Error('currentHighlights is required to generate insights.');
  }

  const prompt = buildPrompt(client, previousSessions, currentHighlights);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0]?.text;
  if (!responseText) {
    throw new Error('Empty response from Claude API.');
  }

  return parseInsightsResponse(responseText);
}

module.exports = { generateInsights };
