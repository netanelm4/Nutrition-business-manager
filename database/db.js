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

// Migrate existing databases: update whatsapp_templates CHECK constraint to allow session_confirmation + calendly_link
try {
  const testRow = db
    .prepare(`INSERT INTO whatsapp_templates (name, trigger_event, body_template, is_active, is_custom) VALUES ('__test__', 'session_confirmation', '__test__', 0, 1)`)
    .run();
  db.prepare('DELETE FROM whatsapp_templates WHERE id = ?').run(testRow.lastInsertRowid);
} catch {
  // CHECK constraint blocks session_confirmation — recreate table with updated constraint
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE whatsapp_templates_v3 (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        trigger_event  TEXT    NOT NULL
                               CHECK (trigger_event IN ('session_reminder','welcome','weekly_checkin','menu_sent','process_ending','payment_reminder','session_confirmation','calendly_link','custom')),
        body_template  TEXT    NOT NULL,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        is_custom      INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec('INSERT INTO whatsapp_templates_v3 SELECT * FROM whatsapp_templates');
    db.exec('DROP TABLE whatsapp_templates');
    db.exec('ALTER TABLE whatsapp_templates_v3 RENAME TO whatsapp_templates');
  })();
  db.pragma('foreign_keys = ON');
  console.log('[db] Migrated whatsapp_templates: added session_confirmation, calendly_link to CHECK constraint.');
}

// Migrate existing databases: create calendly_events table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendly_events (
      id                 TEXT     PRIMARY KEY,
      client_id          INTEGER  REFERENCES clients(id) ON DELETE SET NULL,
      lead_id            INTEGER  REFERENCES leads(id)   ON DELETE SET NULL,
      event_type         TEXT,
      invitee_name       TEXT,
      invitee_phone      TEXT,
      invitee_email      TEXT,
      start_time         DATETIME,
      end_time           DATETIME,
      status             TEXT     NOT NULL DEFAULT 'active',
      confirmation_sent  INTEGER  NOT NULL DEFAULT 0,
      confirmation_link  TEXT,
      calendly_event_uri TEXT,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// Migrate existing databases: add confirmation_link to calendly_events (for tables created before this column)
try {
  db.exec('ALTER TABLE calendly_events ADD COLUMN confirmation_link TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add calendly_link to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN calendly_link TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: clean emojis and dashes from all template bodies
try {
  const CLEAN_TEMPLATES = [
    {
      trigger_event: 'session_reminder',
      body_template: 'היי {{client_name}}, רציתי להזכיר שיש לנו פגישה ב-{{date}} בשעה {{time}}. מחכה לך.',
    },
    {
      trigger_event: 'welcome',
      body_template: 'היי {{client_name}}, ברוך הבא לתהליך. שמח לצאת איתך לדרך. התפריט שלך יהיה אצלך תוך יומיים מהפגישה שלנו.',
    },
    {
      trigger_event: 'menu_sent',
      body_template: 'היי {{client_name}}, התפריט שלך מוכן ונשלח אליך. קרא אותו בנחת ואם יש שאלות, אני כאן.',
    },
    {
      trigger_event: 'weekly_checkin',
      body_template: 'היי {{client_name}}, שבוע טוב. רציתי לבדוק איך עובר השבוע מבחינת התזונה? מה מרגיש טוב ומה קצת מאתגר?',
    },
    {
      trigger_event: 'process_ending',
      body_template: 'היי {{client_name}}, כבר 3 חודשים ביחד, כל הכבוד על ההתמדה. בוא נדבר על המשך הדרך ומה הצעד הבא בשבילך.',
    },
    {
      trigger_event: 'payment_reminder',
      body_template: 'היי {{client_name}}, רציתי להזכיר שיש יתרה פתוחה לתשלום עבור התהליך שלנו. אשמח שנסדיר את זה.',
    },
    {
      trigger_event: 'session_confirmation',
      body_template: 'היי {{client_name}},\nרציתי לאשר את הפגישה שלנו מחר {{date}} בשעה {{time}}.\nאשמח לאישור הגעה.\nאם צריך לשנות, נדבר.',
    },
    {
      trigger_event: 'calendly_link',
      body_template: 'היי {{client_name}},\nהקישור לקביעת הפגישה הקרובה שלנו:\n{{calendly_link}}\nניתן לבחור שעה נוחה, אני אהיה שם.',
    },
  ];

  const updateTmpl = db.prepare(
    'UPDATE whatsapp_templates SET body_template = ? WHERE trigger_event = ? AND is_custom = 0'
  );
  const updateAll = db.transaction((templates) => {
    for (const t of templates) updateTmpl.run(t.body_template, t.trigger_event);
  });
  updateAll(CLEAN_TEMPLATES);
} catch {
  // Non-fatal — seed will set correct values for fresh installs
}

module.exports = db;
