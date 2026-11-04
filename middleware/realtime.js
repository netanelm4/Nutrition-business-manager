const { addClient, broadcast } = require('../services/realtime.service');

// GET /api/stream — Server-Sent Events. Mounted after requireAuth: the client
// reads it with fetch() + a stream reader so the session token travels in the
// Authorization header (EventSource cannot send headers, and a token in the URL
// would end up in logs).
function streamHandler(req, res) {
  addClient(req, res);
}

// After any successful mutating API request, tell open tabs which query roots
// to refresh and let the inbox rules re-evaluate shortly after.
function broadcastMutations(onMutation) {
  return function (req, res, next) {
    if (req.method === 'GET') return next();
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const path = req.originalUrl.split('?')[0].replace(/^\/api/, '');
      broadcast('mutation', { method: req.method, path, by: req.user?.name || null });
      try { onMutation?.(path); } catch (err) { console.error('[realtime] onMutation error:', err.message); }
    });
    return next();
  };
}

module.exports = { streamHandler, broadcastMutations };
