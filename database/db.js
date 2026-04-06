const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DB_DIR, 'nutrition.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure the directory containing the DB file exists at runtime
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Run schema.sql — all statements are CREATE TABLE IF NOT EXISTS, so this is idempotent
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Migrate existing databases: add is_custom column if it doesn't exist
try {
  db.exec('ALTER TABLE whatsapp_templates ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add soap_notes column if it doesn't exist
try {
  db.exec('ALTER TABLE sessions ADD COLUMN soap_notes TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add status_updated_at to leads
try {
  db.exec('ALTER TABLE leads ADD COLUMN status_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add payment_status to clients
try {
  db.exec("ALTER TABLE clients ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add package_price to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN package_price REAL DEFAULT 0');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: create protocols table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS protocols (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL,
      description    TEXT,
      highlights     TEXT    NOT NULL DEFAULT '[]',
      default_tasks  TEXT    NOT NULL DEFAULT '[]',
      is_custom      INTEGER NOT NULL DEFAULT 0,
      is_active      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// Migrate existing databases: update whatsapp_templates CHECK constraint to allow payment_reminder
try {
  // Test-insert with the new trigger_event value; roll back immediately if successful
  const testRow = db
    .prepare(`INSERT INTO whatsapp_templates (name, trigger_event, body_template, is_active, is_custom) VALUES ('__test__', 'payment_reminder', '__test__', 0, 1)`)
    .run();
  db.prepare('DELETE FROM whatsapp_templates WHERE id = ?').run(testRow.lastInsertRowid);
} catch {
  // CHECK constraint blocks payment_reminder — recreate table with updated constraint
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE whatsapp_templates_v2 (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        trigger_event  TEXT    NOT NULL
                               CHECK (trigger_event IN ('session_reminder','welcome','weekly_checkin','menu_sent','process_ending','payment_reminder','custom')),
        body_template  TEXT    NOT NULL,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        is_custom      INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec('INSERT INTO whatsapp_templates_v2 SELECT * FROM whatsapp_templates');
    db.exec('DROP TABLE whatsapp_templates');
    db.exec('ALTER TABLE whatsapp_templates_v2 RENAME TO whatsapp_templates');
  })();
  db.pragma('foreign_keys = ON');
  console.log('[db] Migrated whatsapp_templates: added payment_reminder to CHECK constraint.');
}

// Migrate existing databases: create payments table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id  INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
      amount     REAL    NOT NULL,
      paid_at    TEXT    NOT NULL,
      note       TEXT,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

module.exports = db;
