import test from 'node:test';
import assert from 'node:assert/strict';
import { predictionEntry, missingFields, actualSleepStart, scorePredictions, isDaytimeWake } from '../prediction-log.js';

const wake = '2026-11-16T14:00:00.000Z', at = minutes => new Date(Date.parse(wake) + minutes * 60000).toISOString();
const win = (start, end, target) => ({ available:true, start:at(start), end:at(end), target:at(target) });

test('entries lock in only models with a guess for this wake-up', () => {
  const entry = predictionEntry({ lastWake:wake, childId:'c', now:new Date(at(5)),
    sweetspot:{ available:true, time:at(-30) }, purrfect:win(100,130,115), mia:{ available:false } });
  assert.equal(entry.id, `w${Date.parse(wake)}`); assert.equal(entry.sweetspot, undefined); assert.equal(entry.mia, undefined);
  assert.equal(entry.purrfect.target, at(115));
  assert.equal(predictionEntry({ lastWake:wake, purrfect:{ available:false }, now:new Date(at(5)) }), null);
  assert.equal(predictionEntry({ lastWake:wake, purrfect:win(1,2,1), now:new Date(at(9 * 60)) }), null);
  // 3am (New York) feed wake: SweetSpot alone must not be scored as a nap.
  const night = '2026-11-16T08:00:00.000Z';
  assert.equal(isDaytimeWake(night, 'America/New_York'), false); assert.equal(isDaytimeWake(wake, 'America/New_York'), true);
  assert.equal(predictionEntry({ lastWake:night, timezone:'America/New_York', sweetspot:{ available:true, time:'2026-11-16T09:00:00.000Z' }, now:new Date('2026-11-16T08:05:00Z') }), null);
});

test('a guess already logged is never replaced; missing ones can be added', () => {
  const first = { purrfect:{ target:at(115) } };
  assert.equal(missingFields(first, { purrfect:{ target:at(90) } }), null);
  assert.deepEqual(missingFields(first, { purrfect:{ target:at(90) }, mia:{ target:at(120) } }), { mia:{ target:at(120) } });
  assert.deepEqual(missingFields(null, { mia:{ target:at(1) } }), { mia:{ target:at(1) } });
});

test('the actual nap is the first sleep after the wake-up, including a running timer', () => {
  assert.equal(actualSleepStart(wake, [{ start:at(-60) }, { start:at(130) }, { start:at(300) }]), Date.parse(at(130)));
  assert.equal(actualSleepStart(wake, [], { active:true, start:at(95) }), Date.parse(at(95)));
  assert.equal(actualSleepStart(wake, [{ start:at(10 * 60) }]), null);
});

test('scores error, hits, wins and a leader once each model has three naps', () => {
  const entries = [0, 1, 2].map(day => {
    const shift = day * 1440, w = at(shift);
    return { id:String(day), lastWake:w, sweetspot:{ target:at(shift + 140) }, purrfect:{ start:at(shift + 100), end:at(shift + 130), target:at(shift + 115) }, mia:{ start:at(shift + 110), end:at(shift + 135), target:at(shift + 122) } };
  });
  const sleeps = [0, 1, 2].map(day => ({ start:at(day * 1440 + 120), end:at(day * 1440 + 180) }));
  const { summary, leader, results } = scorePredictions(entries, sleeps);
  const by = Object.fromEntries(summary.map(s => [s.key, s]));
  assert.equal(results.length, 3);
  assert.equal(by.purrfect.mae, 5); assert.equal(by.purrfect.bias, 5); assert.equal(by.purrfect.hitRate, 100);
  assert.equal(by.mia.mae, 2); assert.equal(by.mia.wins, 3);
  assert.equal(by.sweetspot.mae, 20); assert.equal(by.sweetspot.hitRate, 0);
  assert.equal(leader, 'mia');
  assert.equal(scorePredictions(entries.slice(0, 2), sleeps).leader, null);
});
