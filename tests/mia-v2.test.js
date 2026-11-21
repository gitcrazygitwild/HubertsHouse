import test from 'node:test';
import assert from 'node:assert/strict';
import { miaForecast, ageInDays, ageLabel, halfLifeFor, typicalWindow, bottleSleepLinks, correlation } from '../baby-model.js';
import { miaForecastV1 } from '../mia-v1.js';
import { replayGuesses, scorePredictions, MIA_V2_SINCE, miaVersionAt, sweetspotEntry } from '../prediction-log.js';
const { readBirthdate } = await import('../functions/huckleberry-provider.js');

const zone = 'UTC', DAY = 86400000, H = 3600000, M = 60000;
const today = Date.parse('2026-11-16T00:00:00Z');
const iso = list => list.map(s => ({ start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString() }));
// A day: night until 7:00, then naps after the given wake windows; optional bottle `feedBefore` minutes before each nap.
function day(offset, windows, naps, { feedBefore = null, oz = [], base = today } = {}) {
  const start = base - offset * DAY, sleeps = [{ start:start - 5 * H, end:start + 7 * H }], bottles = [];
  let cursor = start + 7 * H;
  windows.forEach((window, i) => {
    const napStart = cursor + window * M;
    if (feedBefore != null) bottles.push({ start:new Date(napStart - feedBefore * M).toISOString(), amount:oz[i] ?? 4, units:'oz' });
    sleeps.push({ start:napStart, end:napStart + naps[i] * M }); cursor = napStart + naps[i] * M;
  });
  return { sleeps, bottles };
}
function history(days, windows, naps, opts = {}) {
  const sleeps = [], bottles = [];
  for (let d = days; d >= 1; d--) { const one = day(d, typeof windows === 'function' ? windows(d) : windows, naps, opts); sleeps.push(...one.sleeps); bottles.push(...one.bottles); }
  return { sleeps, bottles };
}

test('age: days old, labels, how long history counts, and a typical window', () => {
  assert.equal(Math.round(ageInDays('2026-07-19', new Date('2026-11-16T12:00:00Z'))), 120);
  assert.equal(ageInDays('not a date'), null); assert.equal(ageInDays('2030-01-01', new Date('2026-11-16')), null);
  assert.equal(ageLabel(10), '10 days old'); assert.equal(ageLabel(35), '5 weeks old'); assert.equal(ageLabel(125), '4 months old');
  assert.deepEqual([halfLifeFor(null), halfLifeFor(60), halfLifeFor(120), halfLifeFor(250), halfLifeFor(500)], [3, 3, 4, 6, 8]);
  assert.equal(typicalWindow(null), null); assert.equal(Math.round(typicalWindow(120, 2)), 105); assert.ok(typicalWindow(120, 1) < typicalWindow(120, 3));
  assert.ok(Math.abs(correlation([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
});

test('Huckleberry birthdates are read from the likely field shapes', () => {
  assert.equal(readBirthdate({ birthdate:'2026-07-19' }), '2026-07-19');
  assert.equal(readBirthdate({ birthDate:{ seconds:Date.parse('2026-07-19T12:00:00Z') / 1000 } }), '2026-07-19');
  assert.equal(readBirthdate({ dob:Date.parse('2026-07-19T12:00:00Z') / 1000 }), '2026-07-19');
  assert.equal(readBirthdate({ childsName:'Frankie' }), null); assert.equal(readBirthdate({ birthdate:'2999-01-01' }), null);
});

test('with her age, Mia can start from two days of a new nap pattern', () => {
  const { sleeps } = history(2, [100, 120], [60, 60]);
  const now = new Date(today + 7 * H + 10 * M);
  const one = day(0, [], []); // woke at 7:00 today
  const all = iso([...sleeps, ...one.sleeps]);
  assert.equal(miaForecast({ sleeps:all, timezone:zone }, now).available, false);
  const aged = miaForecast({ sleeps:all, timezone:zone, birthdate:'2026-07-19' }, now);
  assert.equal(aged.available, true); assert.equal(aged.ageDays, 119); // 7:10 AM, before her noon-UTC birth time
});

test('a steady "bottle, then asleep" habit pulls the forecast toward her bottle', () => {
  // Windows vary a lot (80–140 min), but she always falls asleep 20 minutes after a bottle.
  const windows = d => [80 + (d * 37) % 60, 120, 140];
  const past = history(10, windows, [60, 60, 45], { feedBefore:20 });
  const nowBottle = today + 7 * H + 95 * M; // today's bottle at 8:35
  const sleeps = iso([...past.sleeps, ...day(0, [], []).sleeps]);
  const bottles = [...past.bottles, { start:new Date(nowBottle).toISOString(), amount:4, units:'oz' }];
  const atWake = miaForecast({ sleeps, bottles:past.bottles, timezone:zone }, new Date(today + 7 * H + 5 * M));
  const afterBottle = miaForecast({ sleeps, bottles, timezone:zone }, new Date(nowBottle + 2 * M));
  assert.equal(atWake.feedShare, 0);
  assert.ok(afterBottle.feedShare > 50, `feedShare ${afterBottle.feedShare}`);
  assert.ok(Math.abs(Date.parse(afterBottle.target) - (nowBottle + 20 * M)) < 6 * M, 'about 20 minutes after the bottle');
  assert.equal(afterBottle.feedTypical, 20);
  // A bottle long before her usual pre-nap bottle (a top-up right after waking) is ignored.
  const early = miaForecast({ sleeps, bottles:[...past.bottles, { start:new Date(today + 7 * H + 5 * M).toISOString(), amount:2, units:'oz' }], timezone:zone }, new Date(today + 7 * H + 10 * M));
  assert.equal(early.feedShare, 0);
});

test('bottles and sleep: a clear link is reported, and noise is called "no clear link"', () => {
  // Nap length grows with the bottle just before it (+10 min per oz); ounces vary by day.
  const sleeps = [], bottles = [];
  for (let d = 20; d >= 1; d--) {
    const oz = [3, 4, 5, 3.5, 4.5][d % 5], base = today - d * DAY;
    sleeps.push({ start:base - 5 * H, end:base + 7 * H });
    let cursor = base + 7 * H;
    for (const w of [90, 120, 130]) { const s = cursor + w * M, len = 30 + oz * 10; bottles.push({ start:new Date(s - 15 * M).toISOString(), amount:oz, units:'oz' }); sleeps.push({ start:s, end:s + len * M }); cursor = s + len * M; }
  }
  const links = bottleSleepLinks({ sleeps:iso(sleeps), bottles, timezone:zone }, new Date(today + 6 * H));
  assert.equal(links.napLength.verdict, 'clear'); assert.equal(links.napLength.slope, 10);
  assert.equal(links.feedToSleep.typical, 15); assert.ok(links.feedToSleep.share >= 60);
  const flat = bottleSleepLinks({ sleeps:iso(history(20, [90, 120, 130], [60, 60, 60]).sleeps), bottles:[], timezone:zone }, new Date(today + 6 * H));
  assert.equal(flat.napLength.verdict, 'not-enough'); assert.equal(flat.feedToSleep.of > 0, true);
});

test('the scoreboard keeps Mia’s version-1 guesses for naps before the switch', () => {
  // A history straddling the cutover, with bottles that version 2 can use.
  const base = Date.parse('2026-11-20T00:00:00Z'); // midnight the day after the switch
  const sleeps = [], bottles = [];
  for (let d = 12; d >= 0; d--) { const one = day(d, [90 + (d * 13) % 40, 120, 140], [60, 60, 45], { feedBefore:15, base }); sleeps.push(...one.sleeps); bottles.push(...one.bottles); }
  const wakes = iso(sleeps).map(s => s.end);
  const list = iso(sleeps), guessable = w => replayGuesses(list, w, zone, { bottles, birthdate:'2026-07-01' }).mia;
  const before = wakes.filter(w => Date.parse(w) < MIA_V2_SINCE && guessable(w)).at(-1), after = wakes.filter(w => Date.parse(w) >= MIA_V2_SINCE && guessable(w))[0];
  assert.equal(miaVersionAt(before), 1); assert.equal(miaVersionAt(after), 2);
  const old = replayGuesses(list, before, zone, { bottles, birthdate:'2026-07-01' });
  const v1 = miaForecastV1({ sleeps:list.filter(s => Date.parse(s.end) <= Date.parse(before)), timezone:zone }, new Date(Date.parse(before) + M));
  assert.equal(old.mia.target, v1.target, 'replayed with the frozen version 1');
  const fresh = replayGuesses(list, after, zone, { bottles, birthdate:'2026-07-01' });
  const v2 = miaForecast({ sleeps:list.filter(s => Date.parse(s.end) <= Date.parse(after)), bottles:bottles.filter(b => Date.parse(b.start) <= Date.parse(after) + M), birthdate:'2026-07-01', timezone:zone }, new Date(Date.parse(after) + M));
  assert.equal(fresh.mia.target, v2.target, 'replayed with version 2');
  // Scored rows say which version made the guess.
  const entries = [before, after].map(w => sweetspotEntry({ lastWake:w, childId:'c', sweetspot:{ available:true, time:new Date(Date.parse(w) + 100 * M).toISOString() }, timezone:zone, sleeps:list, now:new Date(Date.parse(w) + 5 * M) })).filter(Boolean);
  const score = scorePredictions(entries, list, null, zone, { bottles, birthdate:'2026-07-01' });
  assert.ok(score.results.length >= 1);
  for (const row of score.results) assert.equal(row.miaVersion, miaVersionAt(row.lastWake));
});

test('a late catnap that ended in the evening means bedtime is next, not "overnight"', async () => {
  const { purrfectWindow, isEveningCatnap } = await import('../baby-model.js');
  // Usual day: naps at 9, 12:30, 16:00; bedtime 19:00. Today she dozed off at 19:15 and woke at 20:15.
  const days = [];
  for (let d = 10; d >= 1; d--) { const b = today - d * DAY; days.push({ start:b - 5 * H, end:b + 7 * H }, { start:b + 9 * H, end:b + 10 * H }, { start:b + 12.5 * H, end:b + 14 * H }, { start:b + 16 * H, end:b + 16.75 * H }, { start:b + 19 * H, end:b + 30 * H }); }
  const tonight = [{ start:today - 5 * H, end:today + 7 * H }, { start:today + 9 * H, end:today + 10 * H }, { start:today + 12.5 * H, end:today + 14 * H }, { start:today + 16 * H, end:today + 16.75 * H }, { start:today + 19.25 * H, end:today + 20.25 * H }];
  const sleeps = iso([...days.filter(s => s.end <= today + 7 * H), ...tonight]);
  const now = new Date(today + 20.5 * H);
  assert.equal(isEveningCatnap({ start:today + 19.25 * H, end:today + 20.25 * H }, zone), true);
  const mia = miaForecast({ sleeps, timezone:zone }, now), hubert = purrfectWindow({ sleeps, timezone:zone }, now);
  assert.equal(mia.available, true, mia.reason); assert.equal(mia.kind, 'bedtime');
  assert.equal(hubert.available, true, hubert.reason); assert.equal(hubert.kind, 'bedtime');
  // A real night still counts as night: after 7 hours of sleep, waking at 2 AM is a night waking.
  assert.equal(isEveningCatnap({ start:today + 19 * H, end:today + 26 * H }, zone), false);
});
