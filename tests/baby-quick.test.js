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
  // Typed a few minutes early: clamp to now (never a future time the save would reject).
  const early = new Date(2026, 10, 16, 10, 26);
  assert.equal(+parseBabyLog('frankie bottle 10:30am 4oz', early).start, +early);
  assert.equal(hm(parseBabyLog('frankie bottle 10:40am 4oz', early).start), '15 10:40'); // well ahead: yesterday
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
  assert.equal(parseBabyLog('bottle 4oz', now).kind, 'bottle'); // every word is log vocabulary, so no name needed
  assert.ok(parseQuickAdd('Frankie swim class Tue 3pm', now));
});

test('previews read naturally', () => {
  assert.match(describeBabyLog(parseBabyLog('frankie bottle 10:30AM 4oz formula', now), 'en-US'), /🍼 Bottle for Frankie · 10:30 AM · 4 oz Formula/);
  assert.match(describeBabyLog(parseBabyLog('frankie bottle', now), 'en-US'), /same as last bottle/);
  assert.match(describeBabyLog(parseBabyLog('frankie nap 1-2:15pm', now), 'en-US'), /Finished sleep for Frankie · 1:00 PM – 2:15 PM · 75 min/);
});

test('quick Frankie logs without naming her: amounts, diapers, naps, down and up — but plans stay plans', async () => {
  const { parseBabyLog } = await import('../quick-add.js');
  const now = new Date(2026, 10, 27, 14, 30), hm = d => [d.getHours(), d.getMinutes()];
  const log = text => parseBabyLog(text, now);
  assert.deepEqual([log('4oz').kind, log('4oz').amount], ['bottle', 4]);
  assert.deepEqual([log('fed 3.5 at 1:10').amount, ...hm(log('fed 3.5 at 1:10').start)], [3.5, 13, 10]);
  assert.deepEqual([log('ate 4oz 20 min ago').amount, ...hm(log('ate 4oz 20 min ago').start)], [4, 14, 10]);
  assert.equal(log('she drank 3').amount, 3);
  assert.equal(log('4 oz formula').bottleType, 'Formula');
  assert.equal(log('wet').mode, 'pee'); assert.equal(log('poop').mode, 'poo'); assert.equal(log('pee and poop').mode, 'both');
  assert.deepEqual(hm(log('wet diaper 2:05').start), [14, 5]);
  const nap = log('nap 12:30-1:45'); assert.equal(nap.kind, 'sleep-log'); assert.deepEqual([...hm(nap.start), ...hm(nap.end)], [12, 30, 13, 45]);
  assert.equal(log('napped 45 min').kind, 'sleep-log');
  assert.deepEqual([log('down at 2:10').kind, ...hm(log('down at 2:10').start)], ['sleep-start', 14, 10]);
  assert.equal(log("she's down").kind, 'sleep-start'); assert.equal(log('asleep').kind, 'sleep-start');
  assert.deepEqual([log('up 2:20').kind, ...hm(log('up 2:20').start)], ['sleep-stop', 14, 20]);
  assert.equal(log("she's up").kind, 'sleep-stop'); assert.equal(log('woke up').kind, 'sleep-stop');
  assert.equal(log('pumped left 2 right 2.5').kind, 'pump');
  // Anything else in the text means it's a plan (or nothing).
  for (const plan of ['Feed Hubert 9-9:05', 'Nap time Sat 3pm', 'dinner 7pm', 'pick up from daycare 3pm', 'Frankie pick up from daycare 3pm', 'up early meeting 7am', 'down payment tue', 'wet paint on porch', 'Frankie swim class Tue 3pm'])
    assert.equal(log(plan), null, plan);
});
