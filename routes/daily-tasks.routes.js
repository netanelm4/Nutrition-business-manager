const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../database/db');

const router = express.Router();

function ok(res, data)             { return res.json({ success: true, data }); }
function fail(res, status, message){ return res.status(status).json({ success: false, error: message }); }
function todayStr()                { return new Date().toISOString().slice(0, 10); }

// ─── GET /api/daily-tasks ────────────────────────────────────────────────────
// Returns today's tasks grouped by quadrant + completed array.

router.get('/', (req, res) => {
  try {
    const today = todayStr();
    const rows = db.prepare(`
      SELECT dt.*, c.full_name AS client_name
      FROM daily_tasks dt
      LEFT JOIN clients c ON c.id = dt.client_id
      WHERE dt.date = ?
      ORDER BY dt.created_at ASC
    `).all(today);

    const active    = rows.filter((t) => !t.completed);
    const completed = rows.filter((t) =>  t.completed);

    return ok(res, {
      q1: active.filter((t) => t.quadrant === 1),
      q2: active.filter((t) => t.quadrant === 2),
      q3: active.filter((t) => t.quadrant === 3),
      q4: active.filter((t) => t.quadrant === 4),
      completed,
    });
  } catch (err) {
    console.error('[GET /daily-tasks]', err);
    return fail(res, 500, 'Failed to fetch tasks.');
  }
});

// ─── POST /api/daily-tasks/ai-scan ──────────────────────────────────────────
// Scans active clients and generates tasks via Claude. Must be defined BEFORE /:id.

router.post('/ai-scan', async (req, res) => {
  try {
    const today = todayStr();

    const clients = db.prepare(`
      SELECT c.id, c.full_name, c.goal, c.initial_weight, c.start_date,
             c.payment_status, c.process_end_date, c.ai_summary,
             p.name AS protocol_name
      FROM clients c
      LEFT JOIN protocols p ON p.id = c.protocol_id
      WHERE c.status = 'active'
    `).all();

    if (clients.length === 0) return ok(res, { added: 0, tasks: [] });

    const clientData = clients.map((client) => {
      const lastSession = db.prepare(`
        SELECT session_number, session_date, highlights, tasks
        FROM sessions
        WHERE client_id = ?
        ORDER BY session_number DESC
        LIMIT 1
      `).get(client.id);

      const nextWindow = db.prepare(`
        SELECT sw.session_number, sw.expected_date
        FROM session_windows sw
        LEFT JOIN sessions s
          ON s.client_id = sw.client_id AND s.session_number = sw.session_number
        WHERE sw.client_id = ? AND s.id IS NULL
        ORDER BY sw.session_number ASC
        LIMIT 1
      `).get(client.id);

      const daysSince = lastSession?.session_date
        ? Math.floor((Date.now() - new Date(lastSession.session_date).getTime()) / 86_400_000)
        : null;

      let pendingTasks = [];
      if (lastSession?.tasks) {
        try {
          const parsed = JSON.parse(lastSession.tasks);
          pendingTasks = parsed.filter((t) => t.status === 'pending').map((t) => t.text);
        } catch {}
      }

      let aiFlags = '';
      if (client.ai_summary) {
        try {
          const s = JSON.parse(client.ai_summary);
          if (s?.summary?.flags) aiFlags = s.summary.flags;
        } catch {}
      }

      return {
        id:               client.id,
        name:             client.full_name,
        protocol:         client.protocol_name || 'ללא פרוטוקול',
        goal:             client.goal,
        payment_status:   client.payment_status,
        process_end_date: client.process_end_date,
        last_session: lastSession ? {
          number:        lastSession.session_number,
          date:          lastSession.session_date,
          highlights:    lastSession.highlights,
          pending_tasks: pendingTasks,
        } : null,
        days_since_last_session: daysSince,
        next_session: nextWindow ? {
          number:        nextWindow.session_number,
          expected_date: nextWindow.expected_date,
        } : null,
        ai_flags: aiFlags,
      };
    });

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `אתה עוזר AI לתזונאי קליני לניהול משימות יומיות של מעקב אחר לקוחות.

נתח את נתוני הלקוחות שסופקו וצור משימות מעקב ספציפיות ופעולתיות להיום.

לכל משימה, שייך ריבוע אייזנהאואר:
  1 (דחוף + חשוב): לקוח לא היה בקשר מעל 14 ימים, תשלום באיחור, פגישה קרובה דורשת הכנה, דגלים אדומים מסיכום AI
  2 (חשוב + לא דחוף): מעקב על המלצות טיפוליות ספציפיות, בדיקת ציות לתוספים, סקירת התקדמות ביעדים
  3 (דחוף + לא חשוב): משימות אדמיניסטרטיביות, תזכורות תיאום
  4 (לא דחוף + לא חשוב): צ'ק-אין כללי, מעקב בסדר עדיפות נמוך

החזר אך ורק מערך JSON:
[
  {
    "text": "תיאור משימה ספציפי בעברית",
    "quadrant": 1,
    "client_id": 123,
    "client_name": "שם הלקוח"
  }
]

היה ספציפי — הפנה לנתונים אמיתיים מהפגישות.
מקסימום 15 משימות סה"כ.
צור רק משימות בעלות ערך קליני אמיתי.
ענה בעברית בלבד.`,
      messages: [{
        role:    'user',
        content: `נתוני לקוחות פעילים להיום (${today}):\n\n${JSON.stringify(clientData, null, 2)}`,
      }],
    });

    const rawText  = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return ok(res, { added: 0, tasks: [] });

    const aiTasks = JSON.parse(jsonMatch[0]);

    const existingToday = db.prepare(
      "SELECT client_id, text FROM daily_tasks WHERE date = ? AND source = 'ai'"
    ).all(today);

    const newTasks = [];
    for (const task of aiTasks) {
      if (!task.text || !task.quadrant) continue;

      const isDuplicate = existingToday.some(
        (e) => e.client_id === task.client_id &&
               (e.text || '').substring(0, 30) === (task.text || '').substring(0, 30)
      );
      if (isDuplicate) continue;

      const result = db.prepare(`
        INSERT INTO daily_tasks (text, source, quadrant, client_id, date)
        VALUES (?, 'ai', ?, ?, ?)
      `).run(task.text, Number(task.quadrant), task.client_id || null, today);

      const inserted = db.prepare(`
        SELECT dt.*, c.full_name AS client_name
        FROM daily_tasks dt
        LEFT JOIN clients c ON c.id = dt.client_id
        WHERE dt.id = ?
      `).get(result.lastInsertRowid);

      newTasks.push(inserted);
    }

    return ok(res, { added: newTasks.length, tasks: newTasks });
  } catch (err) {
    console.error('[POST /daily-tasks/ai-scan]', err);
    return fail(res, 500, 'Failed to run AI scan.');
  }
});

// ─── POST /api/daily-tasks ───────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const { text, quadrant, client_id } = req.body;
    if (!text || !quadrant) return fail(res, 400, 'text and quadrant are required.');

    const today  = todayStr();
    const result = db.prepare(`
      INSERT INTO daily_tasks (text, source, quadrant, client_id, date)
      VALUES (?, 'manual', ?, ?, ?)
    `).run(text.trim(), Number(quadrant), client_id || null, today);

    const task = db.prepare(`
      SELECT dt.*, c.full_name AS client_name
      FROM daily_tasks dt
      LEFT JOIN clients c ON c.id = dt.client_id
      WHERE dt.id = ?
    `).get(result.lastInsertRowid);

    return ok(res, task);
  } catch (err) {
    console.error('[POST /daily-tasks]', err);
    return fail(res, 500, 'Failed to create task.');
  }
});

// ─── PUT /api/daily-tasks/:id ────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(req.params.id);
    if (!task) return fail(res, 404, 'Task not found.');

    const { text, quadrant, completed } = req.body;
    const sets   = [];
    const values = [];

    if (text      !== undefined) { sets.push('text = ?');      values.push(text.trim()); }
    if (quadrant  !== undefined) { sets.push('quadrant = ?');   values.push(Number(quadrant)); }
    if (completed !== undefined) {
      sets.push('completed = ?');     values.push(completed ? 1 : 0);
      sets.push('completed_at = ?');  values.push(completed ? new Date().toISOString() : null);
    }

    if (sets.length === 0) return fail(res, 400, 'No fields to update.');

    values.push(req.params.id);
    db.prepare(`UPDATE daily_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT dt.*, c.full_name AS client_name
      FROM daily_tasks dt
      LEFT JOIN clients c ON c.id = dt.client_id
      WHERE dt.id = ?
    `).get(req.params.id);

    return ok(res, updated);
  } catch (err) {
    console.error('[PUT /daily-tasks/:id]', err);
    return fail(res, 500, 'Failed to update task.');
  }
});

// ─── DELETE /api/daily-tasks/:id ────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(req.params.id);
    if (!task) return fail(res, 404, 'Task not found.');
    db.prepare('DELETE FROM daily_tasks WHERE id = ?').run(req.params.id);
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[DELETE /daily-tasks/:id]', err);
    return fail(res, 500, 'Failed to delete task.');
  }
});

module.exports = router;
