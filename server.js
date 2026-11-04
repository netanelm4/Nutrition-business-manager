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
const authRouter = require('./routes/auth.routes');
const meetingsRouter = require('./routes/meetings.routes');
const intakesRouter  = require('./routes/intakes.routes');
const adminRouter    = require('./routes/admin.routes');
const aiSummaryRouter  = require('./routes/ai-summary.routes');
const googleRouter     = require('./routes/google.routes');
const agentRouter           = require('./routes/agent.routes');
const engagementsRouter     = require('./routes/engagements.routes');
const foodBankRouter        = require('./routes/food-bank.routes');
const foodBankPdfRouter     = require('./routes/food-bank-pdf.routes');
const menusRouter           = require('./routes/menus.routes');
const aiRecommendationsRouter = require('./routes/ai-recommendations.routes');
const weightRouter             = require('./routes/weight.routes');
const whatsappBotRouter        = require('./routes/whatsapp-bot.routes');
const statsRouter              = require('./routes/stats.routes');
const settingsRouter           = require('./routes/settings.routes');
const { logActivity }          = require('./middleware/activity-log');
const inboxRouter              = require('./routes/inbox.routes');
const { streamHandler, broadcastMutations } = require('./middleware/realtime');
const { reconcileInbox, scheduleReconcile } = require('./services/inbox-rules.service');
const { reconcileJobs, runDueJobs } = require('./services/jobs.service');
const { publish } = require('./services/event-bus.service');
const { autoMarkHeldSessions } = require('./services/session-lifecycle.service');
const { loadStoredToken, syncGoogleCalendar } = require('./services/google-calendar.service');
const cron = require('node-cron');
const { runAnalysis } = require('./services/ai-intelligence.service');

// ─── Seed default data ────────────────────────────────────────────────────────
runSeed(db);
seedProtocols(db);

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();

// Railway terminates TLS at one proxy hop — needed for a real req.ip (rate limiting)
app.set('trust proxy', 1);

app.use(cors());
// Keep the raw bytes: webhook signature verification must HMAC the exact payload
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// ─── Public API routes (no auth) ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api', publicRouter);
app.use('/api/google',    googleRouter);      // callback must be public (no auth)
app.use('/api/whatsapp',  whatsappBotRouter); // webhook is public; /test applies auth internally

// ─── Landing page static files ────────────────────────────────────────────────
app.use('/landing', express.static(path.join(__dirname, 'landing')));

// ─── Protected API routes ─────────────────────────────────────────────────────
app.use('/api', requireAuth);
app.use('/api', logActivity);

// Live updates: SSE stream + broadcast after every successful mutation
app.get('/api/stream', streamHandler);
app.use('/api', broadcastMutations(() => scheduleReconcile(db)));

app.use('/api/dashboard',        dashboardRouter);
app.use('/api/clients',          clientsRouter);
app.use('/api/sessions',         sessionsRouter);
app.use('/api/session-windows',  sessionWindowsRouter);
app.use('/api/leads',            leadsRouter);
app.use('/api/templates',        templatesRouter);
app.use('/api/whatsapp',         whatsappRouter);
app.use('/api',                  paymentsRouter);
app.use('/api/protocols',        protocolsRouter);
app.use('/api/meetings',         meetingsRouter);
app.use('/api',                  intakesRouter);
app.use('/api/admin',            adminRouter);
app.use('/api',                  aiSummaryRouter);
app.use('/api/agent',            agentRouter);
app.use('/api/engagements',      engagementsRouter);
app.use('/api/food-bank',        foodBankRouter);
app.use('/api/food-bank',        foodBankPdfRouter);
app.use('/api/menus',            menusRouter);
app.use('/api/ai-recommendations', aiRecommendationsRouter);
app.use('/api/weight',             weightRouter);
app.use('/api/stats',              statsRouter);
app.use('/api/settings',           settingsRouter);
app.use('/api/inbox',              inboxRouter);

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

  // ── Scheduled jobs: derive jobs from data (24h reminders, menu SLA, freeze
  //    end) every 5 min; execute due jobs every minute. Persisted → deploy-safe.
  const runJobs = async () => {
    try { reconcileJobs(db); await runDueJobs(db); } catch (err) { console.error('[jobs] error:', err.message); }
  };
  setTimeout(runJobs, 10_000);
  setInterval(() => runDueJobs(db).catch((err) => console.error('[jobs] run error:', err.message)), 60 * 1000);
  setInterval(() => { try { reconcileJobs(db); } catch (err) { console.error('[jobs] reconcile error:', err.message); } }, 5 * 60 * 1000);

  // ── Inbox rules: startup + every 15 min (and ~2 s after any mutation) ─────
  const runInboxRules = () => {
    try { reconcileInbox(db); } catch (err) { console.error('[inbox] reconcile error:', err.message); }
  };
  setTimeout(runInboxRules, 12_000);
  setInterval(runInboxRules, 15 * 60 * 1000);

  // ── Session lifecycle: scheduled → held 24h after the meeting (no cancellation) ──
  const runSessionLifecycle = () => {
    try {
      const r = autoMarkHeldSessions(db);
      if (r.held || r.canceled || r.deleted) publish(db, 'session.lifecycle', { payload: r });
    } catch (err) { console.error('[sessions] auto-held error:', err.message); }
  };
  setTimeout(runSessionLifecycle, 20_000);
  setInterval(runSessionLifecycle, 30 * 60 * 1000);

  // ── Google Calendar: load stored refresh token + start sync ───────────────
  setTimeout(async () => {
    try {
      await loadStoredToken();
    } catch (e) {
      console.log('[google] No stored token or load failed:', e.message);
    }
  }, 2000);

  // ── Google Calendar: incremental sync (bookings, reschedules, cancellations) ──
  // Sync token persisted in settings → nothing is lost across restarts/deploys.
  setTimeout(() => syncGoogleCalendar(), 15_000);
  setInterval(() => syncGoogleCalendar(), 5 * 60 * 1000);

  // ── AI Intelligence: analyze active clients twice daily ───────────────────
  cron.schedule('0 8 * * *',  () => runAnalysis().catch(e => console.error('[ai-intelligence] cron error:', e.message)), { timezone: 'Asia/Jerusalem' });
  cron.schedule('0 17 * * *', () => runAnalysis().catch(e => console.error('[ai-intelligence] cron error:', e.message)), { timezone: 'Asia/Jerusalem' });
  console.log('[ai-intelligence] Cron jobs scheduled: 08:00 and 17:00 Israel time');
  // No startup run: every deploy used to re-run the full Claude analysis.
  // Manual run: POST /api/ai-recommendations/run (Inbox → "הרץ ניתוח AI").
});
