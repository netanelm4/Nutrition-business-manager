const { EventEmitter } = require('events');
const { broadcast } = require('./realtime.service');
const { nowUtcISO } = require('../utils/dates');

// ─── Domain event bus ────────────────────────────────────────────────────────
// publish() does three things:
//   1. appends the event to domain_events (audit trail / future agent context)
//   2. notifies in-process subscribers (bus.on(type, handler))
//   3. pushes it over SSE so open tabs refresh the affected queries
// Takes the db handle as a parameter (no require of db.js) so it can be used
// from anywhere, including services loaded by db.js itself.

const bus = new EventEmitter();
bus.setMaxListeners(50);

// Query-key roots each event family invalidates in the client
const INVALIDATE = {
  lead:    ['leads', 'lead', 'dashboard', 'inbox'],
  client:  ['clients', 'client', 'dashboard', 'inbox'],
  session: ['sessions', 'recordings', 'client', 'clients', 'dashboard', 'inbox'],
  meeting: ['upcomingMeetings', 'client-meetings', 'lead-meeting', 'dashboard', 'sessions', 'client', 'inbox'],
  menu:    ['menus', 'client', 'dashboard', 'inbox'],
  inbox:   ['inbox', 'dashboard'],
  reminder:['upcomingMeetings', 'inbox', 'dashboard'],
};

/**
 * @param {Database} database   better-sqlite3 handle (null → skip persistence)
 * @param {string}   type       "<family>.<verb>", e.g. "meeting.canceled"
 * @param {object}   [opts]     { entityType, entityId, payload }
 */
function publish(database, type, { entityType = null, entityId = null, payload = null } = {}) {
  const at = nowUtcISO();
  if (database) {
    try {
      database.prepare(`
        INSERT INTO domain_events (type, entity_type, entity_id, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(type, entityType, entityId === null ? null : String(entityId),
             payload ? JSON.stringify(payload) : null, at);
    } catch (err) {
      console.error(`[event-bus] persist ${type} failed:`, err.message);
    }
  }
  const family = type.split('.')[0];
  const event = { type, entityType, entityId, payload, at, invalidate: INVALIDATE[family] || ['dashboard'] };
  try { bus.emit(type, event); bus.emit('*', event); } catch (err) {
    console.error(`[event-bus] subscriber error on ${type}:`, err.message);
  }
  broadcast('domain', event);
  return event;
}

module.exports = { bus, publish, INVALIDATE };
