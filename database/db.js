const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const {
  calculateSessionWindows, calculateProcessEndDate, todayISO,
  toUtcISO, isCanonicalInstant, israelDateOf,
} = require('../utils/dates');

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

// ── 2026-11: Calendly removed. The bookings table is now `meetings` and Google
// Calendar is the single scheduling source. Runs before every other migration so
// all of them (and every query) operate on the renamed table.
try {
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('calendly_events', 'meetings')"
  ).all().map((r) => r.name);
  if (names.includes('calendly_events') && !names.includes('meetings')) {
    db.exec('ALTER TABLE calendly_events RENAME TO meetings');
    console.log('[migration] Renamed table calendly_events → meetings');
  }
} catch (err) {
  console.error('[migration] calendly_events → meetings rename failed:', err.message);
}

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

// Migrate existing databases: rename trigger calendly_link → booking_link (Google
// appointment-scheduling links) and {{calendly_link}} → {{booking_link}} in bodies.
try {
  const tmplSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='whatsapp_templates'").get()?.sql || '';
  if (!tmplSql.includes("'booking_link'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE whatsapp_templates_v4 (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          name           TEXT    NOT NULL,
          trigger_event  TEXT    NOT NULL
                                 CHECK (trigger_event IN ('session_reminder','welcome','weekly_checkin','menu_sent','process_ending','payment_reminder','session_confirmation','booking_link','custom')),
          body_template  TEXT    NOT NULL,
          is_active      INTEGER NOT NULL DEFAULT 1,
          created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          is_custom      INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.exec(`
        INSERT INTO whatsapp_templates_v4 (id, name, trigger_event, body_template, is_active, created_at, is_custom)
        SELECT id, name,
               CASE trigger_event WHEN 'calendly_link' THEN 'booking_link' ELSE trigger_event END,
               REPLACE(body_template, '{{calendly_link}}', '{{booking_link}}'),
               is_active, created_at, is_custom
        FROM whatsapp_templates
      `);
      db.exec('DROP TABLE whatsapp_templates');
      db.exec('ALTER TABLE whatsapp_templates_v4 RENAME TO whatsapp_templates');
    })();
    db.pragma('foreign_keys = ON');
    console.log('[migration] whatsapp_templates: calendly_link → booking_link');
  }
} catch (err) {
  try { db.pragma('foreign_keys = ON'); } catch {}
  console.error('[migration] whatsapp_templates booking_link migration failed:', err.message);
}

// Migrate existing databases: create meetings table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
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
      calendly_event_uri TEXT,  -- legacy, unused since Calendly was removed
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// Migrate existing databases: add confirmation_link to meetings (for tables created before this column)
try {
  db.exec('ALTER TABLE meetings ADD COLUMN confirmation_link TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add calendly_link to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN calendly_link TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add source column to meetings
try {
  db.exec("ALTER TABLE meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'calendly'");
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add notes column to meetings
try {
  db.exec('ALTER TABLE meetings ADD COLUMN notes TEXT');
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
      trigger_event: 'booking_link',
      body_template: 'היי {{client_name}},\nהקישור לקביעת הפגישה הקרובה שלנו:\n{{booking_link}}\nניתן לבחור שעה נוחה, אני אהיה שם.',
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

// Migrate existing databases: add google_event_id to meetings
try {
  db.exec('ALTER TABLE meetings ADD COLUMN google_event_id TEXT');
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

// Migrate existing databases: add protocol_id to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN protocol_id INTEGER REFERENCES protocols(id) ON DELETE SET NULL');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add ai_assessment to lead_intakes
try {
  db.exec('ALTER TABLE lead_intakes ADD COLUMN ai_assessment TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add ai_summary fields to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN ai_summary TEXT');
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec('ALTER TABLE clients ADD COLUMN ai_summary_updated_at DATETIME');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add checkin_message to sessions
try {
  db.exec('ALTER TABLE sessions ADD COLUMN checkin_message TEXT');
} catch {
  // Column already exists — safe to ignore
}

// Migrate existing databases: add process_summary to clients
try {
  db.exec('ALTER TABLE clients ADD COLUMN process_summary TEXT');
} catch {
  // Column already exists — safe to ignore
}

// ─────────────────────────────────────────────────────────────────────────────
// REPAIR POLICY: Every bug fix that affects existing data
// must have a corresponding repair function here that
// runs on every server startup (idempotent).
// Never assume future data only — always fix past data too.
// ─────────────────────────────────────────────────────────────────────────────

// ── Repair 1: Fix payment_status = 'partial' records that are actually paid ──

function repairPaymentStatus(database) {
  try {
    const clientsToFix = database.prepare(`
      SELECT c.id, c.package_price,
             ROUND(COALESCE(SUM(p.amount), 0), 2) as total_paid
      FROM clients c
      LEFT JOIN payments p ON p.client_id = c.id
      WHERE c.payment_status = 'partial'
      GROUP BY c.id
    `).all();

    for (const client of clientsToFix) {
      const packagePrice = Number((client.package_price || 0).toFixed(2));
      const totalPaid    = Number((client.total_paid    || 0).toFixed(2));

      let newStatus;
      if (packagePrice === 0 && totalPaid > 0) {
        newStatus = 'paid';
      } else if (packagePrice > 0 && totalPaid >= packagePrice) {
        newStatus = 'paid';
      } else {
        continue; // correctly partial — skip
      }

      database.prepare('UPDATE clients SET payment_status = ? WHERE id = ?')
        .run(newStatus, client.id);
      console.log(`[repair] Fixed payment status for client ${client.id}: partial → ${newStatus}`);
    }
  } catch (err) {
    console.error('[repair] repairPaymentStatus failed:', err.message);
  }
}

// ── Repair 2: Create session 1 for converted clients that have none ───────────

function repairConvertedLeads(database) {
  try {
    const clientsToFix = database.prepare(`
      SELECT
        c.id                        AS client_id,
        c.start_date,
        c.converted_from_lead_id,
        ce.start_time               AS meeting_time,
        l.id                        AS lead_id
      FROM clients c
      LEFT JOIN sessions s           ON s.client_id = c.id AND s.session_number = 1
      LEFT JOIN leads l              ON l.id = c.converted_from_lead_id
      LEFT JOIN meetings ce   ON ce.client_id = c.id
                                     OR (ce.lead_id = l.id AND ce.status = 'active')
      WHERE c.converted_from_lead_id IS NOT NULL
        AND s.id IS NULL
      GROUP BY c.id
    `).all();

    if (clientsToFix.length === 0) return;
    console.log(`[repair] Found ${clientsToFix.length} converted client(s) with no session 1 — repairing...`);

    for (const row of clientsToFix) {
      const meetingDate = row.meeting_time
        ? israelDateOf(row.meeting_time)
        : (row.start_date || new Date().toISOString().slice(0, 10));

      // Create session 1 (INSERT OR IGNORE is idempotent)
      const sessionResult = database.prepare(`
        INSERT OR IGNORE INTO sessions (client_id, session_number, session_date, highlights, tasks)
        VALUES (?, 1, ?, '', '[]')
      `).run(row.client_id, meetingDate);

      const sessionId = sessionResult.lastInsertRowid;
      if (!sessionId) {
        console.log(`[repair] Session 1 already exists for client ${row.client_id} — skipping`);
        continue;
      }

      // Set start_date if missing
      if (!row.start_date) {
        database.prepare('UPDATE clients SET start_date = ? WHERE id = ?')
          .run(meetingDate, row.client_id);
      }

      // Recreate session windows
      database.prepare('DELETE FROM session_windows WHERE client_id = ?').run(row.client_id);
      const windows = calculateSessionWindows(meetingDate);
      for (const w of windows) {
        database.prepare(`
          INSERT INTO session_windows (client_id, session_number, expected_date)
          VALUES (?, ?, ?)
        `).run(row.client_id, w.session_number, w.expected_date);
      }

      // Copy lead intake if available
      if (row.lead_id) {
        const intake = database.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(row.lead_id);
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
                 favorite_snacks, favorite_foods, lab_results_pdf_path,
                 nutrition_anamnesis)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
              intake.favorite_foods, intake.lab_results_pdf_path,
              intake.nutrition_anamnesis
            );
            console.log(`[repair] Copied intake data to session 1 for client ${row.client_id}`);
          } catch (err) {
            console.error(`[repair] Failed to copy intake for client ${row.client_id}:`, err.message);
          }
        }
      }

      // Link meeting to client if not already linked
      if (row.meeting_time && row.lead_id) {
        database.prepare(`
          UPDATE meetings
          SET client_id = ?
          WHERE lead_id = ? AND status = 'active' AND client_id IS NULL
        `).run(row.client_id, row.lead_id);
      }

      console.log(`[repair] Fixed client ${row.client_id} — session 1 + ${windows.length} windows from ${meetingDate}`);
    }
  } catch (err) {
    console.error('[repair] repairConvertedLeads failed:', err.message);
  }
}

repairPaymentStatus(db);
repairConvertedLeads(db);

// ── Repair: Correct food bank data to match clinical nutritional guidelines ───
// Applied 2026-05-03: calorie ranges, legume reclassification, household portions.
// Uses name+category lookups (not IDs) so it is safe across environments.
// The seed now inserts legumes into cat 7 and שמנת חמוצה into cat 9; this repair
// deletes any stale rows left in the old categories from before that seed change.
function repairFoodBankClinicalData(database) {
  try {
    let fixed = 0;

    // Step 1 — Remove stale entries in old categories.
    const deleteStaleCat = database.prepare(
      'DELETE FROM food_items WHERE name_he = ? AND category_id = ?'
    );

    // Legumes: old category 4 (חלבון מהצומח — קטניות) — seed now places them in cat 7
    for (const name of [
      'עדשים כתומות מבושלות', 'עדשים ירוקות מבושלות', 'שעועית לבנה מבושלת',
      'שעועית שחורה מבושלת',  'חומוס מבושל',          'אפונה מבושלת',
      'פול מבושל',            'סויה מבושלת',
    ]) {
      const r = deleteStaleCat.run(name, 4);
      if (r.changes > 0) { console.log(`[repair] food_bank: removed stale cat-4 entry for ${name}`); fixed++; }
    }

    // שמנת חמוצה: old category 1 (dairy) — seed now places it in cat 9
    const rSour = deleteStaleCat.run('שמנת חמוצה 15%', 1);
    if (rSour.changes > 0) { console.log('[repair] food_bank: removed stale cat-1 entry for שמנת חמוצה'); fixed++; }

    // Step 2 — Correct portion/calorie values (idempotent: skips rows already correct).
    // Format: [portion_desc, grams, cal, protein(null=keep), notes(null=keep), name, cat, ...WHERE...]
    const updateVals = database.prepare(`
      UPDATE food_items
      SET portion_description = ?, portion_grams = ?, calories_per_half_portion = ?,
          protein_grams = COALESCE(?, protein_grams), notes = COALESCE(?, notes)
      WHERE name_he = ? AND category_id = ?
        AND (portion_description != ? OR portion_grams != ? OR calories_per_half_portion != ?)
    `);

    const corrections = [
      // Protein cat 1 — ביצים ומוצרי חלב — maximized to 140 kcal ceiling
      ['2 ביצים',             100, 140, 12,   null, 'ביצה',                             1, '2 ביצים',             100, 140],
      ['6 כפות',              120, 130, 16,   null, 'גבינה בולגרית 5%',                 1, '6 כפות',              120, 130],
      ['2.5 כפות',            125, 125, 13,   null, 'גבינה לבנה 5%',                    1, '2.5 כפות',            125, 125],
      ['2 פרוסות',             40, 120, 10,   null, 'גבינה צהובה 15%',                  1, '2 פרוסות',             40, 120],
      ['2.5 פרוסות',           50, 125, 15,   null, 'גבינה צהובה 9%',                   1, '2.5 פרוסות',           50, 125],
      ['4.5 כפות',             90, 135, 16,   null, 'גבינת עזים 5%',                    1, '4.5 כפות',             90, 135],
      ['4.5 כפות מפוררות',     54, 135,  9,   null, 'גבינת פטה',                        1, '4.5 כפות מפוררות',     54, 135],
      ['5 כפות',              100, 133, 12,   null, 'גבינת ריקוטה',                     1, '5 כפות',              100, 133],
      ['1 כוס',               200, 113, 20,   null, 'יוגורט יווני 0%',                  1, '1 כוס',               200, 113],
      ['1.5 גביעים',          225, 135, 11,   null, 'יוגורט ביו עד 3%',                 1, '1.5 גביעים',          225, 135],
      ['2.5 כפות',            125, 119, 15,   null, 'קוטג׳ 3%',                         1, '2.5 כפות',            125, 119],
      // Protein cat 2 — דגים — maximized to 140 kcal ceiling
      ['175 גרם',             175, 140, 32,   null, 'בקלה',                             2, '175 גרם',             175, 140],
      ['150 גרם',             150, 142, 27,   null, 'דג מוסר ים',                       2, '150 גרם',             150, 142],
      ['155 גרם',             155, 139, 28,   null, 'הליבוט',                           2, '155 גרם',             155, 139],
      ['פחית שלמה',           130, 112, 25,   null, 'טונה במים',                        2, 'פחית שלמה',           130, 112],
      ['½ פחית',               65, 100, 13,   null, 'טונה בשמן',                        2, '½ פחית',               65, 100],
      ['4 פרוסות',             80, 128, 18,   null, 'סלמון מעושן',                      2, '4 פרוסות',             80, 128],
      ['155 גרם',             155, 139, 28,   null, 'פילה דג לבן (לברק/מושט/דניס)',     2, '155 גרם',             155, 139],
      ['16 יחידות',           160, 136, 29,   null, 'שרימפס',                           2, '16 יחידות',           160, 136],
      // Protein cat 3 — עוף ובשר — maximized to 140 kcal ceiling
      ['65 גרם',               65, 139, 11,   null, 'בשר בקר טחון',                     3, '65 גרם',               65, 139],
      ['125 גרם',             125, 137, 28,   null, 'חזה עוף',                          3, '125 גרם',             125, 137],
      ['75 גרם',               75, 140, 14,   null, 'סטייק אנטריקוט',                   3, '75 גרם',               75, 140],
      ['85 גרם',               85, 136, 28,   null, 'פילה בקר',                         3, '85 גרם',               85, 136],
      ['10 פרוסות',           120, 130, 20,   null, 'פסטרמה דלת שומן',                  3, '10 פרוסות',           120, 130],
      ['105 גרם',             105, 136, 19,   null, 'פרגית',                            3, '105 גרם',             105, 136],
      ['7-8 פרוסות',           96, 128, 18,   null, 'קורנביף',                          3, '7-8 פרוסות',           96, 128],
      ['4-5 קציצות (90 גרם)',  90, 135, 18,   null, 'קציצות עוף',                       3, '4-5 קציצות (90 גרם)',  90, 135],
      ['1 חתיכה (70 גרם)',     70, 135, 15,   null, 'שניצל עוף',                        3, '1 חתיכה (70 גרם)',     70, 135],
      // Protein cat 5 — חלבון מהצומח — maximized to 140 kcal ceiling
      ['⅔ כוס',              110, 137, 12,   null, 'אדממה',                             5, '⅔ כוס',              110, 137],
      ['165 גרם',             165, 140, 17,   null, 'טופו קשה',                         5, '165 גרם',             165, 140],
      ['185 גרם',             185, 139, 15,   null, 'טופו רגיל',                        5, '185 גרם',             185, 139],
      ['70 גרם',               70, 140, 16,   null, 'טמפה',                             5, '70 גרם',               70, 140],
      // Legumes cat 7 — maximized to 100 kcal ceiling
      ['2/3 כוס',  107,  94, null, null, 'אפונה מבושלת',          7, '2/3 כוס',  107,  94],
      ['1/4 כוס',   62,  99, null, null, 'חומוס מבושל',           7, '1/4 כוס',   62,  99],
      ['1/4 כוס',   60, 100, null, null, 'סויה מבושלת',           7, '1/4 כוס',   60, 100],
      ['1/3 כוס',   87,  99, null, null, 'עדשים ירוקות מבושלות',  7, '1/3 כוס',   87,  99],
      ['1/3 כוס',   87,  99, null, null, 'עדשים כתומות מבושלות',  7, '1/3 כוס',   87,  99],
      ['1/3 כוס',   90,  99, null, null, 'פול מבושל',             7, '1/3 כוס',   90,  99],
      ['1/3 כוס',   79,  99, null, null, 'שעועית לבנה מבושלת',    7, '1/3 כוס',   79,  99],
      ['1/3 כוס',   76,  99, null, null, 'שעועית שחורה מבושלת',   7, '1/3 כוס',   76,  99],
      // Carbs cat 6 — maximized to 100 kcal ceiling
      ['11 כפות',        110,  94, null, null, 'בורגול מבושל',        6, '11 כפות',        110,  94],
      ['1 פרוסה',         40, 100, null, null, 'לחם מלא',             6, '1 פרוסה',         40, 100],
      ['2.5 פרוסות',      50, 100, null, null, 'לחם קל',              6, '2.5 פרוסות',      50, 100],
      ['1/2 פיתה',        40, 100, null, null, 'פיתה כוסמין',         6, '1/2 פיתה',        40, 100],
      ['9 כפות',          90,  99, null, null, 'קוסקוס מבושל',        6, '9 כפות',          90,  99],
      ['3 כפות יבש',      30, 112, null, null, 'שיבולת שועל',         6, '3 כפות יבש',      30, 112],
      ['4 כפות',          60,  93, null, null, 'פסטה מבושלת',         6, '4 כפות',          60,  93],
      ['1/2 לחמניה',      30,  78, null, null, 'לחמניה מלאה',         6, '1/2 לחמניה',      30,  78],
      ['6 כפות',          75,  98, null, null, 'אורז לבן מבושל',      6, '6 כפות',          75,  98],
      ['4 כפות',          67,  87, null, null, 'פתיתים מבושלים',      6, '4 כפות',          67,  87],
      ['6 כפות',          75,  90, null, null, 'קינואה מבושלת',       6, '6 כפות',          75,  90],
      ['2 יחידות',        20,  77, null, null, 'קרקר מלאים',          6, '2 יחידות',        20,  77],
      ['7 כפות',          87,  96, null, null, 'אורז מלא מבושל',      6, '7 כפות',          87,  96],
      ['6 כפות',          86,  95, null, null, 'אטריות אורז מבושלות', 6, '6 כפות',          86,  95],
      ['2 יחידות',        20,  73, null, null, 'פריכיות אורז',        6, '2 יחידות',        20,  73],
      // Starchy veg cat 8 — maximized to 100 kcal ceiling
      ['1/2 יחידה',       115,  98, null, null, 'בטטה אפויה',          8, '1/2 יחידה',       115,  98],
      ['1.5 כוס',         210,  98, null, null, 'דלעת מבושלת',         8, '1.5 כוס',         210,  98],
      ['1 קלח בינוני',    105, 100, null, null, 'תירס',                8, '1 קלח בינוני',    105, 100],
      ['1 יחידה בינונית', 113,  98, null, null, 'תפוח אדמה אפוי',      8, '1 יחידה בינונית', 113,  98],
      ['1 יחידה',         130, 100, null, null, 'תפוח אדמה מבושל',     8, '1 יחידה',         130, 100],
      // Fats cat 9/10/11 — maximized to 60 kcal ceiling
      ['2 כפות',         36, 60, null, null, 'גואקמולי',             9, '2 כפות',         36, 60],
      ['1.5 כפיות',       8, 56, null, null, 'חמאה',                 9, '1.5 כפיות',       8, 56],
      ['2 כפות',         40, 60, null, null, 'שמנת חמוצה 15%',       9, '2 כפות',         40, 60],
      ['2 כפיות',        10, 59, null, null, 'חמאת בוטנים טבעית',    9, '2 כפיות',        10, 59],
      ['2 כפיות',        10, 59, null, null, 'חמאת שקדים',            9, '2 כפיות',        10, 59],
      ['4 יחידות',       10, 58, null, null, 'שקדים',               10, '4 יחידות',       10, 58],
      ['1 כף',           10, 58, null, null, 'גרעיני חמנייה',       10, '1 כף',           10, 58],
      ['1 כף',           13, 60, null, null, 'גרעיני פשתן',         10, '1 כף',           13, 60],
      ['1 כף',           10, 58, null, null, 'זרעי דלעת',           10, '1 כף',           10, 58],
      ['10 יחידות',      10, 58, null, null, 'פיסטוקים',            10, '10 יחידות',      10, 58],
      ['5 יחידות',       10, 55, null, null, 'קשיו',                10, '5 יחידות',       10, 55],
      ['2 חצאים',         9, 60, null, null, 'אגוזי מלך',           10, '2 חצאים',         9, 60],
      ['2.5 כפות',       37, 59, null, null, 'אבוקדו',              11, '2.5 כפות',       37, 59],
      ['10 יחידות',      40, 55, null, null, 'זיתים ירוקים',        11, '10 יחידות',      40, 55],
      ['10 יחידות',      40, 60, null, null, 'זיתים שחורים',        11, '10 יחידות',      40, 60],
      ['2 כפות גרוסות',  17, 60, null, null, 'קוקוס (טרי)',         11, '2 כפות גרוסות',  17, 60],
      // Vegetables cat 12 — maximized to 40 kcal ceiling
      ['10 גבעולים',    160, 36, null, null, 'אספרגוס',             12, '10 גבעולים',    160, 36],
      ['3 פרחים',       117, 40, null, null, 'ברוקולי',             12, '3 פרחים',       117, 40],
      ['1 יחידה',        97, 40, null, null, 'גזר',                 12, '1 יחידה',        97, 40],
      ['1 יחידה',       150, 40, null, null, 'גמבה אדומה',          12, '1 יחידה',       150, 40],
      ['1 יחידה',       150, 30, null, null, 'גמבה ירוקה',          12, '1 יחידה',       150, 30],
      ['1/2 יחידה',     160, 40, null, null, 'חציל',                12, '1/2 יחידה',     160, 40],
      ['1.5 כוסות',     135, 38, null, null, 'כרוב',                12, '1.5 כוסות',     135, 38],
      ['4 פרחים',       160, 40, null, null, 'כרובית',              12, '4 פרחים',       160, 40],
      ['1/2 יחידה',      93, 40, null, null, 'כרישה',               12, '1/2 יחידה',      93, 40],
      ['1 יחידה',       200, 30, null, null, 'מלפפון',              12, '1 יחידה',       200, 30],
      ['5 גבעולים',     200, 33, null, null, 'סלרי',                12, '5 גבעולים',     200, 33],
      ['כוס',           200, 36, null, null, 'עגבניות שרי',         12, 'כוס',           200, 36],
      ['1 יחידה גדולה', 200, 36, null, null, 'עגבנייה',             12, '1 יחידה גדולה', 200, 36],
      ['4 כוסות',       240, 40, null, null, 'עלי מנגולד',          12, '4 כוסות',       240, 40],
      ['2.5 כוסות',     175, 38, null, null, 'פטריות',              12, '2.5 כוסות',     175, 38],
      ['1 יחידה גדולה', 240, 40, null, null, 'קישוא',               12, '1 יחידה גדולה', 240, 40],
      ['1 כוס',         133, 40, null, null, 'שעועית ירוקה',        12, '1 כוס',         133, 40],
      ['2.5 כוסות',     150, 38, null, null, 'תרד',                 12, '2.5 כוסות',     150, 38],
      // Fruits cat 13 — maximized to 120 kcal ceiling
      ['2 פרוסות',      400, 120, null, null, 'אבטיח',              13, '2 פרוסות',      400, 120],
      ['1 יחידה',       200, 113, null, null, 'אגס',                13, '1 יחידה',       200, 113],
      ['4 טבעות',       200, 100, null, null, 'אננס',               13, '4 טבעות',       200, 100],
      ['1 יחידה',       200,  87, null, null, 'אפרסק',              13, '1 יחידה',       200,  87],
      ['1 יחידה',       240,  80, null, null, 'אשכולית',            13, '1 יחידה',       240,  80],
      ['1 יחידה',       133, 120, null, null, 'בננה',               13, '1 יחידה',       133, 120],
      ['35 יחידות',     175, 112, null, null, 'דובדבנים',           13, '35 יחידות',     175, 112],
      ['3 פרוסות',      300,  98, null, null, 'מלון',               13, '3 פרוסות',      300,  98],
      ['1/2 יחידה',     180, 120, null, null, 'מנגו',               13, '1/2 יחידה',     180, 120],
      ['6 יחידות',      240, 120, null, null, 'משמש',               13, '6 יחידות',      240, 120],
      ['36 יחידות',     180, 120, null, null, 'ענבים',              13, '36 יחידות',     180, 120],
      ['4 יחידות',      120, 100, null, null, 'פסיפלורה',           13, '4 יחידות',      120, 100],
      ['2 יחידות',      197, 120, null, null, 'קיווי',              13, '2 יחידות',      197, 120],
      ['3 יחידות',      225,  98, null, null, 'קלמנטינה/מנדרינה',  13, '3 יחידות',      225,  98],
      ['1/2 יחידה',     150, 120, null, null, 'רימון',              13, '1/2 יחידה',     150, 120],
      ['5 יחידות',      250, 113, null, null, 'שזיף',               13, '5 יחידות',      250, 113],
      ['4 יחידות',      160, 110, null, null, 'תאנה טרייה',         13, '4 יחידות',      160, 110],
      ['40 יחידות',     400, 120, null, null, 'תותים',              13, '40 יחידות',     400, 120],
      ['1 יחידה',        42, 118, null, null, 'תמר',                13, '1 יחידה',        42, 118],
      ['1.5 יחידות',    225, 105, null, null, 'תפוז',               13, '1.5 יחידות',    225, 105],
      ['1 גדול',        240, 120, null, null, 'תפוח',               13, '1 גדול',        240, 120],
    ];

    for (const row of corrections) {
      const r = updateVals.run(...row);
      if (r.changes > 0) { console.log(`[repair] food_bank: corrected ${row[5]}`); fixed++; }
    }

    // Clear stale 'מנה גדולה' notes — these items now have proper maximized portions
    const clearNotes = database.prepare(
      "UPDATE food_items SET notes = NULL WHERE name_he = ? AND category_id = 3 AND notes = 'מנה גדולה'"
    );
    for (const name of ['סטייק אנטריקוט', 'בשר בקר טחון']) {
      const r = clearNotes.run(name);
      if (r.changes > 0) { console.log(`[repair] food_bank: cleared stale notes for ${name}`); fixed++; }
    }

    if (fixed === 0) console.log('[repair] food_bank: all items already up to date');
    else console.log(`[repair] food_bank: corrected ${fixed} item(s)`);
  } catch (err) {
    console.error('[repair] repairFoodBankClinicalData failed:', err.message);
  }
}

repairFoodBankClinicalData(db);

// AI backfills (session-1 assessments, process summaries, check-in messages)
// moved to scheduled jobs: services/jobs.service.js → reconcileAIBackfill().
// No Claude calls run from the database layer.

// ── Repair 6: Create missing client rows for leads stuck as 'became_client' ───
// Catches leads where conversion started but the transaction was interrupted
// before the client row was committed.

function repairOrphanedConvertedLeads(database) {
  try {
    // Find leads that were marked became_client but have no client row
    const orphaned = database.prepare(`
      SELECT l.id, l.full_name, l.phone, l.created_at,
             li.age, li.gender, li.weight, li.goal, li.activity_factor,
             li.bmr_mifflin, li.bmr_harris, li.bmr_average, li.adjusted_weight, li.tdee,
             li.height, li.marital_status, li.num_children, li.occupation,
             li.work_hours, li.work_type, li.eating_at_work, li.medical_conditions,
             li.medications, li.lab_results_pdf_path, li.prev_treatment,
             li.prev_treatment_goal, li.prev_success, li.prev_challenges,
             li.reason_for_treatment, li.diet_type, li.eating_patterns, li.water_intake,
             li.coffee_per_day, li.alcohol_per_week, li.sleep_hours, li.sleep_quality,
             li.physical_activity, li.activity_type, li.activity_frequency,
             li.favorite_snacks, li.favorite_foods, li.nutrition_anamnesis
      FROM leads l
      LEFT JOIN lead_intakes li ON li.lead_id = l.id
      WHERE l.status = 'became_client'
        AND NOT EXISTS (
          SELECT 1 FROM clients c WHERE c.converted_from_lead_id = l.id
        )
    `).all();

    if (orphaned.length === 0) return;
    console.log(`[repair] Found ${orphaned.length} orphaned converted lead(s) — repairing...`);

    for (const lead of orphaned) {
      try {
        const meeting = database.prepare(`
          SELECT * FROM meetings
          WHERE lead_id = ? AND status = 'active'
          ORDER BY start_time ASC LIMIT 1
        `).get(lead.id);

        const sessionDate = meeting
          ? israelDateOf(meeting.start_time)
          : (lead.created_at ? lead.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));

        const doRepair = database.transaction(() => {
          // Create client row
          const clientRes = database.prepare(`
            INSERT INTO clients
              (full_name, phone, age, gender, initial_weight, status,
               converted_from_lead_id, start_date)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `).run(
            lead.full_name, lead.phone || '',
            lead.age || null, lead.gender || null, lead.weight || null,
            lead.id, sessionDate
          );
          const clientId = clientRes.lastInsertRowid;
          console.log(`[repair] ✓ Created client id=${clientId} for lead ${lead.id} "${lead.full_name}"`);

          // Create session 1
          const sessionRes = database.prepare(`
            INSERT INTO sessions (client_id, session_number, session_date, highlights, tasks)
            VALUES (?, 1, ?, '', '[]')
          `).run(clientId, sessionDate);
          const sessionId = sessionRes.lastInsertRowid;
          console.log(`[repair] ✓ Session 1 id=${sessionId} for client ${clientId}`);

          // Link meeting
          if (meeting) {
            database.prepare('UPDATE meetings SET client_id = ? WHERE id = ?')
              .run(clientId, meeting.id);
          }

          // Create 6 session windows
          const windows = calculateSessionWindows(sessionDate);
          database.prepare('DELETE FROM session_windows WHERE client_id = ?').run(clientId);
          const insertWin = database.prepare(
            'INSERT INTO session_windows (client_id, session_number, expected_date) VALUES (?, ?, ?)'
          );
          for (const w of windows) insertWin.run(clientId, w.session_number, w.expected_date);
          console.log(`[repair] ✓ Created ${windows.length} windows for client ${clientId}`);

          // Copy intake data if available
          const hasIntake = lead.age || lead.gender || lead.weight || lead.medical_conditions;
          if (hasIntake) {
            try {
              database.prepare(`
                INSERT INTO session_intakes
                  (session_id, client_id, age, gender, weight, goal, activity_factor,
                   bmr_mifflin, bmr_harris, bmr_average, adjusted_weight, tdee,
                   height, marital_status, num_children, occupation,
                   work_hours, work_type, eating_at_work, medical_conditions, medications,
                   lab_results_pdf_path, prev_treatment, prev_treatment_goal, prev_success,
                   prev_challenges, reason_for_treatment, diet_type, eating_patterns,
                   water_intake, coffee_per_day, alcohol_per_week, sleep_hours, sleep_quality,
                   physical_activity, activity_type, activity_frequency, favorite_snacks,
                   favorite_foods, nutrition_anamnesis)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              `).run(
                sessionId, clientId,
                lead.age, lead.gender, lead.weight, lead.goal, lead.activity_factor,
                lead.bmr_mifflin, lead.bmr_harris, lead.bmr_average, lead.adjusted_weight, lead.tdee,
                lead.height, lead.marital_status, lead.num_children, lead.occupation,
                lead.work_hours, lead.work_type, lead.eating_at_work,
                lead.medical_conditions, lead.medications, lead.lab_results_pdf_path,
                lead.prev_treatment, lead.prev_treatment_goal, lead.prev_success, lead.prev_challenges,
                lead.reason_for_treatment, lead.diet_type, lead.eating_patterns, lead.water_intake,
                lead.coffee_per_day, lead.alcohol_per_week, lead.sleep_hours, lead.sleep_quality,
                lead.physical_activity, lead.activity_type, lead.activity_frequency,
                lead.favorite_snacks, lead.favorite_foods, lead.nutrition_anamnesis || null
              );
              console.log(`[repair] ✓ Copied intake for client ${clientId}`);
            } catch (err) {
              console.error(`[repair] Intake copy failed for client ${clientId}:`, err.message);
            }
          }
        });

        doRepair();
      } catch (err) {
        console.error(`[repair] Failed to repair orphaned lead ${lead.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[repair] repairOrphanedConvertedLeads failed:', err.message);
  }
}

repairOrphanedConvertedLeads(db);

// ── Migrate: create daily_tasks table ─────────────────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      text         TEXT    NOT NULL,
      source       TEXT    DEFAULT 'manual',
      quadrant     INTEGER NOT NULL,
      client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      completed    INTEGER DEFAULT 0,
      completed_at DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      date         DATE    NOT NULL,
      carried_over INTEGER DEFAULT 0
    )
  `);
} catch {
  // Table already exists — safe to ignore
}

// ── Carry over incomplete tasks from previous days to today ───────────────────
function carryOverIncompleteTasks(database) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = database.prepare(`
      UPDATE daily_tasks
      SET date = ?, carried_over = 1
      WHERE date < ? AND completed = 0
    `).run(today, today);
    if (result.changes > 0) {
      console.log(`[tasks] Carried over ${result.changes} tasks to today`);
    }
  } catch (err) {
    console.error('[tasks] carryOverIncompleteTasks failed:', err.message);
  }
}

carryOverIncompleteTasks(db);

// ── Migrate leads: add email column + google_calendar source value ────────────
// SQLite cannot ALTER CHECK constraints, so we recreate the table.
// Guard: skip if the schema already includes 'google_calendar'.
try {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leads'").get();
  if (row && !row.sql.includes('google_calendar')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE leads_new (
        id                INTEGER  PRIMARY KEY AUTOINCREMENT,
        full_name         TEXT     NOT NULL,
        phone             TEXT,
        email             TEXT,
        source            TEXT     CHECK (source IN ('landing_page', 'referral', 'other', 'google_calendar')),
        status            TEXT     NOT NULL DEFAULT 'new'
                                   CHECK (status IN ('new', 'contacted', 'meeting_scheduled', 'became_client', 'not_relevant')),
        notes             TEXT,
        follow_up_date    TEXT,
        created_at        TEXT     NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        status_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO leads_new (id, full_name, phone, source, status, notes, follow_up_date, created_at)
        SELECT id, full_name, phone, source, status, notes, follow_up_date, created_at FROM leads;
      DROP TABLE leads;
      ALTER TABLE leads_new RENAME TO leads;
    `);
    db.exec('PRAGMA foreign_keys = ON');
    console.log('[migration] leads table recreated: added email + google_calendar source');
  }
} catch (err) {
  console.error('[migration] leads table recreation failed:', err.message);
}

// ── Engagements: step 1 migration ────────────────────────────────────────────

// 1. Create engagements table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS engagements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id    INTEGER NOT NULL REFERENCES clients(id),
      number       INTEGER NOT NULL DEFAULT 1,
      status       TEXT    NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'completed')),
      goals        TEXT,
      package_name TEXT,
      price        REAL,
      started_at   TEXT,
      ended_at     TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);
} catch (err) {
  console.error('[migration] engagements table creation failed:', err.message);
}

// 2. Add engagement_id to sessions, payments, meetings
try {
  db.exec('ALTER TABLE sessions ADD COLUMN engagement_id INTEGER');
} catch { /* column already exists */ }

try {
  db.exec('ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT NULL');
} catch { /* column already exists */ }

try {
  db.exec('ALTER TABLE payments ADD COLUMN engagement_id INTEGER');
} catch { /* column already exists */ }

try {
  db.exec('ALTER TABLE meetings ADD COLUMN engagement_id INTEGER');
} catch { /* column already exists */ }

try { db.exec('ALTER TABLE session_intakes ADD COLUMN menu_building TEXT'); } catch {}
try { db.exec('ALTER TABLE lead_intakes ADD COLUMN menu_building TEXT'); } catch {}

// ── Menu feature tables ───────────────────────────────────────────────────────

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menus (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id      INTEGER NOT NULL REFERENCES clients(id),
      engagement_id  INTEGER REFERENCES engagements(id),
      title          TEXT NOT NULL,
      calorie_target INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'final')),
      created_at     TEXT DEFAULT (datetime('now')),
      notes          TEXT
    )
  `);
} catch {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_meals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id    INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      meal_name  TEXT NOT NULL,
      meal_order INTEGER NOT NULL,
      notes      TEXT
    )
  `);
} catch {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      meal_id      INTEGER NOT NULL REFERENCES menu_meals(id) ON DELETE CASCADE,
      item_type    TEXT NOT NULL
                   CHECK (item_type IN ('protein','carb','fat','vegetable','fruit','daily_basket')),
      portions     REAL NOT NULL DEFAULT 1,
      food_item_id INTEGER REFERENCES food_items(id),
      custom_text  TEXT,
      notes        TEXT,
      sort_order   INTEGER DEFAULT 0
    )
  `);
} catch {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_examples (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id        INTEGER NOT NULL REFERENCES menus(id),
      client_summary TEXT,
      menu_summary   TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    )
  `);
} catch {}

// menu_meals: add time_label column (missing from original schema)
try { db.exec('ALTER TABLE menu_meals ADD COLUMN time_label TEXT'); } catch {}

// menu_examples: add calorie_target column for few-shot filtering
try { db.exec('ALTER TABLE menu_examples ADD COLUMN calorie_target INTEGER'); } catch {}

// menu_items: remove CHECK constraint on item_type to allow 'custom' and future types
try {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='menu_items'").get();
  if (schema && schema.sql && schema.sql.includes('CHECK')) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS menu_items_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_id      INTEGER NOT NULL REFERENCES menu_meals(id) ON DELETE CASCADE,
        item_type    TEXT NOT NULL DEFAULT 'protein',
        portions     REAL NOT NULL DEFAULT 1,
        food_item_id INTEGER REFERENCES food_items(id),
        custom_text  TEXT,
        notes        TEXT,
        sort_order   INTEGER DEFAULT 0
      )`);
      db.exec(`INSERT INTO menu_items_new SELECT * FROM menu_items`);
      db.exec(`DROP TABLE menu_items`);
      db.exec(`ALTER TABLE menu_items_new RENAME TO menu_items`);
    })();
    console.log('[db] menu_items CHECK constraint removed — custom item_type now allowed');
  }
} catch (err) {
  console.error('[db] menu_items migration error:', err.message);
}

// ai_recommendations table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_recommendations (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id         INTEGER REFERENCES clients(id),
      type              TEXT NOT NULL,
      priority          TEXT NOT NULL CHECK (priority IN ('urgent','medium','low')),
      title             TEXT NOT NULL,
      message_draft     TEXT,
      action_suggestion TEXT,
      is_dismissed      INTEGER DEFAULT 0,
      is_sent           INTEGER DEFAULT 0,
      created_at        TEXT DEFAULT (datetime('now')),
      expires_at        TEXT
    )
  `);
} catch {}

// 3. Auto-create engagement #1 for every existing client that has none
try {
  db.exec(`
    INSERT INTO engagements (client_id, number, status, started_at)
    SELECT id, 1, 'active', created_at FROM clients
    WHERE id NOT IN (SELECT client_id FROM engagements)
  `);
  const count = db.prepare('SELECT COUNT(*) AS n FROM engagements').get().n;
  if (count > 0) console.log(`[migration] engagements seeded: ${count} total row(s)`);
} catch (err) {
  console.error('[migration] engagements seed failed:', err.message);
}

// ── Food database: food_categories and food_items ─────────────────────────────

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_categories (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nutrient_type TEXT    NOT NULL CHECK (nutrient_type IN ('protein','carb','fat','vegetable','fruit')),
      name_he       TEXT    NOT NULL UNIQUE,
      sort_order    INTEGER DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now'))
    )
  `);
} catch { /* Table already exists — safe to ignore */ }

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_items (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id               INTEGER NOT NULL REFERENCES food_categories(id),
      name_he                   TEXT    NOT NULL,
      portion_description       TEXT,
      portion_grams             REAL,
      calories_per_half_portion REAL,
      protein_grams             REAL,
      notes                     TEXT,
      is_active                 INTEGER DEFAULT 1,
      sort_order                INTEGER DEFAULT 0,
      created_at                TEXT    DEFAULT (datetime('now')),
      UNIQUE(category_id, name_he)
    )
  `);
} catch { /* Table already exists — safe to ignore */ }

// Seed categories (idempotent — INSERT OR IGNORE on UNIQUE name_he)
try {
  const insertCat = db.prepare(
    'INSERT OR IGNORE INTO food_categories (nutrient_type, name_he, sort_order) VALUES (?, ?, ?)'
  );
  db.transaction(() => {
    insertCat.run('protein',   'חלבון מהחי — ביצים ומוצרי חלב',  1);
    insertCat.run('protein',   'חלבון מהחי — דגים',                2);
    insertCat.run('protein',   'חלבון מהחי — עוף ובשר',            3);
    insertCat.run('protein',   'חלבון מהצומח — קטניות',            4);
    insertCat.run('protein',   'חלבון מהצומח — אחר',               5);
    insertCat.run('carb',      'דגנים ולחמים',                      6);
    insertCat.run('carb',      'קטניות (פחמימה)',                   7);
    insertCat.run('carb',      'ירקות עמילניים',                    8);
    insertCat.run('fat',       'שמנים וממרחים',                     9);
    insertCat.run('fat',       'אגוזים וזרעים',                    10);
    insertCat.run('fat',       'פירות שמנים',                      11);
    insertCat.run('vegetable', 'ירקות',                             12);
    insertCat.run('fruit',     'פירות',                             13);
  })();
} catch (err) {
  console.error('[migration] food_categories seed failed:', err.message);
}

// Seed food items (idempotent — INSERT OR IGNORE on UNIQUE(category_id, name_he))
try {
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO food_items
      (category_id, name_he, portion_description, portion_grams,
       calories_per_half_portion, protein_grams, notes)
    VALUES ((SELECT id FROM food_categories WHERE name_he = ?), ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    // ── חלבון מהחי — ביצים ומוצרי חלב ─────────────────────────────────────
    const d = 'חלבון מהחי — ביצים ומוצרי חלב';
    insertItem.run(d, 'ביצה',               '1 ביצה בינונית',  50,  70,  6, null);
    insertItem.run(d, 'ביצה גדולה',         '1 ביצה גדולה',    60,  85,  7, null);
    insertItem.run(d, 'קוטג׳ 3%',           '2 כפות',         100,  95, 12, null);
    insertItem.run(d, 'גבינה לבנה 5%',      '2 כפות',         100, 100, 10, null);
    insertItem.run(d, 'גבינה לבנה 9%',      '2 כפות',         100, 130,  9, null);
    insertItem.run(d, 'גבינה צהובה 9%',     '1 פרוסה',         20,  50,  6, null);
    insertItem.run(d, 'גבינה צהובה 15%',    '1 פרוסה',         20,  60,  5, null);
    insertItem.run(d, 'גבינה צהובה 28%',    '1 פרוסה',         20,  75,  5, null);
    insertItem.run(d, 'גבינה בולגרית 5%',   '3 כפות',          60,  65,  8, null);
    insertItem.run(d, 'גבינת עזים 5%',      '2 כפות',          40,  60,  7, null);
    insertItem.run(d, 'גבינת ריקוטה',       '3 כפות',          60,  80,  7, null);
    insertItem.run(d, 'גבינת פטה',          '30 גרם',          30,  75,  5, null);
    insertItem.run(d, 'יוגורט יווני 0%',    '3/4 כוס',        150,  85, 15, null);
    insertItem.run(d, 'יוגורט יווני 2%',    '3/4 כוס',        150, 110, 12, null);
    insertItem.run(d, 'יוגורט ביו עד 3%',   '1 גביע',         150,  90,  7, null);
    // שמנת חמוצה moved to שמנים וממרחים (fat category) — seeded there below
    insertItem.run(d, 'מעדן חלבון',         '1 יחידה',        200, 140, 20, '= מנה שלמה');
    insertItem.run(d, 'משקה חלבון',         '1 בקבוק',        250, 130, 25, '= מנה שלמה ויותר');

    // ── חלבון מהחי — דגים ──────────────────────────────────────────────────
    const fi = 'חלבון מהחי — דגים';
    insertItem.run(fi, 'פילה דג לבן (לברק/מושט/דניס)', '1 פילה',    100,  90, 18, null);
    insertItem.run(fi, 'פילה סלמון',                   '1/2 פילה',   80, 130, 16, null);
    insertItem.run(fi, 'טונה במים',                    '1/2 פחית',   60,  60, 14, null);
    insertItem.run(fi, 'טונה בשמן',                    '1/2 פחית',   60, 115, 12, null);
    insertItem.run(fi, 'סלמון מעושן',                  '2 פרוסות',   40,  65,  9, null);
    insertItem.run(fi, 'הליבוט',                       '1 פילה',    100,  90, 18, null);
    insertItem.run(fi, 'בקלה',                         '1 פילה',    100,  80, 18, null);
    insertItem.run(fi, 'דג מוסר ים',                   '1 פילה',    100,  95, 18, null);
    insertItem.run(fi, 'פלמידה',                       '1 פילה',    100, 145, 22, null);
    insertItem.run(fi, 'שרימפס',                       '10 יחידות', 100,  85, 18, null);

    // ── חלבון מהחי — עוף ובשר ──────────────────────────────────────────────
    const m = 'חלבון מהחי — עוף ובשר';
    insertItem.run(m, 'חזה עוף',          '1-2 חתיכות',  100, 110, 22, 'לאחר בישול');
    insertItem.run(m, 'פרגית',            '1-2 חתיכות',  100, 130, 18, 'לאחר בישול');
    insertItem.run(m, 'שניצל עוף',        '1 חתיכה',      80, 155, 14, null);
    insertItem.run(m, 'קציצות עוף',       '4-5 קציצות',  100, 150, 16, null);
    insertItem.run(m, 'כרע עוף ללא עור',  '1 כרע',       100, 120, 19, null);
    insertItem.run(m, 'בשר בקר טחון',     '100 גרם',     100, 215, 17, 'לפני בישול, 15% שומן');
    insertItem.run(m, 'סטייק אנטריקוט',   '150-200 גרם', 150, 280, 28, null);
    insertItem.run(m, 'פילה בקר',         '150 גרם',     150, 240, 30, null);
    insertItem.run(m, 'פסטרמה דלת שומן',  '4-5 פרוסות',   60,  65, 10, null);
    insertItem.run(m, 'קורנביף',          '4-5 פרוסות',   60,  80, 11, null);
    insertItem.run(m, 'נקניקיות עוף',     '2 יחידות',     80, 140, 10, null);

    // ── חלבון מהצומח — קטניות ───────────────────────────────────────────────
    // Legumes reclassified to קטניות (פחמימה) (carb category) — seeded there below

    // ── חלבון מהצומח — אחר ──────────────────────────────────────────────────
    const po = 'חלבון מהצומח — אחר';
    insertItem.run(po, 'טופו רגיל', '100 גרם', 100,  75,  8, null);
    insertItem.run(po, 'טופו קשה',  '100 גרם', 100,  85, 10, null);
    insertItem.run(po, 'טמפה',      '80 גרם',   80, 160, 15, null);
    insertItem.run(po, 'סייטן',     '80 גרם',   80, 140, 25, null);
    insertItem.run(po, 'אדממה',     '1/2 כוס',  80, 100,  9, null);

    // ── דגנים ולחמים ────────────────────────────────────────────────────────
    const g = 'דגנים ולחמים';
    insertItem.run(g, 'אורז לבן מבושל',      '8 כפות',      100, 130, 3, null);
    insertItem.run(g, 'אורז מלא מבושל',      '8 כפות',      100, 110, 3, null);
    insertItem.run(g, 'קינואה מבושלת',       '8 כפות',      100, 120, 4, null);
    insertItem.run(g, 'בורגול מבושל',        '10 כפות',     100,  85, 3, null);
    insertItem.run(g, 'קוסקוס מבושל',        '10 כפות',     100, 110, 4, null);
    insertItem.run(g, 'פסטה מבושלת',         '6-7 כפות',    100, 155, 6, null);
    insertItem.run(g, 'אטריות אורז מבושלות', '7 כפות',      100, 110, 2, null);
    insertItem.run(g, 'פתיתים מבושלים',      '6 כפות',      100, 130, 4, null);
    insertItem.run(g, 'שיבולת שועל',         '4 כפות יבש',   40, 150, 5, null);
    insertItem.run(g, 'לחם מלא',             '1 פרוסה',      30,  75, 4, null);
    insertItem.run(g, 'לחם קל',              '2 פרוסות',     40,  80, 4, null);
    insertItem.run(g, 'חלה',                 '1 פרוסה',      30,  80, 3, null);
    insertItem.run(g, 'פיתה כוסמין',         '1 קטנה',       60, 150, 5, null);
    insertItem.run(g, 'לחמניה מלאה',         '1 יחידה',      60, 155, 5, null);
    insertItem.run(g, 'טורטייה',             '1 יחידה',      30,  90, 3, null);
    insertItem.run(g, 'קרקר מלאים',          '3 יחידות',     30, 115, 3, null);
    insertItem.run(g, 'פריכיות אורז',        '3 יחידות',     30, 110, 2, null);
    insertItem.run(g, 'ברנפלקס',             '2 כפות',       20,  70, 2, null);
    insertItem.run(g, 'גרנולה ללא סוכר',     '2 כפות',       25, 100, 3, null);

    // ── ירקות עמילניים ──────────────────────────────────────────────────────
    const sv = 'ירקות עמילניים';
    insertItem.run(sv, 'תפוח אדמה אפוי',  '1-2 יחידות בינוניות', 150, 130, 3, null);
    insertItem.run(sv, 'תפוח אדמה מבושל', '1-2 יחידות',          150, 115, 3, null);
    insertItem.run(sv, 'בטטה אפויה',       '1/2 יחידה',           100,  85, 2, null);
    insertItem.run(sv, 'תירס',             '1 קלח בינוני',        100,  95, 3, null);
    insertItem.run(sv, 'דלעת מבושלת',      '1 כוס',               150,  70, 2, null);

    // ── קטניות (פחמימה) ─────────────────────────────────────────────────────
    const lc = 'קטניות (פחמימה)';
    insertItem.run(lc, 'עדשים כתומות מבושלות',  '1/3 כוס',  70,  80,  9, null);
    insertItem.run(lc, 'עדשים ירוקות מבושלות',  '1/3 כוס',  70,  80,  9, null);
    insertItem.run(lc, 'שעועית לבנה מבושלת',    '1/3 כוס',  70,  88,  9, null);
    insertItem.run(lc, 'שעועית שחורה מבושלת',   '1/3 כוס',  65,  85,  9, null);
    insertItem.run(lc, 'חומוס מבושל',           '1/4 כוס',  50,  80,  9, null);
    insertItem.run(lc, 'אפונה מבושלת',          '1/2 כוס',  80,  70,  4, null);
    insertItem.run(lc, 'פול מבושל',             '1/3 כוס',  70,  77,  8, null);
    insertItem.run(lc, 'סויה מבושלת',           '1/4 כוס',  55,  92, 14, null);

    // ── שמנים וממרחים ────────────────────────────────────────────────────────
    const oi = 'שמנים וממרחים';
    insertItem.run(oi, 'שמן זית',           '1/2 כף',   7,  60, 0, null);
    insertItem.run(oi, 'שמן קוקוס',         '1/2 כף',   7,  60, 0, null);
    insertItem.run(oi, 'חמאה',              '1 כפית',   5,  35, 0, null);
    insertItem.run(oi, 'שמנת חמוצה 15%',   '2 כפות',  30,  45, 1, 'כמות חלבון נמוכה');
    insertItem.run(oi, 'טחינה גולמית',      '2 כפיות', 10,  60, 2, null);
    insertItem.run(oi, 'סלט טחינה מוכן',    '1 כף',    20,  60, 2, null);
    insertItem.run(oi, 'חמאת בוטנים טבעית', '1 כף',    16,  95, 4, null);
    insertItem.run(oi, 'חמאת שקדים',        '1 כף',    16,  95, 4, null);
    insertItem.run(oi, 'גואקמולי',          '2 כפות',  30,  50, 1, null);

    // ── אגוזים וזרעים ────────────────────────────────────────────────────────
    const ns = 'אגוזים וזרעים';
    insertItem.run(ns, 'שקדים',          '8 יחידות',  20, 115, 4, null);
    insertItem.run(ns, 'אגוזי מלך',      '2 חצאים',   15, 100, 2, null);
    insertItem.run(ns, 'קשיו',           '10 יחידות', 20, 110, 3, null);
    insertItem.run(ns, 'פיסטוקים',       '20 יחידות', 20, 115, 4, null);
    insertItem.run(ns, 'גרעיני חמנייה',  '2 כפות',    20, 115, 4, null);
    insertItem.run(ns, 'זרעי צ׳יה',      '1 כף',      12,  58, 2, null);
    insertItem.run(ns, 'גרעיני פשתן',    '1 כף',      12,  55, 2, null);
    insertItem.run(ns, 'זרעי דלעת',      '2 כפות',    20, 115, 6, null);

    // ── פירות שמנים ─────────────────────────────────────────────────────────
    const ff = 'פירות שמנים';
    insertItem.run(ff, 'אבוקדו',        '1/4 יחידה',  50,  80, 1, null);
    insertItem.run(ff, 'קוקוס (טרי)',   '30 גרם',     30, 105, 1, null);
    insertItem.run(ff, 'זיתים שחורים',  '10 יחידות',  40,  60, 0, null);
    insertItem.run(ff, 'זיתים ירוקים',  '10 יחידות',  40,  55, 0, null);

    // ── ירקות ───────────────────────────────────────────────────────────────
    const v = 'ירקות';
    insertItem.run(v, 'מלפפון',        '1 יחידה',    100,  15, 1, null);
    insertItem.run(v, 'עגבנייה',       '1 יחידה',    100,  18, 1, null);
    insertItem.run(v, 'עגבניות שרי',   '4-6 יחידות', 100,  18, 1, null);
    insertItem.run(v, 'גמבה אדומה',    '1/2 יחידה',   75,  20, 1, null);
    insertItem.run(v, 'גמבה ירוקה',    '1/2 יחידה',   75,  15, 1, null);
    insertItem.run(v, 'גזר',           '1 יחידה',     80,  33, 1, null);
    insertItem.run(v, 'קישוא',         '1 יחידה',    150,  25, 2, null);
    insertItem.run(v, 'ברוקולי',       '3 פרחים',    100,  34, 3, null);
    insertItem.run(v, 'כרובית',        '3 פרחים',    100,  25, 2, null);
    insertItem.run(v, 'חסה/עלים',      'ללא הגבלה',  100,  15, 1, 'ללא הגבלה');
    insertItem.run(v, 'תרד',           '1 כוס',       60,  15, 2, null);
    insertItem.run(v, 'כרוב',          '1 כוס',       90,  25, 1, null);
    insertItem.run(v, 'סלרי',          '2 גבעולים',   80,  13, 1, null);
    insertItem.run(v, 'פטריות',        '1 כוס',       70,  15, 2, null);
    insertItem.run(v, 'בצל',           '1 יחידה',    100,  40, 1, null);
    insertItem.run(v, 'כרישה',         '1/2 יחידה',   70,  30, 1, null);
    insertItem.run(v, 'שעועית ירוקה',  '100 גרם',    100,  30, 2, null);
    insertItem.run(v, 'אספרגוס',       '5 גבעולים',   80,  18, 2, null);
    insertItem.run(v, 'חציל',          '1/2 יחידה',  100,  25, 1, null);
    insertItem.run(v, 'עלי מנגולד',    '1 כוס',       60,  10, 1, null);

    // ── פירות ───────────────────────────────────────────────────────────────
    const fr = 'פירות';
    insertItem.run(fr, 'תפוח',             '1 קטן',      120,  60, 0, null);
    insertItem.run(fr, 'בננה',             '1 יחידה',    100,  90, 1, null);
    insertItem.run(fr, 'אגס',              '1 יחידה',    150,  85, 1, null);
    insertItem.run(fr, 'אפרסק',            '1 יחידה',    150,  65, 1, null);
    insertItem.run(fr, 'שזיף',             '2 קטנים',    100,  45, 1, null);
    insertItem.run(fr, 'משמש',             '2 יחידות',    80,  40, 1, null);
    insertItem.run(fr, 'תמר',              '1 יחידה',     25,  70, 0, null);
    insertItem.run(fr, 'תותים',            '10 יחידות',  100,  30, 1, null);
    insertItem.run(fr, 'ענבים',            '15 יחידות',   75,  50, 0, null);
    insertItem.run(fr, 'דובדבנים',         '15 יחידות',   75,  48, 1, null);
    insertItem.run(fr, 'קלמנטינה/מנדרינה','2 יחידות',   150,  65, 1, null);
    insertItem.run(fr, 'תפוז',             '1 יחידה',    150,  70, 1, null);
    insertItem.run(fr, 'אשכולית',          '1/2 יחידה',  120,  40, 1, null);
    insertItem.run(fr, 'מנגו',             '1/2 יחידה',  150, 100, 1, null);
    insertItem.run(fr, 'אננס',             '2 טבעות',    100,  50, 1, null);
    insertItem.run(fr, 'אבטיח',            'פרוסה',      200,  60, 1, null);
    insertItem.run(fr, 'מלון',             '2 פרוסות',   200,  65, 1, null);
    insertItem.run(fr, 'קיווי',            '2 יחידות',   140,  85, 2, null);
    insertItem.run(fr, 'רימון',            '1/2 יחידה',  100,  80, 1, null);
    insertItem.run(fr, 'תאנה טרייה',       '2 יחידות',    80,  55, 1, null);
    insertItem.run(fr, 'פסיפלורה',         '2 יחידות',    60,  50, 1, null);
  })();
} catch (err) {
  console.error('[migration] food_items seed failed:', err.message);
}

// Log row counts per category after seeding
try {
  const counts = db.prepare(`
    SELECT fc.name_he, COUNT(fi.id) AS item_count
    FROM food_categories fc
    LEFT JOIN food_items fi ON fi.category_id = fc.id
    GROUP BY fc.id
    ORDER BY fc.sort_order
  `).all();
  for (const row of counts) {
    console.log(`[food-db] ${row.name_he}: ${row.item_count} פריטים`);
  }
} catch { /* non-fatal */ }

// weight_logs table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weight_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id    INTEGER NOT NULL REFERENCES clients(id),
      weigh_date   TEXT    NOT NULL,
      weight       REAL    NOT NULL,
      day_of_week  TEXT    CHECK (day_of_week IN ('monday','thursday')),
      notes        TEXT,
      created_at   TEXT    DEFAULT (datetime('now')),
      UNIQUE(client_id, weigh_date)
    )
  `);
} catch {}

// whatsapp_log — add direction, message_type, status columns for bot support
try { db.exec("ALTER TABLE whatsapp_log ADD COLUMN direction TEXT NOT NULL DEFAULT 'outgoing'"); } catch {}
try { db.exec("ALTER TABLE whatsapp_log ADD COLUMN message_type TEXT"); } catch {}
try { db.exec("ALTER TABLE whatsapp_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'"); } catch {}

// weight_token — unique shareable token per client for public weight entry
try { db.exec('ALTER TABLE clients ADD COLUMN weight_token TEXT'); } catch {}
try {
  db.exec("UPDATE clients SET weight_token = hex(randomblob(8)) WHERE weight_token IS NULL");
  const tokenCount = db.prepare("SELECT COUNT(*) AS n FROM clients WHERE weight_token IS NOT NULL").get().n;
  if (tokenCount > 0) console.log(`[migration] weight_token seeded for ${tokenCount} client(s)`);
} catch (err) {
  console.error('[migration] weight_token seed failed:', err.message);
}

// food_items — client submission columns
try { db.exec('ALTER TABLE food_items ADD COLUMN submitted_by_client INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE food_items ADD COLUMN approved INTEGER DEFAULT 0'); } catch {}

// recipes table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      name                 TEXT NOT NULL,
      description          TEXT,
      servings             INTEGER NOT NULL DEFAULT 1,
      submitted_by_client  INTEGER DEFAULT 1,
      created_at           TEXT DEFAULT (datetime('now'))
    )
  `);
} catch {}

// recipe_ingredients table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id        INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
      food_item_id     INTEGER REFERENCES food_items(id),
      custom_food_name TEXT,
      amount_grams     REAL NOT NULL,
      notes            TEXT
    )
  `);
} catch {}

// client_food_favorites — starred foods per client (DB items and OFA items)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_food_favorites (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL REFERENCES clients(id),
      food_item_id     INTEGER REFERENCES food_items(id),
      ofa_product_name TEXT,
      ofa_kcal_100g    REAL,
      ofa_protein_100g REAL,
      ofa_macro_type   TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      UNIQUE(client_id, food_item_id),
      UNIQUE(client_id, ofa_product_name)
    )
  `);
} catch {}

// index on food_items.name_he for faster LIKE searches
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_food_items_name_he ON food_items(name_he)');
} catch {}

// ai_memory — persistent memory store for future RAG/Vector DB upgrade
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_memory (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id       INTEGER REFERENCES clients(id),
      memory_type     TEXT NOT NULL CHECK (memory_type IN (
                        'anamnesis_summary',
                        'menu_insight',
                        'conversation',
                        'progress',
                        'protocol_note'
                      )),
      content         TEXT NOT NULL,
      source_type     TEXT,
      source_id       INTEGER,
      embedding_ready INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);
} catch {}

// process stop / freeze columns
try { db.exec('ALTER TABLE clients ADD COLUMN stop_reason TEXT'); } catch {}
try { db.exec('ALTER TABLE clients ADD COLUMN stop_reason_text TEXT'); } catch {}
try { db.exec('ALTER TABLE clients ADD COLUMN stop_date TEXT'); } catch {}
try { db.exec('ALTER TABLE clients ADD COLUMN frozen_until TEXT'); } catch {}
try { db.exec('ALTER TABLE clients ADD COLUMN stopped_at TEXT DEFAULT NULL'); } catch {}

// Expand clients.status CHECK to include 'frozen' (requires table recreation in SQLite)
try {
  const clientsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='clients'").get()?.sql || '';
  if (!clientsSql.includes("'frozen'")) {
    const existingCols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
    const colList = existingCols.join(', ');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE clients_v2 (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name               TEXT    NOT NULL,
        phone                   TEXT    DEFAULT '',
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
                                        CHECK (status IN ('active', 'ending_soon', 'ended', 'paused', 'frozen')),
        payment_status          TEXT    DEFAULT 'unpaid',
        package_price           REAL    DEFAULT 0,
        converted_from_lead_id  INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        calendly_link           TEXT,
        pending_intake_data     TEXT,
        protocol_id             INTEGER REFERENCES protocols(id) ON DELETE SET NULL,
        ai_summary              TEXT,
        ai_summary_updated_at   DATETIME,
        process_summary         TEXT,
        weight_token            TEXT,
        stop_reason             TEXT    CHECK (stop_reason IN ('goal_achieved', 'cant_continue', 'not_suitable', 'frozen', 'other')),
        stop_reason_text        TEXT,
        stop_date               TEXT,
        frozen_until            TEXT,
        stopped_at              TEXT    DEFAULT NULL
      )
    `);
    db.exec(`INSERT INTO clients_v2 (${colList}) SELECT ${colList} FROM clients`);
    db.exec('DROP TABLE clients');
    db.exec('ALTER TABLE clients_v2 RENAME TO clients');
    db.exec('PRAGMA foreign_keys = ON');
    console.log('[migrate] clients table: added frozen status + stop columns');
  }
} catch (err) {
  try { db.exec('PRAGMA foreign_keys = ON'); } catch {}
  console.error('[migrate] clients CHECK migration failed:', err.message);
}

// ── Multi-user auth: users, sessions, activity_log tables ────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    )
  `);
} catch (err) {
  console.error('[migrate] users table failed:', err.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      token      TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  console.error('[migrate] auth_sessions table failed:', err.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id),
      user_name  TEXT NOT NULL,
      method     TEXT NOT NULL,
      path       TEXT NOT NULL,
      label      TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  console.error('[migrate] activity_log table failed:', err.message);
}

// ── Seed: bootstrap one owner user from AUTH_PASSWORD (one-time only) ────────
try {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0 && process.env.AUTH_PASSWORD) {
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync(process.env.AUTH_PASSWORD, 10);
    db.prepare('INSERT INTO users (name, password_hash) VALUES (?, ?)').run('נתנאל מלכה', hash);
    console.log('[seed] Created initial owner user "נתנאל מלכה" from AUTH_PASSWORD');
  }
} catch (err) {
  console.error('[seed] Owner user seed failed:', err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 flow repairs (2026-11-04)
// Runs last so every table referenced below already exists. All idempotent.
// ─────────────────────────────────────────────────────────────────────────────

// ai_recommendations.handled_at — when it was sent/dismissed (drives the cooldown
// that stops handled recommendations from being regenerated)
try { db.exec('ALTER TABLE ai_recommendations ADD COLUMN handled_at TEXT'); } catch { /* exists */ }

// ── Repair 7: every client has start_date (when derivable) and process_end_date ──
// Converted leads never got process_end_date, so "ending soon" / "ended" alerts
// could not fire for them. Covers every status (active, ending_soon, ended, paused, frozen).
function repairProcessDates(database) {
  try {
    const missingStart = database.prepare(`
      SELECT c.id, MIN(s.session_date) AS first_session
      FROM clients c
      JOIN sessions s ON s.client_id = c.id AND s.session_date IS NOT NULL AND s.session_date != ''
      WHERE c.start_date IS NULL OR c.start_date = ''
      GROUP BY c.id
    `).all();
    for (const row of missingStart) {
      const startDate = String(row.first_session).slice(0, 10);
      database.prepare('UPDATE clients SET start_date = ? WHERE id = ?').run(startDate, row.id);
      console.log(`[repair] Set start_date=${startDate} for client ${row.id} (from first session)`);
    }

    const missingEnd = database.prepare(`
      SELECT id, start_date FROM clients
      WHERE (process_end_date IS NULL OR process_end_date = '')
        AND start_date IS NOT NULL AND start_date != ''
    `).all();
    for (const c of missingEnd) {
      const endDate = calculateProcessEndDate(String(c.start_date).slice(0, 10));
      if (!endDate) continue;
      database.prepare('UPDATE clients SET process_end_date = ? WHERE id = ?').run(endDate, c.id);
      console.log(`[repair] Set process_end_date=${endDate} for client ${c.id}`);
    }
  } catch (err) {
    console.error('[repair] repairProcessDates failed:', err.message);
  }
}

// ── Repair 8: engagements are consistent and every row is linked to one ───────
function repairEngagementLinks(database) {
  try {
    // a) every client has at least engagement #1
    const noEngagement = database.prepare(`
      SELECT id, COALESCE(start_date, substr(created_at, 1, 10)) AS started
      FROM clients WHERE id NOT IN (SELECT client_id FROM engagements)
    `).all();
    for (const c of noEngagement) {
      database.prepare(
        "INSERT INTO engagements (client_id, number, status, started_at) VALUES (?, 1, 'active', ?)"
      ).run(c.id, c.started);
      console.log(`[repair] Created engagement #1 for client ${c.id}`);
    }

    // b) ended clients must not keep an active engagement
    const endedActive = database.prepare(`
      SELECT e.id, e.client_id,
             COALESCE(c.stop_date, c.process_end_date, ?) AS ended_at
      FROM engagements e JOIN clients c ON c.id = e.client_id
      WHERE c.status = 'ended' AND e.status = 'active'
    `).all(todayISO());
    for (const e of endedActive) {
      database.prepare("UPDATE engagements SET status = 'completed', ended_at = ? WHERE id = ?")
        .run(e.ended_at, e.id);
      console.log(`[repair] Closed engagement ${e.id} for ended client ${e.client_id}`);
    }

    // c) link sessions / payments / meetings that have no engagement_id
    //    to the client's active engagement, or its latest one if none is active
    const targetEngagement = `
      (SELECT e.id FROM engagements e
       WHERE e.client_id = t.client_id
       ORDER BY (e.status = 'active') DESC, e.number DESC LIMIT 1)`;
    for (const table of ['sessions', 'payments', 'meetings']) {
      const result = database.prepare(`
        UPDATE ${table} AS t SET engagement_id = ${targetEngagement}
        WHERE t.engagement_id IS NULL AND t.client_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM engagements e WHERE e.client_id = t.client_id)
      `).run();
      if (result.changes > 0) {
        console.log(`[repair] Linked ${result.changes} ${table} row(s) to their engagement`);
      }
    }
  } catch (err) {
    console.error('[repair] repairEngagementLinks failed:', err.message);
  }
}

// ── Repair 9: clients with a finalized menu are marked menu_sent ─────────────
function repairMenuSentFromFinalMenus(database) {
  try {
    const rows = database.prepare(`
      SELECT c.id, MIN(substr(m.created_at, 1, 10)) AS first_final
      FROM clients c
      JOIN menus m ON m.client_id = c.id AND m.status = 'final'
      WHERE c.menu_sent = 0
      GROUP BY c.id
    `).all();
    for (const r of rows) {
      database.prepare(`
        UPDATE clients SET menu_sent = 1, menu_sent_date = COALESCE(menu_sent_date, ?)
        WHERE id = ?
      `).run(r.first_final, r.id);
      database.prepare(`
        UPDATE ai_recommendations SET is_dismissed = 1, handled_at = datetime('now')
        WHERE client_id = ? AND type = 'menu_update_needed' AND is_dismissed = 0
      `).run(r.id);
      console.log(`[repair] Marked menu_sent for client ${r.id} (final menu from ${r.first_final})`);
    }
  } catch (err) {
    console.error('[repair] repairMenuSentFromFinalMenus failed:', err.message);
  }
}

// ── Repair 10: weight_token for any client still missing one ─────────────────
function repairWeightTokens(database) {
  try {
    const result = database.prepare(
      "UPDATE clients SET weight_token = lower(hex(randomblob(8))) WHERE weight_token IS NULL OR weight_token = ''"
    ).run();
    if (result.changes > 0) console.log(`[repair] Generated weight_token for ${result.changes} client(s)`);
  } catch (err) {
    console.error('[repair] repairWeightTokens failed:', err.message);
  }
}

// Orphaned converted leads (became_client with no client row) are repaired by
// repairOrphanedConvertedLeads above; the repairs below then complete the rows
// it creates (process_end_date, engagement, links, token) in the same startup.
repairProcessDates(db);
repairEngagementLinks(db);
repairMenuSentFromFinalMenus(db);
repairWeightTokens(db);

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 (time normalization) + Phase 3 (session status model) — 2026-11-04
// ─────────────────────────────────────────────────────────────────────────────

// Google Calendar incremental sync state (replaces the in-memory lastPollTime)
try { db.exec('ALTER TABLE settings ADD COLUMN google_sync_token TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE settings ADD COLUMN google_last_sync_at TEXT'); } catch { /* exists */ }

// Session ↔ meeting link (the booking a session came from)
try {
  db.exec('ALTER TABLE sessions ADD COLUMN meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL');
} catch { /* exists */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_meeting_id ON sessions(meeting_id)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_meetings_google_event_id ON meetings(google_event_id)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time)'); } catch {}

// leads.status CHECK: add meeting_held (used by the UI, rejected by the old constraint).
// SQLite cannot alter a CHECK → recreate, copying every existing column.
try {
  const leadsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leads'").get()?.sql || '';
  if (leadsSql && !leadsSql.includes("'meeting_held'")) {
    const cols = db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);
    const known = ['id', 'full_name', 'phone', 'email', 'source', 'status', 'notes',
                   'follow_up_date', 'created_at', 'status_updated_at'];
    const extra = cols.filter((c) => !known.includes(c));
    if (extra.length > 0) throw new Error(`unexpected leads columns: ${extra.join(', ')}`);
    const colList = cols.join(', ');
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE leads_v3 (
          id                INTEGER  PRIMARY KEY AUTOINCREMENT,
          full_name         TEXT     NOT NULL,
          phone             TEXT,
          email             TEXT,
          source            TEXT     CHECK (source IN ('landing_page', 'referral', 'other', 'google_calendar')),
          status            TEXT     NOT NULL DEFAULT 'new'
                                     CHECK (status IN ('new', 'contacted', 'meeting_scheduled', 'meeting_held', 'became_client', 'not_relevant')),
          notes             TEXT,
          follow_up_date    TEXT,
          created_at        TEXT     NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          status_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`INSERT INTO leads_v3 (${colList}) SELECT ${colList} FROM leads`);
      db.exec('DROP TABLE leads');
      db.exec('ALTER TABLE leads_v3 RENAME TO leads');
    })();
    db.pragma('foreign_keys = ON');
    console.log('[migration] leads.status CHECK now allows meeting_held');
  }
} catch (err) {
  try { db.pragma('foreign_keys = ON'); } catch {}
  console.error('[migration] leads meeting_held CHECK migration failed:', err.message);
}

// ── Repair 11: meeting instants → canonical UTC ISO ("YYYY-MM-DDTHH:MM:SS.sssZ") ──
// Rows held three formats: Calendly UTC "…000000Z", Google "+02:00" offsets and
// naive manual "YYYY-MM-DDTHH:MM:SS" (Israel local). String comparisons in SQL
// only work once every row uses the same fixed-length UTC form.
function repairMeetingInstants(database) {
  try {
    const rows = database.prepare('SELECT id, start_time, end_time FROM meetings').all();
    const update = database.prepare('UPDATE meetings SET start_time = ?, end_time = ? WHERE id = ?');
    let fixed = 0;
    for (const r of rows) {
      const startOk = !r.start_time || isCanonicalInstant(r.start_time);
      const endOk   = !r.end_time   || isCanonicalInstant(r.end_time);
      if (startOk && endOk) continue;
      const start = r.start_time ? toUtcISO(r.start_time) : null;
      const end   = r.end_time   ? toUtcISO(r.end_time)   : null;
      if ((r.start_time && !start) || (r.end_time && !end)) {
        console.error(`[repair] Meeting ${r.id}: unparseable time "${r.start_time}" / "${r.end_time}" — left as is`);
        continue;
      }
      update.run(start, end, r.id);
      fixed++;
      console.log(`[repair] Meeting ${r.id}: ${r.start_time} → ${start}`);
    }
    if (fixed > 0) console.log(`[repair] Normalized ${fixed} meeting time(s) to UTC ISO`);
  } catch (err) {
    console.error('[repair] repairMeetingInstants failed:', err.message);
  }
}

// ── Repair 12: sessions.session_date → Israel calendar date "YYYY-MM-DD" ──────
// Booking-created sessions stored the raw booking instant (any of the 3 formats).
// session_date is a calendar day (date inputs, windows, alerts) — not an instant.
function repairSessionDates(database) {
  try {
    const rows = database.prepare(`
      SELECT id, client_id, session_date FROM sessions
      WHERE session_date IS NOT NULL AND session_date != ''
        AND session_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    `).all();
    for (const r of rows) {
      const date = israelDateOf(r.session_date);
      if (!date) {
        console.error(`[repair] Session ${r.id}: unparseable session_date "${r.session_date}" — left as is`);
        continue;
      }
      database.prepare('UPDATE sessions SET session_date = ? WHERE id = ?').run(date, r.id);
      console.log(`[repair] Session ${r.id} (client ${r.client_id}): session_date ${r.session_date} → ${date}`);
    }
  } catch (err) {
    console.error('[repair] repairSessionDates failed:', err.message);
  }
}

// ── Repair 13: every session has a lifecycle status ──────────────────────────
// legacy 'completed' → held; missing: future date → scheduled, otherwise held
// (conservative default, also for past sessions without notes).
function repairSessionStatuses(database) {
  try {
    const legacy = database.prepare("UPDATE sessions SET status = 'held' WHERE status = 'completed'").run();
    if (legacy.changes > 0) console.log(`[repair] ${legacy.changes} session(s): status completed → held`);

    const today = todayISO();
    const rows = database.prepare(`
      SELECT id, client_id, session_date, status FROM sessions
      WHERE status IS NULL OR status NOT IN ('scheduled', 'held', 'no_show', 'canceled')
    `).all();
    for (const r of rows) {
      const date = r.session_date ? israelDateOf(r.session_date) : null;
      const status = date && date > today ? 'scheduled' : 'held';
      database.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, r.id);
      console.log(`[repair] Session ${r.id} (client ${r.client_id}, ${r.session_date || 'no date'}): status ${r.status ?? 'NULL'} → ${status}`);
    }
  } catch (err) {
    console.error('[repair] repairSessionStatuses failed:', err.message);
  }
}

// ── Repair 14: link sessions to the meeting they were booked from ────────────
// Match = same client + same Israel calendar day; each meeting links at most once.
function repairSessionMeetingLinks(database) {
  try {
    const unlinked = database.prepare(`
      SELECT id, client_id, session_date FROM sessions
      WHERE meeting_id IS NULL AND client_id IS NOT NULL AND session_date IS NOT NULL
    `).all();
    if (unlinked.length === 0) return;

    const linkedIds = new Set(
      database.prepare('SELECT meeting_id FROM sessions WHERE meeting_id IS NOT NULL').all().map((r) => r.meeting_id)
    );
    const meetingsByClient = {};
    for (const m of database.prepare('SELECT id, client_id, start_time FROM meetings WHERE client_id IS NOT NULL ORDER BY start_time').all()) {
      (meetingsByClient[m.client_id] ||= []).push(m);
    }
    for (const s of unlinked) {
      const match = (meetingsByClient[s.client_id] || []).find(
        (m) => !linkedIds.has(m.id) && israelDateOf(m.start_time) === s.session_date
      );
      if (!match) continue;
      database.prepare('UPDATE sessions SET meeting_id = ? WHERE id = ?').run(match.id, s.id);
      linkedIds.add(match.id);
      console.log(`[repair] Linked session ${s.id} (client ${s.client_id}, ${s.session_date}) → meeting ${match.id}`);
    }
  } catch (err) {
    console.error('[repair] repairSessionMeetingLinks failed:', err.message);
  }
}

repairMeetingInstants(db);
repairSessionDates(db);
repairSessionStatuses(db);
repairSessionMeetingLinks(db);

// Scheduled sessions whose meeting was canceled → canceled / placeholder deleted;
// scheduled sessions 24h past their meeting with no cancellation → held.
try {
  const { autoMarkHeldSessions } = require('../services/session-lifecycle.service');
  autoMarkHeldSessions(db);
} catch (err) {
  console.error('[repair] autoMarkHeldSessions failed:', err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: event bus, scheduled jobs, action queue (Inbox) — 2026-11-04
// All timestamps here are canonical UTC ISO (utils/dates.nowUtcISO()).
// ─────────────────────────────────────────────────────────────────────────────

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      entity_type TEXT,
      entity_id   TEXT,
      payload     TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_domain_events_entity ON domain_events(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_domain_events_created ON domain_events(created_at);

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      run_at      TEXT NOT NULL,
      payload     TEXT,
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'done', 'failed', 'canceled')),
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT,
      dedupe_key  TEXT UNIQUE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs(status, run_at);

    CREATE TABLE IF NOT EXISTS action_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL,
      category      TEXT NOT NULL DEFAULT 'task' CHECK (category IN ('message', 'task')),
      title         TEXT NOT NULL,
      body          TEXT,
      client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      lead_id       INTEGER REFERENCES leads(id)   ON DELETE CASCADE,
      meeting_id    TEXT,
      phone         TEXT,
      message       TEXT,
      link          TEXT,
      priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'medium', 'low')),
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'done', 'dismissed')),
      due_at        TEXT NOT NULL,
      snoozed_until TEXT,
      source        TEXT NOT NULL DEFAULT 'rule'
                    CHECK (source IN ('rule', 'job', 'ai', 'bot', 'system', 'agent')),
      dedupe_key    TEXT NOT NULL UNIQUE,
      send_error    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT,
      resolved_at   TEXT,
      resolved_by   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_action_queue_status_due ON action_queue(status, due_at);
    CREATE INDEX IF NOT EXISTS idx_action_queue_client ON action_queue(client_id, kind);
  `);
} catch (err) {
  console.error('[migration] phase 4 tables failed:', err.message);
}

try { db.exec('ALTER TABLE ai_recommendations ADD COLUMN migrated_action_id INTEGER'); } catch { /* exists */ }

// ── Repair 15: pending ai_recommendations → action_queue (Inbox) ─────────────
// Deterministic dedupe keys: AI recommendations use the same key the analysis
// now writes ("ai:<type>:client:<id>:<ISO week>"), so the next run updates the
// migrated item instead of duplicating it. Other legacy rows use "legacy_rec:<id>".
function repairMigrateRecommendations(database) {
  try {
    const { isoWeekKey, nowUtcISO, toUtcISO } = require('../utils/dates');
    const rows = database.prepare(`
      SELECT * FROM ai_recommendations
      WHERE is_dismissed = 0 AND is_sent = 0 AND migrated_action_id IS NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all();
    if (rows.length === 0) return;

    const KIND = {
      whatsapp_flag: 'whatsapp_flag',
      new_food_submitted: 'food_submitted',
      freeze_reminder: 'freeze_end',
      freeze_expired: 'freeze_end',
    };
    const insert = database.prepare(`
      INSERT OR IGNORE INTO action_queue
        (kind, category, title, body, client_id, phone, message, link, priority,
         status, due_at, source, dedupe_key, created_at)
      VALUES (@kind, @category, @title, @body, @client_id, @phone, @message, @link, @priority,
              'pending', @due_at, @source, @dedupe_key, @created_at)
    `);
    for (const r of rows) {
      const createdIso = toUtcISO(r.created_at ? `${r.created_at.replace(' ', 'T')}Z` : null) || nowUtcISO();
      const legacyKind = KIND[r.type];
      const kind = legacyKind || `ai_${r.type}`;
      const dedupeKey = legacyKind
        ? `legacy_rec:${r.id}`
        : `ai:${r.type}:client:${r.client_id}:${isoWeekKey(createdIso)}`;
      const phone = r.client_id
        ? database.prepare('SELECT phone FROM clients WHERE id = ?').get(r.client_id)?.phone || null
        : null;
      insert.run({
        kind,
        category: r.message_draft ? 'message' : 'task',
        title: r.title,
        body: r.action_suggestion || null,
        client_id: r.client_id || null,
        phone: r.message_draft ? phone : null,
        message: r.message_draft || null,
        link: r.client_id ? `/clients/${r.client_id}` : null,
        priority: r.priority,
        due_at: createdIso,
        source: r.type === 'whatsapp_flag' ? 'bot' : legacyKind ? 'system' : 'ai',
        dedupe_key: dedupeKey,
        created_at: createdIso,
      });
      const actionId = database.prepare('SELECT id FROM action_queue WHERE dedupe_key = ?').get(dedupeKey)?.id;
      database.prepare('UPDATE ai_recommendations SET migrated_action_id = ? WHERE id = ?').run(actionId ?? -1, r.id);
      console.log(`[repair] Migrated recommendation ${r.id} (${r.type}, client ${r.client_id}) → inbox item ${actionId} [${dedupeKey}]`);
    }
  } catch (err) {
    console.error('[repair] repairMigrateRecommendations failed:', err.message);
  }
}

repairMigrateRecommendations(db);

module.exports = db;
