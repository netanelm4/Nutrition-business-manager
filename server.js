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
app.listen(PORT, () => {
  console.log(`[server] Nutrition CRM running on http://localhost:${PORT}`);
});
