const { z } = require('zod');
const { upsertAction, listActions } = require('../action-queue.service');
const { computeClientAlerts, hasUpcomingMeeting } = require('../alerts.service');
const { publish } = require('../event-bus.service');
const { LEAD_STATUS } = require('../../constants/statuses');
const {
  todayISO, nowUtcISO, israelDateOf, israelDateTimeParts, israelLocalToUtcISO, addDays, parseDate, toISODate,
} = require('../../utils/dates');

// ─── Agent tool registry ─────────────────────────────────────────────────────
//   read     — runs immediately, returns data
//   propose  — never writes the CRM: creates an Inbox item (kind agent_<tool>)
//              that Netanel approves with one click (services/agent/proposals.js)
//   auto     — the one autonomous write (update_weight), audit-logged
// Every input is validated with zod before running; errors go back to the
// model as is_error tool results so it can correct itself.

const id = () => z.number().int().positive();
const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const hhmm = () => z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM');
const reason = () => z.string().describe('Short reason shown to Netanel in the Inbox (Hebrew)');

function fmtInstant(iso) {
  const p = israelDateTimeParts(iso);
  return p ? `${p.date} ${p.time}` : null;
}
function clip(text, n = 300) {
  if (!text) return text;
  const s = String(text);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function requireRow(db, table, rowId, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
  if (!row) throw new Error(`${label} ${rowId} not found.`);
  return row;
}

/** Create the Inbox proposal for a write tool. */
function propose(db, ctx, tool, { title, body, clientId = null, leadId = null, payload, category = 'task', phone = null, message = null, link = null }) {
  const res = upsertAction(db, {
    kind: `agent_${tool}`,
    category,
    dedupeKey: `agent:${tool}:${ctx.conversationId || 'na'}:${ctx.toolUseId}`,
    title,
    body,
    clientId,
    leadId,
    phone,
    message,
    link,
    payload,
    priority: 'medium',
    source: 'agent',
  });
  return { proposal_id: res.id, status: 'awaiting_approval', note: 'Netanel approves this in the Inbox; nothing was changed yet.' };
}

// ── Read tools ───────────────────────────────────────────────────────────────

const READ = {
  search_entities: {
    description: 'Find clients and leads by name or phone. Use this first to get ids.',
    schema: z.object({
      query: z.string().min(1),
      types: z.array(z.enum(['client', 'lead'])).optional(),
    }),
    run: (db, { query, types }) => {
      const want = new Set(types?.length ? types : ['client', 'lead']);
      const q = `%${query.trim()}%`;
      const digits = query.replace(/\D/g, '');
      const phoneQ = digits.length >= 4 ? `%${digits.slice(-7)}%` : '__no_phone__';
      const out = [];
      if (want.has('client')) {
        out.push(...db.prepare(`
          SELECT id, full_name, phone, status, start_date FROM clients
          WHERE full_name LIKE ? OR REPLACE(REPLACE(phone, '-', ''), ' ', '') LIKE ? LIMIT 20
        `).all(q, phoneQ).map((c) => ({ type: 'client', ...c })));
      }
      if (want.has('lead')) {
        out.push(...db.prepare(`
          SELECT id, full_name, phone, status, source FROM leads
          WHERE full_name LIKE ? OR REPLACE(REPLACE(phone, '-', ''), ' ', '') LIKE ? LIMIT 20
        `).all(q, phoneQ).map((l) => ({ type: 'lead', ...l })));
      }
      return { results: out };
    },
  },

  get_client_snapshot: {
    description: 'Everything current about one client: profile, process, sessions, alerts, payments, menu, protocol, weights, upcoming meetings, open inbox items.',
    schema: z.object({ client_id: id() }),
    run: (db, { client_id }) => {
      const c = requireRow(db, 'clients', client_id, 'Client');
      const sessions = db.prepare('SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number').all(client_id);
      const windows = db.prepare('SELECT * FROM session_windows WHERE client_id = ? ORDER BY session_number').all(client_id);
      const alerts = computeClientAlerts(c, windows, sessions, { hasUpcomingMeeting: hasUpcomingMeeting(db, client_id) });
      const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE client_id = ?').get(client_id).t;
      const protocol = c.protocol_id ? db.prepare('SELECT id, name FROM protocols WHERE id = ?').get(c.protocol_id) : null;
      const menu = db.prepare('SELECT id, title, calorie_target, status, created_at FROM menus WHERE client_id = ? ORDER BY id DESC LIMIT 1').get(client_id);
      const weights = db.prepare('SELECT weigh_date, weight FROM weight_logs WHERE client_id = ? ORDER BY weigh_date DESC LIMIT 6').all(client_id);
      const meetings = db.prepare("SELECT id, event_type, start_time FROM meetings WHERE client_id = ? AND status = 'active' AND start_time > ? ORDER BY start_time LIMIT 5").all(client_id, nowUtcISO());
      const openItems = db.prepare("SELECT kind, title FROM action_queue WHERE client_id = ? AND status = 'pending' LIMIT 10").all(client_id);
      return {
        client: {
          id: c.id, full_name: c.full_name, phone: c.phone, age: c.age, gender: c.gender, goal: c.goal,
          medical_notes: c.medical_notes, status: c.status, start_date: c.start_date, process_end_date: c.process_end_date,
          initial_weight: c.initial_weight, menu_sent: !!c.menu_sent, payment_status: c.payment_status,
          package_price: c.package_price, total_paid: paid, frozen_until: c.frozen_until,
        },
        protocol,
        sessions: sessions.map((s) => ({
          id: s.id, number: s.session_number, date: s.session_date, status: s.status, weight: s.weight,
          highlights: clip(s.highlights, 400),
        })),
        overdue_windows: alerts.windowAlerts.filter((w) => w.state === 'red' || w.state === 'yellow'),
        alerts: { menu_not_sent: alerts.menuAlert, ending_soon: alerts.endingSoonAlert, process_ended: alerts.processEndedAlert },
        latest_menu: menu || null,
        recent_weights: weights,
        upcoming_meetings: meetings.map((m) => ({ id: m.id, type: m.event_type, at: fmtInstant(m.start_time) })),
        open_inbox_items: openItems,
      };
    },
  },

  get_client_timeline: {
    description: 'Chronological history of a client: sessions, meetings, WhatsApp messages, weights and system events (newest first).',
    schema: z.object({ client_id: id(), limit: z.number().int().positive().optional() }),
    run: (db, { client_id, limit = 30 }) => {
      requireRow(db, 'clients', client_id, 'Client');
      const items = [];
      for (const s of db.prepare('SELECT * FROM sessions WHERE client_id = ?').all(client_id)) {
        items.push({ at: s.session_date, kind: 'session', text: `פגישה ${s.session_number} (${s.status}): ${clip(s.highlights, 200) || ''}` });
      }
      for (const m of db.prepare('SELECT * FROM meetings WHERE client_id = ?').all(client_id)) {
        items.push({ at: israelDateOf(m.start_time), kind: 'meeting', text: `${m.event_type} ${fmtInstant(m.start_time)} (${m.status})` });
      }
      for (const w of db.prepare('SELECT * FROM whatsapp_log WHERE client_id = ?').all(client_id)) {
        items.push({ at: israelDateOf(w.sent_at), kind: `whatsapp_${w.direction || 'outgoing'}`, text: clip(w.rendered_message, 200) });
      }
      for (const w of db.prepare('SELECT * FROM weight_logs WHERE client_id = ?').all(client_id)) {
        items.push({ at: w.weigh_date, kind: 'weight', text: `${w.weight} ק"ג` });
      }
      for (const e of db.prepare("SELECT * FROM domain_events WHERE entity_type = 'client' AND entity_id = ?").all(String(client_id))) {
        items.push({ at: israelDateOf(e.created_at), kind: 'event', text: e.type });
      }
      items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      return { timeline: items.slice(0, limit) };
    },
  },

  get_stale_leads: {
    description: 'Leads with no status change for N days (default 5), excluding converted / not relevant.',
    schema: z.object({ days: z.number().int().positive().optional() }),
    run: (db, { days = 5 }) => {
      const before = new Date(Date.now() - days * 864e5).toISOString();
      const terminal = new Set([LEAD_STATUS.BECAME_CLIENT, LEAD_STATUS.NOT_RELEVANT]);
      const leads = db.prepare('SELECT * FROM leads').all().filter((l) => {
        if (terminal.has(l.status)) return false;
        const last = l.status_updated_at || l.created_at;
        const iso = String(last).includes('T') ? String(last) : `${String(last).replace(' ', 'T')}Z`;
        return iso < before;
      });
      return {
        leads: leads.slice(0, 30).map((l) => ({
          id: l.id, full_name: l.full_name, phone: l.phone, status: l.status,
          last_change: israelDateOf(l.status_updated_at || l.created_at), notes: clip(l.notes, 200),
        })),
      };
    },
  },

  get_schedule: {
    description: 'Meetings (Israel time) and expected session windows between two dates. Defaults: today to 7 days ahead.',
    schema: z.object({ from: isoDate().optional(), to: isoDate().optional() }),
    run: (db, { from, to }) => {
      const start = from || todayISO();
      const end = to || toISODate(addDays(parseDate(start), 7));
      const rows = db.prepare(`
        SELECT m.*, COALESCE(c.full_name, l.full_name, m.invitee_name) AS person
        FROM meetings m LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN leads l ON l.id = m.lead_id
        WHERE m.status = 'active' AND m.start_time >= ? AND m.start_time < ? ORDER BY m.start_time
      `).all(israelLocalToUtcISO(start, '00:00'), israelLocalToUtcISO(toISODate(addDays(parseDate(end), 1)), '00:00'));
      const windows = db.prepare(`
        SELECT w.client_id, c.full_name, w.session_number, w.expected_date
        FROM session_windows w JOIN clients c ON c.id = w.client_id
        LEFT JOIN sessions s ON s.client_id = w.client_id AND s.session_number = w.session_number
        WHERE c.status IN ('active', 'ending_soon') AND s.id IS NULL AND w.expected_date BETWEEN ? AND ?
        ORDER BY w.expected_date
      `).all(start, end);
      return {
        meetings: rows.map((m) => ({
          id: m.id, at: fmtInstant(m.start_time), type: m.event_type, person: m.person,
          client_id: m.client_id, lead_id: m.lead_id, confirmation_sent: !!m.confirmation_sent,
        })),
        unbooked_session_windows: windows,
      };
    },
  },

  get_inbox: {
    description: 'Open Inbox items (pending actions), most urgent first.',
    schema: z.object({ kind: z.string().optional(), limit: z.number().int().positive().optional() }),
    run: (db, { kind, limit = 30 }) => ({
      items: listActions(db).filter((i) => !kind || i.kind === kind).slice(0, limit).map((i) => ({
        id: i.id, kind: i.kind, priority: i.priority, title: i.title, body: clip(i.body, 200),
        client_id: i.client_id, lead_id: i.lead_id, due: israelDateOf(i.due_at),
      })),
    }),
  },

  search_food_bank: {
    description: 'Search the food database (Hebrew name) for portions, calories and protein per portion.',
    schema: z.object({ query: z.string().min(1), limit: z.number().int().positive().optional() }),
    run: (db, { query, limit = 15 }) => ({
      foods: db.prepare(`
        SELECT f.id, f.name_he, f.portion_description, f.portion_grams, f.calories_per_half_portion,
               f.protein_grams, c.name_he AS category
        FROM food_items f LEFT JOIN food_categories c ON c.id = f.category_id
        WHERE f.name_he LIKE ? AND COALESCE(f.is_active, 1) = 1 LIMIT ?
      `).all(`%${query.trim()}%`, limit),
    }),
  },

  get_protocol: {
    description: 'Read one protocol by id, or list active protocols (id + name) when no id is given.',
    schema: z.object({ protocol_id: id().optional() }),
    run: (db, { protocol_id }) => {
      if (!protocol_id) {
        return { protocols: db.prepare('SELECT id, name, description FROM protocols WHERE is_active = 1 ORDER BY name').all() };
      }
      const p = requireRow(db, 'protocols', protocol_id, 'Protocol');
      return { protocol: { id: p.id, name: p.name, description: p.description, highlights: JSON.parse(p.highlights || '[]'), default_tasks: JSON.parse(p.default_tasks || '[]') } };
    },
  },

  recall_memory: {
    description: 'Search long-term clinical memory (session progress, menu insights, anamnesis notes) for a client or by text.',
    schema: z.object({
      client_id: id().optional(),
      query: z.string().optional(),
      memory_type: z.enum(['anamnesis_summary', 'menu_insight', 'conversation', 'progress', 'protocol_note']).optional(),
      limit: z.number().int().positive().optional(),
    }),
    run: (db, { client_id, query, memory_type, limit = 15 }) => {
      const where = []; const args = [];
      if (client_id) { where.push('client_id = ?'); args.push(client_id); }
      if (memory_type) { where.push('memory_type = ?'); args.push(memory_type); }
      if (query) { where.push('content LIKE ?'); args.push(`%${query}%`); }
      const rows = db.prepare(`
        SELECT id, client_id, memory_type, content, created_at FROM ai_memory
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?
      `).all(...args, limit);
      return { memories: rows.map((r) => ({ ...r, content: clip(r.content, 500) })) };
    },
  },
};

// ── Proposal tools (write → Inbox approval) ──────────────────────────────────

const PROPOSE = {
  convert_lead_to_client: {
    description: 'Propose converting a lead into a client (creates client, session 1, windows). Requires approval.',
    schema: z.object({ lead_id: id(), reason: reason() }),
    run: (db, input, ctx) => {
      const lead = requireRow(db, 'leads', input.lead_id, 'Lead');
      return propose(db, ctx, 'convert_lead_to_client', {
        title: `המרת ליד למטופל: ${lead.full_name}`, body: input.reason, leadId: lead.id, payload: input,
      });
    },
  },

  update_lead_status: {
    description: 'Propose changing a lead status. Requires approval.',
    schema: z.object({
      lead_id: id(),
      status: z.enum(['new', 'contacted', 'meeting_scheduled', 'meeting_held', 'became_client', 'not_relevant']),
      note: z.string().optional(),
      reason: reason(),
    }),
    run: (db, input, ctx) => {
      const lead = requireRow(db, 'leads', input.lead_id, 'Lead');
      return propose(db, ctx, 'update_lead_status', {
        title: `עדכון סטטוס ליד: ${lead.full_name} ← ${input.status}`, body: input.reason, leadId: lead.id, payload: input,
      });
    },
  },

  schedule_meeting: {
    description: 'Propose a meeting for a lead or client (Israel date/time). On approval it is added to Google Calendar. Requires approval.',
    schema: z.object({
      lead_id: id().optional(), client_id: id().optional(),
      date: isoDate(), time: hhmm(),
      event_type: z.enum(['first_meeting', 'follow_up', 'consultation']),
      notes: z.string().optional(), reason: reason(),
    }),
    run: (db, input, ctx) => {
      if (!input.lead_id && !input.client_id) throw new Error('lead_id or client_id is required.');
      const person = input.client_id ? requireRow(db, 'clients', input.client_id, 'Client') : requireRow(db, 'leads', input.lead_id, 'Lead');
      if (!israelLocalToUtcISO(input.date, input.time)) throw new Error('Invalid date or time.');
      return propose(db, ctx, 'schedule_meeting', {
        title: `קביעת פגישה: ${person.full_name}, ${input.date} ${input.time}`, body: input.reason,
        clientId: input.client_id || null, leadId: input.client_id ? null : input.lead_id, payload: input,
      });
    },
  },

  draft_whatsapp_message: {
    description: 'Draft a WhatsApp message to a client or lead (follow prompts/voice.md). Sent only when Netanel approves it.',
    schema: z.object({ client_id: id().optional(), lead_id: id().optional(), message: z.string().min(1), reason: reason() }),
    run: (db, input, ctx) => {
      if (!input.client_id && !input.lead_id) throw new Error('client_id or lead_id is required.');
      const person = input.client_id ? requireRow(db, 'clients', input.client_id, 'Client') : requireRow(db, 'leads', input.lead_id, 'Lead');
      if (!person.phone) throw new Error(`${person.full_name} has no phone number.`);
      return propose(db, ctx, 'draft_whatsapp', {
        title: `הודעת WhatsApp ל${person.full_name}`, body: input.reason, category: 'message',
        clientId: input.client_id || null, leadId: input.client_id ? null : input.lead_id,
        phone: person.phone, message: input.message, payload: input,
      });
    },
  },

  schedule_followup: {
    description: 'Propose a follow-up task on a given date (added to the daily task board on approval).',
    schema: z.object({ client_id: id().optional(), lead_id: id().optional(), due_date: isoDate(), title: z.string().min(1), reason: reason() }),
    run: (db, input, ctx) => {
      if (input.client_id) requireRow(db, 'clients', input.client_id, 'Client');
      if (input.lead_id) requireRow(db, 'leads', input.lead_id, 'Lead');
      return propose(db, ctx, 'schedule_followup', {
        title: `מעקב ב-${input.due_date}: ${input.title}`, body: input.reason,
        clientId: input.client_id || null, leadId: input.lead_id || null, payload: input,
      });
    },
  },

  log_session_notes: {
    description: 'Propose adding notes, weight or tasks to a session. Requires approval.',
    schema: z.object({
      session_id: id(), highlights: z.string().optional(), weight: z.number().positive().optional(),
      tasks: z.array(z.string()).optional(), reason: reason(),
    }),
    run: (db, input, ctx) => {
      const s = requireRow(db, 'sessions', input.session_id, 'Session');
      const c = requireRow(db, 'clients', s.client_id, 'Client');
      return propose(db, ctx, 'log_session_notes', {
        title: `תיעוד פגישה ${s.session_number}: ${c.full_name}`, body: input.reason, clientId: c.id, payload: input,
      });
    },
  },

  assign_protocol: {
    description: 'Propose assigning a protocol to a client. Requires approval.',
    schema: z.object({ client_id: id(), protocol_id: id(), reason: reason() }),
    run: (db, input, ctx) => {
      const c = requireRow(db, 'clients', input.client_id, 'Client');
      const p = requireRow(db, 'protocols', input.protocol_id, 'Protocol');
      return propose(db, ctx, 'assign_protocol', {
        title: `שיוך פרוטוקול "${p.name}" ל${c.full_name}`, body: input.reason, clientId: c.id, payload: input,
      });
    },
  },

  create_menu_draft: {
    description: 'Propose creating a menu draft for a client (opens in the menu editor after approval).',
    schema: z.object({ client_id: id(), title: z.string().min(1), calorie_target: z.number().int().positive(), notes: z.string().optional(), reason: reason() }),
    run: (db, input, ctx) => {
      const c = requireRow(db, 'clients', input.client_id, 'Client');
      return propose(db, ctx, 'create_menu_draft', {
        title: `טיוטת תפריט ${input.calorie_target} קק"ל: ${c.full_name}`, body: input.reason, clientId: c.id, payload: input,
      });
    },
  },

  record_payment: {
    description: 'Propose recording a payment received from a client. Requires approval.',
    schema: z.object({ client_id: id(), amount: z.number().positive(), paid_at: isoDate(), note: z.string().optional(), reason: reason() }),
    run: (db, input, ctx) => {
      const c = requireRow(db, 'clients', input.client_id, 'Client');
      return propose(db, ctx, 'record_payment', {
        title: `רישום תשלום ${input.amount} ₪: ${c.full_name}`, body: input.reason, clientId: c.id, payload: input,
      });
    },
  },
};

// ── Autonomous write (decision #3: weight logging) ───────────────────────────

const AUTO = {
  update_weight: {
    description: 'Record a client weigh-in directly (autonomous, audit-logged). Use the date the client weighed in.',
    schema: z.object({ client_id: id(), weight: z.number().positive(), date: isoDate() }),
    run: (db, { client_id, weight, date }, ctx) => {
      requireRow(db, 'clients', client_id, 'Client');
      if (weight < 25 || weight > 350) throw new Error(`Weight ${weight} kg is outside the plausible range; ask Netanel to confirm.`);
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      const dayOfWeek = day === 1 ? 'monday' : day === 4 ? 'thursday' : null;
      db.prepare(`
        INSERT INTO weight_logs (client_id, weigh_date, weight, day_of_week) VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id, weigh_date) DO UPDATE SET weight = excluded.weight
      `).run(client_id, date, weight, dayOfWeek);
      publish(db, 'weight.logged', { entityType: 'client', entityId: client_id, payload: { weight, date, by: 'agent', user: ctx.userName } });
      return { saved: true, client_id, weight, date };
    },
  },
};

const REGISTRY = {};
for (const [name, t] of Object.entries(READ))    REGISTRY[name] = { ...t, name, kind: 'read' };
for (const [name, t] of Object.entries(PROPOSE)) REGISTRY[name] = { ...t, name, kind: 'propose' };
for (const [name, t] of Object.entries(AUTO))    REGISTRY[name] = { ...t, name, kind: 'auto' };

/** Tool definitions for the API — deterministic order (prompt-cache friendly). */
function toolDefinitions() {
  return Object.values(REGISTRY).map((t) => {
    const { $schema, ...inputSchema } = z.toJSONSchema(t.schema); // eslint-disable-line no-unused-vars
    const prefix = t.kind === 'read' ? '[read] ' : t.kind === 'propose' ? '[proposal: needs approval] ' : '[autonomous write] ';
    return { name: t.name, description: prefix + t.description, input_schema: inputSchema };
  });
}

/**
 * Validate + run one tool call; always resolves (errors become is_error results).
 * @returns {{ output: object, isError: boolean, kind: string }}
 */
function executeTool(db, name, rawInput, ctx) {
  const tool = REGISTRY[name];
  if (!tool) return { output: { error: `Unknown tool ${name}` }, isError: true, kind: 'unknown' };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  let result;
  if (!parsed.success) {
    result = { output: { error: 'Invalid input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, isError: true, kind: tool.kind };
  } else {
    try {
      result = { output: tool.run(db, parsed.data, ctx), isError: false, kind: tool.kind };
    } catch (err) {
      result = { output: { error: err.message }, isError: true, kind: tool.kind };
    }
  }
  try {
    db.prepare(`
      INSERT INTO agent_tool_log (conversation_id, user_name, tool_name, kind, input, output, is_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ctx.conversationId || null, ctx.userName || null, name, tool.kind, JSON.stringify(rawInput ?? {}),
           JSON.stringify(result.output).slice(0, 20000), result.isError ? 1 : 0, nowUtcISO());
  } catch (err) {
    console.error('[agent] tool log failed:', err.message);
  }
  return result;
}

module.exports = { REGISTRY, toolDefinitions, executeTool };
