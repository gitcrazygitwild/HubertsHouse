import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
import { DEFAULT_BATH_DAYS, cleanBathDays, setBathDays, bathDays, isBathDay, describeBathDays, bathDaysInRange, bathEvents, nextBathDay } from '../bath-days.js';
const { buildDigest, composeEmail } = await import('../functions/newsletter.js');

test('bath days default to Wednesday and Sunday, and can be changed or cleared', () => {
  assert.deepEqual(DEFAULT_BATH_DAYS, [0, 3]);
  assert.deepEqual(setBathDays(null), [0, 3], 'never set → the default');
  assert.deepEqual(setBathDays([5, 1, 1, 9, 'x', 2.5]), [1, 5]);
  assert.deepEqual(setBathDays([]), [], 'cleared on purpose stays cleared');
  assert.equal(cleanBathDays('nope'), null);
  setBathDays([0, 3]);
  assert.deepEqual(bathDays(), [0, 3]);
  assert.equal(describeBathDays(), 'Wednesdays and Sundays');
  assert.equal(describeBathDays([1, 3, 5]), 'Mondays, Wednesdays and Fridays');
  assert.equal(describeBathDays([]), 'No bath days set'); assert.equal(describeBathDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
});

test('bath nights land on the right dates, on the calendar and as "next"', () => {
  setBathDays([0, 3]);
  // Nov 2026: Sun 22, Wed 25, Sun 29.
  assert.deepEqual(bathDaysInRange(new Date(2026, 10, 21), new Date(2026, 10, 30)).map(b => b.date), ['2026-11-22', '2026-11-25', '2026-11-29']);
  assert.deepEqual(bathDaysInRange(new Date(2026, 10, 22, 0, 0), new Date(2026, 10, 23)).map(b => b.date), ['2026-11-22'], 'a range starting at midnight includes that day');
  const [event] = bathEvents(new Date(2026, 10, 25), new Date(2026, 10, 26));
  assert.deepEqual([event.title, event.start, event.end, event.allDay, event.editable, event.extendedProps.bath], ['🛁 Bath night', '2026-11-25', '2026-11-26', true, false, true]);
  assert.equal(isBathDay(new Date(2026, 10, 25, 19)), true); assert.equal(isBathDay(new Date(2026, 10, 24, 19)), false);
  assert.deepEqual(nextBathDay(new Date(2026, 10, 25, 8)), { date:'2026-11-25', label:'Tonight' });
  assert.deepEqual(nextBathDay(new Date(2026, 10, 24, 8)), { date:'2026-11-25', label:'Tomorrow' });
  assert.deepEqual(nextBathDay(new Date(2026, 10, 26, 8)), { date:'2026-11-29', label:'Sunday' });
  assert.equal(nextBathDay(new Date(), []), null);
});

test('the morning email lists bath night with today’s (and tomorrow’s) plans', () => {
  const wednesday = new Date(2026, 10, 25, 6, 30);
  const digest = buildDigest({ now:wednesday, bathDays:[0, 3] });
  assert.equal(digest.today[0].title, '🛁 Bath night'); assert.equal(digest.tomorrow.length, 0);
  assert.match(composeEmail(digest).text, /Bath night/);
  assert.equal(buildDigest({ now:new Date(2026, 10, 24, 6, 30), bathDays:[0, 3] }).tomorrow[0].title, '🛁 Bath night');
  assert.equal(buildDigest({ now:wednesday, bathDays:[] }).today.length, 0, 'no bath days set');
  assert.equal(buildDigest({ now:wednesday }).today[0].title, '🛁 Bath night', 'never set → Wednesday and Sunday');
});
