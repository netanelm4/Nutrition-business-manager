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

module.exports = db;
