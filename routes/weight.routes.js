const express = require('express');
const router = express.Router();
const db = require('../database/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDayOfWeek(dateStr) {
  // Returns 'monday', 'thursday', or null
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0=Sun 1=Mon ... 4=Thu
  if (day === 1) return 'monday';
  if (day === 4) return 'thursday';
  return null;
}

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function groupByWeek(rows) {
  const weekMap = {};

  for (const row of rows) {
    const weekStart = getMondayOfWeek(row.weigh_date);
    if (!weekMap[weekStart]) {
      weekMap[weekStart] = {
        week_start: weekStart,
        monday_weight: null, monday_id: null,
        thursday_weight: null, thursday_id: null,
      };
    }
    if (row.day_of_week === 'monday') {
      weekMap[weekStart].monday_weight = row.weight;
      weekMap[weekStart].monday_id = row.id;
    } else if (row.day_of_week === 'thursday') {
      weekMap[weekStart].thursday_weight = row.weight;
      weekMap[weekStart].thursday_id = row.id;
    }
  }

  return Object.values(weekMap)
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .map((w) => {
      const both = w.monday_weight !== null && w.thursday_weight !== null;
      const one  = w.monday_weight !== null || w.thursday_weight !== null;
      const avg  = both
        ? Math.round(((w.monday_weight + w.thursday_weight) / 2) * 10) / 10
        : one
          ? (w.monday_weight ?? w.thursday_weight)
          : null;
      return { ...w, average: avg, average_approximate: !both && one };
    });
}

// ─── GET /api/weight/:clientId ────────────────────────────────────────────────

router.get('/:clientId', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, weigh_date, weight, day_of_week, notes FROM weight_logs WHERE client_id = ? ORDER BY weigh_date ASC'
    ).all(req.params.clientId);

    const weeks = groupByWeek(rows);

    const allWeights = rows.map((r) => r.weight);
    const firstWeight  = allWeights.length > 0 ? allWeights[0] : null;
    const latestWeight = allWeights.length > 0 ? allWeights[allWeights.length - 1] : null;
    const totalChange  = firstWeight !== null && latestWeight !== null
      ? Math.round((latestWeight - firstWeight) * 10) / 10
      : null;

    res.json({ success: true, data: { weeks, first_weight: firstWeight, latest_weight: latestWeight, total_change: totalChange } });
  } catch (err) {
    console.error('[weight] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/weight/:clientId ───────────────────────────────────────────────

router.post('/:clientId', (req, res) => {
  try {
    const { date, weight, notes } = req.body;

    if (!date || weight === undefined || weight === null) {
      return res.status(400).json({ success: false, error: 'date ו-weight הם שדות חובה' });
    }

    const w = Number(weight);
    if (isNaN(w) || w < 20 || w > 300) {
      return res.status(400).json({ success: false, error: 'משקל לא תקין — יש להזין ערך בין 20 ל-300 ק"ג' });
    }

    const dayOfWeek = getDayOfWeek(date);
    if (!dayOfWeek) {
      return res.status(400).json({ success: false, error: 'ניתן להוסיף שקילה רק בימי שני וחמישי' });
    }

    const result = db.prepare(`
      INSERT INTO weight_logs (client_id, weigh_date, weight, day_of_week, notes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(client_id, weigh_date) DO UPDATE SET weight = excluded.weight, notes = excluded.notes
    `).run(req.params.clientId, date, w, dayOfWeek, notes || null);

    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('[weight] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /api/weight/:clientId/:id ────────────────────────────────────────

router.delete('/:clientId/:id', (req, res) => {
  try {
    const result = db.prepare(
      'DELETE FROM weight_logs WHERE id = ? AND client_id = ?'
    ).run(req.params.id, req.params.clientId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'לא נמצא' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[weight] DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
