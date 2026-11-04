const { z } = require('zod');
const { generateStructured, withVoice } = require('../ai/ai.service');
const { upsertAction, listActions } = require('../action-queue.service');
const { publish } = require('../event-bus.service');
const {
  todayISO, israelLocalToUtcISO, israelDateTimeParts, addDays, parseDate, toISODate, nowUtcISO,
} = require('../../utils/dates');

// ─── Morning brief (scheduled job, 08:00 Israel; Haiku) ──────────────────────
// Synthesizes today's meetings (with prep notes from the last held session),
// stale leads and urgent Inbox items into Inbox proposals:
//   morning_brief        one summary item per day
//   meeting_prep         prep note per meeting today
//   brief_lead_followup  WhatsApp draft per stale lead (approve = send)
// Ids returned by the model are checked against the data it was given.

const STALE_LEAD_DAYS = 5;

const BriefSchema = z.object({
  summary: z.string().describe('סיכום הבוקר לנתנאל: מה חשוב היום, בשלוש עד שש שורות'),
  meeting_preps: z.array(z.object({
    meeting_id: z.string(),
    prep_note: z.string().describe('מה להכין ולבדוק בפגישה, לפי הפגישה הקודמת'),
  })),
  lead_followups: z.array(z.object({
    lead_id: z.number().int(),
    message_draft: z.string().describe('הודעת WhatsApp קצרה לליד'),
    reason: z.string(),
  })),
});

function aiAvailable() {
  return process.env.AI_MOCK === '1' || !!process.env.ANTHROPIC_API_KEY;
}

function gather(db, date) {
  const dayStart = israelLocalToUtcISO(date, '00:00');
  const dayEnd = israelLocalToUtcISO(toISODate(addDays(parseDate(date), 1)), '00:00');
  const meetings = db.prepare(`
    SELECT m.id, m.start_time, m.event_type, m.client_id, m.lead_id,
           COALESCE(c.full_name, l.full_name, m.invitee_name) AS person
    FROM meetings m LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN leads l ON l.id = m.lead_id
    WHERE m.status = 'active' AND m.start_time >= ? AND m.start_time < ? ORDER BY m.start_time
  `).all(dayStart, dayEnd).map((m) => {
    const last = m.client_id ? db.prepare(`
      SELECT session_number, session_date, highlights, weight FROM sessions
      WHERE client_id = ? AND status = 'held' ORDER BY session_number DESC LIMIT 1
    `).get(m.client_id) : null;
    return { ...m, time: israelDateTimeParts(m.start_time)?.time, last_session: last };
  });

  const before = new Date(Date.now() - STALE_LEAD_DAYS * 864e5).toISOString();
  const staleLeads = db.prepare('SELECT * FROM leads').all().filter((l) => {
    if (['became_client', 'not_relevant', 'meeting_held'].includes(l.status)) return false;
    const last = l.status_updated_at || l.created_at;
    const iso = String(last).includes('T') ? String(last) : `${String(last).replace(' ', 'T')}Z`;
    return iso < before;
  }).slice(0, 10);

  const urgent = listActions(db).filter((i) => i.priority === 'urgent').slice(0, 15);
  return { meetings, staleLeads, urgent };
}

/**
 * Build today's brief. Idempotent per day (dedupe keys); force re-runs the
 * synthesis but still never duplicates items.
 */
async function runMorningBrief(db, { force = false } = {}) {
  const date = todayISO();
  const briefKey = `morning_brief:${date}`;
  if (!force && db.prepare('SELECT 1 FROM action_queue WHERE dedupe_key = ?').get(briefKey)) {
    return { skipped: 'exists', date };
  }
  const { meetings, staleLeads, urgent } = gather(db, date);

  let brief;
  if (aiAvailable()) {
    brief = await generateStructured({
      task: 'morning_brief',
      system: `You prepare the morning brief for Netanel Malka, a clinical dietitian. Be concise and practical, in Hebrew.
Only reference meetings and leads from the data, using their exact ids. Lead follow-up drafts are WhatsApp messages to the lead.
${withVoice('')}`,
      prompt: JSON.stringify({
        date,
        meetings_today: meetings.map((m) => ({
          meeting_id: m.id, time: m.time, person: m.person, type: m.event_type,
          last_session: m.last_session ? { number: m.last_session.session_number, date: m.last_session.session_date, highlights: m.last_session.highlights, weight: m.last_session.weight } : null,
        })),
        stale_leads: staleLeads.map((l) => ({ lead_id: l.id, name: l.full_name, status: l.status, notes: l.notes })),
        urgent_inbox_items: urgent.map((i) => ({ kind: i.kind, title: i.title })),
      }),
      schema: BriefSchema,
    });
  } else {
    brief = {
      summary: `היום: ${meetings.length} פגישות, ${urgent.length} פריטים דחופים בתיבה, ${staleLeads.length} לידים ממתינים.`,
      meeting_preps: [], lead_followups: [],
    };
  }

  const stats = { date, meetings: meetings.length, preps: 0, followups: 0 };
  upsertAction(db, {
    kind: 'morning_brief',
    dedupeKey: briefKey,
    title: `תדריך בוקר · ${date}`,
    body: brief.summary,
    priority: 'medium',
    source: 'job',
    link: '/',
  });

  const meetingIds = new Map(meetings.map((m) => [m.id, m]));
  for (const p of brief.meeting_preps) {
    const m = meetingIds.get(p.meeting_id);
    if (!m) continue; // model referenced something not in the data
    upsertAction(db, {
      kind: 'meeting_prep',
      dedupeKey: `meeting_prep:${m.id}`,
      title: `הכנה לפגישה ${m.time}: ${m.person}`,
      body: p.prep_note,
      clientId: m.client_id,
      leadId: m.client_id ? null : m.lead_id,
      meetingId: m.id,
      priority: 'medium',
      dueAt: m.start_time,
      source: 'job',
    });
    stats.preps++;
  }

  const leadIds = new Map(staleLeads.map((l) => [l.id, l]));
  for (const f of brief.lead_followups) {
    const lead = leadIds.get(f.lead_id);
    if (!lead || !lead.phone || !f.message_draft?.trim()) continue;
    upsertAction(db, {
      kind: 'brief_lead_followup',
      category: 'message',
      dedupeKey: `brief_lead_followup:lead:${lead.id}:${date}`,
      title: `מעקב ליד: ${lead.full_name}`,
      body: f.reason,
      leadId: lead.id,
      phone: lead.phone,
      message: f.message_draft.trim(),
      priority: 'low',
      source: 'job',
    });
    stats.followups++;
  }

  publish(db, 'inbox.morning_brief', { payload: stats });
  return stats;
}

/** Run at/after 08:00 Israel, once a day. */
function morningBriefDueAt(date = todayISO()) {
  return israelLocalToUtcISO(date, '08:00');
}

module.exports = { runMorningBrief, morningBriefDueAt, BriefSchema, nowUtcISO };
