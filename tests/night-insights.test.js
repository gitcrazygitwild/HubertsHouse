import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { lastNight, weekdayLinks, weekdayPattern } = await import('../night-insights.js');
const { lastNightTile, weekdayHTML } = await import('../night-insights-view.js');
const tz = 'America/New_York', HOUR = 3600000, MIN = 60000;
const at = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h + 5, min)).getTime(); // EST

test('last night: bedtime to morning, wake-ups, feeds and how it compares', () => {
  const now = at(2026, 11, 24, 10), sleeps = [], bottles = [];
  for (let d = 10; d <= 22; d++) { sleeps.push({ start:at(2026, 11, d, 19, 30), end:at(2026, 11, d, 23, 30) }, { start:at(2026, 11, d, 23, 50), end:at(2026, 11, d + 1, 6, 0) }); }
  // Last night: 7:00 PM → 1:00 AM, up 20 min with a bottle, back down until 6:40 AM.
  sleeps.push({ start:at(2026, 11, 23, 19), end:at(2026, 11, 24, 1) }, { start:at(2026, 11, 24, 1, 20), end:at(2026, 11, 24, 6, 40) });
  bottles.push({ start:at(2026, 11, 24, 1, 5), amount:4, units:'oz' });
  const night = lastNight({ sleeps, bottles, timezone:tz, now });
  assert.equal(night.available, true); assert.equal(night.key, '2026-11-23');
  assert.deepEqual([night.slept, night.longest, night.wakeups, night.feeds, night.ounces], [680, 360, 1, 1, 4]);
  assert.equal(night.average.slept, 610); assert.equal(night.vsAverage, 70);
  const tile = lastNightTile(night, tz);
  assert.match(tile, /Last night/); assert.match(tile, /11h 20m/); assert.match(tile, /7:00 PM → 6:40 AM · 1h 10m more than usual/); assert.match(tile, /1 wake-up · 1 feed \(4 oz\) · longest 6h 00m/);
});

test('a night in progress shows as "Tonight so far"', () => {
  const now = at(2026, 11, 24, 23), night = lastNight({ sleeps:[], timer:{ active:true, start:at(2026, 11, 24, 19, 30) }, timezone:tz, now });
  assert.equal(night.inProgress, true); assert.equal(night.slept, 210); assert.match(lastNightTile(night, tz), /Tonight so far/);
});

test('weekday pattern: a planted Saturday effect is found; noise is not', () => {
  const start = at(2026, 9, 28, 12), points = [], noise = [];
  let seed = 3; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 56; i++) {
    const t = start + i * 24 * HOUR, day = new Date(t).getUTCDay(), base = 600 + i * 0.8 + (rand() - 0.5) * 40;
    points.push({ t, day, v:base + (day === 6 ? 60 : 0) }); noise.push({ t, day, v:base });
  }
  const found = weekdayPattern(points), none = weekdayPattern(noise);
  assert.equal(found.verdict, 'clear'); assert.equal(found.high.name, 'Saturday'); assert.ok(found.high.diff > 40);
  assert.equal(none.verdict, 'none');
  assert.equal(weekdayPattern(points.slice(0, 10)).verdict, 'not-enough');
});

test('weekdayLinks covers five measures, and the rows explain themselves', () => {
  const now = at(2026, 11, 24, 10), sleeps = [], bottles = [];
  for (let d = 0; d < 50; d++) {
    const day = new Date(at(2026, 10, 5, 12) + d * 24 * HOUR), y = 2026, m = day.getUTCMonth() + 1, dd = day.getUTCDate(), sat = day.getUTCDay() === 6;
    const bed = at(y, m, dd, 19, 30), wake = bed + (sat ? 12 * 60 : 10.5 * 60) * MIN;
    sleeps.push({ start:at(y, m, dd, 9), end:at(y, m, dd, 10) }, { start:bed, end:wake });
    for (const h of [7, 10, 13, 16, 19]) bottles.push({ start:at(y, m, dd, h), amount:4, units:'oz' });
  }
  const links = weekdayLinks({ sleeps, bottles, timezone:tz, now });
  assert.deepEqual(Object.keys(links), ['night', 'bedtime', 'wake', 'naps', 'ounces']);
  assert.equal(links.night.verdict, 'clear'); assert.equal(links.night.high.name, 'Saturday');
  const html = weekdayHTML(links);
  assert.match(html, /Days of the week/); assert.match(html, /Night sleep by weekday/); assert.match(html, /Saturdays 1h \d\dm longer than her average/);
});
