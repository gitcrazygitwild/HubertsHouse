import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHypothesis, describeHypothesis, hypothesisData, testHypothesis, claudeDigest, fits, FACTORS, OUTCOMES } from '../hypotheses.js';

const zone = 'UTC', H = 3600000, M = 60000, DAY = 86400000, now = Date.parse('2026-11-22T12:00:00Z');
// Five weeks: bath nights (Sun, Wed) run 45 minutes longer; afternoon naps are shorter.
function logs() {
  const sleeps = [], bottles = [];
  for (let d = 35; d >= 1; d--) {
    const base = Date.parse('2026-11-22T00:00:00Z') - d * DAY, weekday = new Date(base).getUTCDay(), bath = weekday === 0 || weekday === 3;
    sleeps.push({ start:base + 9 * H, end:base + 10.25 * H }, { start:base + 13 * H, end:base + 13.75 * H + (d % 3) * 5 * M }, { start:base + 19.5 * H, end:base + (30 + (bath ? 0.75 : 0) + (d % 4) * 0.08) * H });
    for (const [h, oz] of [[7, 4], [11, 4], [15, 4], [18.5, 5 + (d % 2)]]) bottles.push({ start:new Date(base + h * H).toISOString(), amount:oz, units:'oz' });
  }
  return { sleeps:sleeps.map(s => ({ start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString() })), bottles };
}

test('hunches in plain words are read into something testable (or left for Claude)', () => {
  const read = text => { const p = parseHypothesis(text); return [p.factor, p.outcome, p.direction]; };
  assert.deepEqual(read('She sleeps longer on bath nights'), ['bath', 'nightLength', 'more']);
  assert.deepEqual(read('A bigger bottle before bed means fewer night wakings'), ['eveningOz', 'wakeups', 'less']);
  assert.deepEqual(read('Late last nap = later bedtime'), ['lateLastNap', 'bedtime', 'more']);
  assert.deepEqual(read('Afternoon naps are shorter'), ['afternoon', 'napLength', 'less']);
  assert.deepEqual(read('She wakes up earlier when bedtime is late'), ['lateBedtime', 'morningWake', 'less']);
  assert.deepEqual(read('She takes shorter naps when she has a bottle right before'), ['bottleBefore', 'napLength', 'less']);
  assert.deepEqual(read('When she eats more she sleeps through'), ['dayOz', 'wakeups', 'less']);
  assert.deepEqual(read('She is happier on Tuesdays').slice(0, 2), [null, null], 'nothing to test: saved for Claude');
  assert.equal(describeHypothesis({ factor:'bath', outcome:'nightLength', direction:'more' }), 'When it’s a bath night, her night sleep is longer.');
  assert.equal(fits('bath', 'napLength'), false, 'a night thing needs a night result');
  assert.equal(fits('lateBedtime', 'bedtime'), false, 'no circular hunches');
  for (const [key, f] of Object.entries(FACTORS)) assert.ok(Object.keys(OUTCOMES).some(o => fits(key, o)), key);
});

test('a hunch is tested against her logs: true, the opposite, no difference, or not enough yet', () => {
  const data = hypothesisData({ ...logs(), timezone:zone, bathDays:[0, 3], now });
  assert.ok(data.nights.length >= 30 && data.naps.length >= 60);
  const bath = testHypothesis({ factor:'bath', outcome:'nightLength', direction:'more' }, data);
  assert.equal(bath.status, 'true'); assert.match(bath.detail, /bath nights.*longer/); assert.ok(bath.diff > 30);
  assert.equal(testHypothesis({ factor:'bath', outcome:'nightLength', direction:'less' }, data).status, 'opposite');
  assert.equal(testHypothesis({ factor:'afternoon', outcome:'napLength', direction:'less' }, data).status, 'true');
  assert.equal(testHypothesis({ factor:'eveningOz', outcome:'bedtime', direction:'more' }, data).status, 'none', 'bedtime never moves in these logs');
  const thin = testHypothesis({ factor:'bath', outcome:'nightLength' }, hypothesisData({ ...logs(), timezone:zone, bathDays:[0, 3], now, days:6 }));
  assert.equal(thin.status, 'thin');
  assert.equal(testHypothesis({ factor:'bath', outcome:'napLength' }, data).status, 'invalid');
  const digest = claudeDigest('She’s fussier on Tuesdays', data, { timezone:zone, bathDays:[0, 3] });
  assert.match(digest, /Hunch: "She’s fussier on Tuesdays"/); assert.match(digest, /Nights \(/); assert.ok(digest.split('\n').length > 40 && digest.length < 12000);
});
