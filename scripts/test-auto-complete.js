/**
 * Automatic client completion: rule + cleanup, with a mock date progression.
 * Runs directly against a SCRATCH database copy (never the real one):
 *
 *   DB_PATH=/tmp/copy.db node scripts/test-auto-complete.js
 *
 * Rule: after the 6th held session of the process, the client stays active
 * until max(6th + 14 days, process_end_date) and is completed the day after.
 */

if (!process.env.DB_PATH || /data\/nutrition\.db$/.test(process.env.DB_PATH)) {
  console.error('Refusing to run: set DB_PATH to a scratch copy of the database.');
  process.exit(1);
}

const db = require('../database/db');
const { evaluateCompletion, runAutoCompletion, endClientProcess } = require('../services/client-completion.service');
const { upsertAction } = require('../services/action-queue.service');
const { scheduleJob } = require('../services/jobs.service');
const { addDays, parseDate, toISODate, todayISO } = require('../utils/dates');

let passed = 0;
let failed = 0;
function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const BASE = '2026-03-01'; // fixed calendar so the progression is deterministic
const day = (offset, from = BASE) => toISODate(addDays(parseDate(from), offset));
let phoneSeq = 0;

/** Client with an active engagement and `held` held sessions, the last on `sixthDate`. */
function makeClient(name, { held = 6, sixthDate, processEnd, status = 'active' }) {
  const id = db.prepare(`
    INSERT INTO clients (full_name, phone, start_date, process_end_date, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, `05299${String(++phoneSeq).padStart(5, '0')}`, day(-90, sixthDate), processEnd, status).lastInsertRowid;
  const eng = db.prepare("INSERT INTO engagements (client_id, number, status, started_at) VALUES (?, 1, 'active', ?)")
    .run(id, day(-90, sixthDate)).lastInsertRowid;
  for (let n = 1; n <= held; n++) {
    // sessions every 14 days, the 6th exactly on sixthDate
    db.prepare(`INSERT INTO sessions (client_id, session_number, session_date, status, engagement_id, weight)
                VALUES (?, ?, ?, 'held', ?, 80)`).run(id, n, day((n - 6) * 14, sixthDate), eng);
  }
  return id;
}
const clientRow = (id) => db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
const statusOn = (id, today) => evaluateCompletion(db, clientRow(id), today);
const runOn = (today) => runAutoCompletion(db, { today });

console.log('\n══ Automatic client completion (mock dates) ══\n');

// ── A: 6th held before the end date, end date is later than the grace period
console.log('── A: end date later than 6th + 14 ──');
{
  const sixth = day(0);
  const id = makeClient('השלמה A', { sixthDate: sixth, processEnd: day(30) });
  const ev = statusOn(id, day(1));
  assert('completeAt = process end date (later)', ev.completeAt === day(30) && ev.sixthHeldDate === sixth, JSON.stringify(ev));
  for (const [offset, expect] of [[14, 'grace_period'], [20, 'grace_period'], [30, 'grace_period'], [31, 'due']]) {
    assert(`Day +${offset}: ${expect}`, statusOn(id, day(offset)).reason === expect, JSON.stringify(statusOn(id, day(offset))));
  }
  runOn(day(30));
  assert('Run on the end date itself → still active', clientRow(id).status === 'active');
  runOn(day(31));
  assert('Run the day after → ended', clientRow(id).status === 'ended');
}

// ── B: 6th held before the end date, but the end date comes first
console.log('── B: 6th + 14 later than the end date ──');
{
  const id = makeClient('השלמה B', { sixthDate: day(0), processEnd: day(5) });
  assert('completeAt = 6th + 14', statusOn(id, day(1)).completeAt === day(14));
  runOn(day(14));
  assert('Day +14 → still active (full 14 days)', clientRow(id).status === 'active');
  runOn(day(15));
  assert('Day +15 → ended', clientRow(id).status === 'ended');
}

// ── C: 6th held after the end date → a full 14 days from that session
console.log('── C: 6th held after the end date ──');
{
  const id = makeClient('השלמה C', { sixthDate: day(0), processEnd: day(-10) });
  assert('completeAt = 6th + 14 (end date already passed)', statusOn(id, day(1)).completeAt === day(14));
  runOn(day(14));
  assert('Day +14 → still active', clientRow(id).status === 'active');
  runOn(day(15));
  assert('Day +15 → ended', clientRow(id).status === 'ended');
}

// ── D: fewer than 6 held sessions → never completed by the rule
console.log('── D: only 5 sessions held ──');
{
  const id = makeClient('השלמה D', { held: 5, sixthDate: day(0), processEnd: day(-10) });
  runOn(day(120));
  const ev = statusOn(id, day(120));
  assert('5 held sessions → stays active', clientRow(id).status === 'active' && ev.reason === 'sessions_remaining' && ev.heldCount === 5);
  // a canceled 6th does not count
  db.prepare("INSERT INTO sessions (client_id, session_number, session_date, status) VALUES (?, 6, ?, 'canceled')").run(id, day(1));
  runOn(day(120));
  assert('Canceled 6th session does not count', clientRow(id).status === 'active');
}

// ── E: a booking ahead blocks completion until it passes
console.log('── E: booking ahead ──');
{
  const id = makeClient('השלמה E', { sixthDate: day(0), processEnd: day(5) });
  // sessions are capped at 6, so a further booking is a calendar meeting
  db.prepare(`INSERT INTO meetings (id, start_time, end_time, status, client_id, event_type, created_at)
              VALUES (?, ?, ?, 'active', ?, 'follow_up', ?)`)
    .run(`test-ahead-${id}`, `${day(20)}T08:00:00.000Z`, `${day(20)}T08:45:00.000Z`, id, new Date().toISOString());
  runOn(day(16));
  assert('Meeting booked on day +20 → not completed on day +16', clientRow(id).status === 'active' && statusOn(id, day(16)).reason === 'booking_ahead');
  runOn(day(21));
  assert('After the meeting date passes → completed', clientRow(id).status === 'ended');
}

// ── F: frozen / paused clients are not touched
console.log('── F: frozen client ──');
{
  const id = makeClient('השלמה F', { sixthDate: day(0), processEnd: day(5), status: 'frozen' });
  runOn(day(60));
  assert('Frozen client stays frozen', clientRow(id).status === 'frozen' && statusOn(id, day(60)).reason === 'not_active');
}

// ── G: completion closes open scheduling work
console.log('── G: cleanup on completion ──');
{
  const id = makeClient('השלמה G', { sixthDate: day(0), processEnd: day(5) });
  upsertAction(db, { kind: 'session_due', dedupeKey: `session_due:client:${id}:after:${day(0)}`, title: 'test', clientId: id, priority: 'urgent' });
  upsertAction(db, { kind: 'checkin', dedupeKey: `checkin:test:${id}`, title: 'checkin stays', clientId: id, priority: 'medium' });
  scheduleJob(db, { type: 'menu_sla_due', runAt: '2099-01-01T00:00:00.000Z', payload: { clientId: id }, dedupeKey: `menu_sla_due:test:${id}` });

  const r = runOn(day(15));
  const done = r.completed.find((c) => c.clientId === id);
  assert('Completed by the run', !!done && clientRow(id).status === 'ended', JSON.stringify(r));
  const c = clientRow(id);
  assert('Marked automatic, stop_date = run date, reason text set',
    c.completed_automatically === 1 && c.stop_date === day(15) && /אוטומטית/.test(c.stop_reason_text || ''), JSON.stringify(c));
  assert('Engagement closed', db.prepare("SELECT COUNT(*) n FROM engagements WHERE client_id = ? AND status = 'active'").get(id).n === 0);
  const inbox = (key) => db.prepare('SELECT status, resolved_by FROM action_queue WHERE dedupe_key = ?').get(key);
  assert('session_due item closed (client_ended)', inbox(`session_due:client:${id}:after:${day(0)}`).status === 'done' && inbox(`session_due:client:${id}:after:${day(0)}`).resolved_by === 'client_ended');
  assert('Check-in message item left pending', inbox(`checkin:test:${id}`).status === 'pending');
  assert('menu_sla_due job canceled', db.prepare('SELECT status FROM scheduled_jobs WHERE dedupe_key = ?').get(`menu_sla_due:test:${id}`).status === 'canceled');
  assert('Held sessions untouched', db.prepare("SELECT COUNT(*) n FROM sessions WHERE client_id = ? AND status = 'held'").get(id).n === 6);
  assert('client.completed domain event', !!db.prepare("SELECT 1 FROM domain_events WHERE type = 'client.completed' AND entity_id = ?").get(String(id)));

  // Idempotent: running again changes nothing
  const again = runOn(day(15));
  assert('Second run the same day completes nobody again', !again.completed.some((x) => x.clientId === id));
}

// ── H: manual end uses the same cleanup and keeps real bookings
console.log('── H: manual end ──');
{
  const id = makeClient('השלמה H', { held: 3, sixthDate: day(0), processEnd: day(60) });
  upsertAction(db, { kind: 'session_due', dedupeKey: `session_due:client:${id}:manual`, title: 'test', clientId: id, priority: 'urgent' });
  db.prepare(`INSERT INTO meetings (id, start_time, end_time, status, client_id, event_type, created_at)
              VALUES (?, '2099-02-01T08:00:00.000Z', '2099-02-01T08:45:00.000Z', 'active', ?, 'follow_up', ?)`)
    .run(`test-booking-${id}`, id, new Date().toISOString());
  const booked = db.prepare("INSERT INTO sessions (client_id, session_number, session_date, status, meeting_id) VALUES (?, 4, '2099-02-01', 'scheduled', ?)")
    .run(id, `test-booking-${id}`).lastInsertRowid;
  const placeholder = db.prepare("INSERT INTO sessions (client_id, session_number, session_date, status) VALUES (?, 5, ?, 'scheduled')")
    .run(id, day(10)).lastInsertRowid; // empty, no meeting → placeholder
  endClientProcess(db, id, { reason: 'cant_continue' });
  const c = clientRow(id);
  assert('Manual end → ended, not automatic', c.status === 'ended' && c.completed_automatically === 0 && c.stop_reason === 'cant_continue' && c.stop_date === todayISO());
  assert('Open session_due closed', db.prepare('SELECT status FROM action_queue WHERE dedupe_key = ?').get(`session_due:client:${id}:manual`).status === 'done');
  assert('Empty placeholder session canceled', db.prepare('SELECT status FROM sessions WHERE id = ?').get(placeholder).status === 'canceled');
  assert('Real calendar booking left as is', db.prepare('SELECT status FROM sessions WHERE id = ?').get(booked).status === 'scheduled');
}

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
