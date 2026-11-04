/**
 * Google Calendar sync test — runs syncGoogleCalendar() against a fake event
 * feed (no network, no Google account needed).
 *
 * ALWAYS against a throwaway DB copy:
 *   cp data/nutrition.db /tmp/sync-test.db
 *   DB_PATH=/tmp/sync-test.db node scripts/test-google-sync.js
 */

if (!process.env.DB_PATH) {
  console.error('Refusing to run without DB_PATH (use a DB copy).');
  process.exit(1);
}
process.env.GOOGLE_CLIENT_ID = '';      // never touch the real Google API here
process.env.ANTHROPIC_API_KEY = '';

const db = require('../database/db');
const { syncGoogleCalendar } = require('../services/google-calendar.service');
const { calculateSessionWindows, todayISO, addDays, toISODate, parseDate } = require('../utils/dates');

let passed = 0;
let failed = 0;
function assert(label, condition, detail = '') {
  if (condition) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const day = (offset) => toISODate(addDays(parseDate(todayISO()), offset));
const booking = ({ id, summary, start, end, name, phone, email = '', status = 'confirmed' }) => ({
  id, status, summary,
  description: `<b>Booked by</b>\n${name}\n${email}\n${phone}`,
  start: { dateTime: start }, end: { dateTime: end },
});

// Fake Google feed: each call returns the next queued response
function feed(responses) {
  const calls = [];
  const listEvents = async (params) => {
    calls.push(params);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { listEvents, calls };
}

async function run() {
  console.log('\n══ Google Calendar sync (fake feed) ══\n');
  db.prepare('UPDATE settings SET google_sync_token = NULL WHERE id = 1').run();

  // A client with 6 windows and a held session 1 (books follow-ups by phone)
  const phone = '0527770001';
  const clientId = db.prepare(
    "INSERT INTO clients (full_name, phone, status, start_date) VALUES ('בדיקת סנכרון', ?, 'active', ?)"
  ).run(phone, day(-14)).lastInsertRowid;
  db.prepare("INSERT INTO engagements (client_id, number, status, started_at) VALUES (?, 1, 'active', ?)").run(clientId, day(-14));
  for (const w of calculateSessionWindows(day(-14))) {
    db.prepare('INSERT INTO session_windows (client_id, session_number, expected_date) VALUES (?, ?, ?)')
      .run(clientId, w.session_number, w.expected_date);
  }
  db.prepare("INSERT INTO sessions (client_id, session_number, session_date, status) VALUES (?, 1, ?, 'held')").run(clientId, day(-14));

  const followStart = `${day(3)}T09:00:00+02:00`;
  const followEnd   = `${day(3)}T10:00:00+02:00`;
  const firstStart  = `${day(4)}T23:30:00Z`; // 01:30/02:30 Israel on day(5)

  // ── 1. Full sync (no token): one follow-up for the client + one new first meeting
  const f1 = feed([{
    items: [
      booking({ id: 'g-follow-1', summary: 'פגישת מעקב', start: followStart, end: followEnd, name: 'בדיקת סנכרון', phone }),
      booking({ id: 'g-first-1', summary: 'פגישה ראשונה', start: firstStart, end: `${day(5)}T00:30:00Z`, name: 'ליד מהיומן', phone: '0527770002', email: 'lead@example.com' }),
      { id: 'g-allday', status: 'confirmed', summary: 'חופש', start: { date: day(2) }, end: { date: day(3) } },
      { id: 'g-private', status: 'confirmed', summary: 'רופא שיניים', start: { dateTime: followStart }, end: { dateTime: followEnd } },
    ],
    nextSyncToken: 'token-1',
  }]);
  const r1 = await syncGoogleCalendar({ listEvents: f1.listEvents });
  assert('First sync is a full sync with timeMin', r1.mode === 'full' && !!f1.calls[0].timeMin, JSON.stringify(f1.calls[0]));
  assert('2 bookings created, 2 ignored', r1.created === 2 && r1.ignored === 2, JSON.stringify(r1));
  assert('Sync token persisted', db.prepare('SELECT google_sync_token FROM settings WHERE id = 1').get().google_sync_token === 'token-1');

  const m1 = db.prepare("SELECT * FROM meetings WHERE google_event_id = 'g-follow-1'").get();
  assert('Booking stored as canonical UTC', m1?.start_time === new Date(followStart).toISOString(), m1?.start_time);
  assert('Follow-up matched to client by phone', m1?.client_id === clientId);
  const s2 = db.prepare('SELECT * FROM sessions WHERE meeting_id = ?').get('g-follow-1');
  assert('Follow-up booking → session 2 scheduled', s2?.session_number === 2 && s2?.status === 'scheduled', JSON.stringify(s2));
  assert('Session date = Israel date', s2?.session_date === day(3), s2?.session_date);

  const lead = db.prepare("SELECT * FROM leads WHERE email = 'lead@example.com'").get();
  assert('Unknown first-meeting booking → new lead (meeting_scheduled)', lead?.status === 'meeting_scheduled' && lead?.source === 'google_calendar');
  const mFirst = db.prepare("SELECT * FROM meetings WHERE google_event_id = 'g-first-1'").get();
  assert('Late-night booking keeps exact UTC instant', mFirst?.start_time === new Date(firstStart).toISOString());

  // ── 2. Incremental: the follow-up is rescheduled to another day
  const movedStart = `${day(4)}T15:00:00+02:00`;
  const f2 = feed([{
    items: [booking({ id: 'g-follow-1', summary: 'פגישת מעקב', start: movedStart, end: `${day(4)}T16:00:00+02:00`, name: 'בדיקת סנכרון', phone })],
    nextSyncToken: 'token-2',
  }]);
  const r2 = await syncGoogleCalendar({ listEvents: f2.listEvents });
  assert('Incremental sync uses stored syncToken', r2.mode === 'incremental' && f2.calls[0].syncToken === 'token-1', JSON.stringify(f2.calls[0]));
  assert('Reschedule detected', r2.updated === 1, JSON.stringify(r2));
  assert('Linked session moved to new date',
    db.prepare('SELECT session_date FROM sessions WHERE id = ?').get(s2.id).session_date === day(4));

  // ── 3. Incremental: the follow-up is cancelled → empty placeholder deleted
  const f3 = feed([{ items: [{ id: 'g-follow-1', status: 'cancelled' }], nextSyncToken: 'token-3' }]);
  const r3 = await syncGoogleCalendar({ listEvents: f3.listEvents });
  assert('Cancellation detected', r3.canceled === 1, JSON.stringify(r3));
  assert('Meeting marked canceled', db.prepare("SELECT status FROM meetings WHERE google_event_id = 'g-follow-1'").get().status === 'canceled');
  assert('Placeholder session deleted', !db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(s2.id));

  // ── 4. New booking, notes written, then cancelled → session kept as canceled
  const f4 = feed([{
    items: [booking({ id: 'g-follow-2', summary: 'פגישת מעקב', start: `${day(7)}T09:00:00+02:00`, end: `${day(7)}T10:00:00+02:00`, name: 'בדיקת סנכרון', phone })],
    nextSyncToken: 'token-4',
  }]);
  await syncGoogleCalendar({ listEvents: f4.listEvents });
  const s3 = db.prepare("SELECT * FROM sessions WHERE meeting_id = 'g-follow-2'").get();
  db.prepare("UPDATE sessions SET highlights = 'הכנה לפגישה' WHERE id = ?").run(s3.id);
  const f5 = feed([{ items: [{ id: 'g-follow-2', status: 'cancelled' }], nextSyncToken: 'token-5' }]);
  await syncGoogleCalendar({ listEvents: f5.listEvents });
  assert('Cancelled session with notes kept as canceled',
    db.prepare('SELECT status FROM sessions WHERE id = ?').get(s3.id)?.status === 'canceled');

  // ── 5. Expired token (410) → automatic full resync, token replaced
  const gone = Object.assign(new Error('Sync token is no longer valid'), { code: 410 });
  const f6 = feed([gone, { items: [], nextSyncToken: 'token-fresh' }]);
  const r6 = await syncGoogleCalendar({ listEvents: f6.listEvents });
  assert('410 → full resync', r6.mode === 'full' && f6.calls.length === 2 && !!f6.calls[1].timeMin, JSON.stringify(r6));
  assert('Fresh token stored', db.prepare('SELECT google_sync_token FROM settings WHERE id = 1').get().google_sync_token === 'token-fresh');

  // ── 6. API failure → token NOT advanced (nothing lost)
  const f7 = feed([Object.assign(new Error('backend error'), { code: 500 })]);
  const r7 = await syncGoogleCalendar({ listEvents: f7.listEvents });
  assert('Failure reported, token unchanged', !!r7.error
    && db.prepare('SELECT google_sync_token FROM settings WHERE id = 1').get().google_sync_token === 'token-fresh');

  // ── 7. Idempotent: replaying the same feed changes nothing
  const before = db.prepare('SELECT COUNT(*) n FROM meetings').get().n;
  const f8 = feed([{ items: [booking({ id: 'g-first-1', summary: 'פגישה ראשונה', start: firstStart, end: `${day(5)}T00:30:00Z`, name: 'ליד מהיומן', phone: '0527770002', email: 'lead@example.com' })], nextSyncToken: 'token-6' }]);
  const r8 = await syncGoogleCalendar({ listEvents: f8.listEvents });
  assert('Replay is a no-op', r8.ignored === 1 && db.prepare('SELECT COUNT(*) n FROM meetings').get().n === before, JSON.stringify(r8));

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
