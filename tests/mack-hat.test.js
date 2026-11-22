import test from 'node:test';
import assert from 'node:assert/strict';
import { hatGuess, hatSeed, scoreHat, HAT_LINES } from '../mack-hat.js';
import { scorePredictions } from '../prediction-log.js';
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
