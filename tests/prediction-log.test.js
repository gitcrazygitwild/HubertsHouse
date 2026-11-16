import test from 'node:test';
import assert from 'node:assert/strict';
import { sweetspotEntry, sweetspotPatch, previousSweetspot, actualSleepStart, replayGuesses, scorePredictions, isDaytimeWake, predictionId } from '../prediction-log.js';
import { purrfectWindow, miaForecast } from '../baby-model.js';

const zone = 'UTC', DAY = 86400000, H = 3600000, M = 60000;
const today = Date.parse('2026-11-16T00:00:00Z'), iso = ms => new Date(ms).toISOString();
// Night until 7:00, then naps placed by wake windows and nap lengths (minutes).
function day(offset, windows = [90, 120, 140], naps = [60, 70, 40]) {
  const base = today - offset * DAY, sleeps = [{ start:base - 5 * H, end:base + 7 * H }];
  let cursor = base + 7 * H;
  windows.forEach((w, i) => { const start = cursor + w * M; sleeps.push({ start, end:start + naps[i] * M }); cursor = start + naps[i] * M; });
  return sleeps;
}
const history = days => Array.from({ length:days }, (_, i) => day(days - i)).flat().map(s => ({ start:iso(s.start), end:iso(s.end) }));

test('SweetSpot is captured for daytime wake-ups while awake, and the latest capture wins', () => {
  const wake = iso(today + 9 * H), now = new Date(today + 9.1 * H), sweetspot = { available:true, time:iso(today + 11 * H) };
  const entry = sweetspotEntry({ lastWake:wake, childId:'c', sweetspot, timezone:zone, now });
  assert.equal(entry.id, predictionId(wake)); assert.equal(entry.sweetspot.target, sweetspot.time);
  // Asleep, overnight, expired, or the previous nap's unrecalculated prediction: nothing to save.
  assert.equal(sweetspotEntry({ lastWake:wake, sweetspot, timer:{ active:true }, timezone:zone, now }), null);
  assert.equal(sweetspotEntry({ lastWake:iso(today + 3 * H), sweetspot, timezone:zone, now:new Date(today + 3.1 * H) }), null);
  assert.equal(sweetspotEntry({ lastWake:wake, sweetspot:{ available:true, time:iso(today + 8 * H) }, timezone:zone, now }), null);
  assert.equal(sweetspotEntry({ lastWake:wake, sweetspot, previousTarget:sweetspot.time, timezone:zone, now }), null);
  assert.equal(isDaytimeWake('2026-11-16T08:00:00.000Z', 'America/New_York'), false);
  // Huckleberry recalculated: replace; same prediction again: no write.
  const newer = sweetspotEntry({ lastWake:wake, childId:'c', sweetspot:{ available:true, time:iso(today + 11.3 * H) }, timezone:zone, now:new Date(today + 9.5 * H) });
  assert.deepEqual(sweetspotPatch(entry, newer), { sweetspot:newer.sweetspot });
  assert.equal(sweetspotPatch(newer, newer), null); assert.equal(sweetspotPatch(null, entry), entry);
  assert.equal(previousSweetspot([entry, { id:'x', lastWake:iso(today + 12 * H), sweetspot:{ target:'later' } }], iso(today + 12 * H)), sweetspot.time);
});

test('Hubert and Mia are replayed as of the wake-up, using only sleep logged before it', () => {
  const sleeps = history(8), wake = sleeps.at(-2).end, known = sleeps.filter(s => Date.parse(s.end) <= Date.parse(wake));
  const replay = replayGuesses(sleeps, wake, zone), at = new Date(Date.parse(wake) + M);
  assert.equal(replay.purrfect.target, purrfectWindow({ sleeps:known, timezone:zone }, at).target);
  assert.equal(replay.mia.target, miaForecast({ sleeps:known, timezone:zone }, at).target);
  // The nap that came after the wake-up cannot influence its guesses.
  const altered = sleeps.map((s, i) => i === sleeps.length - 1 ? { start:iso(Date.parse(s.start) + 40 * M), end:s.end } : s);
  assert.deepEqual(replayGuesses(altered, wake, zone), replay);
});

test('a backfilled nap gets Hubert and Mia guesses; scoring needs all three models', () => {
  const sleeps = history(8), wakes = sleeps.slice(-4, -1).map(s => s.end);
  const entries = wakes.map(w => ({ id:predictionId(w), lastWake:w, sweetspot:{ target:iso(actualSleepStart(w, sleeps) + 10 * M) } }));
  // Drop the SweetSpot for the middle wake-up, as if the nap was backfilled later.
  const partial = entries.filter((_, i) => i !== 1), score = scorePredictions(partial, sleeps, null, zone);
  assert.equal(score.scoredNaps, 2); assert.equal(score.skipped, 1); assert.equal(score.leader, null);
  for (const row of score.results) assert.deepEqual(Object.keys(row.models).sort(), ['mia', 'purrfect', 'sweetspot']);
  assert.equal(score.results[0].models.sweetspot.error, -10); assert.equal(score.results[0].models.sweetspot.hit, true);
  const full = scorePredictions(entries, sleeps, null, zone);
  assert.equal(full.scoredNaps, 3); assert.ok(full.leader); assert.equal(full.summary[0].n, 3);
  // Naps before the first saved SweetSpot predate the scoreboard and are not "skipped".
  assert.equal(full.skipped, 0);
});

test('the actual nap is the first sleep after the wake-up, including a running timer', () => {
  const wake = iso(today + 9 * H);
  assert.equal(actualSleepStart(wake, [{ start:iso(today + 8 * H) }, { start:iso(today + 11 * H) }]), today + 11 * H);
  assert.equal(actualSleepStart(wake, [], { active:true, start:iso(today + 10 * H) }), today + 10 * H);
  assert.equal(actualSleepStart(wake, [{ start:iso(today + 19 * H) }]), null);
});

test('a wide window earns no easier hit: every model is judged on one time, ±15 minutes', () => {
  const sleeps = history(8), wake = sleeps.at(-2).end, actual = actualSleepStart(wake, sleeps);
  const entries = [{ id:predictionId(wake), lastWake:wake, sweetspot:{ target:iso(actual + 20 * M) } }];
  const { results, summary } = scorePredictions(entries, sleeps, null, zone);
  const row = results[0].models;
  assert.equal(row.sweetspot.hit, false); assert.equal(row.sweetspot.width, null);
  for (const key of ['purrfect', 'mia']) {
    assert.equal(row[key].hit, Math.abs(row[key].error) <= 15, `${key} hit follows ±15 of its center`);
    assert.ok(row[key].width > 0); assert.equal(typeof row[key].inWindow, 'boolean');
  }
  const by = Object.fromEntries(summary.map(s => [s.key, s]));
  assert.equal(by.sweetspot.avgWidth, null); assert.ok(by.purrfect.avgWidth > 0); assert.ok(by.mia.avgWidth > 0);
});
