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
      LEFT JOIN calendly_events ce   ON ce.client_id = c.id
                                     OR (ce.lead_id = l.id AND ce.status = 'active')
      WHERE c.converted_from_lead_id IS NOT NULL
        AND s.id IS NULL
      GROUP BY c.id
    `).all();

    if (clientsToFix.length === 0) return;
    console.log(`[repair] Found ${clientsToFix.length} converted client(s) with no session 1 — repairing...`);

    for (const row of clientsToFix) {
      const meetingDate = row.meeting_time
        ? row.meeting_time.slice(0, 10)
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

      // Link calendly_event to client if not already linked
      if (row.meeting_time && row.lead_id) {
        database.prepare(`
          UPDATE calendly_events
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

// ── Repair 3: Generate missing AI assessments for session 1 intakes ───────────
// Runs async (fire-and-forget) so it never blocks server startup.

function parseJsonSafe(str, fallback = []) {
  try { return JSON.parse(str || '[]'); }
  catch { return fallback; }
}

function scheduleAIAssessmentRepairs(database) {
  try {
    const sessionsNeedingAssessment = database.prepare(`
      SELECT s.id as session_id, s.client_id,
             si.id as intake_id
      FROM sessions s
      JOIN session_intakes si ON si.session_id = s.id
      WHERE s.session_number = 1
      AND (
        s.ai_insights IS NULL
        OR s.ai_insights = '[]'
        OR s.ai_insights = ''
        OR s.ai_insights NOT LIKE '%initial_assessment%'
      )
    `).all();

    if (sessionsNeedingAssessment.length === 0) {
      console.log('[repair] All session 1 AI assessments are present');
      return;
    }

    console.log(`[repair] Scheduling AI assessments for ${sessionsNeedingAssessment.length} sessions`);

    sessionsNeedingAssessment.forEach((row, index) => {
      setTimeout(async () => {
        try {
          const intake = database.prepare(
            'SELECT * FROM session_intakes WHERE session_id = ?'
          ).get(row.session_id);

          const client = database.prepare(
            'SELECT * FROM clients WHERE id = ?'
          ).get(row.client_id);

          if (!intake || !client) return;

          // Build the same prompt as in intakes.routes.js
          const activeMedical = (() => {
            try {
              const c = typeof intake.medical_conditions === 'string'
                ? JSON.parse(intake.medical_conditions)
                : (intake.medical_conditions || {});
              const active = Object.entries(c).filter(([, v]) => v).map(([k]) => k);
              return active.length > 0 ? active.join(', ') : 'אין';
            } catch { return 'אין'; }
          })();

          const medications = (() => {
            try {
              const m = typeof intake.medications === 'string'
                ? JSON.parse(intake.medications)
                : (intake.medications || []);
              return Array.isArray(m) && m.length > 0 ? m.join(', ') : 'אין';
            } catch { return 'אין'; }
          })();

          const prompt = `פרטי הלקוח:
גיל: ${intake.age || 'לא צוין'} | מגדר: ${intake.gender === 'male' ? 'זכר' : intake.gender === 'female' ? 'נקבה' : 'לא צוין'}
גובה: ${intake.height || 'לא צוין'} ס״מ | משקל: ${intake.weight || client.initial_weight || 'לא צוין'} ק״ג
BMI: ${intake.weight && intake.height ? (intake.weight / ((Number(intake.height) / 100) ** 2)).toFixed(1) : 'לא חושב'}
משקל מתוקנן: ${intake.adjusted_weight ? intake.adjusted_weight + ' ק״ג' : 'לא נדרש'}
הוצאה קלורית יומית: ${intake.tdee ? Math.round(intake.tdee) + ' קק״ל' : 'לא חושב'}
מטרה: ${intake.goal || client.goal || 'לא צוין'}
מצבים רפואיים: ${activeMedical}
תרופות: ${medications}
סוג תזונה: ${intake.diet_type || 'לא צוין'}
פעילות גופנית: ${intake.activity_type || 'לא צוין'}, ${intake.activity_frequency || ''}
שינה: ${intake.sleep_hours || 'לא צוין'} שעות, איכות: ${intake.sleep_quality || 'לא צוין'}

צור הערכה ראשונית קלינית.`;

          const Anthropic = require('@anthropic-ai/sdk');
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: `You are a clinical nutrition assistant helping a licensed nutritionist prepare for a first session with a new client.

Based on the intake form data provided, generate an initial clinical assessment that includes:

1. קליני-תזונתי ראשוני: A brief clinical nutrition profile based on the data (BMI category, energy needs, key nutritional considerations)

2. נקודות לתשומת לב: Red flags or important points from medical history, eating patterns, or lifestyle that require attention

3. כיוון טיפולי ראשוני: Suggested initial direction for the nutrition treatment plan based on the client's goal, medical history, and lifestyle

Base ALL recommendations on current scientific consensus from WHO, AND, AHA, EASD and peer-reviewed research.
Do not make medical diagnoses.
Respond in Hebrew only.
Be concise — maximum 3-4 bullet points per section.
If BMI, weight, or other metrics are already calculated, use them as context — do NOT suggest calculating them again.`,
            messages: [{ role: 'user', content: prompt }],
          });

          const assessmentText = response.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n');

          const existingInsights = parseJsonSafe(
            database.prepare('SELECT ai_insights FROM sessions WHERE id = ?')
              .get(row.session_id)?.ai_insights
          );

          const filtered = Array.isArray(existingInsights)
            ? existingInsights.filter((i) => i.type !== 'initial_assessment')
            : [];
          filtered.unshift({
            text: assessmentText,
            saved_for_next: false,
            type: 'initial_assessment',
          });

          database.prepare('UPDATE sessions SET ai_insights = ? WHERE id = ?')
            .run(JSON.stringify(filtered), row.session_id);

          console.log(`[repair] ✓ AI assessment generated for session ${row.session_id}`);
        } catch (err) {
          console.error(`[repair] AI assessment failed for session ${row.session_id}:`, err.message);
        }
      }, index * 3000); // 3 second delay between each
    });
  } catch (err) {
    console.error('[repair] scheduleAIAssessmentRepairs error:', err.message);
  }
}

// Delay 5 s so server is fully ready before making external API calls
setTimeout(() => scheduleAIAssessmentRepairs(db), 5000);

// ── Repair 4: Generate process_summary for ended clients that don't have one ──

function scheduleProcessSummaryRepairs(database) {
  try {
    const clientsToRepair = database.prepare(`
      SELECT id, full_name, goal, initial_weight, start_date
      FROM clients
      WHERE status = 'ended'
        AND (process_summary IS NULL OR process_summary = '')
    `).all();

    if (clientsToRepair.length === 0) return;
    console.log(`[repair] Scheduling process summaries for ${clientsToRepair.length} ended client(s)`);

    clientsToRepair.forEach((client, index) => {
      setTimeout(async () => {
        try {
          const sessions = database.prepare(
            'SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number ASC'
          ).all(client.id);

          const lines = [];
          lines.push(`שם: ${client.full_name}`);
          if (client.goal)           lines.push(`מטרה: ${client.goal}`);
          if (client.initial_weight) lines.push(`משקל התחלתי: ${client.initial_weight} ק"ג`);
          if (client.start_date)     lines.push(`תחילת טיפול: ${client.start_date}`);
          lines.push(`מספר פגישות: ${sessions.length}`);
          const lastSession = sessions.at(-1);
          if (lastSession?.weight) lines.push(`משקל אחרון: ${lastSession.weight} ק"ג`);
          for (const s of sessions) {
            lines.push(`\nפגישה ${s.session_number}: ${s.highlights || '(אין דגשים)'}`);
          }

          const Anthropic = require('@anthropic-ai/sdk');
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

          const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            system: `אתה תזונאי קליני מסכם תהליך טיפולי שהסתיים. החזר JSON בלבד: { "headline": "כותרת", "journey": "תיאור", "achievements": "הישגים", "recommendations": "המלצות", "closing": "משפט סיום" }. כתוב בעברית בלבד.`,
            messages: [{ role: 'user', content: lines.join('\n') + '\n\nכתוב סיכום תהליך.' }],
          });

          const rawText = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
          const cleaned = rawText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
          const parsed  = JSON.parse(cleaned);

          database.prepare('UPDATE clients SET process_summary = ? WHERE id = ?')
            .run(JSON.stringify(parsed), client.id);
          console.log(`[repair] ✓ Process summary generated for client ${client.id}`);
        } catch (err) {
          console.error(`[repair] Process summary failed for client ${client.id}:`, err.message);
        }
      }, 10000 + index * 5000); // start after 10s, 5s between each
    });
  } catch (err) {
    console.error('[repair] scheduleProcessSummaryRepairs error:', err.message);
  }
}

// ── Repair 5: Generate checkin_message for last 10 sessions that don't have one ──

function scheduleCheckinMessageRepairs(database) {
  try {
    const sessionsToRepair = database.prepare(`
      SELECT s.id, s.client_id, s.session_number, s.session_date, s.highlights, s.soap_notes
      FROM sessions s
      WHERE (s.checkin_message IS NULL OR s.checkin_message = '')
        AND s.highlights IS NOT NULL AND s.highlights != ''
      ORDER BY s.id DESC
      LIMIT 10
    `).all();

    if (sessionsToRepair.length === 0) return;
    console.log(`[repair] Scheduling check-in messages for ${sessionsToRepair.length} session(s)`);

    sessionsToRepair.forEach((session, index) => {
      setTimeout(async () => {
        try {
          const client = database.prepare('SELECT * FROM clients WHERE id = ?').get(session.client_id);
          if (!client) return;

          const Anthropic = require('@anthropic-ai/sdk');
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

          const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: `אתה תזונאי קליני שכותב הודעת צ'ק-אין חמה ללקוח בסיום פגישה. כתוב 3-5 משפטים בגוף שני, בסגנון אישי וחם. כתוב בעברית בלבד, ללא כוכביות.`,
            messages: [{
              role: 'user',
              content: `לקוח: ${client.full_name}, פגישה ${session.session_number}.\nדגשים: ${session.highlights}\nכתוב הודעת צ'ק-אין.`,
            }],
          });

          const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (!text) return;

          database.prepare('UPDATE sessions SET checkin_message = ? WHERE id = ?').run(text, session.id);
          console.log(`[repair] ✓ Check-in message generated for session ${session.id}`);
        } catch (err) {
          console.error(`[repair] Check-in message failed for session ${session.id}:`, err.message);
        }
      }, 20000 + index * 4000); // start after 20s, 4s between each
    });
  } catch (err) {
    console.error('[repair] scheduleCheckinMessageRepairs error:', err.message);
  }
}

setTimeout(() => {
  scheduleProcessSummaryRepairs(db);
  scheduleCheckinMessageRepairs(db);
}, 5000);

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
          SELECT * FROM calendly_events
          WHERE lead_id = ? AND status = 'active'
          ORDER BY start_time ASC LIMIT 1
        `).get(lead.id);

        const sessionDate = meeting
          ? meeting.start_time.slice(0, 10)
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

          // Link calendly_event
          if (meeting) {
            database.prepare('UPDATE calendly_events SET client_id = ? WHERE id = ?')
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

// 2. Add engagement_id to sessions, payments, calendly_events
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
  db.exec('ALTER TABLE calendly_events ADD COLUMN engagement_id INTEGER');
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

module.exports = db;
