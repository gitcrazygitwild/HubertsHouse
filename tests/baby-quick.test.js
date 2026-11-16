import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBabyLog, describeBabyLog, parseQuickAdd } from '../quick-add.js';
process.env.TZ = 'America/New_York';
const now = new Date(2026, 10, 16, 16, 0); // 4:00pm
const hm = d => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

test('bottles: time, amount, units, milk type, and past-leaning times', () => {
  const b = parseBabyLog('frankie bottle 10:30AM 4oz', now);
  assert.equal(b.kind, 'bottle'); assert.equal(hm(b.start), '16 10:30'); assert.equal(b.amount, 4); assert.equal(b.units, 'oz');
  const ml = parseBabyLog('Frankie 120ml breast milk at 3:15', now);
  assert.equal(ml.units, 'ml'); assert.equal(ml.amount, 120); assert.equal(ml.bottleType, 'Breast Milk'); assert.equal(hm(ml.start), '16 15:15');
  assert.equal(hm(parseBabyLog('frankie bottle 11pm', now).start), '15 23:00'); // later than now → last night
  const bare = parseBabyLog('frankie bottle', now); assert.equal(bare.amount, undefined); assert.equal(+bare.start, +now);
  assert.equal(parseBabyLog('fed frankie 5 oz 20 min ago', now).start.getMinutes(), 40);
});

test('diapers and sleep', () => {
  assert.equal(parseBabyLog('frankie diaper wet', now).mode, 'pee');
  assert.equal(parseBabyLog('frankie poopy diaper 2pm', now).mode, 'poo');
  assert.equal(parseBabyLog('frankie diaper wet and dirty', now).mode, 'both');
  const nap = parseBabyLog('frankie nap 1-2:15pm', now);
  assert.equal(nap.kind, 'sleep-log'); assert.equal(hm(nap.start), '16 13:00'); assert.equal(hm(nap.end), '16 14:15');
  const short = parseBabyLog('frankie napped 45 min', now);
  assert.equal(short.kind, 'sleep-log'); assert.equal((short.end - short.start) / 60000, 45); assert.equal(+short.end, +now);
  assert.equal(parseBabyLog('frankie fell asleep 3:40', now).kind, 'sleep-start');
  assert.equal(hm(parseBabyLog('frankie fell asleep 3:40', now).start), '16 15:40');
  assert.equal(parseBabyLog('frankie woke up', now).kind, 'sleep-stop');
});

test('calendar plans with Frankie stay calendar plans', () => {
  assert.equal(parseBabyLog('Frankie swim class Tue 3pm', now), null);
  assert.equal(parseBabyLog('Pediatrician Tue 3pm with Frankie', now), null);
  assert.equal(parseBabyLog('bottle 4oz', now), null); // must name Frankie
  assert.ok(parseQuickAdd('Frankie swim class Tue 3pm', now));
});

test('previews read naturally', () => {
  assert.match(describeBabyLog(parseBabyLog('frankie bottle 10:30AM 4oz formula', now), 'en-US'), /🍼 Bottle for Frankie · 10:30 AM · 4 oz Formula/);
  assert.match(describeBabyLog(parseBabyLog('frankie bottle', now), 'en-US'), /same as last bottle/);
  assert.match(describeBabyLog(parseBabyLog('frankie nap 1-2:15pm', now), 'en-US'), /Finished sleep for Frankie · 1:00 PM – 2:15 PM · 75 min/);
});
