import test from 'node:test';
import assert from 'node:assert/strict';
import { bottlePace } from '../bottle-pace.js';

const zone = 'UTC', H = 3600000, M = 60000, DAY = 86400000;
const today = Date.parse('2026-11-21T00:00:00Z');
const at = (d, h) => new Date(today - d * DAY + h * H).toISOString();
// Seven usual days: 4 oz every 3 hours from 2 AM to 11 PM (8 bottles, 32 oz).
const HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
const usual = (d, oz = 4) => HOURS.map(h => ({ start:at(d, h), amount:oz, units:'oz' }));
const history = [1, 2, 3, 4, 5, 6, 7].flatMap(d => usual(d));

test('the target is her recent average, and her usual gap comes from the same days', () => {
  const pace = bottlePace(history, zone, today + 9 * H);
  assert.equal(pace.available, true); assert.equal(pace.target, 32); assert.equal(pace.days, 7); assert.equal(pace.gapMinutes, 180);
  assert.equal(bottlePace(history.slice(0, 10), zone, today + 9 * H).available, false, 'needs three full days');
});

test('right after a normal bottle she is on track, not ahead', () => {
  const sameAsUsual = [...history, ...usual(0).filter(b => Date.parse(b.start) <= today + 11 * H)];
  // 11:05 AM: she just had her 11 AM bottle, exactly like every other day.
  const pace = bottlePace(sameAsUsual, zone, today + 11 * H + 5 * M);
  assert.equal(pace.status, 'on-track', JSON.stringify(pace));
  assert.equal(pace.drank, 16); assert.ok(pace.counted < pace.drank, 'the newest bottle is still being counted in');
  assert.ok(pace.lastBottle.settling > 1.5 && pace.lastBottle.settling < 2.5, 'about half of that bottle is still to be counted');
  assert.ok(Math.abs(pace.diff) < 0.3, `an ordinary day sits right on pace (${pace.diff})`);
});

test('skipped or extra bottles show as behind or ahead, with a projection', () => {
  const skipped = [...history, ...usual(0).filter(b => Date.parse(b.start) <= today + 8 * H && !b.start.includes('T05:'))]; // missed 5 AM
  const behind = bottlePace(skipped, zone, today + 10 * H);
  assert.equal(behind.status, 'behind'); assert.ok(behind.diff <= -3); assert.ok(behind.projected < 32);
  const bigger = [...history, ...usual(0, 6).filter(b => Date.parse(b.start) <= today + 11 * H)];   // 6 oz bottles
  const ahead = bottlePace(bigger, zone, today + 13 * H);
  assert.equal(ahead.status, 'ahead'); assert.ok(ahead.projected > 32);
  assert.equal(ahead.remaining, Math.max(0, 32 - ahead.drank));
});

test('the next bottle is due one usual gap after the last one', () => {
  const sofar = [...history, ...usual(0).filter(b => Date.parse(b.start) <= today + 8 * H)];
  const pace = bottlePace(sofar, zone, today + 9 * H);
  assert.equal(pace.nextDue, new Date(today + 11 * H).toISOString()); assert.equal(pace.count, 3);
  // ml bottles count in ounces.
  const ml = bottlePace([...history, { start:at(0, 2), amount:120, units:'ml' }], zone, today + 9 * H);
  assert.ok(Math.abs(ml.drank - 4.1) < 0.1);
});

test('five minutes before a bottle she isn’t “behind”, and the bottle doesn’t flip her to “ahead”', () => {
  // A day running 40 minutes late: the 11 AM bottle hasn't happened yet at 11:35.
  const late = [...history, ...usual(0).filter(b => Date.parse(b.start) <= today + 8 * H).map(b => ({ ...b, start:new Date(Date.parse(b.start) + 40 * M).toISOString() }))];
  const before = bottlePace(late, zone, today + 11 * H + 35 * M);
  assert.equal(before.status, 'on-track', JSON.stringify(before)); assert.ok(before.coming && before.coming.counted > 0, 'the coming bottle already counts a little');
  const after = bottlePace([...late, { start:new Date(today + 11 * H + 40 * M).toISOString(), amount:4, units:'oz' }], zone, today + 11 * H + 45 * M);
  assert.equal(after.status, 'on-track', JSON.stringify(after)); assert.ok(Math.abs(after.counted - before.counted) < 1.5, 'no jump when the bottle is logged');
});

test('asleep: the next bottle waits for her to wake up', () => {
  const sofar = [...history, ...usual(0).filter(b => Date.parse(b.start) <= today + 20 * H)];
  const wakeAt = new Date(today + 30.5 * H).toISOString(); // 6:30 AM tomorrow
  const pace = bottlePace(sofar, zone, today + 21 * H, { wakeAt });
  assert.equal(pace.nextDue, wakeAt); assert.equal(pace.waitingForWake, true);
  const awake = bottlePace(sofar, zone, today + 21 * H, { wakeAt:new Date(today + 21.5 * H).toISOString() });
  assert.equal(awake.nextDue, new Date(today + 23 * H).toISOString(), 'waking before the usual gap changes nothing'); assert.equal(awake.waitingForWake, false);
});
