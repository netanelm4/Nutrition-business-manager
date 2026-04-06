# Nutrition CRM — Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full-stack private CRM for a clinical nutritionist to manage clients, sessions, progress, and leads — with WhatsApp deep-link messaging and Claude-powered session insights.

**Architecture:** Node.js/Express REST API backed by SQLite (better-sqlite3), served alongside a React/Vite/Tailwind frontend. The server owns all business logic (alert states, session window generation, task carry-over, AI calls). The client is a pure presentation layer that fetches from `/api/*`.

**Tech Stack:** Node.js, Express, better-sqlite3, React 18, Vite, Tailwind CSS 3, Anthropic SDK (claude-sonnet-4-20250514)

---

## Approved Schema (final)

### `clients`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| full_name | TEXT NOT NULL | |
| phone | TEXT NOT NULL | |
| age | INTEGER | |
| gender | TEXT | 'male'/'female'/'other' |
| start_date | DATE | First session date — drives window calculation |
| goal | TEXT | |
| medical_notes | TEXT | |
| menu_sent | INTEGER DEFAULT 0 | Boolean |
| menu_sent_date | DATE | |
| initial_weight | REAL | kg — baseline from session 1 |
| process_end_date | DATE | Auto-set to start_date+90; editable |
| status | TEXT DEFAULT 'active' | 'active'/'ending_soon'/'ended'/'paused' |
| converted_from_lead_id | INTEGER FK→leads.id | Nullable |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

### `session_windows`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| client_id | INTEGER NOT NULL FK→clients.id | ON DELETE CASCADE |
| session_number | INTEGER NOT NULL CHECK(1-6) | |
| expected_date | DATE NOT NULL | start_date + (n-1)*14 days |
| manually_overridden | INTEGER DEFAULT 0 | Boolean |
| override_note | TEXT | Reason for manual change |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

Alert logic (±3 days tolerance = 7-day window):
- GREEN: session exists for this number, date within ±3 days of expected_date
- YELLOW: today is within ±3 days of expected_date, no session yet
- RED: today > expected_date + 3 days, no session exists

### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| client_id | INTEGER NOT NULL FK→clients.id | ON DELETE CASCADE |
| session_number | INTEGER NOT NULL CHECK(1-6) | |
| session_date | DATE | |
| weight | REAL | kg |
| highlights | TEXT | Free-form notes |
| ai_insights | TEXT | JSON: [{text, saved_for_next}] |
| ai_flags | TEXT | JSON: [{text, saved_for_next}] |
| tasks | TEXT | JSON: [{id, text, status, carried_over_from_session}] |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

### `leads`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| full_name | TEXT NOT NULL | |
| phone | TEXT | |
| source | TEXT | 'landing_page'/'referral'/'other' |
| status | TEXT DEFAULT 'new' | 'new'/'contacted'/'meeting_scheduled'/'became_client'/'not_relevant' |
| notes | TEXT | |
| follow_up_date | DATE | |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

### `whatsapp_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT NOT NULL | Human-readable label |
| trigger_event | TEXT NOT NULL | 'session_reminder'/'welcome'/'weekly_checkin'/'menu_sent'/'process_ending'/'custom' |
| body_template | TEXT NOT NULL | Hebrew text with {{variable}} placeholders |
| is_active | INTEGER DEFAULT 1 | Boolean |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

---

## Planned File Structure

```
מערכת ניהול לקוחות/
├── .env.example
├── .gitignore
├── package.json                         # Server — Node/Express
│
├── server.js                            # Express entry point, mounts all routes
│
├── database/
│   ├── db.js                            # better-sqlite3 connection + auto-init
│   ├── schema.sql                       # All CREATE TABLE IF NOT EXISTS statements
│   └── seed.js                          # Seeds 5 WhatsApp templates on first run
│
├── routes/
│   ├── clients.routes.js                # CRUD + alert state injection
│   ├── sessions.routes.js               # CRUD + AI insights trigger
│   ├── leads.routes.js                  # CRUD + /convert endpoint
│   ├── templates.routes.js              # CRUD + /render endpoint
│   ├── session-windows.routes.js        # Manual override endpoint
│   └── dashboard.routes.js             # Aggregated dashboard data
│
├── services/
│   ├── whatsapp.service.js              # deeplink mode + api stub
│   ├── ai.service.js                    # Claude API — insights generation
│   └── alerts.service.js               # Alert state computation
│
├── middleware/
│   └── auth.js                          # Simple password check via Authorization header
│
├── constants/
│   ├── statuses.js                      # CLIENT_STATUS, LEAD_STATUS enums
│   └── events.js                        # TRIGGER_EVENT, SESSION_TOLERANCE_DAYS
│
└── client/                              # React frontend (Vite + Tailwind)
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx                      # Router setup, auth gate
        │
        ├── pages/
        │   ├── Login.jsx
        │   ├── Dashboard.jsx
        │   ├── Clients.jsx
        │   ├── ClientDetail.jsx
        │   ├── Leads.jsx
        │   └── LeadDetail.jsx
        │
        ├── components/
        │   ├── ui/
        │   │   ├── Button.jsx
        │   │   ├── Badge.jsx
        │   │   ├── Card.jsx
        │   │   ├── Modal.jsx
        │   │   └── Input.jsx
        │   ├── layout/
        │   │   ├── Sidebar.jsx
        │   │   └── TopBar.jsx
        │   ├── dashboard/
        │   │   ├── WeeklySessionsPanel.jsx
        │   │   ├── AlertsPanel.jsx
        │   │   └── SummaryCounters.jsx
        │   ├── clients/
        │   │   ├── ClientList.jsx
        │   │   ├── ClientCard.jsx
        │   │   └── ClientForm.jsx
        │   ├── sessions/
        │   │   ├── SessionTimeline.jsx
        │   │   ├── SessionCard.jsx
        │   │   ├── TaskList.jsx
        │   │   └── AIInsightsPanel.jsx
        │   ├── leads/
        │   │   ├── LeadList.jsx
        │   │   ├── LeadCard.jsx
        │   │   └── LeadForm.jsx
        │   └── whatsapp/
        │       └── WhatsAppPanel.jsx
        │
        ├── hooks/
        │   ├── useClients.js
        │   ├── useSessions.js
        │   ├── useLeads.js
        │   └── useDashboard.js
        │
        ├── services/
        │   └── api.js                   # fetch wrapper + base URL + auth header
        │
        └── constants/
            └── index.js
```

---

## API Routes

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/dashboard | Weekly sessions, all alerts, summary counters |

### Clients
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/clients | All clients with computed alert state |
| POST | /api/clients | Create client + auto-generate 6 session_windows |
| GET | /api/clients/:id | Client detail with sessions and windows |
| PUT | /api/clients/:id | Update client fields |
| DELETE | /api/clients/:id | Delete client (cascades sessions + windows) |

### Sessions
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/clients/:clientId/sessions | All sessions for a client |
| POST | /api/clients/:clientId/sessions | Create session — carries over tasks + saved insights |
| GET | /api/sessions/:id | Single session |
| PUT | /api/sessions/:id | Update highlights, weight, tasks |
| POST | /api/sessions/:id/insights | Trigger AI insights generation |

### Session Windows
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/clients/:clientId/windows | All windows for a client |
| PUT | /api/session-windows/:id | Manually override a window date |

### Leads
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/leads | All leads |
| POST | /api/leads | Create lead |
| GET | /api/leads/:id | Single lead |
| PUT | /api/leads/:id | Update lead |
| POST | /api/leads/:id/convert | Convert to client — returns pre-fill data |
| DELETE | /api/leads/:id | Delete lead |

### WhatsApp Templates
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/templates | All active templates |
| PUT | /api/templates/:id | Update template |
| POST | /api/templates/render | Render template with client data + return wa.me link |

---

## Step 1 — Database + API Implementation Plan

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1:** Create package.json with dependencies:
- express, better-sqlite3, dotenv, cors, @anthropic-ai/sdk, uuid
- devDependencies: nodemon

**Step 2:** Create .env.example:
```
PORT=3001
AUTH_PASSWORD=changeme
ANTHROPIC_API_KEY=sk-...
WHATSAPP_MODE=deeplink
```

**Step 3:** Create .gitignore (node_modules, .env, *.db, data/)

**Step 4:** Run `npm install` and verify node_modules created.

**Step 5:** Commit
```bash
git init
git add package.json .env.example .gitignore
git commit -m "chore: project scaffold"
```

---

### Task 2: Constants

**Files:**
- Create: `constants/statuses.js`
- Create: `constants/events.js`

**Step 1:** Write `constants/statuses.js`:
```js
const CLIENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  ENDING_SOON: 'ending_soon',
  ENDED: 'ended',
  PAUSED: 'paused',
});

const LEAD_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  MEETING_SCHEDULED: 'meeting_scheduled',
  BECAME_CLIENT: 'became_client',
  NOT_RELEVANT: 'not_relevant',
});

const ALERT_STATE = Object.freeze({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  NONE: 'none',
});

module.exports = { CLIENT_STATUS, LEAD_STATUS, ALERT_STATE };
```

**Step 2:** Write `constants/events.js`:
```js
const TRIGGER_EVENT = Object.freeze({
  SESSION_REMINDER: 'session_reminder',
  WELCOME: 'welcome',
  WEEKLY_CHECKIN: 'weekly_checkin',
  MENU_SENT: 'menu_sent',
  PROCESS_ENDING: 'process_ending',
  CUSTOM: 'custom',
});

const SESSION_TOLERANCE_DAYS = 3;   // ±3 days = 7-day window
const PROCESS_DURATION_DAYS = 90;
const MENU_ALERT_THRESHOLD_DAYS = 2;
const ENDING_SOON_THRESHOLD_DAYS = 14;

module.exports = {
  TRIGGER_EVENT,
  SESSION_TOLERANCE_DAYS,
  PROCESS_DURATION_DAYS,
  MENU_ALERT_THRESHOLD_DAYS,
  ENDING_SOON_THRESHOLD_DAYS,
};
```

**Step 3:** Commit
```bash
git add constants/
git commit -m "chore: add status and event constants"
```

---

### Task 3: Database — schema.sql

**Files:**
- Create: `database/schema.sql`

**Step 1:** Write all CREATE TABLE IF NOT EXISTS statements (clients, session_windows, sessions, leads, whatsapp_templates) with all approved columns, FK constraints, CHECK constraints, and DEFAULT values.

**Step 2:** Verify SQL is valid by reading it once carefully — check every column is present and FK references are correct.

**Step 3:** Commit
```bash
git add database/schema.sql
git commit -m "feat: database schema — all 5 tables"
```

---

### Task 4: Database — db.js connection + auto-init

**Files:**
- Create: `database/db.js`

**Step 1:** Write db.js:
- Open better-sqlite3 connection to `./data/nutrition.db` (create `data/` dir if missing)
- Read schema.sql and execute it (idempotent — IF NOT EXISTS)
- Export the db instance as a singleton

**Step 2:** Write `database/seed.js`:
- Check if whatsapp_templates table is empty
- If empty, insert the 5 Hebrew templates with correct trigger_event values
- Export a `runSeed(db)` function

**Step 3:** Update `server.js` to call `runSeed(db)` on startup.

**Step 4:** Verify: `node database/db.js` should create data/nutrition.db with no errors.

**Step 5:** Commit
```bash
git add database/
git commit -m "feat: database connection, auto-init, and template seed"
```

---

### Task 5: Middleware — auth.js

**Files:**
- Create: `middleware/auth.js`

**Step 1:** Write simple password middleware:
- Reads `Authorization: Bearer <password>` header
- Compares to `process.env.AUTH_PASSWORD`
- Returns 401 JSON if mismatch

**Step 2:** Commit
```bash
git add middleware/auth.js
git commit -m "feat: simple password auth middleware"
```

---

### Task 6: Alerts service

**Files:**
- Create: `services/alerts.service.js`

**Step 1:** Write `computeWindowAlertState(window, sessions)`:
- Accepts a session_window row and array of existing sessions for that client
- Returns ALERT_STATE enum value (green/yellow/red/none)

**Step 2:** Write `computeClientAlerts(client, windows, sessions)`:
- Returns object: `{ windowAlerts, menuAlert, endingSoonAlert, processEndedAlert }`
- menuAlert: true if !menu_sent and session 1 exists and session1_date + 2 days < today
- endingSoonAlert: true if process_end_date is within 14 days and status !== 'ended'
- processEndedAlert: true if process_end_date < today and status !== 'ended'

**Step 3:** Commit
```bash
git add services/alerts.service.js
git commit -m "feat: alert state computation service"
```

---

### Task 7: WhatsApp service

**Files:**
- Create: `services/whatsapp.service.js`

**Step 1:** Write template renderer:
- `renderTemplate(bodyTemplate, variables)` — replaces `{{key}}` with values from variables object

**Step 2:** Write deeplink mode:
- `generateLink(phone, message)` — returns `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
- cleanPhone strips non-digits, adds 972 prefix if starts with 0

**Step 3:** Write api mode stub:
- `sendMessage(phone, message)` — throws Error('WhatsApp API mode not implemented yet')

**Step 4:** Export unified interface controlled by `process.env.WHATSAPP_MODE`

**Step 5:** Commit
```bash
git add services/whatsapp.service.js
git commit -m "feat: WhatsApp service — deeplink mode + api stub"
```

---

### Task 8: AI service

**Files:**
- Create: `services/ai.service.js`

**Step 1:** Write `generateInsights(client, sessions, currentHighlights)`:
- Builds structured prompt: client profile + all previous sessions + current highlights
- Calls Claude API: claude-sonnet-4-20250514
- Parses response into `{ insights: [{text}], flags: [{text}] }`
- All insight objects initialize with `saved_for_next: false`

**Step 2:** Commit
```bash
git add services/ai.service.js
git commit -m "feat: AI insights service using Claude API"
```

---

### Task 9: Clients routes

**Files:**
- Create: `routes/clients.routes.js`

All responses follow shape: `{ success: true, data: ... }` or `{ success: false, error: "..." }`

**Step 1:** `GET /api/clients` — fetch all clients, compute alert state for each via alerts.service, return array

**Step 2:** `POST /api/clients` — validate required fields, insert client, auto-generate 6 session_window rows (expected_date = start_date + (n-1)*14 days), auto-set process_end_date = start_date + 90 days if not provided

**Step 3:** `GET /api/clients/:id` — fetch client + sessions + windows, compute alerts, return full detail object

**Step 4:** `PUT /api/clients/:id` — update allowed fields, return updated client

**Step 5:** `DELETE /api/clients/:id` — delete client (SQLite cascade handles sessions + windows)

**Step 6:** Commit
```bash
git add routes/clients.routes.js
git commit -m "feat: clients CRUD routes with alert state and session window generation"
```

---

### Task 10: Sessions routes

**Files:**
- Create: `routes/sessions.routes.js`

**Step 1:** `GET /api/clients/:clientId/sessions` — all sessions for client, ordered by session_number

**Step 2:** `POST /api/clients/:clientId/sessions` — create session:
- Determine next session_number (max existing + 1)
- Carry over incomplete tasks from previous session (status !== 'done') → set carried_over_from_session
- Carry over saved insights/flags (saved_for_next: true) from previous session → prepend to new session's ai_insights/ai_flags

**Step 3:** `GET /api/sessions/:id` — single session

**Step 4:** `PUT /api/sessions/:id` — update highlights, weight, tasks, ai_insights, ai_flags

**Step 5:** `POST /api/sessions/:id/insights` — call ai.service.generateInsights, save result to session, return it

**Step 6:** Commit
```bash
git add routes/sessions.routes.js
git commit -m "feat: sessions CRUD routes with task carry-over and AI insights"
```

---

### Task 11: Session windows routes

**Files:**
- Create: `routes/session-windows.routes.js`

**Step 1:** `GET /api/clients/:clientId/windows` — all windows for a client

**Step 2:** `PUT /api/session-windows/:id` — update expected_date, set manually_overridden=1, save override_note

**Step 3:** Commit
```bash
git add routes/session-windows.routes.js
git commit -m "feat: session windows route — manual override support"
```

---

### Task 12: Leads routes

**Files:**
- Create: `routes/leads.routes.js`

**Step 1:** `GET /api/leads` — all leads, ordered by created_at DESC

**Step 2:** `POST /api/leads` — create lead

**Step 3:** `GET /api/leads/:id` — single lead

**Step 4:** `PUT /api/leads/:id` — update lead fields

**Step 5:** `POST /api/leads/:id/convert` — mark lead as became_client, return `{ full_name, phone }` for pre-fill (does NOT create client — UI does that on confirm)

**Step 6:** `DELETE /api/leads/:id` — delete lead

**Step 7:** Commit
```bash
git add routes/leads.routes.js
git commit -m "feat: leads CRUD routes with convert endpoint"
```

---

### Task 13: Templates routes

**Files:**
- Create: `routes/templates.routes.js`

**Step 1:** `GET /api/templates` — all templates where is_active = 1

**Step 2:** `PUT /api/templates/:id` — update name, body_template, is_active

**Step 3:** `POST /api/templates/render` — accepts `{ templateId, clientId }`, fetches template + client, renders variables, returns `{ rendered_text, whatsapp_link }`
  - Variables available: client_name, phone, date, time (date/time passed in request body)

**Step 4:** Commit
```bash
git add routes/templates.routes.js
git commit -m "feat: templates routes with render endpoint"
```

---

### Task 14: Dashboard route

**Files:**
- Create: `routes/dashboard.routes.js`

**Step 1:** `GET /api/dashboard` — single aggregated endpoint returning:
```json
{
  "weekly_sessions": [...],   // clients with expected window in current week
  "alerts": [...],            // all red/yellow + menu + ending soon + ended
  "counters": {
    "active_clients": N,
    "leads_this_month": N,
    "sessions_this_week": N
  }
}
```

**Step 2:** Commit
```bash
git add routes/dashboard.routes.js
git commit -m "feat: dashboard aggregation route"
```

---

### Task 15: server.js — wire everything together

**Files:**
- Create: `server.js`

**Step 1:** Write server.js:
- dotenv config
- Express app with JSON body parser + CORS
- Mount auth middleware on all /api/* routes
- Mount all 6 route files
- Serve client/dist as static in production
- Listen on PORT

**Step 2:** Add start script to package.json: `"start": "node server.js"`, `"dev": "nodemon server.js"`

**Step 3:** Commit
```bash
git add server.js package.json
git commit -m "feat: Express server with all routes mounted"
```

---

### Task 16: Route smoke test script

**Files:**
- Create: `scripts/test-routes.js`

**Step 1:** Write a Node script that:
1. Creates a lead
2. Converts it to pre-fill data
3. Creates a client (using pre-fill + start_date)
4. Verifies 6 session_windows were created
5. Creates session 1 with highlights
6. Calls insights endpoint
7. Creates session 2 — verifies tasks carried over
8. Overrides a session window
9. Calls dashboard endpoint
10. Deletes test data

Each step prints PASS/FAIL.

**Step 2:** Run: `node scripts/test-routes.js`

**Step 3:** Fix any failures before proceeding to Step 2 (Frontend).

---

## Step 2–6 (Frontend) — Deferred until Step 1 is confirmed complete

Steps 2–6 will be planned in detail once all API routes pass the smoke test.
