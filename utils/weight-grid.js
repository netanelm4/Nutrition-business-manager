// ─── Weekly weigh-in grid (Monday / Thursday slots) ─────────────────────────
// Weigh-ins on other days (e.g. logged from WhatsApp: "אתמול" on a Saturday)
// are shown in the closest slot of their week, keeping the actual date:
//   Sunday / Tuesday / Wednesday → Monday,  Friday / Saturday → Thursday.
// A real Monday / Thursday weigh-in always wins its slot; among off-days the
// one closest to the slot day wins (later date on a tie).

// day → [slot, offset in days from the weigh date to the slot day]
const SLOT_OF_DAY = {
  0: ['monday', 1],    // Sunday → next day
  1: ['monday', 0],
  2: ['monday', -1],
  3: ['monday', -2],
  4: ['thursday', 0],
  5: ['thursday', -1],
  6: ['thursday', -2],
};

function shift(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** { slot: 'monday'|'thursday', slotDate, weekStart (Monday), offDay } for a weigh date. */
function slotFor(dateStr) {
  const day = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  const [slot, offset] = SLOT_OF_DAY[day];
  const slotDate = shift(dateStr, offset);
  const weekStart = slot === 'monday' ? slotDate : shift(slotDate, -3);
  return { slot, slotDate, weekStart, offDay: offset !== 0, distance: Math.abs(offset) };
}

function groupByWeek(rows) {
  const weekMap = {};
  const pick = {}; // `${week}:${slot}` → { distance, date }

  for (const row of rows) {
    const s = slotFor(row.weigh_date);
    if (!weekMap[s.weekStart]) {
      weekMap[s.weekStart] = {
        week_start: s.weekStart,
        monday_weight: null, monday_id: null, monday_date: null, monday_off_day: false,
        thursday_weight: null, thursday_id: null, thursday_date: null, thursday_off_day: false,
      };
    }
    const key = `${s.weekStart}:${s.slot}`;
    const cur = pick[key];
    const better = !cur || s.distance < cur.distance || (s.distance === cur.distance && row.weigh_date > cur.date);
    if (!better) continue;
    pick[key] = { distance: s.distance, date: row.weigh_date };
    const w = weekMap[s.weekStart];
    w[`${s.slot}_weight`] = row.weight;
    w[`${s.slot}_id`] = row.id;
    w[`${s.slot}_date`] = row.weigh_date;
    w[`${s.slot}_off_day`] = s.offDay;
  }

  return Object.values(weekMap)
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .map((w) => {
      const both = w.monday_weight !== null && w.thursday_weight !== null;
      const one  = w.monday_weight !== null || w.thursday_weight !== null;
      const avg  = both
        ? Math.round(((w.monday_weight + w.thursday_weight) / 2) * 10) / 10
        : one ? (w.monday_weight ?? w.thursday_weight) : null;
      return { ...w, average: avg, average_approximate: !both && one };
    });
}

module.exports = { groupByWeek, slotFor };
