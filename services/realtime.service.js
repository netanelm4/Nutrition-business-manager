// ─── Server-Sent Events broadcaster ──────────────────────────────────────────
// GET /api/stream keeps one response open per browser tab. Any server-side
// change (a mutation, a calendar sync, a job) is pushed as an SSE message so the
// client invalidates exactly the affected TanStack queries instead of polling.
// Single Railway instance → an in-process Set of open responses is enough.

const HEARTBEAT_MS = 25_000; // keeps proxies from closing idle connections

const clients = new Set();

function addClient(req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const client = { res, user: req.user?.name || null };
  clients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

/**
 * Push an event to every connected tab.
 * @param {string} type        e.g. 'mutation', 'meeting.canceled', 'inbox.changed'
 * @param {object} data        JSON-serializable payload; `invalidate` = query-key roots
 */
function broadcast(type, data = {}) {
  if (clients.size === 0) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.res.write(frame); } catch { clients.delete(client); }
  }
}

function connectedCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, connectedCount };
