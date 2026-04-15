require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./database/db');
const { runSeed, seedProtocols } = require('./database/seed');
const { requireAuth } = require('./middleware/auth');

const clientsRouter = require('./routes/clients.routes');
const sessionsRouter = require('./routes/sessions.routes');
const sessionWindowsRouter = require('./routes/session-windows.routes');
const leadsRouter = require('./routes/leads.routes');
const templatesRouter = require('./routes/templates.routes');
const dashboardRouter = require('./routes/dashboard.routes');
const whatsappRouter = require('./routes/whatsapp.routes');
const paymentsRouter = require('./routes/payments.routes');
const protocolsRouter = require('./routes/protocols.routes');
const publicRouter = require('./routes/public.routes');
const { webhookRouter, calendlyRouter } = require('./routes/calendly.routes');
const intakesRouter  = require('./routes/intakes.routes');
const googleRouter   = require('./routes/google.routes');
const { checkUpcomingReminders } = require('./services/reminders.service');
const { registerCalendlyWebhook } = require('./services/calendly.service');
const { loadStoredToken, syncCanceledEvents } = require('./services/google-calendar.service');

// ─── Seed default data ────────────────────────────────────────────────────────
runSeed(db);
seedProtocols(db);

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());

// ─── Public API routes (no auth) ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', publicRouter);
app.use('/api/calendly', webhookRouter);
app.use('/api/google',   googleRouter);   // callback must be public (no auth)

// ─── Landing page static files ────────────────────────────────────────────────
app.use('/landing', express.static(path.join(__dirname, 'landing')));

// ─── Protected API routes ─────────────────────────────────────────────────────
app.use('/api', requireAuth);

app.use('/api/dashboard',        dashboardRouter);
app.use('/api/clients',          clientsRouter);
app.use('/api/sessions',         sessionsRouter);
app.use('/api/session-windows',  sessionWindowsRouter);
app.use('/api/leads',            leadsRouter);
app.use('/api/templates',        templatesRouter);
app.use('/api/whatsapp',         whatsappRouter);
app.use('/api',                  paymentsRouter);
app.use('/api/protocols',        protocolsRouter);
app.use('/api/calendly',         calendlyRouter);
app.use('/api',                  intakesRouter);

// Session sub-routes are mounted on the clients router (/:id/sessions, /:id/windows)
// Direct session access (/api/sessions/:id) is mounted here for GET/PUT/POST insights

// ─── Static client in production ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`[server] Nutrition CRM running on http://localhost:${PORT}`);

  // ── Debug: log recent clients on startup ──────────────────────────────────
  try {
    const recentClients = db.prepare(
      'SELECT id, full_name, status, created_at FROM clients ORDER BY created_at DESC LIMIT 5'
    ).all();
    console.log(`[debug] Recent clients (${recentClients.length}):`, recentClients.length === 0 ? 'none' : recentClients);
  } catch (err) {
    console.error('[debug] Failed to query recent clients:', err.message);
  }

  // ── Reminder service: check for upcoming sessions every 30 minutes ──────────
  // Initial run after 10 s so the server is fully ready before any DB queries
  setTimeout(checkUpcomingReminders, 10_000);
  setInterval(checkUpcomingReminders, 30 * 60 * 1000);

  // ── Calendly webhook registration ─────────────────────────────────────────
  try {
    await registerCalendlyWebhook();
  } catch (err) {
    console.error('[calendly] Webhook registration error:', err.message);
  }

  // ── Google Calendar: load stored refresh token + start sync ───────────────
  setTimeout(async () => {
    try {
      await loadStoredToken();
    } catch (e) {
      console.log('[google] No stored token or load failed:', e.message);
    }
  }, 2000);

  setTimeout(syncCanceledEvents, 15_000);
  setInterval(syncCanceledEvents, 30 * 60 * 1000);
});
