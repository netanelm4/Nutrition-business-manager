const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const db         = require('../database/db');
const { calculateSessionWindows, calculateProcessEndDate } = require('../utils/dates');
const { computeClientAlerts } = require('../services/alerts.service');
const { CLIENT_STATUS, TASK_STATUS, SESSION_STATUS } = require('../constants/statuses');
const { isValidSessionStatus, initialStatusForDate, isPlaceholderSession } = require('../services/session-lifecycle.service');
const { parseJsonArray } = require('../utils/parseJson');

const { ensureActiveEngagement, closeActiveEngagements, generateWeightToken } = require('../services/client-lifecycle.service');
const { generateProcessSummary } = require('../services/ai/generators');

// Fire-and-forget: generate the process summary when a process ends
function triggerProcessSummary(clientId) {
  generateProcessSummary(db, clientId)
    .then(() => console.log(`[process-summary] Generated for client ${clientId}`))
    .catch((err) => console.error(`[process-summary] Failed for client ${clientId}:`, err.message));
}

const router = express.Router();

// ─── session JSON helpers (used by session creation on this router) ────────────

function parseSoapNotes(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function serializeSession(row) {
  if (!row) return null;
  return {
    ...row,
    tasks: parseJsonArray(row.tasks),
    ai_insights: parseJsonArray(row.ai_insights),
    ai_flags: parseJsonArray(row.ai_flags),
    soap_notes: parseSoapNotes(row.soap_notes),
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function getClientAlerts(clientId) {
  const windows = db
    .prepare('SELECT * FROM session_windows WHERE client_id = ? ORDER BY session_number')
    .all(clientId);
  const sessions = db
    .prepare('SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number')
    .all(clientId);
  return { windows, sessions };
}

function attachAlerts(client) {
  const { windows, sessions } = getClientAlerts(client.id);
  const alerts = computeClientAlerts(client, windows, sessions);
  return {
    ...client,
    alerts,
    session_windows: windows,
    // Session numbers that took place (held) — the UI progress bar counts these
    sessions_recorded: sessions.filter((s) => s.status === SESSION_STATUS.HELD).map((s) => s.session_number),
    // Booked but not yet held
    sessions_scheduled: sessions.filter((s) => s.status === SESSION_STATUS.SCHEDULED).map((s) => s.session_number),
  };
}

// ─── GET /api/clients ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const conditions = [];
    const params = [];

    // Filter by lead conversion source when ?converted_from_lead_id=X
    if (req.query.converted_from_lead_id !== undefined) {
      conditions.push('converted_from_lead_id = ?');
      params.push(Number(req.query.converted_from_lead_id));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const all = db
      .prepare(`SELECT * FROM clients ${where} ORDER BY created_at DESC`)
      .all(...params);

    const withAlerts = all.map(attachAlerts);
    return ok(res, withAlerts);
  } catch (err) {
    console.error('[GET /clients]', err);
    return fail(res, 500, 'Failed to fetch clients.');
  }
});

// ─── POST /api/clients ────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const {
      full_name,
      phone,
      age,
      gender,
      start_date,
      goal,
      medical_notes,
      menu_sent,
      menu_sent_date,
      initial_weight,
      process_end_date,
      status,
      converted_from_lead_id,
      package_price,
    } = req.body;

    if (!full_name || !full_name.trim()) {
      return fail(res, 400, 'full_name is required.');
    }
    if (!phone || !phone.trim()) {
      return fail(res, 400, 'phone is required.');
    }

    const resolvedProcessEndDate =
      process_end_date || (start_date ? calculateProcessEndDate(start_date) : null);

    const insert = db.prepare(`
      INSERT INTO clients
        (full_name, phone, age, gender, start_date, goal, medical_notes,
         menu_sent, menu_sent_date, initial_weight, process_end_date, status,
         converted_from_lead_id, package_price)
      VALUES
        (@full_name, @phone, @age, @gender, @start_date, @goal, @medical_notes,
         @menu_sent, @menu_sent_date, @initial_weight, @process_end_date, @status,
         @converted_from_lead_id, @package_price)
    `);

    const result = insert.run({
      full_name: full_name.trim(),
      phone: phone.trim(),
      age: age || null,
      gender: gender || null,
      start_date: start_date || null,
      goal: goal || null,
      medical_notes: medical_notes || null,
      menu_sent: menu_sent ? 1 : 0,
      menu_sent_date: menu_sent_date || null,
      initial_weight: initial_weight || null,
      process_end_date: resolvedProcessEndDate,
      status: status || CLIENT_STATUS.ACTIVE,
      converted_from_lead_id: converted_from_lead_id || null,
      package_price: package_price ? Number(package_price) : 0,
    });

    const clientId = result.lastInsertRowid;

    // Every client starts with engagement #1 and a personal weight-entry token
    ensureActiveEngagement(db, clientId, start_date || null);
    db.prepare('UPDATE clients SET weight_token = ? WHERE id = ? AND weight_token IS NULL')
      .run(generateWeightToken(), clientId);

    console.log(`[POST /clients] Created client id=${clientId} name="${full_name}" status=${status || CLIENT_STATUS.ACTIVE} converted_from_lead=${converted_from_lead_id || null}`);

    // If converted from a lead that has intake data, store it as pending for session 1
    if (converted_from_lead_id) {
      try {
        const leadIntake = db.prepare('SELECT * FROM lead_intakes WHERE lead_id = ?').get(converted_from_lead_id);
        if (leadIntake) {
          db.prepare('UPDATE clients SET pending_intake_data = ? WHERE id = ?').run(
            JSON.stringify(leadIntake),
            clientId
          );
        }
      } catch { /* best-effort — don't fail client creation */ }
    }

    // Auto-generate 6 session windows if start_date provided
    if (start_date) {
      const windows = calculateSessionWindows(start_date);
      const insertWindow = db.prepare(`
        INSERT INTO session_windows (client_id, session_number, expected_date)
        VALUES (@client_id, @session_number, @expected_date)
      `);
      const insertAll = db.transaction((wins) => {
        for (const w of wins) {
          insertWindow.run({ client_id: clientId, ...w });
        }
      });
      insertAll(windows);
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    return ok(res, attachAlerts(client));
  } catch (err) {
    console.error('[POST /clients]', err);
    return fail(res, 500, 'Failed to create client.');
  }
});

// ─── GET /api/clients/:id ─────────────────────────────────────────────────────

function attachProtocol(client) {
  if (!client) return client;
  const protocol = client.protocol_id
    ? db.prepare('SELECT id, name, description, highlights, default_tasks FROM protocols WHERE id = ?').get(client.protocol_id)
    : null;
  return {
    ...client,
    protocol: protocol
      ? {
          ...protocol,
          highlights:    JSON.parse(protocol.highlights    || '[]'),
          default_tasks: JSON.parse(protocol.default_tasks || '[]'),
        }
      : null,
  };
}

router.get('/:id/weight-link', (req, res) => {
  try {
    try { db.exec('ALTER TABLE clients ADD COLUMN weight_token TEXT'); } catch {}
    try { db.exec("UPDATE clients SET weight_token = hex(randomblob(8)) WHERE weight_token IS NULL"); } catch {}

    const client = db.prepare('SELECT id, weight_token FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');
    let token = client.weight_token;
    if (!token) {
      token = require('crypto').randomBytes(8).toString('hex');
      db.prepare('UPDATE clients SET weight_token = ? WHERE id = ?').run(token, client.id);
    }
    const proto   = req.get('x-forwarded-proto') || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;
    return ok(res, { url: `${baseUrl}/w/${token}` });
  } catch (err) {
    console.error('[weight-link] ERROR:', err.message, err.stack);
    return fail(res, 500, err.message);
  }
});

router.get('/:id', (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');
    return ok(res, attachProtocol(attachAlerts(client)));
  } catch (err) {
    console.error('[GET /clients/:id]', err);
    return fail(res, 500, 'Failed to fetch client.');
  }
});

// ─── PUT /api/clients/:id ─────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    const fields = [
      'full_name', 'phone', 'age', 'gender', 'start_date', 'goal',
      'medical_notes', 'menu_sent', 'menu_sent_date', 'initial_weight',
      'process_end_date', 'status', 'package_price', 'protocol_id',
    ];

    const updates = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        updates[f] = req.body[f];
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 400, 'No updatable fields provided.');
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE clients SET ${setClauses} WHERE id = @id`).run({ ...updates, id: req.params.id });

    // If start_date changed and no windows exist yet, generate them
    if (updates.start_date) {
      const existing = db
        .prepare('SELECT COUNT(*) as n FROM session_windows WHERE client_id = ?')
        .get(req.params.id);
      if (existing.n === 0) {
        const windows = calculateSessionWindows(updates.start_date);
        const insertWindow = db.prepare(`
          INSERT INTO session_windows (client_id, session_number, expected_date)
          VALUES (@client_id, @session_number, @expected_date)
        `);
        const insertAll = db.transaction((wins) => {
          for (const w of wins) insertWindow.run({ client_id: Number(req.params.id), ...w });
        });
        insertAll(windows);
      }
    }

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);

    // If status just changed to 'ended', fire-and-forget process summary generation
    if (updates.status === CLIENT_STATUS.ENDED && client.status !== CLIENT_STATUS.ENDED) {
      closeActiveEngagements(db, Number(req.params.id));
      if (!updated.process_summary) {
        triggerProcessSummary(req.params.id);
      }
    }

    return ok(res, attachProtocol(attachAlerts(updated)));
  } catch (err) {
    console.error('[PUT /clients/:id]', err);
    return fail(res, 500, 'Failed to update client.');
  }
});

// ─── DELETE /api/clients/:id ──────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    // These tables reference clients without ON DELETE CASCADE, so the FK refuses
    // a bare DELETE (every client has an engagement). Remove them explicitly, atomically.
    // sessions, windows, payments, intakes, whatsapp_log cascade; meetings and
    // daily_tasks are SET NULL by their FKs.
    const deleteClient = db.transaction((id) => {
      db.prepare('DELETE FROM menu_examples WHERE menu_id IN (SELECT id FROM menus WHERE client_id = ?)').run(id);
      db.prepare('DELETE FROM menus WHERE client_id = ?').run(id);
      for (const table of ['ai_recommendations', 'weight_logs', 'ai_memory', 'client_food_favorites', 'engagements']) {
        db.prepare(`DELETE FROM ${table} WHERE client_id = ?`).run(id);
      }
      db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    });
    deleteClient(Number(req.params.id));

    return ok(res, { id: Number(req.params.id) });
  } catch (err) {
    console.error('[DELETE /clients/:id]', err);
    return fail(res, 500, 'Failed to delete client.');
  }
});

// ─── GET /api/clients/:id/windows ────────────────────────────────────────────

router.get('/:id/windows', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');
    const windows = db
      .prepare('SELECT * FROM session_windows WHERE client_id = ? ORDER BY session_number')
      .all(req.params.id);
    return ok(res, windows);
  } catch (err) {
    console.error('[GET /clients/:id/windows]', err);
    return fail(res, 500, 'Failed to fetch session windows.');
  }
});

// ─── POST /api/clients/:id/sessions ──────────────────────────────────────────

router.post('/:id/sessions', (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    const activeEng = db.prepare(
      "SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1"
    ).get(Number(req.params.id));

    const existing = db
      .prepare('SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number')
      .all(req.params.id);

    const { session_date, weight, highlights } = req.body;
    if (req.body.status !== undefined && !isValidSessionStatus(req.body.status)) {
      return fail(res, 400, 'status must be one of: scheduled, held, no_show, canceled.');
    }
    const status = req.body.status || initialStatusForDate(session_date);

    // A booking already created an empty `scheduled` session for this slot →
    // recording the meeting fills that placeholder instead of adding a new number.
    const placeholder = existing.find(
      (s) => s.status === SESSION_STATUS.SCHEDULED && isPlaceholderSession(db, s)
    );
    const nextNumber = placeholder
      ? placeholder.session_number
      : (existing.length > 0 ? existing[existing.length - 1].session_number + 1 : 1);
    if (nextNumber > 6) return fail(res, 400, 'Client already has 6 sessions recorded.');
    const previous = existing.filter((s) => s.session_number < nextNumber);

    // Carry over incomplete tasks from the previous session
    let carriedTasks = [];
    if (previous.length > 0) {
      const prev = previous[previous.length - 1];
      carriedTasks = parseJsonArray(prev.tasks)
        .filter((t) => t.status !== TASK_STATUS.DONE)
        .map((t) => ({
          ...t,
          id: uuidv4(),
          status: TASK_STATUS.PENDING,
          carried_over_from_session: prev.session_number,
        }));
    }

    // Prepend saved insights/flags from the previous session
    let savedInsights = [];
    let savedFlags = [];
    if (previous.length > 0) {
      const prev = previous[previous.length - 1];
      savedInsights = parseJsonArray(prev.ai_insights).filter((i) => i.saved_for_next);
      savedFlags = parseJsonArray(prev.ai_flags).filter((f) => f.saved_for_next);
    }

    const values = {
      session_date: session_date || null,
      weight: weight || null,
      highlights: highlights || null,
      ai_insights: JSON.stringify(savedInsights),
      ai_flags: JSON.stringify(savedFlags),
      tasks: JSON.stringify(carriedTasks),
      engagement_id: activeEng?.id ?? null,
      status,
    };

    let sessionId;
    if (placeholder) {
      db.prepare(`
        UPDATE sessions
        SET session_date = COALESCE(@session_date, session_date), weight = @weight, highlights = @highlights,
            ai_insights = @ai_insights, ai_flags = @ai_flags, tasks = @tasks,
            engagement_id = COALESCE(engagement_id, @engagement_id), status = @status
        WHERE id = @id
      `).run({ ...values, id: placeholder.id });
      sessionId = placeholder.id;
    } else {
      sessionId = db.prepare(`
        INSERT INTO sessions
          (client_id, session_number, session_date, weight, highlights, ai_insights, ai_flags, tasks, engagement_id, status)
        VALUES
          (@client_id, @session_number, @session_date, @weight, @highlights, @ai_insights, @ai_flags, @tasks, @engagement_id, @status)
      `).run({ ...values, client_id: Number(req.params.id), session_number: nextNumber }).lastInsertRowid;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    return ok(res, serializeSession(session));
  } catch (err) {
    console.error('[POST /clients/:id/sessions]', err);
    return fail(res, 500, 'Failed to create session.');
  }
});

// ─── GET /api/clients/:id/sessions ───────────────────────────────────────────

router.get('/:id/sessions', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');
    const sessions = db
      .prepare('SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number')
      .all(req.params.id)
      .map(serializeSession);
    return ok(res, sessions);
  } catch (err) {
    console.error('[GET /clients/:id/sessions]', err);
    return fail(res, 500, 'Failed to fetch sessions.');
  }
});

// ─── POST /api/clients/:id/protocol-tasks ────────────────────────────────────
// Adds protocol tasks to a specific session (or the next pending one).
// Body: { tasks: string[], session_number?: number }

router.post('/:id/protocol-tasks', (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) return fail(res, 404, 'Client not found.');

    const ptActiveEng = db.prepare(
      "SELECT id FROM engagements WHERE client_id = ? AND status = 'active' ORDER BY number DESC LIMIT 1"
    ).get(clientId);
    const ptEngagementId = ptActiveEng?.id ?? null;

    const { tasks: newTasks, session_number: requestedNumber } = req.body;
    if (!Array.isArray(newTasks) || newTasks.length === 0) {
      return fail(res, 400, 'tasks array is required and must not be empty.');
    }

    // Build task objects
    const taskObjects = newTasks.map((text) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: typeof text === 'string' ? text : String(text),
      status: 'pending',
    }));

    // ── If a specific session_number was requested ─────────────────────────────
    if (requestedNumber) {
      const targetNum = Number(requestedNumber);

      // Try to find an existing session for this number
      const existingSession = db
        .prepare('SELECT * FROM sessions WHERE client_id = ? AND session_number = ?')
        .get(clientId, targetNum);

      if (existingSession) {
        const existing = parseJsonArray(existingSession.tasks);
        const merged = JSON.stringify([...existing, ...taskObjects]);
        db.prepare('UPDATE sessions SET tasks = ? WHERE id = ?').run(merged, existingSession.id);
        return ok(res, { session_number: targetNum, tasks_added: taskObjects.length });
      }

      // No session yet — find the window for this number and create a session
      const window = db
        .prepare('SELECT * FROM session_windows WHERE client_id = ? AND session_number = ?')
        .get(clientId, targetNum);

      const sessionDate = window?.expected_date ?? null;
      db.prepare(`
        INSERT INTO sessions (client_id, session_number, session_date, highlights, ai_insights, ai_flags, tasks, engagement_id)
        VALUES (?, ?, ?, '', '[]', '[]', ?, ?)
      `).run(clientId, targetNum, sessionDate, JSON.stringify(taskObjects), ptEngagementId);

      return ok(res, { session_number: targetNum, tasks_added: taskObjects.length });
    }

    // ── Auto: find the next pending window ────────────────────────────────────
    const windows = db
      .prepare('SELECT * FROM session_windows WHERE client_id = ? ORDER BY session_number')
      .all(clientId);

    const recordedNums = db
      .prepare('SELECT session_number FROM sessions WHERE client_id = ?')
      .all(clientId)
      .map((s) => s.session_number);

    const nextWindow = windows.find((w) => !recordedNums.includes(w.session_number));

    if (!nextWindow) {
      // All windows recorded — append to last session
      const lastSession = db
        .prepare('SELECT * FROM sessions WHERE client_id = ? ORDER BY session_number DESC LIMIT 1')
        .get(clientId);
      if (!lastSession) return fail(res, 400, 'No sessions or windows found for this client.');
      const existing = parseJsonArray(lastSession.tasks);
      db.prepare('UPDATE sessions SET tasks = ? WHERE id = ?')
        .run(JSON.stringify([...existing, ...taskObjects]), lastSession.id);
      return ok(res, { session_number: lastSession.session_number, tasks_added: taskObjects.length });
    }

    const existingSession = db
      .prepare('SELECT * FROM sessions WHERE client_id = ? AND session_number = ?')
      .get(clientId, nextWindow.session_number);

    if (existingSession) {
      const existing = parseJsonArray(existingSession.tasks);
      db.prepare('UPDATE sessions SET tasks = ? WHERE id = ?')
        .run(JSON.stringify([...existing, ...taskObjects]), existingSession.id);
      return ok(res, { session_number: nextWindow.session_number, tasks_added: taskObjects.length });
    }

    db.prepare(`
      INSERT INTO sessions (client_id, session_number, session_date, highlights, ai_insights, ai_flags, tasks, engagement_id)
      VALUES (?, ?, ?, '', '[]', '[]', ?, ?)
    `).run(clientId, nextWindow.session_number, nextWindow.expected_date, JSON.stringify(taskObjects), ptEngagementId);

    return ok(res, { session_number: nextWindow.session_number, tasks_added: taskObjects.length });
  } catch (err) {
    console.error('[POST /clients/:id/protocol-tasks]', err);
    return fail(res, 500, 'Failed to add protocol tasks.');
  }
});

// ─── GET /api/clients/:id/whatsapp-log ───────────────────────────────────────

router.get('/:id/whatsapp-log', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');
    const logs = db.prepare(`
      SELECT wl.*, wt.name as template_name
      FROM whatsapp_log wl
      LEFT JOIN whatsapp_templates wt ON wl.template_id = wt.id
      WHERE wl.client_id = ?
      ORDER BY wl.sent_at DESC
      LIMIT 50
    `).all(req.params.id);
    return ok(res, logs);
  } catch (err) {
    console.error('[GET /clients/:id/whatsapp-log]', err);
    return fail(res, 500, 'Failed to fetch whatsapp log.');
  }
});

// ─── POST /api/clients/:id/stop ───────────────────────────────────────────────

router.post('/:id/stop', (req, res) => {
  const { reason, reason_text } = req.body;
  const VALID_REASONS = ['goal_achieved', 'cant_continue', 'not_suitable', 'other'];
  if (!reason || !VALID_REASONS.includes(reason)) {
    return fail(res, 400, 'reason must be one of: ' + VALID_REASONS.join(', '));
  }
  try {
    const client = db.prepare('SELECT id, status, process_summary FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    db.prepare(`
      UPDATE clients
      SET status = 'ended',
          stop_reason = ?,
          stop_reason_text = ?,
          stop_date = date('now'),
          stopped_at = datetime('now')
      WHERE id = ?
    `).run(reason, reason_text || null, req.params.id);

    closeActiveEngagements(db, Number(req.params.id));

    // Same side effect as PUT status=ended: generate the process summary once
    if (client.status !== CLIENT_STATUS.ENDED && !client.process_summary) {
      triggerProcessSummary(req.params.id);
    }

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    console.log(`[POST /clients/${req.params.id}/stop] reason=${reason}`);
    return ok(res, updated);
  } catch (err) {
    console.error('[POST /clients/:id/stop]', err);
    return fail(res, 500, 'Failed to stop client process.');
  }
});

// ─── POST /api/clients/:id/freeze ─────────────────────────────────────────────

router.post('/:id/freeze', (req, res) => {
  const days = Number(req.body.days);
  if (!days || days < 1) return fail(res, 400, 'days must be a positive number');
  try {
    const client = db.prepare('SELECT id, full_name FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    const frozenUntil = db.prepare("SELECT date('now', ?) AS d").get(`+${days} days`).d;

    db.prepare(`
      UPDATE clients
      SET status = 'frozen',
          stop_reason = 'frozen',
          frozen_until = ?,
          stop_date = date('now'),
          stopped_at = datetime('now')
      WHERE id = ?
    `).run(frozenUntil, req.params.id);

    // The freeze_end job (services/jobs.service.js) puts a "return to the
    // process?" item in the inbox on frozen_until; reactivating resolves it.

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    console.log(`[POST /clients/${req.params.id}/freeze] frozen_until=${frozenUntil}`);
    return ok(res, updated);
  } catch (err) {
    console.error('[POST /clients/:id/freeze]', err);
    return fail(res, 500, 'Failed to freeze client process.');
  }
});

// ─── POST /api/clients/:id/reactivate ────────────────────────────────────────

router.post('/:id/reactivate', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    db.prepare(`
      UPDATE clients
      SET status = 'active',
          stop_reason = NULL,
          stop_reason_text = NULL,
          frozen_until = NULL,
          stop_date = NULL,
          stopped_at = NULL
      WHERE id = ?
    `).run(req.params.id);

    // Pending freeze_end inbox items / jobs are resolved by the reconcilers

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    console.log(`[POST /clients/${req.params.id}/reactivate]`);
    return ok(res, updated);
  } catch (err) {
    console.error('[POST /clients/:id/reactivate]', err);
    return fail(res, 500, 'Failed to reactivate client.');
  }
});

module.exports = router;
