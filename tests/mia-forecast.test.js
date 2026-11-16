import test from 'node:test';
import assert from 'node:assert/strict';
import { miaForecast, indexedWakeWindows, purrfectWindow } from '../baby-model.js';

const zone = 'UTC', DAY = 86400000, H = 3600000, M = 60000;
const today = Date.parse('2026-11-16T00:00:00Z');
// A day: night until 7:00, then naps placed by wake windows (minutes) and nap lengths (minutes).
function day(offset, windows, naps, morning = 7) {
  const base = today - offset * DAY, sleeps = [{start:base - 5 * H, end:base + morning * H}];
  let cursor = base + morning * H;
  windows.forEach((window, i) => { const start = cursor + window * M, end = start + naps[i] * M; sleeps.push({start, end}); cursor = end; });
  return sleeps;
}
const iso = list => list.map(s => ({start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString()}));

test('wake windows are indexed by their position in the day', () => {
  const sleeps = iso([...day(1,[90,120,150],[60,60,45])]);
  const {samples} = indexedWakeWindows(sleeps, zone, new Date(today + 10 * H));
  assert.deepEqual(samples.map(s => [s.index, s.minutes, s.previousNap]), [[1,90,null],[2,120,60],[3,150,60]]);
});

test('Mia forecasts the next wake window for the right nap of the day', () => {
  const history = []; for (let d = 1; d <= 7; d++) history.push(...day(d,[90,120,150],[60,60,45]));
  const sleeps = iso([...history, ...day(0,[90],[60])]); // woke 7:00, nap 1 8:30–9:30
  const now = new Date(today + 10 * H);
  const mia = miaForecast({sleeps, timezone:zone}, now);
  assert.equal(mia.available, true); assert.equal(mia.napNumber, 2); assert.equal(mia.matched, 'exact');
  assert.equal(Date.parse(mia.target), today + (9.5 * H) + 120 * M); // 11:30
  assert.equal(mia.trendMinutes, 0); assert.equal(mia.napMinutes, 0);
  assert.ok(Date.parse(mia.start) < Date.parse(mia.target) && Date.parse(mia.end) > Date.parse(mia.target));
});

test('a short nap shortens the forecast when the history shows that pattern', () => {
  // Learn: after a 30-minute nap 1, the next window was 30 minutes shorter.
  const history = []; for (let d = 1; d <= 8; d++) history.push(...(d % 2 ? day(d,[90,120],[60,60]) : day(d,[90,105],[30,60])));
  const now = new Date(today + 9.5 * H);
  const short = miaForecast({sleeps:iso([...history, ...day(0,[90],[30])]), timezone:zone}, now);
  const long = miaForecast({sleeps:iso([...history, ...day(0,[90],[60])]), timezone:zone}, new Date(today + 10 * H));
  assert.ok(short.napMinutes < 0, `short nap effect ${short.napMinutes}`);
  assert.ok(long.napMinutes > 0, `long nap effect ${long.napMinutes}`);
  assert.ok(Date.parse(short.target) - Date.parse(short.lastWake) < Date.parse(long.target) - Date.parse(long.lastWake));
});

test('a growing wake window projects above the plain average', () => {
  const history = []; for (let d = 1; d <= 10; d++) history.push(...day(d,[90 - d * 2],[60]));
  const mia = miaForecast({sleeps:iso([...history, {start:today - 5 * H, end:today + 7 * H}]), timezone:zone}, new Date(today + 7.5 * H));
  assert.equal(mia.napNumber, 1); assert.ok(mia.trendMinutes > 0); assert.ok(mia.baseMinutes + mia.trendMinutes > mia.baseMinutes);
});

test('Mia stays quiet while asleep, overnight, without history, and uses a different method from Purrfect Window', () => {
  assert.equal(miaForecast({sleeps:[], timer:{active:true}}).available, false);
  assert.equal(miaForecast({sleeps:iso(day(0,[],[])), timezone:zone}, new Date(today + 7.2 * H)).available, false);
  assert.equal(miaForecast({sleeps:iso(day(1,[90],[60])), timezone:zone}, new Date(today + 23 * H)).available, false);
  // Same history, different answers: Purrfect pools every window near this hour; Mia looks at nap 2 only.
  const history = []; for (let d = 1; d <= 6; d++) history.push(...day(d,[60,150],[60,60]));
  const sleeps = iso([...history, ...day(0,[60],[60])]), now = new Date(today + 9.2 * H);
  const mia = miaForecast({sleeps, timezone:zone}, now), purr = purrfectWindow({sleeps, timezone:zone}, now);
  assert.equal(mia.available, true); assert.equal(purr.available, true);
  assert.notEqual(mia.target, purr.target);
});
