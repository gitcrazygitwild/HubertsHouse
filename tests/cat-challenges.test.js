import test from 'node:test';
import assert from 'node:assert/strict';
import { nightsFrom, currentBedtime, morningPicks, bottlePicks, scoreMornings, scoreBottles, pumpPicks, scorePumps, CHALLENGES, MACK_EXCUSE, napNightPicks, nextSleepKind, scoreNapNight } from '../cat-challenges.js';
import { dailyPumps } from '../baby-history.js';
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

test('pumps roll up per day with both sides, and single totals as "unsplit"', () => {
  const at = (d, h) => new Date(today - d * DAY + h * H).toISOString();
  const pumps = [{ start:at(1, 8), left:2, right:2.5, total:4.5, units:'oz' }, { start:at(1, 14), left:60, right:90, total:150, units:'ml' }, { start:at(1, 20), left:null, right:null, total:3, units:'oz' }, { start:at(0, 7), left:1.5, right:2, total:3.5, units:'oz' }];
  const rows = dailyPumps(pumps, zone, 2, today + 9 * H);
  assert.deepEqual(rows[0], { key:'2026-11-18', ounces:12.6, left:4, right:5.5, unsplit:3, count:3 }); // 60 ml ≈ 2 oz, 90 ml ≈ 3 oz
  assert.deepEqual([rows[1].ounces, rows[1].left, rows[1].right, rows[1].count], [3.5, 1.5, 2, 1]);
  assert.equal(dailyPumps(undefined, zone, 3, today).length, 3);
});

test('the Pump Pool: same time last week, supply & demand, and copycat', () => {
  // Weekdays pump ~20 oz, Sundays ~14; slight upward trend. The guess is for Thursday Nov 19.
  const totals = { '2026-11-05':19, '2026-11-06':19.5, '2026-11-07':18, '2026-11-08':14, '2026-11-09':20, '2026-11-10':20, '2026-11-11':20.5, '2026-11-12':21, '2026-11-13':21, '2026-11-14':19, '2026-11-15':15, '2026-11-16':21.5, '2026-11-17':22, '2026-11-18':22.5 };
  const pumps = Object.entries(totals).flatMap(([day, oz]) => [8, 13, 18, 22].map(h => ({ start:new Date(Date.parse(`${day}T00:00:00Z`) + h * H).toISOString(), left:oz / 8, right:oz / 8, total:oz / 4, units:'oz' })));
  const picks = pumpPicks(pumps, zone, '2026-11-19');
  assert.equal(picks.mack, 22.5, 'yesterday, exactly');
  // Hubert: the middle of the last 7 days (21) and last Thursday (21) agree → 21.
  assert.equal(picks.hubert, 21);
  // For Sunday, last Sunday (15) pulls the weekday-heavy middle down a third of the way.
  const sunday = { ...totals, '2026-11-19':23, '2026-11-20':23, '2026-11-21':22 }, sundayPumps = Object.entries(sunday).flatMap(([day, oz]) => [8, 20].map(h => ({ start:new Date(Date.parse(`${day}T00:00:00Z`) + h * H).toISOString(), left:oz / 4, right:oz / 4, total:oz / 2, units:'oz' })));
  assert.equal(pumpPicks(sundayPumps, zone, '2026-11-22').hubert, 19.5); // middle 22, a third of the way to 15 → 19.67 → nearest half ounce
  assert.ok(picks.mia >= 21.5 && picks.mia <= 24.5, `Mia follows the trend (${picks.mia})`);
  // A thirsty baby nudges Mia up, never by more than 1.5 oz.
  const bottles = [16, 17, 18].flatMap(d => [8, 12, 16, 20].map(h => ({ start:new Date(Date.parse(`2026-11-${d}T00:00:00Z`) + h * H).toISOString(), amount:8, units:'oz' })));
  const thirsty = pumpPicks(pumps, zone, '2026-11-19', { bottles });
  assert.ok(thirsty.mia > picks.mia && thirsty.mia - picks.mia <= 1.5, `${picks.mia} → ${thirsty.mia}`);
  assert.deepEqual(pumpPicks(pumps.slice(0, 8), zone, '2026-11-19'), { hubert:null, mia:null, mack:null }, 'needs three pumping days');
  const score = scorePumps(pumps, zone, today + 9 * H);
  assert.ok(score.scored >= 10); assert.equal(score.summary.length, 3); assert.ok(['hubert', 'mia', 'mack'].includes(score.leader));
  assert.deepEqual(CHALLENGES.pump.map(m => m.owner), ['Hubert', 'Mia', 'Mack']);
});

test('nap or night: each cat calls the next sleep from its own method, and the scoreboard counts right calls', () => {
  // Ten regular days: three naps, then the night at 20:00.
  const sleeps = iso(history(10)), now = today + 8 * H;
  assert.deepEqual(CHALLENGES.napnight.map(c => c.owner), ['Hubert', 'Mia', 'Mack']);
  // After the third nap (woke 16:45 yesterday), Hubert and Mia call night; Mack's 4-nap plan still says nap.
  const evening = today - DAY + 16.75 * H, picks = napNightPicks(sleeps, zone, evening, { plan:4 });
  assert.deepEqual([picks.hubert, picks.mia, picks.mack, picks.napsToday], ['night', 'night', 'nap', 3]);
  assert.equal(napNightPicks(sleeps, zone, evening, { plan:3 }).mack, 'night', 'a 3-nap plan: SweetSpot is bedtime now');
  assert.equal(napNightPicks(sleeps, zone, today - DAY + 10 * H, { plan:3 }).mack, 'nap');
  // What actually came next.
  assert.equal(nextSleepKind(sleeps, null, zone, evening, now).kind, 'night');
  assert.equal(nextSleepKind(sleeps, null, zone, today - DAY + 10 * H, now).kind, 'nap');
  // A nap still running isn't settled; once it passes four hours it's the night.
  const wake = today + 9 * H, running = { active:true, start:new Date(today + 9.5 * H).toISOString() };
  assert.equal(nextSleepKind(sleeps, running, zone, wake, today + 10 * H), null);
  assert.equal(nextSleepKind(sleeps, running, zone, wake, today + 14 * H).kind, 'night');
  const score = scoreNapNight(sleeps, zone, now, { plan:4 });
  const by = Object.fromEntries(score.summary.map(m => [m.key, m]));
  assert.ok(score.scored >= 10);
  assert.equal(by.mack.nightsRight, 0, 'the 4-nap plan never calls bedtime after three naps');
  assert.equal(by.mack.napsRight, by.mack.naps);
  assert.ok(by.hubert.hitRate > by.mack.hitRate && by.mia.hitRate > by.mack.hitRate);
  assert.notEqual(score.leader, 'mack');
  assert.equal(scoreNapNight(sleeps, zone, now, { plan:3 }).summary.find(m => m.key === 'mack').hitRate, 100);
});
