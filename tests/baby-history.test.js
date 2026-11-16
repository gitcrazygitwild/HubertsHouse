import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, dayKeys, dailySleep, dailyBottles, timelineRows, toOunces, babySummary } from '../baby-history.js';

const NY = 'America/New_York', H = 3600000;
const iso = ms => new Date(ms).toISOString();

test('local midnights follow the time zone, including daylight-saving changes', () => {
  assert.equal(iso(dayStart('2026-11-16', NY)), '2026-11-16T05:00:00.000Z');
  assert.equal(iso(dayStart('2026-07-04', NY)), '2026-07-04T04:00:00.000Z');
  assert.equal(dayStart('2026-11-02', NY) - dayStart('2026-11-01', NY), 25 * H); // fall back
  assert.deepEqual(dayKeys(3, NY, Date.parse('2026-11-16T15:00:00Z')), ['2026-11-14','2026-11-15','2026-11-16']);
});

test('a night sleep is split across midnight and naps are counted on their own day', () => {
  const mid = dayStart('2026-11-16', NY);
  const sleeps = [{ start:iso(mid - 4 * H), end:iso(mid + 7 * H) }, { start:iso(mid + 9 * H), end:iso(mid + 10.5 * H) }];
  const [yesterday, today] = dailySleep(sleeps, NY, 2, mid + 12 * H);
  assert.equal(yesterday.night, 4); assert.equal(today.night, 7); assert.equal(today.nap, 1.5); assert.equal(today.naps, 1); assert.equal(today.partial, true);
});

test('bottles add up per local day in ounces, converting milliliters', () => {
  const mid = dayStart('2026-11-16', NY);
  const rows = dailyBottles([{ start:iso(mid + H), amount:4, units:'oz' }, { start:iso(mid + 5 * H), amount:118.294, units:'ml' }, { start:iso(mid - H), amount:3, units:'oz' }], NY, 2, mid + 12 * H);
  assert.deepEqual(rows.map(r => [r.ounces, r.count]), [[3,1],[8,2]]);
  assert.equal(Math.round(toOunces(29.5735, 'ml') * 100) / 100, 1);
});

test('timeline rows run newest first with blocks clipped to each day', () => {
  const mid = dayStart('2026-11-16', NY);
  const rows = timelineRows([{ start:iso(mid - 2 * H), end:iso(mid + 6 * H) }], NY, 2, mid + 8 * H);
  assert.equal(rows[0].key, '2026-11-16'); assert.equal(rows[0].blocks[0].from, 0); assert.equal(rows[0].blocks[0].to, 360); assert.equal(rows[0].nowMinute, 480);
  assert.equal(rows[1].blocks[0].from, 22 * 60); assert.equal(rows[1].blocks[0].kind, 'night');
});

test('summary averages leave out today and empty days', () => {
  const mid = dayStart('2026-11-16', NY), sleeps = [], bottles = [];
  for (let d = 1; d <= 7; d++) { const s = mid - d * 24 * H; sleeps.push({ start:iso(s - 4 * H), end:iso(s + 7 * H) }); bottles.push({ start:iso(s + 8 * H), amount:24, units:'oz' }); }
  const summary = babySummary({ sleeps, bottles }, NY, mid + 10 * H);
  assert.equal(summary.avgOunces, 24); assert.ok(summary.avgSleep > 10);
});
