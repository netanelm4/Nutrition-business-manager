PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────
-- leads must exist before clients references it
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name        TEXT    NOT NULL,
  phone            TEXT,
  source           TEXT    CHECK (source IN ('landing_page', 'referral', 'other')),
  status           TEXT    NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new', 'contacted', 'meeting_scheduled', 'became_client', 'not_relevant')),
  notes            TEXT,
  follow_up_date   TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────
-- clients
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name               TEXT    NOT NULL,
  phone                   TEXT    NOT NULL,
  age                     INTEGER,
  gender                  TEXT    CHECK (gender IN ('male', 'female', 'other')),
  start_date              TEXT,
  goal                    TEXT,
  medical_notes           TEXT,
  menu_sent               INTEGER NOT NULL DEFAULT 0,
  menu_sent_date          TEXT,
  initial_weight          REAL,
  process_end_date        TEXT,
  status                  TEXT    NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'ending_soon', 'ended', 'paused')),
  payment_status          TEXT    DEFAULT 'unpaid',
  package_price           REAL    DEFAULT 0,
  converted_from_lead_id  INTEGER REFERENCES leads (id) ON DELETE SET NULL,
  created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────
-- session_windows — 6 expected dates per client
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_windows (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id           INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  session_number      INTEGER NOT NULL CHECK (session_number BETWEEN 1 AND 6),
  expected_date       TEXT    NOT NULL,
  manually_overridden INTEGER NOT NULL DEFAULT 0,
  override_note       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (client_id, session_number)
);

-- ─────────────────────────────────────────────
-- sessions — actual recorded sessions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL CHECK (session_number BETWEEN 1 AND 6),
  session_date   TEXT,
  weight         REAL,
  highlights     TEXT,
  ai_insights    TEXT    DEFAULT '[]',
  ai_flags       TEXT    DEFAULT '[]',
  tasks          TEXT    DEFAULT '[]',
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (client_id, session_number)
);

-- ─────────────────────────────────────────────
-- whatsapp_templates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  trigger_event  TEXT    NOT NULL
                         CHECK (trigger_event IN ('session_reminder', 'welcome', 'weekly_checkin', 'menu_sent', 'process_ending', 'payment_reminder', 'custom')),
  body_template  TEXT    NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  is_custom      INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- protocols — reusable clinical protocol templates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS protocols (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  description    TEXT,
  highlights     TEXT    NOT NULL DEFAULT '[]',
  default_tasks  TEXT    NOT NULL DEFAULT '[]',
  is_custom      INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────
-- payments
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  amount     REAL    NOT NULL,
  paid_at    TEXT    NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────
-- whatsapp_log — records each manual WhatsApp send
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  template_id      INTEGER REFERENCES whatsapp_templates (id) ON DELETE SET NULL,
  rendered_message TEXT    NOT NULL,
  sent_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
