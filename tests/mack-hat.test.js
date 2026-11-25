import test from 'node:test';
import assert from 'node:assert/strict';
import { hatGuess, hatSeed, scoreHat, HAT_LINES, sweetspotQuiet } from '../mack-hat.js';
import { scorePredictions, predictionId } from '../prediction-log.js';
import { sampleHistory, samplePredictions } from '../baby-sample.js';

const M = 60000;
test('Mack’s hat: near the other cats, a little random, the same every time for the same moment', () => {
  const base = Date.parse('2026-11-22T19:00:00Z'), offsets = new Set();
  for (let i = 0; i < 60; i++) {
    const seed = hatSeed('wake', base - i * 3600000), a = hatGuess({ bases:[base - 10 * M, base + 10 * M], seed }), b = hatGuess({ bases:[base - 10 * M, base + 10 * M], seed });
    assert.deepEqual(a, b, 'the same moment pulls the same slip');
    const off = (Date.parse(a.target) - base) / M;
    assert.ok(Math.abs(off) <= 25 && off % 5 === 0, `${off} minutes: within 25, in fives`);
    assert.equal(a.offset, off); assert.ok(a.line.length > 20);
    offsets.add(off);
  }
  assert.ok(offsets.size >= 5, 'it really is a bit random');
  // Never earlier than 10 minutes after the hat came out; nothing to go on gives null.
  const late = hatGuess({ bases:[base - 3 * 3600000], seed:'x', firedAt:base });
  assert.ok(Date.parse(late.target) >= base + 10 * M && Date.parse(late.target) <= base + 30 * M); assert.equal(late.offset, null);
  assert.equal(hatGuess({ bases:[null], seed:'y' }), null);
  assert.ok(hatGuess({ bases:[], fallback:base, seed:'z' }), 'a plain fallback works');
  assert.ok(HAT_LINES.length >= 8);
});

test('the hat’s track record is replayed from the logs and never touches the competition', () => {
  const now = Date.parse('2026-11-22T18:00:00Z'), { sleeps, bottles } = sampleHistory(now), entries = samplePredictions(sleeps, 'UTC', now);
  const before = JSON.stringify(scorePredictions(entries, sleeps, null, 'UTC', { bottles }).summary);
  const hat = scoreHat(entries, sleeps, null, 'UTC', now, { bottles });
  assert.ok(hat.n > 20 && hat.kinds.wake > 0 && hat.kinds.morning > 0, JSON.stringify(hat.kinds));
  assert.equal(hat.n, hat.kinds.sleep + hat.kinds.wake + hat.kinds.morning);
  assert.ok(hat.results.every(r => Number.isInteger(r.error) && r.line), 'every pull has a miss and an excuse');
  assert.ok(Math.abs(hat.best.error) <= Math.abs(hat.worst.error));
  assert.equal(JSON.stringify(hat), JSON.stringify(scoreHat(entries, sleeps, null, 'UTC', now, { bottles })), 'replays the same');
  // Next-sleep pulls only where SweetSpot didn't cover the wake-up.
  const covered = new Set(entries.map(e => e.lastWake));
  assert.ok(hat.results.filter(r => r.kind === 'sleep').every(r => !covered.has(r.at) || entries.some(e => e.sweetspot.target === r.at)));
  assert.equal(JSON.stringify(scorePredictions(entries, sleeps, null, 'UTC', { bottles }).summary), before, 'the nap scoreboard is unchanged');
});

test('Mack stays quiet when SweetSpot’s nap call passed while she’s still up, but not after a bedtime call', () => {
  process.env.TZ = 'America/New_York';
  const tz = 'America/New_York', day = d => `2026-11-${String(d).padStart(2, '0')}`, sleeps = [];
  for (let d = 18; d <= 24; d++) sleeps.push({ start:`${day(d - 1)}T19:30:00-05:00`, end:`${day(d)}T06:30:00-05:00` }, { start:`${day(d)}T09:00:00-05:00`, end:`${day(d)}T10:00:00-05:00` });
  const now = Date.parse(`${day(24)}T12:30:00-05:00`);
  // Awake since 10:00; SweetSpot said 12:15 for her nap and it's 12:30: she's just late, no hat.
  assert.equal(sweetspotQuiet({ available:true, time:`${day(24)}T12:15:00-05:00`, expired:true, sleeping:false }, sleeps, tz, now), false);
  // A live call: no hat.
  assert.equal(sweetspotQuiet({ available:true, time:`${day(24)}T13:00:00-05:00`, expired:false, sleeping:false }, sleeps, tz, now), false);
  // SweetSpot's call was for bedtime (7:15 PM, past her evening line) and it passed: SweetSpot is done until morning, so Mack may.
  assert.equal(sweetspotQuiet({ available:true, time:`${day(24)}T19:15:00-05:00`, expired:true, sleeping:false }, sleeps, tz, Date.parse(`${day(24)}T19:45:00-05:00`)), true);
  // No call since her last sleep (the saved one is from before she napped), asleep, or no SweetSpot: Mack may.
  assert.equal(sweetspotQuiet({ available:true, time:`${day(24)}T08:50:00-05:00`, expired:true, sleeping:false }, sleeps, tz, now), true);
  assert.equal(sweetspotQuiet({ available:true, time:`${day(24)}T13:00:00-05:00`, expired:false, sleeping:true }, sleeps, tz, now), true);
  assert.equal(sweetspotQuiet({ available:false }, sleeps, tz, now), true);
});

test('the hat’s record skips wake-ups whose nap SweetSpot passed, and keeps ones whose bedtime call passed', () => {
  process.env.TZ = 'America/New_York';
  const tz = 'America/New_York', day = d => `2026-11-${String(d).padStart(2, '0')}`, sleeps = [];
  for (let d = 10; d <= 24; d++) sleeps.push({ start:`${day(d - 1)}T19:30:00-05:00`, end:`${day(d)}T06:30:00-05:00` }, { start:`${day(d)}T09:00:00-05:00`, end:`${day(d)}T10:00:00-05:00` }, { start:`${day(d)}T13:00:00-05:00`, end:`${day(d)}T14:00:00-05:00` });
  const now = Date.parse(`${day(24)}T21:00:00-05:00`), id = stamp => predictionId(stamp);
  // On the 23rd: after the 10:00 wake SweetSpot said 12:30 (passed, she slept at 1:00) → no pull;
  // after the 2:00 PM wake SweetSpot said 7:00 PM bedtime (passed, she slept at 7:30) → a pull.
  const entries = [
    { id:id(`${day(23)}T10:00:00-05:00`), lastWake:`${day(23)}T10:00:00-05:00`, sweetspot:{ target:`${day(23)}T12:30:00-05:00` } },
    { id:id(`${day(23)}T14:00:00-05:00`), lastWake:`${day(23)}T14:00:00-05:00`, sweetspot:{ target:`${day(23)}T19:00:00-05:00` } }
  ];
  const score = scoreHat(entries, sleeps, null, tz, now, { days:2 });
  const sleepPulls = score.results.filter(r => r.kind === 'sleep').map(r => r.at);
  assert.ok(!sleepPulls.includes(new Date(`${day(23)}T12:30:00-05:00`).toISOString()), 'a passed nap call is not a pull');
  assert.ok(sleepPulls.includes(new Date(`${day(23)}T19:00:00-05:00`).toISOString()), 'a passed bedtime call is');
});
