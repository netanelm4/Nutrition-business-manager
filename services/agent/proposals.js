const { v4: uuidv4 } = require('uuid');
const { registerApprovalHandler } = require('../action-queue.service');
const { convertLeadToClient } = require('../client-lifecycle.service');
const { createManualMeeting } = require('../meeting.service');
const { publish } = require('../event-bus.service');
const { SESSION_STATUS, LEAD_STATUS } = require('../../constants/statuses');
const { todayISO, nowUtcISO, israelDateOf } = require('../../utils/dates');

// ─── Agent proposals: what runs when Netanel approves one in the Inbox ────────
// The agent never writes these directly — its tools create an action_queue item
// (kind "agent_<tool>") holding the input as payload. Approving the item runs
// the matching executor below. agent_draft_whatsapp needs no executor: approving
// a message item sends it through the normal Inbox send path.

function syncPaymentStatus(clientId) {
  // routes/payments.routes.js owns the rule; required lazily (route module)
  return require('../../routes/payments.routes').syncPaymentStatus(clientId);
}

const EXECUTORS = {
  agent_convert_lead_to_client: async (db, item, p) => {
    const r = convertLeadToClient(db, p.lead_id);
    return { clientId: r.clientId, alreadyConverted: r.alreadyConverted };
  },

  agent_update_lead_status: async (db, item, p) => {
    if (p.status === LEAD_STATUS.BECAME_CLIENT) {
      return { clientId: convertLeadToClient(db, p.lead_id).clientId };
    }
    const lead = db.prepare('SELECT id, notes FROM leads WHERE id = ?').get(p.lead_id);
    if (!lead) throw new Error('Lead not found.');
    const notes = p.note ? [lead.notes, `${todayISO()}: ${p.note}`].filter(Boolean).join('\n') : lead.notes;
    db.prepare('UPDATE leads SET status = ?, status_updated_at = ?, notes = ? WHERE id = ?')
      .run(p.status, nowUtcISO(), notes, p.lead_id);
    publish(db, 'lead.status_changed', { entityType: 'lead', entityId: p.lead_id, payload: { to: p.status, by: 'agent_proposal' } });
    return { leadId: p.lead_id, status: p.status };
  },

  agent_schedule_meeting: async (db, item, p) => createManualMeeting(db, {
    leadId: p.lead_id || null, clientId: p.client_id || null,
    date: p.date, time: p.time, eventType: p.event_type, notes: p.notes || null,
  }),

  agent_schedule_followup: async (db, item, p) => {
    const res = db.prepare(`
      INSERT INTO daily_tasks (text, source, quadrant, client_id, date) VALUES (?, 'agent', 2, ?, ?)
    `).run(p.title, p.client_id || null, p.due_date);
    return { dailyTaskId: res.lastInsertRowid };
  },

  agent_log_session_notes: async (db, item, p) => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(p.session_id);
    if (!s) throw new Error('Session not found.');
    const highlights = p.highlights
      ? [s.highlights, p.highlights].filter((x) => x && String(x).trim()).join('\n')
      : s.highlights;
    let tasks = [];
    try { tasks = JSON.parse(s.tasks || '[]'); } catch { tasks = []; }
    for (const text of p.tasks || []) tasks.push({ id: uuidv4(), text, status: 'pending', carried_over_from_session: null });
    const weight = p.weight ?? s.weight;
    // Notes on a booked session whose day has come confirm it took place
    const status = s.status === SESSION_STATUS.SCHEDULED && (p.highlights || p.weight != null)
      && s.session_date && israelDateOf(s.session_date) <= todayISO()
      ? SESSION_STATUS.HELD : s.status;
    db.prepare('UPDATE sessions SET highlights = ?, weight = ?, tasks = ?, status = ? WHERE id = ?')
      .run(highlights, weight, JSON.stringify(tasks), status, s.id);
    publish(db, 'session.notes_logged', { entityType: 'session', entityId: s.id, payload: { by: 'agent_proposal' } });
    return { sessionId: s.id, status };
  },

  agent_assign_protocol: async (db, item, p) => {
    const protocol = db.prepare('SELECT id FROM protocols WHERE id = ?').get(p.protocol_id);
    if (!protocol) throw new Error('Protocol not found.');
    db.prepare('UPDATE clients SET protocol_id = ? WHERE id = ?').run(p.protocol_id, p.client_id);
    publish(db, 'client.protocol_assigned', { entityType: 'client', entityId: p.client_id, payload: { protocolId: p.protocol_id } });
    return { clientId: p.client_id, protocolId: p.protocol_id };
  },

  agent_create_menu_draft: async (db, item, p) => {
    const engagementId = db.prepare(
      "SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1"
    ).get(p.client_id)?.id ?? null;
    const res = db.prepare(`
      INSERT INTO menus (client_id, engagement_id, title, calorie_target, notes) VALUES (?, ?, ?, ?, ?)
    `).run(p.client_id, engagementId, p.title, p.calorie_target, p.notes || null);
    db.prepare('UPDATE action_queue SET link = ? WHERE id = ?').run(`/clients/${p.client_id}/menus/${res.lastInsertRowid}`, item.id);
    return { menuId: res.lastInsertRowid };
  },

  agent_record_payment: async (db, item, p) => {
    const engagementId = db.prepare(
      "SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1"
    ).get(p.client_id)?.id ?? null;
    const res = db.prepare('INSERT INTO payments (client_id, amount, paid_at, note, engagement_id) VALUES (?, ?, ?, ?, ?)')
      .run(p.client_id, p.amount, p.paid_at, p.note || null, engagementId);
    const status = syncPaymentStatus(p.client_id);
    return { paymentId: res.lastInsertRowid, paymentStatus: status?.status };
  },
};

for (const [kind, fn] of Object.entries(EXECUTORS)) registerApprovalHandler(kind, fn);

module.exports = { EXECUTORS };
