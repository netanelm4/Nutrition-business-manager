const { nowUtcISO } = require('../utils/dates');
const { generateLink } = require('./whatsapp.service');
const { publish } = require('./event-bus.service');

// ─── Action queue (the Inbox) ────────────────────────────────────────────────
// One row per thing the nutritionist should act on. Every producer (rules
// reconciler, jobs, AI analysis, WhatsApp bot) goes through upsertAction() with a
// deterministic dedupe_key, so re-running a producer never duplicates an item,
// and an item that was already handled (sent / done / dismissed) never returns.
// Client-facing messages are only sent on explicit approval (approveAction).

const OPEN = 'pending';
const PRIORITY_RANK = { urgent: 0, medium: 1, low: 2 };

/**
 * Create or refresh an inbox item.
 * @param {object} item
 *   kind, dedupeKey, title, [body], [category 'task'|'message'], [clientId], [leadId],
 *   [meetingId], [phone], [message], [link], [priority], [dueAt], [source],
 *   [supersedePrefix] — pending items whose key starts with it (other than this
 *   one) are closed as superseded (e.g. last week's check-in for the same client)
 * @returns {{ id, created?: true, updated?: true, skipped?: true }}
 */
function upsertAction(database, item) {
  const now = nowUtcISO();
  const existing = database.prepare('SELECT * FROM action_queue WHERE dedupe_key = ?').get(item.dedupeKey);

  if (item.supersedePrefix) {
    const superseded = database.prepare(`
      UPDATE action_queue SET status = 'done', resolved_at = ?, resolved_by = 'superseded', updated_at = ?
      WHERE status = 'pending' AND dedupe_key LIKE ? AND dedupe_key != ?
    `).run(now, now, `${item.supersedePrefix}%`, item.dedupeKey);
    if (superseded.changes) publish(null, 'inbox.changed');
  }

  const values = {
    kind: item.kind,
    category: item.category || (item.message ? 'message' : 'task'),
    title: item.title,
    body: item.body || null,
    client_id: item.clientId || null,
    lead_id: item.leadId || null,
    meeting_id: item.meetingId || null,
    phone: item.phone || null,
    message: item.message || null,
    link: item.link || (item.clientId ? `/clients/${item.clientId}` : item.leadId ? `/leads/${item.leadId}` : null),
    priority: item.priority || 'medium',
    due_at: item.dueAt || now,
    source: item.source || 'rule',
    dedupe_key: item.dedupeKey,
    payload: item.payload ? JSON.stringify(item.payload) : null,
  };

  if (!existing) {
    const res = database.prepare(`
      INSERT INTO action_queue
        (kind, category, title, body, client_id, lead_id, meeting_id, phone, message, link,
         priority, status, due_at, source, dedupe_key, payload, created_at, updated_at)
      VALUES
        (@kind, @category, @title, @body, @client_id, @lead_id, @meeting_id, @phone, @message, @link,
         @priority, 'pending', @due_at, @source, @dedupe_key, @payload, @now, @now)
    `).run({ ...values, now });
    publish(database, 'inbox.created', { entityType: 'action', entityId: res.lastInsertRowid, payload: { kind: item.kind, dedupeKey: item.dedupeKey } });
    return { id: res.lastInsertRowid, created: true };
  }

  if (existing.status !== OPEN) return { id: existing.id, skipped: true }; // handled — never resurrect

  const changed = ['title', 'body', 'message', 'phone', 'priority', 'due_at', 'link']
    .some((k) => (existing[k] ?? null) !== (values[k] ?? null));
  if (changed) {
    database.prepare(`
      UPDATE action_queue
      SET title = @title, body = @body, message = @message, phone = @phone,
          priority = @priority, due_at = @due_at, link = @link, updated_at = @now
      WHERE id = @id
    `).run({ ...values, now, id: existing.id });
    publish(null, 'inbox.changed');
  }
  return { id: existing.id, updated: changed };
}

/** Close one pending item (condition gone, or handled elsewhere). */
function resolveAction(database, dedupeKey, status = 'done', by = 'system') {
  const now = nowUtcISO();
  const res = database.prepare(`
    UPDATE action_queue SET status = ?, resolved_at = ?, resolved_by = ?, updated_at = ?
    WHERE dedupe_key = ? AND status = 'pending'
  `).run(status, now, by, now, dedupeKey);
  if (res.changes) publish(null, 'inbox.changed');
  return res.changes;
}

/**
 * Reconciler helper: close pending items of `kind` whose key is not in
 * `activeKeys` — their condition no longer holds.
 */
function resolveStale(database, kind, activeKeys) {
  const pending = database.prepare("SELECT id, dedupe_key FROM action_queue WHERE kind = ? AND status = 'pending'").all(kind);
  const now = nowUtcISO();
  let closed = 0;
  for (const row of pending) {
    if (activeKeys.has(row.dedupe_key)) continue;
    database.prepare(`
      UPDATE action_queue SET status = 'done', resolved_at = ?, resolved_by = 'auto_resolved', updated_at = ?
      WHERE id = ?
    `).run(now, now, row.id);
    closed++;
  }
  if (closed) publish(null, 'inbox.changed');
  return closed;
}

function withLinks(row) {
  if (!row) return row;
  return {
    ...row,
    whatsapp_link: row.category === 'message' && row.phone && row.message
      ? generateLink(row.phone, row.message) : null,
  };
}

/** Open items (pending, not snoozed), most urgent and earliest first. */
function listActions(database, { limit = 200 } = {}) {
  const now = nowUtcISO();
  const rows = database.prepare(`
    SELECT a.*, COALESCE(c.full_name, l.full_name) AS person_name
    FROM action_queue a
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN leads   l ON l.id = a.lead_id
    WHERE a.status = 'pending' AND (a.snoozed_until IS NULL OR a.snoozed_until <= ?)
    LIMIT ?
  `).all(now, limit);
  rows.sort((a, b) =>
    (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0));
  return rows.map(withLinks);
}

function countOpen(database) {
  return database.prepare(
    "SELECT COUNT(*) AS n FROM action_queue WHERE status = 'pending' AND (snoozed_until IS NULL OR snoozed_until <= ?)"
  ).get(nowUtcISO()).n;
}

// Actions that run when an item of a given kind is approved (agent proposals
// register theirs from services/agent/proposals.js). A handler that throws
// leaves the item pending with the error, so nothing is marked done unless it
// actually happened.
const APPROVAL_HANDLERS = {};
function registerApprovalHandler(kind, handler) {
  APPROVAL_HANDLERS[kind] = handler;
}

// Side effects of approving specific kinds
const ON_APPROVED = {
  meeting_reminder: (database, item) => {
    if (item.meeting_id) {
      database.prepare('UPDATE meetings SET confirmation_sent = 1 WHERE id = ?').run(item.meeting_id);
    }
  },
};

function logOutgoing(database, item, status) {
  if (!item.client_id) return; // whatsapp_log requires a client
  database.prepare(`
    INSERT INTO whatsapp_log (client_id, rendered_message, direction, message_type, status)
    VALUES (?, ?, 'outgoing', ?, ?)
  `).run(item.client_id, item.message, item.kind, status);
}

function markResolved(database, item, status, by) {
  const now = nowUtcISO();
  database.prepare(`
    UPDATE action_queue SET status = ?, resolved_at = ?, resolved_by = ?, send_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(status, now, by, now, item.id);
  ON_APPROVED[item.kind]?.(database, item);
  publish(database, `inbox.${status}`, { entityType: 'action', entityId: item.id, payload: { kind: item.kind } });
}

/**
 * Approve an item.
 *   task    → done
 *   message → sent by the Cloud API when auto-send is available; otherwise (or
 *             if the API rejects it) the response carries a wa.me link for the
 *             nutritionist to send manually, and the item is marked sent.
 * @returns {{ id, status, delivered: 'api'|'manual'|null, whatsapp_link?, error? }}
 */
async function approveAction(database, id, by = 'user') {
  const item = database.prepare('SELECT * FROM action_queue WHERE id = ?').get(id);
  if (!item) { const e = new Error('Inbox item not found.'); e.status = 404; throw e; }
  if (item.status !== OPEN) return { id, status: item.status, delivered: null };

  let executed = null;
  const handler = APPROVAL_HANDLERS[item.kind];
  if (handler) {
    try {
      executed = await handler(database, item, item.payload ? JSON.parse(item.payload) : {});
    } catch (err) {
      database.prepare('UPDATE action_queue SET send_error = ?, updated_at = ? WHERE id = ?')
        .run(err.message, nowUtcISO(), id);
      publish(null, 'inbox.changed');
      return { id, status: 'pending', delivered: null, error: err.message };
    }
  }

  if (item.category !== 'message' || !item.message || !item.phone) {
    markResolved(database, item, 'done', by);
    return { id, status: 'done', delivered: null, result: executed };
  }

  const link = generateLink(item.phone, item.message);
  logOutgoing(database, item, 'manual');
  markResolved(database, item, 'sent', by);
  return { id, status: 'sent', delivered: 'manual', whatsapp_link: link };
}

function dismissAction(database, id, by = 'user') {
  const item = database.prepare("SELECT * FROM action_queue WHERE id = ? AND status = 'pending'").get(id);
  if (!item) return false;
  markResolved(database, item, 'dismissed', by);
  return true;
}

function snoozeAction(database, id, untilIso) {
  const res = database.prepare("UPDATE action_queue SET snoozed_until = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(untilIso, nowUtcISO(), id);
  if (res.changes) publish(null, 'inbox.changed');
  return res.changes > 0;
}

module.exports = {
  registerApprovalHandler,
  upsertAction,
  resolveAction,
  resolveStale,
  listActions,
  countOpen,
  approveAction,
  dismissAction,
  snoozeAction,
};
