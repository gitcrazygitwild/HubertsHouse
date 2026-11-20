import test from 'node:test';
import assert from 'node:assert/strict';
import { nightsFrom, currentBedtime, morningPicks, bottlePicks, scoreMornings, scoreBottles, CHALLENGES, MACK_EXCUSE } from '../cat-challenges.js';
import { miaForecast } from '../baby-model.js';
import { MODELS } from '../prediction-log.js';

const zone = 'UTC', H = 3600000, M = 60000, DAY = 86400000;
const today = Date.parse('2026-11-19T00:00:00Z');
const iso = list => list.map(s => ({ start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString() }));
// A day ending in a night: naps, bedtime at `bed` (hours, e.g. 20), a 2 AM feed, and the morning wake at `wake` (hours) next day.
function dayAndNight(offset, { bed = 20, wake = 6.5, naps = [[9, 10], [12.5, 14], [16, 16.75]] } = {}) {
  const base = today - offset * DAY;
  return [...naps.map(([a, b]) => ({ start:base + a * H, end:base + b * H })),
    { start:base + bed * H, end:base + 26 * H }, { start:base + 26.4 * H, end:base + (24 + wake) * H }];
}
function history(nights, opts = () => ({})) { const out = []; for (let d = nights; d >= 1; d--) out.push(...dayAndNight(d, opts(d))); return out; }

test('nights run from bedtime to the morning wake-up, across midnight feeds', () => {
  const nights = nightsFrom(iso(history(5)), zone, today + 8 * H);
  assert.equal(nights.length, 5);
  const last = nights.at(-1);
  assert.equal(last.bedtime, today - DAY + 20 * H); assert.equal(last.morning, today + 6.5 * H);
  assert.equal(last.bedClock, 20 * 60); assert.equal(last.wakeClock, 390);
});

test('each cat calls the morning differently', () => {
  // Wake-ups wander 6:00–7:00; the last night (bed 20:00) woke at 6:40. Tonight's bedtime is 21:00.
  const wakes = [6, 6.25, 7, 6.5, 6.75, 6.1, 6 + 40 / 60];
  const sleeps = iso(history(7, d => ({ wake:wakes[7 - d], bed:d % 2 ? 20 : 21 })));
  const bedtime = today + 21 * H, picks = morningPicks(sleeps, zone, bedtime);
  const clock = iso8601 => { const d = new Date(iso8601); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  // Mack: yesterday's 6:40, plus half of tonight's hour-later bedtime (21:00 vs 20:00) → 7:10.
  assert.equal(clock(picks.mack.target), 430); assert.equal(Date.parse(picks.mack.end) - Date.parse(picks.mack.target), 12 * M);
  // Hubert: nights that started at 21:00 (d even → bed 21): wakes 6.25, 6.5, 6.1 → median 6:15.
  assert.equal(clock(picks.hubert.target), 375);
  // Mia: somewhere sensible in between, with a tight window.
  assert.ok(clock(picks.mia.target) >= 360 && clock(picks.mia.target) <= 420); assert.ok(Date.parse(picks.mia.end) - Date.parse(picks.mia.target) <= 10 * M);
  // With one night logged, only Mack is brave enough to call it.
  const one = morningPicks(iso(history(1)), zone, today + 20 * H);
  assert.ok(one.mack && !one.hubert && !one.mia);
});

test('tonight’s bedtime is found while she sleeps, even after a night feed', () => {
  const sleeps = iso([...history(3), { start:today + 20 * H, end:today + 26 * H }]); // bedtime 20:00, feed at 2 AM
  assert.equal(currentBedtime(sleeps, { active:true, start:new Date(today + 26.3 * H).toISOString() }, zone, today + 27 * H), today + 20 * H);
  assert.equal(currentBedtime(sleeps, { active:true, start:new Date(today + 13 * H).toISOString() }, zone, today + 13.5 * H), null, 'a nap is not bedtime');
  assert.equal(currentBedtime(sleeps, { active:false }, zone), null);
});

test('the Bottle Bet: middle day, growth spurt, and bottomless bowl', () => {
  const totals = [20, 22, 21, 24, 23, 25, 26]; // oldest → yesterday
  const bottles = totals.flatMap((oz, i) => [8, 12, 16, 20].map(h => ({ start:new Date(today - (totals.length - i) * DAY + h * H).toISOString(), amount:oz / 4, units:'oz' })));
  const picks = bottlePicks(bottles, zone, '2026-11-19');
  assert.equal(picks.hubert, 23); assert.equal(picks.mack, 26);
  assert.ok(picks.mia > 24 && picks.mia <= 28, `Mia follows the upward trend (${picks.mia})`);
  assert.deepEqual(bottlePicks(bottles.slice(0, 8), zone, '2026-11-19'), { hubert:null, mia:null, mack:null });
});

test('scores, leaders and winners for both challenges', () => {
  const sleeps = iso(history(20, d => ({ wake:6.5 + (d % 3) * 0.1 })));
  const mornings = scoreMornings(sleeps, zone, today + 9 * H);
  assert.ok(mornings.scored >= 10); assert.ok(['hubert', 'mia', 'mack'].includes(mornings.leader));
  assert.ok(mornings.results.every(row => row.winners.length >= 1 && Number.isFinite(row.errors.mack)));
  const bottles = []; for (let d = 25; d >= 1; d--) for (const h of [8, 12, 16, 20]) bottles.push({ start:new Date(today - d * DAY + h * H).toISOString(), amount:5 + (d % 2) * 0.5, units:'oz' });
  const bet = scoreBottles(bottles, zone, today + 9 * H);
  assert.ok(bet.scored >= 15); assert.equal(bet.summary.length, 3); assert.ok(bet.summary.every(m => m.mae != null));
});

test('Mack borrows SweetSpot in the nap challenge, with an excuse', () => {
  assert.deepEqual(MODELS.map(m => m.owner), ['Hubert', 'Mia', 'Mack']);
  assert.deepEqual(CHALLENGES.bottle.map(m => m.owner), ['Hubert', 'Mia', 'Mack'], 'every challenge lists the cats in the same order');
  assert.match(MACK_EXCUSE, /laundry basket/);
  assert.deepEqual(CHALLENGES.morning.map(m => m.owner), ['Hubert', 'Mia', 'Mack']);
});

test('Mia calls the wake-up from a nap, with a tight window', () => {
  // Nap 2 (12:30) usually lasts 90 minutes.
  const sleeps = iso([...history(8), { start:today - 5 * H, end:today + 6.5 * H }, { start:today + 9 * H, end:today + 10 * H }]);
  const timer = { active:true, start:new Date(today + 12.5 * H).toISOString() };
  const mia = miaForecast({ sleeps, timer, timezone:zone }, new Date(today + 12.75 * H));
  assert.equal(mia.kind, 'wake'); assert.equal(mia.napNumber, 2); assert.equal(mia.typicalMinutes, 90);
  assert.equal(Date.parse(mia.target), today + 14 * H);
  assert.ok(Date.parse(mia.end) - Date.parse(mia.target) <= 10 * M && Date.parse(mia.end) - Date.parse(mia.target) >= 5 * M);
  const night = miaForecast({ sleeps, timer:{ active:true, start:new Date(today + 20 * H).toISOString() }, timezone:zone }, new Date(today + 21 * H));
  assert.equal(night.available, false); assert.match(night.reason, /morning wake-up calls/);
});
