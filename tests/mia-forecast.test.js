import test from 'node:test';
import assert from 'node:assert/strict';
import { miaForecast, indexedWakeWindows, purrfectWindow } from '../baby-model.js';
import { nightLine, sleepKind, dailySleep } from '../baby-history.js';
import { isDaytimeWake } from '../prediction-log.js';

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

test('Mia forecasts bedtime after the day’s usual last nap', () => {
  // Three naps a day, bed at 19:00 every night (the next day's night starts then).
  const history = []; for (let d = 1; d <= 7; d++) history.push(...day(d,[90,120,150],[60,60,45]));
  const sleeps = iso([...history, ...day(0,[90,120,150],[60,60,45])]); // nap 3 ended 15:45
  const mia = miaForecast({sleeps, timezone:zone}, new Date(today + 16 * H));
  assert.equal(mia.available, true); assert.equal(mia.kind, 'bedtime'); assert.equal(mia.usualNaps, 3);
  assert.equal(Date.parse(mia.target), today + 19 * H); // 3h15 after nap 3, which is also 7:00 PM
  const {bedtimes} = indexedWakeWindows(sleeps, zone, new Date(today + 16 * H));
  assert.ok(bedtimes.length >= 6 && bedtimes.every(b => b.minutes === 195 && b.naps === 3));
  // Earlier in the day it is still a nap forecast.
  const midday = miaForecast({sleeps:iso([...history, ...day(0,[90,120],[60,60])]), timezone:zone}, new Date(today + 13 * H));
  assert.equal(midday.kind, 'nap'); assert.equal(midday.napNumber, 3);
});

test('bedtime leans on the clock when bedtime is a steady routine', () => {
  // Last nap ends at different times, but bed is always 19:00: the clock is steadier.
  const history = []; for (let d = 1; d <= 8; d++) history.push(...day(d,[90,120 + (d % 3) * 30],[60,60]));
  const sleeps = iso([...history, ...day(0,[90,180],[60,60])]); // nap 2 ended 13:30, later than usual
  const mia = miaForecast({sleeps, timezone:zone}, new Date(today + 14 * H));
  assert.equal(mia.kind, 'bedtime');
  assert.ok(mia.clockShare > 50, `clock share ${mia.clockShare}`);
  assert.ok(Math.abs(Date.parse(mia.target) - (today + 19 * H)) <= 20 * M, new Date(mia.target).toISOString());
});

test('a short night shortens the first wake window when the history shows that pattern', () => {
  // Learn: after an 11h night the first window was 120m; after a 9h night, 90m.
  const history = [];
  for (let d = 1; d <= 8; d++) { const long = d % 2 === 1, s = day(d,[long ? 120 : 90],[60]); s[0].start = s[0].end - (long ? 11 : 9) * H; history.push(...s); }
  const shortNight = day(0,[],[]); shortNight[0].start = shortNight[0].end - 9 * H;
  const longNight = day(0,[],[]); longNight[0].start = longNight[0].end - 11 * H;
  const now = new Date(today + 7.25 * H);
  const short = miaForecast({sleeps:iso([...history, ...shortNight]), timezone:zone}, now);
  const long = miaForecast({sleeps:iso([...history, ...longNight]), timezone:zone}, now);
  assert.equal(short.napNumber, 1); assert.equal(short.kind, 'nap');
  assert.equal(short.lastNight, 540); assert.equal(long.lastNight, 660);
  assert.ok(short.nightMinutes < 0, `short night effect ${short.nightMinutes}`);
  assert.ok(long.nightMinutes > 0, `long night effect ${long.nightMinutes}`);
  assert.ok(Date.parse(short.target) < Date.parse(long.target));
});

test('night segments with a waking add up to one night', () => {
  const base = today, sleeps = iso([
    {start:base - 5 * H, end:base + 1 * H}, {start:base + 1.5 * H, end:base + 6.5 * H}, // 19:00–01:00, 01:30–06:30
    {start:base + 8 * H, end:base + 9 * H}]);
  const {byDay, samples} = indexedWakeWindows(sleeps, zone, new Date(base + 10 * H));
  const entry = byDay.get('2026-11-16');
  assert.equal(entry.night, 660); assert.equal(entry.wake, base + 6.5 * H);
  assert.equal(samples[0].minutes, 90); assert.equal(samples[0].lastNight, 660);
});

// Frankie's real rhythm: bed around 10 PM and a late catnap 7:15–7:45 PM.
function lateDay(offset, bedHour = 22) {
  const sleeps = day(offset, [120,150,150,150], [60,60,45,30]);
  sleeps[0].start = today - offset * DAY - (24 - bedHour) * H; // last night's bedtime
  return sleeps;
}
test('the evening line is learned from Frankie’s bedtimes, so a late catnap is still a nap', () => {
  const history = []; for (let d = 1; d <= 8; d++) history.push(...lateDay(d, d % 2 ? 21.5 : 22.5));
  const line = nightLine(iso(history), zone, today);
  assert.ok(line >= 20.5 * 60 && line <= 21.5 * 60, `line ${line / 60}`);
  const catnap = {start:new Date(today - DAY + 19.25 * H).toISOString(), end:new Date(today - DAY + 19.75 * H).toISOString()};
  assert.equal(sleepKind(catnap, zone, line), 'nap');
  assert.equal(sleepKind(catnap, zone), 'night'); // the old fixed 7 PM rule
  assert.equal(nightLine([], zone, today), 19 * 60); // too little history: the old line
  // The Frankie page counts the catnap as a nap too.
  const yesterday = dailySleep(iso(history), zone, 3, today).at(-2);
  assert.equal(yesterday.naps, 4);
});

test('after a late catnap Mia forecasts bedtime instead of calling it overnight', () => {
  const history = []; for (let d = 1; d <= 8; d++) history.push(...lateDay(d));
  const sleeps = iso([...history, ...lateDay(0)]); // catnap 7:15–7:45 PM today
  const now = new Date(today + 20 * H);
  const mia = miaForecast({sleeps, timezone:zone}, now);
  assert.equal(mia.available, true, mia.reason); assert.equal(mia.kind, 'bedtime'); assert.equal(mia.napsToday, 4);
  assert.equal(Date.parse(mia.target), today + 22 * H);
  // A real night waking (asleep at 10, up at 11) stays quiet.
  const waking = iso([...history, ...lateDay(0), {start:today + 22 * H, end:today + 23 * H}]);
  assert.equal(miaForecast({sleeps:waking, timezone:zone}, new Date(today + 23.1 * H)).available, false);
  // The scoreboard scores the wake-up after the catnap, but not the night waking.
  assert.equal(isDaytimeWake(sleeps.at(-1).end, zone, sleeps), true);
  assert.equal(isDaytimeWake(waking.at(-1).end, zone, waking), false);
});
