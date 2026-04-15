const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { calculateSessionWindows } = require('../utils/dates');

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

// Migrate existing databases: add source column to calendly_events
try {
  db.exec("ALTER TABLE calendly_events ADD COLUMN source TEXT NOT NULL DEFAULT 'calendly'");
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add notes column to calendly_events
try {
  db.exec('ALTER TABLE calendly_events ADD COLUMN notes TEXT');
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

// Migrate existing databases: create settings table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id                   INTEGER PRIMARY KEY DEFAULT 1,
      google_refresh_token TEXT,
      google_connected     INTEGER DEFAULT 0,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// Ensure exactly one settings row exists
try {
  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
} catch {
  // Row already exists — safe to ignore
}

// Migrate existing databases: add google_event_id to calendly_events
try {
  db.exec('ALTER TABLE calendly_events ADD COLUMN google_event_id TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: create session_intakes table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_intakes (
      id                    INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id            INTEGER  NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      client_id             INTEGER  NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
      height                REAL,
      marital_status        TEXT,
      num_children          INTEGER,
      occupation            TEXT,
      work_hours            TEXT,
      work_type             TEXT,
      eating_at_work        TEXT,
      medical_conditions    TEXT,
      medications           TEXT,
      lab_results_pdf_path  TEXT,
      prev_treatment        INTEGER  DEFAULT 0,
      prev_treatment_goal   TEXT,
      prev_success          TEXT,
      prev_challenges       TEXT,
      reason_for_treatment  TEXT,
      diet_type             TEXT,
      eating_patterns       TEXT,
      water_intake          TEXT,
      coffee_per_day        TEXT,
      alcohol_per_week      TEXT,
      sleep_hours           TEXT,
      sleep_quality         TEXT,
      physical_activity     INTEGER  DEFAULT 0,
      activity_type         TEXT,
      activity_frequency    TEXT,
      favorite_snacks       TEXT,
      favorite_foods        TEXT,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// Migrate existing databases: add pending_intake_data to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN pending_intake_data TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: create lead_intakes table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_intakes (
      id                    INTEGER  PRIMARY KEY AUTOINCREMENT,
      lead_id               INTEGER  NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      height                REAL,
      marital_status        TEXT,
      num_children          INTEGER,
      occupation            TEXT,
      work_hours            TEXT,
      work_type             TEXT,
      eating_at_work        TEXT,
      medical_conditions    TEXT,
      medications           TEXT,
      lab_results_pdf_path  TEXT,
      prev_treatment        INTEGER  DEFAULT 0,
      prev_treatment_goal   TEXT,
      prev_success          TEXT,
      prev_challenges       TEXT,
      reason_for_treatment  TEXT,
      diet_type             TEXT,
      eating_patterns       TEXT,
      water_intake          TEXT,
      coffee_per_day        TEXT,
      alcohol_per_week      TEXT,
      sleep_hours           TEXT,
      sleep_quality         TEXT,
      physical_activity     INTEGER  DEFAULT 0,
      activity_type         TEXT,
      activity_frequency    TEXT,
      favorite_snacks       TEXT,
      favorite_foods        TEXT,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// Migrate existing databases: add nutrition_anamnesis to intakes
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN nutrition_anamnesis TEXT'); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN nutrition_anamnesis TEXT'); } catch {}

// ── Clinical fields: session_intakes ─────────────────────────────────────────
try { db.exec('ALTER TABLE session_intakes ADD COLUMN age INTEGER'); } catch {}
try { db.exec("ALTER TABLE session_intakes ADD COLUMN gender TEXT"); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN weight REAL'); } catch {}
try { db.exec("ALTER TABLE session_intakes ADD COLUMN goal TEXT"); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN activity_factor REAL'); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN bmr_mifflin REAL'); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN bmr_harris REAL'); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN bmr_average REAL'); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN adjusted_weight REAL'); } catch {}
try { db.exec('ALTER TABLE session_intakes ADD COLUMN tdee REAL'); } catch {}

// ── Clinical fields: lead_intakes ─────────────────────────────────────────────
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN age INTEGER'); } catch {}
try { db.exec("ALTER TABLE lead_intakes ADD COLUMN gender TEXT"); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN weight REAL'); } catch {}
try { db.exec("ALTER TABLE lead_intakes ADD COLUMN goal TEXT"); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN activity_factor REAL'); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN bmr_mifflin REAL'); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN bmr_harris REAL'); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN bmr_average REAL'); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN adjusted_weight REAL'); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN tdee REAL'); } catch {}

// ── One-time repair: create session 1 for converted leads that have no sessions ─
// Runs on every startup but only affects rows that need it (idempotent).

function repairConvertedLeads(database) {
  try {
    const clientsToFix = database.prepare(`
      SELECT c.id          AS client_id,
             c.start_date,
             ce.start_time AS meeting_time,
             li.id         AS intake_id
      FROM   clients c
      LEFT JOIN sessions s         ON s.client_id  = c.id
      LEFT JOIN calendly_events ce ON ce.client_id = c.id
      LEFT JOIN leads l            ON l.id          = c.converted_from_lead_id
      LEFT JOIN lead_intakes li    ON li.lead_id    = l.id
      WHERE  c.converted_from_lead_id IS NOT NULL
        AND  s.id              IS NULL
        AND  ce.start_time     IS NOT NULL
    `).all();

    if (clientsToFix.length === 0) return;
    console.log(`[repair] Found ${clientsToFix.length} converted client(s) with no sessions — repairing...`);

    for (const row of clientsToFix) {
      const meetingDate = row.meeting_time.slice(0, 10);

      // Create session 1
      const sessionResult = database.prepare(`
        INSERT INTO sessions (client_id, session_number, session_date, highlights, tasks)
        VALUES (?, 1, ?, '', '[]')
      `).run(row.client_id, meetingDate);
      const sessionId = sessionResult.lastInsertRowid;

      // Set start_date if not already set
      if (!row.start_date) {
        database.prepare('UPDATE clients SET start_date = ? WHERE id = ?')
          .run(meetingDate, row.client_id);
      }

      // Copy lead intake to session 1 intakes if available
      if (row.intake_id) {
        const intake = database.prepare('SELECT * FROM lead_intakes WHERE id = ?').get(row.intake_id);
        if (intake) {
          try {
            database.prepare(`
              INSERT OR IGNORE INTO session_intakes
                (session_id, client_id, age, gender, weight, height,
                 goal, activity_factor, bmr_mifflin, bmr_harris,
                 bmr_average, adjusted_weight, tdee, medical_conditions,
                 medications, prev_treatment, prev_treatment_goal,
                 prev_success, prev_challenges, reason_for_treatment,
                 diet_type, eating_patterns, water_intake, coffee_per_day,
                 alcohol_per_week, sleep_hours, sleep_quality,
                 physical_activity, activity_type, activity_frequency,
                 favorite_snacks, favorite_foods, lab_results_pdf_path)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              sessionId, row.client_id,
              intake.age, intake.gender, intake.weight, intake.height,
              intake.goal, intake.activity_factor, intake.bmr_mifflin,
              intake.bmr_harris, intake.bmr_average, intake.adjusted_weight,
              intake.tdee, intake.medical_conditions, intake.medications,
              intake.prev_treatment, intake.prev_treatment_goal,
              intake.prev_success, intake.prev_challenges,
              intake.reason_for_treatment, intake.diet_type,
              intake.eating_patterns, intake.water_intake,
              intake.coffee_per_day, intake.alcohol_per_week,
              intake.sleep_hours, intake.sleep_quality,
              intake.physical_activity, intake.activity_type,
              intake.activity_frequency, intake.favorite_snacks,
              intake.favorite_foods, intake.lab_results_pdf_path
            );
          } catch (err) {
            console.error(`[repair] Failed to copy intake for client ${row.client_id}:`, err.message);
          }
        }
      }

      // Recreate session windows from meeting date
      const windows = calculateSessionWindows(meetingDate);
      database.prepare('DELETE FROM session_windows WHERE client_id = ?').run(row.client_id);
      for (const w of windows) {
        database.prepare(`
          INSERT INTO session_windows (client_id, session_number, expected_date)
          VALUES (?, ?, ?)
        `).run(row.client_id, w.session_number, w.expected_date);
      }

      console.log(`[repair] Fixed client ${row.client_id} — session 1 + ${windows.length} windows from ${meetingDate}`);
    }
  } catch (err) {
    console.error('[repair] repairConvertedLeads failed:', err.message);
  }
}

repairConvertedLeads(db);

module.exports = db;
