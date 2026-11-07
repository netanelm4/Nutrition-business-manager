const kapso = require('./kapso.service');
const { computeSessionSla, hasUpcomingMeeting } = require('./alerts.service');
const { openTasks } = require('./agent/tools');
const { SESSION_SLA_DAYS } = require('../constants/events');
const {
  todayISO, israelLocalToUtcISO, addDays, parseDate, toISODate, formatDateHebrewShort, hebrewWeekday,
} = require('../utils/dates');

// ─── Admin WhatsApp briefs ───────────────────────────────────────────────────
//   daily      08:00 every day: active clients with nothing booked ahead
//   weigh_in   10:00 Monday & Thursday: who weighed in (value, change) / who
//              missed, plus open tasks & habits
// Inside the 24h window the full text is sent; otherwise the approved template
// with a one-line summary, and "פירוט" returns the full text.

const ACTIVE = ['active', 'ending_soon'];
const short = (iso) => (iso ? formatDateHebrewShort(iso) : '');

function activeClients(db) {
  return db.prepare(`SELECT * FROM clients WHERE status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY full_name`).all(...ACTIVE);
}

/** Active clients with no future session / meeting, most overdue first. */
function buildDailyBrief(db, today = todayISO()) {
  const rows = [];
  for (const c of activeClients(db)) {
    const sessions = db.prepare('SELECT * FROM sessions WHERE client_id = ?').all(c.id);
    const sla = computeSessionSla(c, sessions, { hasUpcomingMeeting: hasUpcomingMeeting(db, c.id) });
    if (sla.hasUpcoming) continue;
    rows.push({ c, sla });
  }
  rows.sort((a, b) => (b.sla.daysSince ?? -1) - (a.sla.daysSince ?? -1));
  const overdue = rows.filter((r) => r.sla.stale).length;
  const dayStart = israelLocalToUtcISO(today, '00:00');
  const dayEnd = israelLocalToUtcISO(toISODate(addDays(parseDate(today), 1)), '00:00');
  const meetingsToday = db.prepare("SELECT COUNT(*) AS n FROM meetings WHERE status = 'active' AND start_time >= ? AND start_time < ?").get(dayStart, dayEnd).n;

  const head = `תדריך בוקר · ${hebrewWeekday(today)} ${short(today)}\nפגישות היום: ${meetingsToday}`;
  if (!rows.length) {
    return { full: `${head}\n\nלכל המטופלים הפעילים יש פגישה עתידית ביומן.`, summary: `פגישות היום: ${meetingsToday}. לכל המטופלים הפעילים יש פגישה עתידית`, count: 0 };
  }
  const lines = rows.map(({ c, sla }) => {
    const when = sla.anchor === 'held'
      ? `${sla.daysSince} ימים מהפגישה האחרונה (${short(sla.anchorDate)})`
      : `טרם התקיימה פגישה (התחלה ${short(sla.anchorDate)})`;
    return `• ${c.full_name}: ${when}${sla.stale ? `, מעל ${SESSION_SLA_DAYS} יום` : ''}`;
  });
  return {
    full: `${head}\n\nללא פגישה עתידית (${rows.length}, מתוכם ${overdue} מעל ${SESSION_SLA_DAYS} יום):\n${lines.join('\n')}`,
    summary: `פגישות היום: ${meetingsToday}. ${rows.length} מטופלים ללא פגישה עתידית, מתוכם ${overdue} מעל ${SESSION_SLA_DAYS} יום`,
    count: rows.length,
  };
}

/** Monday / Thursday: today's weigh-ins vs. missing, and open tasks. */
function buildWeighInReport(db, today = todayISO()) {
  const weighed = [];
  const missing = [];
  const tasksLines = [];
  let openCount = 0;
  for (const c of activeClients(db)) {
    const w = db.prepare('SELECT weight FROM weight_logs WHERE client_id = ? AND weigh_date = ?').get(c.id, today);
    if (w) {
      const prev = db.prepare('SELECT weight, weigh_date FROM weight_logs WHERE client_id = ? AND weigh_date < ? ORDER BY weigh_date DESC LIMIT 1').get(c.id, today);
      const diff = prev ? Math.round((w.weight - prev.weight) * 10) / 10 : null;
      weighed.push(`• ${c.full_name}: ${w.weight} ק"ג${diff === null ? '' : ` (${diff > 0 ? '+' : ''}${diff} מ-${short(prev.weigh_date)})`}`);
    } else {
      missing.push(`• ${c.full_name}`);
    }
    const open = openTasks(db, c.id);
    if (open.length) {
      openCount += open.length;
      tasksLines.push(`• ${c.full_name}: ${open.slice(0, 3).map((t) => t.text).join('; ')}${open.length > 3 ? ` (+${open.length - 3})` : ''}`);
    }
  }
  const total = weighed.length + missing.length;
  const parts = [
    `דוח שקילות · ${hebrewWeekday(today)} ${short(today)}`,
    `שקלו (${weighed.length} מתוך ${total}):\n${weighed.join('\n') || '• אף אחד עדיין'}`,
    `לא שקלו (${missing.length}):\n${missing.join('\n') || '• כולם שקלו'}`,
    `משימות והרגלים פתוחים (${openCount}):\n${tasksLines.join('\n') || '• אין'}`,
  ];
  return {
    full: parts.join('\n\n'),
    summary: `שקלו ${weighed.length} מתוך ${total}, ${missing.length} לא שקלו, ${openCount} משימות פתוחות`,
    weighed: weighed.length, missing: missing.length,
  };
}

const BUILDERS = { daily: buildDailyBrief, weigh_in: buildWeighInReport };

/** Build and send a brief to Netanel. Text inside the 24h window, template otherwise. */
async function sendBrief(db, kind, { today = todayISO() } = {}) {
  const build = BUILDERS[kind];
  if (!build) throw new Error(`Unknown brief: ${kind}`);
  if (!kapso.isConfigured()) return { skipped: 'not_configured' };
  const brief = build(db, today);
  if (kapso.windowOpen(db)) {
    const r = await kapso.sendText(db, brief.full, { brief: kind, date: today });
    return { ...r, via: 'text' };
  }
  const r = await kapso.sendTemplate(db, brief.summary, { brief: kind, date: today, pending_detail: brief.full });
  return { ...r, via: 'template' };
}

module.exports = { buildDailyBrief, buildWeighInReport, sendBrief, BUILDERS };
