// The cats' other two Frankie challenges (the nap challenge lives in prediction-log.js).
// - Morning wake-up: at bedtime, each cat calls when Frankie will wake up for the day.
// - The Bottle Bet: at midnight, each cat guesses how many ounces she'll drink that day.
// - Nap or night: each time she wakes, each cat calls whether her next sleep is a nap or the night.
// - The Pump Pool: at midnight, each cat guesses how many ounces Karena will pump that day.
// Every method is deterministic and uses only what was logged before the call, so past
// nights and days are replayed honestly. If a method ever changes, freeze the old one
// (as mia-v1.js does for naps) so past scores keep the guesses actually made.
// No imports beyond the app's own pure modules, so the newsletter can share this file.
import { nightLine, sleepKind, localDay, clockAt, dailyBottles, dailyPumps, dayStart } from './baby-history.js';
import { ageInDays, halfLifeFor, purrfectWindow, miaForecast } from './baby-model.js';

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const toStamp = value => typeof value === 'number' ? value : Date.parse(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const median = values => { const s = [...values].sort((a, b) => a - b), m = (s.length - 1) / 2; return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2; };
const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b), p = (s.length - 1) * q, lo = Math.floor(p); return s[lo] + (s[Math.ceil(p)] - s[lo]) * (p - lo); };
const wmean = (values, weights) => values.reduce((sum, v, i) => sum + v * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
const wsd = (values, weights) => { const m = wmean(values, weights); return Math.sqrt(wmean(values.map(v => (v - m) ** 2), weights)); };
const evening = clock => clock < 6 * 60 ? clock + 1440 : clock; // 1 AM bedtime → 25:00

export const CHALLENGES = {
  morning:[
    { key:'hubert', owner:'Hubert', name:'Bedtime Twins', how:'Finds recent nights that started about when tonight did and takes the middle of their wake-up times.' },
    { key:'mia', owner:'Mia', name:'Sunrise Forecast', how:'Blends how long Frankie’s nights usually last with her usual wake-up time, trusting whichever has been steadier, with recent nights counting most.' },
    { key:'mack', owner:'Mack', name:'Groundhog Day', how:'Assumes this morning will go exactly like yesterday’s, nudged half as much as tonight’s bedtime moved (a full nudge was too much effort).' }
  ],
  bottle:[
    { key:'hubert', owner:'Hubert', name:'The Middle Day', how:'Takes the middle of her last seven days of ounces.' },
    { key:'mia', owner:'Mia', name:'Growth Spurt', how:'Weights the last few days most and adds the trend, because babies keep getting hungrier.' },
    { key:'mack', owner:'Mack', name:'Bottomless Bowl', how:'Picks her biggest day of the last three, because Mack assumes everyone is as hungry as he is.' }
  ],
  napnight:[
    { key:'hubert', owner:'Hubert', name:'Evening Instinct', how:'Looks at wake-ups around this time of day: if most were followed by the night’s sleep, he calls night.' },
    { key:'mia', owner:'Mia', name:'Nap Counter', how:'Calls night once Frankie has had her usual number of naps, or when another nap would run into her usual bedtime.' },
    { key:'mack', owner:'Mack', name:'The Nap Plan', how:'Copies Huckleberry’s SweetSpot plan: once she’s had the plan’s naps for the day, the next sleep is the night, and he sticks with it.' }
  ],
  pump:[
    { key:'hubert', owner:'Hubert', name:'Same Time Last Week', how:'Takes the middle of Karena’s last seven pumping days, then leans toward the same weekday last week, because routines repeat.' },
    { key:'mia', owner:'Mia', name:'Supply & Demand', how:'Follows Karena’s recent trend, recent days counting most, and nudges it toward how much Frankie has been drinking.' },
    { key:'mack', owner:'Mack', name:'Copycat', how:'Says exactly what she pumped yesterday. Mack calls this “consistency”.' }
  ]
};
export const MACK_EXCUSE = 'Mack was asleep in the laundry basket while the others built their models, so he copies Huckleberry’s SweetSpot and takes full credit.';

// ---------- Nights: bedtime → the morning wake-up that starts her day ----------
export function nightsFrom(sleeps, timezone, now = Date.now(), days = 35) {
  const list = sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) })).filter(s => Number.isFinite(s.start) && s.end > s.start && s.end <= +now && s.start >= +now - days * DAY).sort((a, b) => a.start - b.start);
  const line = nightLine(list, timezone, now, Math.min(days, 21)), byKey = new Map();
  for (const sleep of list) {
    if (sleepKind(sleep, timezone, line) !== 'night') continue;
    const key = localDay(sleep.start - 6 * HOUR, timezone); // a 3 AM stretch belongs to the night before
    const night = byKey.get(key) || { key, bedtime:Infinity, morning:null };
    night.bedtime = Math.min(night.bedtime, sleep.start);
    const endClock = clockAt(sleep.end, timezone);
    if (endClock >= 4 * 60 && endClock < 12 * 60) night.morning = Math.max(night.morning ?? 0, sleep.end);
    byKey.set(key, night);
  }
  return [...byKey.values()].filter(n => { const b = evening(clockAt(n.bedtime, timezone)); return b >= 17 * 60 && b <= 27 * 60; })
    .map(n => ({ ...n, bedClock:evening(clockAt(n.bedtime, timezone)), wakeClock:n.morning ? clockAt(n.morning, timezone) : null })).sort((a, b) => a.bedtime - b.bedtime);
}
// Tonight's bedtime: the first night stretch of the night now in progress.
export function currentBedtime(sleeps, timer, timezone, now = Date.now()) {
  if (!timer?.active || timer.paused) return null;
  const began = toStamp(timer.start); if (!Number.isFinite(began)) return null;
  const line = nightLine(sleeps, timezone, now);
  if (sleepKind({ start:began, end:began + MINUTE }, timezone, line) !== 'night') return null;
  const key = localDay(began - 6 * HOUR, timezone);
  const earlier = nightsFrom(sleeps, timezone, now, 2).find(n => n.key === key);
  return Math.min(began, earlier?.bedtime ?? Infinity);
}
const at = (bedtime, clock, timezone) => bedtime + (((clock - clockAt(bedtime, timezone)) % 1440 + 1440) % 1440) * MINUTE;
const pick = (target, start, end) => ({ target:new Date(target).toISOString(), start:new Date(start).toISOString(), end:new Date(end).toISOString() });
// Each cat's call, made at `bedtime` from nights that had ended before it.
export function morningPicks(sleeps, timezone, bedtime, { birthdate = null } = {}) {
  const known = sleeps.filter(s => toStamp(s.end) <= bedtime);
  const past = nightsFrom(known, timezone, bedtime, 35).filter(n => n.morning && n.morning < bedtime).slice(-21);
  const tonight = evening(clockAt(bedtime, timezone)), out = { hubert:null, mia:null, mack:null };
  if (!past.length) return out;
  // Mack: yesterday again, half-adjusted for bedtime. ±12 minutes, because precision is effort.
  const last = past.at(-1), mackClock = last.wakeClock + (tonight - last.bedClock) / 2, mack = at(bedtime, ((Math.round(mackClock) % 1440) + 1440) % 1440, timezone);
  out.mack = pick(mack, mack - 12 * MINUTE, mack + 12 * MINUTE);
  if (past.length < 3) return out;
  // Hubert: nights that began like tonight; the middle of their wake-ups.
  let twins = past.filter(n => Math.abs(n.bedClock - tonight) <= 45);
  if (twins.length < 3) twins = past.filter(n => Math.abs(n.bedClock - tonight) <= 90);
  if (twins.length < 3) twins = past;
  twins = twins.slice(-14);
  const clocks = twins.map(n => n.wakeClock), mid = median(clocks), half = clamp((quantile(clocks, .75) - quantile(clocks, .25)) / 4, 5, 12), lo = mid - half, hi = mid + half;
  const hubert = at(bedtime, Math.round(mid), timezone);
  out.hubert = pick(hubert, hubert - (mid - lo) * MINUTE, hubert + (hi - mid) * MINUTE);
  // Mia: usual night length vs usual wake-up clock, blended by steadiness, recent nights first.
  const halfLife = halfLifeFor(ageInDays(birthdate, new Date(bedtime))), weights = past.map(n => 0.5 ** ((bedtime - n.bedtime) / DAY / halfLife));
  const lengths = past.map(n => (n.morning - n.bedtime) / MINUTE), wakes = past.map(n => n.wakeClock);
  const byLength = bedtime + wmean(lengths, weights) * MINUTE, byClock = at(bedtime, Math.round(wmean(wakes, weights)), timezone);
  const wL = 1 / Math.max(wsd(lengths, weights), 5) ** 2, wC = 1 / Math.max(wsd(wakes, weights), 5) ** 2;
  const mia = (byLength * wL + byClock * wC) / (wL + wC), spread = clamp(0.4 / Math.sqrt(wL + wC), 5, 10) * MINUTE;
  out.mia = { ...pick(mia, mia - spread, mia + spread), clockShare:Math.round(100 * wC / (wL + wC)) };
  return out;
}

// ---------- The Bottle Bet ----------
// Daily ounces before `dayKey`, oldest first, skipping days with no bottles logged.
function ounceHistory(bottles, timezone, dayKey, days = 14) {
  return dailyBottles(bottles, timezone, days, dayStart(dayKey, timezone) - 1).filter(row => row.count > 0);
}
export function bottlePicks(bottles, timezone, dayKey, { birthdate = null } = {}) {
  const rows = ounceHistory(bottles, timezone, dayKey), out = { hubert:null, mia:null, mack:null };
  if (rows.length < 3) return out;
  const oz = rows.map(r => r.ounces), round = value => Math.round(value * 2) / 2;
  out.hubert = round(median(oz.slice(-7)));
  out.mack = round(Math.max(...oz.slice(-3)));
  const halfLife = halfLifeFor(ageInDays(birthdate, new Date(dayStart(dayKey, timezone)))), ago = rows.map((_, i) => rows.length - i);
  const weights = ago.map(a => 0.5 ** (a / halfLife)), base = wmean(oz, weights);
  const mx = wmean(ago, weights), slope = -ago.reduce((s, a, i) => s + weights[i] * (a - mx) * (oz[i] - base), 0) / Math.max(1e-9, ago.reduce((s, a, i) => s + weights[i] * (a - mx) ** 2, 0));
  out.mia = round(base + clamp(slope * mx, -2, 2));
  return out;
}

// ---------- The Pump Pool ----------
// Pumped ounces per day before `dayKey`, oldest first, skipping days with no pumps.
export function pumpPicks(pumps, timezone, dayKey, { bottles = [] } = {}) {
  const before = dayStart(dayKey, timezone) - 1, rows = dailyPumps(pumps, timezone, 14, before).filter(row => row.count > 0), out = { hubert:null, mia:null, mack:null };
  if (rows.length < 3) return out;
  const oz = rows.map(r => r.ounces), round = value => Math.max(0, Math.round(value * 2) / 2);
  out.mack = round(oz.at(-1));
  // Hubert: the 7-day middle, blended a third of the way toward the same weekday a week ago (if logged).
  const weekAgo = rows.find(r => r.key === localDay(dayStart(dayKey, timezone) - 7 * DAY + 12 * HOUR, timezone));
  const mid = median(oz.slice(-7));
  out.hubert = round(weekAgo ? mid + (weekAgo.ounces - mid) / 3 : mid);
  // Mia: recency-weighted level plus trend (±2 oz), then a small pull toward Frankie's recent intake.
  const ago = rows.map((_, i) => rows.length - i), weights = ago.map(a => 0.5 ** (a / 4)), base = wmean(oz, weights);
  const mx = wmean(ago, weights), slope = -ago.reduce((s, a, i) => s + weights[i] * (a - mx) * (oz[i] - base), 0) / Math.max(1e-9, ago.reduce((s, a, i) => s + weights[i] * (a - mx) ** 2, 0));
  let mia = base + clamp(slope * mx, -2, 2);
  const drank = dailyBottles(bottles, timezone, 3, before).filter(r => r.count >= 3).map(r => r.ounces);
  if (drank.length) mia += clamp((wmean(drank, drank.map(() => 1)) - mia) * 0.15, -1.5, 1.5);
  out.mia = round(mia);
  return out;
}

// ---------- Scoring (all challenges) ----------
function summarize(rows, models, hit) {
  const n = rows.length;
  const summary = models.map(model => {
    const errors = rows.map(row => row.errors[model.key]);
    return { ...model, n, mae:n ? Math.round(10 * errors.reduce((s, e) => s + Math.abs(e), 0) / n) / 10 : null, bias:n ? Math.round(10 * errors.reduce((s, e) => s + e, 0) / n) / 10 : null,
      hitRate:n ? Math.round(100 * errors.filter(e => Math.abs(e) <= hit).length / n) : null, wins:rows.filter(row => row.winners.length === 1 && row.winners[0] === model.key).length };
  });
  const leader = n >= 3 ? [...summary].sort((a, b) => a.mae - b.mae || b.hitRate - a.hitRate)[0].key : null;
  return { summary, leader, scored:n };
}
const winnersOf = errors => { const best = Math.min(...Object.values(errors).map(Math.abs)); return Object.keys(errors).filter(key => Math.abs(errors[key]) === best); };
let morningMemo = { key:null, value:null }, bottleMemo = { key:null, value:null }, pumpMemo = { key:null, value:null };
export function scoreMornings(sleeps, timezone, now = Date.now(), { birthdate = null, days = 30 } = {}) {
  const key = JSON.stringify([timezone, birthdate, days, sleeps.length, sleeps.at(-1)?.end, sleeps[0]?.start, Math.floor(+now / HOUR)]);
  if (morningMemo.key === key) return morningMemo.value;
  const rows = [];
  for (const night of nightsFrom(sleeps, timezone, now, days + 1).filter(n => n.morning && n.bedtime >= +now - days * DAY)) {
    const picks = morningPicks(sleeps, timezone, night.bedtime, { birthdate });
    if (!picks.hubert || !picks.mia || !picks.mack) continue;
    const errors = Object.fromEntries(Object.entries(picks).map(([cat, p]) => [cat, Math.round((night.morning - Date.parse(p.target)) / MINUTE)]));
    rows.push({ key:night.key, bedtime:new Date(night.bedtime).toISOString(), actual:new Date(night.morning).toISOString(), picks, errors, winners:winnersOf(errors) });
  }
  rows.reverse();
  const value = { results:rows, ...summarize(rows, CHALLENGES.morning, 15) }; morningMemo = { key, value }; return value;
}
export function scoreBottles(bottles, timezone, now = Date.now(), { birthdate = null, days = 30 } = {}) {
  const key = JSON.stringify([timezone, birthdate, days, bottles.length, bottles.at(-1)?.start, localDay(+now, timezone)]);
  if (bottleMemo.key === key) return bottleMemo.value;
  // Completed days only, with a believable number of bottles logged.
  const rows = [];
  for (const day of dailyBottles(bottles, timezone, days + 1, now).slice(0, -1).filter(row => row.count >= 3)) {
    const picks = bottlePicks(bottles, timezone, day.key, { birthdate });
    if (picks.hubert == null || picks.mia == null || picks.mack == null) continue;
    const errors = Object.fromEntries(Object.entries(picks).map(([cat, oz]) => [cat, Math.round((day.ounces - oz) * 10) / 10]));
    rows.push({ key:day.key, actual:day.ounces, picks, errors, winners:winnersOf(errors) });
  }
  rows.reverse();
  const value = { results:rows, ...summarize(rows, CHALLENGES.bottle, 2) }; bottleMemo = { key, value }; return value;
}
export function scorePumps(pumps = [], timezone, now = Date.now(), { bottles = [], days = 30 } = {}) {
  const key = JSON.stringify([timezone, days, pumps.length, pumps.at(-1)?.start, bottles.length, bottles.at(-1)?.start, localDay(+now, timezone)]);
  if (pumpMemo.key === key) return pumpMemo.value;
  // Completed days that had at least one pump logged.
  const rows = [];
  for (const day of dailyPumps(pumps, timezone, days + 1, now).slice(0, -1).filter(row => row.count >= 1)) {
    const picks = pumpPicks(pumps, timezone, day.key, { bottles });
    if (picks.hubert == null || picks.mia == null || picks.mack == null) continue;
    const errors = Object.fromEntries(Object.entries(picks).map(([cat, oz]) => [cat, Math.round((day.ounces - oz) * 10) / 10]));
    rows.push({ key:day.key, actual:day.ounces, picks, errors, winners:winnersOf(errors) });
  }
  rows.reverse();
  const value = { results:rows, ...summarize(rows, CHALLENGES.pump, 2) }; pumpMemo = { key, value }; return value;
}

// ---------- Nap or night? ----------
// Each cat's call at a wake-up ('nap' | 'night' | null), from what was logged by then.
// Hubert and Mia use their nap models' own decision (a bedtime forecast means night).
// Mack follows Huckleberry's SweetSpot nap plan (`plan` naps a day): once that many naps
// are done, SweetSpot's next prediction is bedtime, and it stays that way.
export function napNightPicks(sleeps, timezone, wake, { bottles = [], birthdate = null, plan = 4 } = {}) {
  const known = sleeps.filter(s => toStamp(s.end) <= wake), at = new Date(wake + MINUTE);
  const call = model => model?.available && (model.kind === 'bedtime' || model.kind === 'nap') ? (model.kind === 'bedtime' ? 'night' : 'nap') : null;
  const line = nightLine(known, timezone, wake), day = localDay(wake, timezone);
  const napsToday = known.filter(s => localDay(toStamp(s.start), timezone) === day && sleepKind(s, timezone, line) === 'nap').length;
  const naps = Math.max(1, Math.round(Number(plan)) || 4);
  return {
    hubert:call(purrfectWindow({ sleeps:known, timezone }, at)),
    mia:call(miaForecast({ sleeps:known, bottles:bottles.filter(b => toStamp(b.start) <= +at), birthdate, timezone }, at)),
    mack:known.length ? (napsToday >= naps ? 'night' : 'nap') : null,
    napsToday
  };
}
// What her next sleep after `wake` turned out to be, or null if it isn't settled yet.
// A running nap isn't settled until it reaches four hours or the evening line has passed.
export function nextSleepKind(sleeps, timer, timezone, wake, now = Date.now(), line = nightLine(sleeps, timezone, now)) {
  const next = sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) })).filter(s => s.start > wake && s.start - wake <= 8 * HOUR).sort((a, b) => a.start - b.start)[0];
  const running = timer?.active && toStamp(timer.start) > wake && toStamp(timer.start) - wake <= 8 * HOUR ? toStamp(timer.start) : null;
  if (next && (!running || next.start <= running)) return { kind:sleepKind(next, timezone, line), start:next.start };
  if (!running) return null;
  const kind = sleepKind({ start:running, end:running + MINUTE }, timezone, line);
  if (kind === 'night' || +now - running >= 4 * HOUR) return { kind:'night', start:running };
  return null;
}
// Wake-ups worth a call: the end of a nap, or the end of the night (4 AM to noon).
function callWakes(sleeps, timezone, from, now, line) {
  return sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) })).filter(s => s.end >= from && s.end <= +now)
    .filter(s => sleepKind(s, timezone, line) === 'nap' || (clockAt(s.end, timezone) >= 4 * 60 && clockAt(s.end, timezone) < 12 * 60))
    .map(s => s.end).filter((end, i, all) => all.indexOf(end) === i).sort((a, b) => a - b);
}
let napNightMemo = { key:null, value:null };
export function scoreNapNight(sleeps, timezone, now = Date.now(), { bottles = [], birthdate = null, plan = 4, timer = null, days = 30 } = {}) {
  const key = JSON.stringify([timezone, birthdate, plan, days, sleeps.length, sleeps.at(-1)?.end, sleeps[0]?.start, bottles.length, bottles.at(-1)?.start, timer?.active ? timer.start : null, Math.floor(+now / (15 * MINUTE))]);
  if (napNightMemo.key === key) return napNightMemo.value;
  const line = nightLine(sleeps, timezone, now), rows = [];
  for (const wake of callWakes(sleeps, timezone, +now - days * DAY, now, line)) {
    const actual = nextSleepKind(sleeps, timer, timezone, wake, now, line);
    if (!actual) continue;
    const picks = napNightPicks(sleeps, timezone, wake, { bottles, birthdate, plan });
    if (!picks.hubert || !picks.mia || !picks.mack) continue;
    const right = Object.fromEntries(['hubert', 'mia', 'mack'].map(cat => [cat, picks[cat] === actual.kind]));
    rows.push({ wake:new Date(wake).toISOString(), actual:actual.kind, asleep:new Date(actual.start).toISOString(), picks:{ hubert:picks.hubert, mia:picks.mia, mack:picks.mack }, right });
  }
  rows.reverse();
  const n = rows.length, nights = rows.filter(r => r.actual === 'night'), naps = rows.filter(r => r.actual === 'nap');
  const summary = CHALLENGES.napnight.map(model => ({ ...model, n, hitRate:n ? Math.round(100 * rows.filter(r => r.right[model.key]).length / n) : null,
    nightsRight:nights.filter(r => r.right[model.key]).length, nights:nights.length, napsRight:naps.filter(r => r.right[model.key]).length, naps:naps.length }));
  const leader = n >= 3 ? [...summary].sort((a, b) => b.hitRate - a.hitRate || b.nightsRight - a.nightsRight)[0].key : null;
  const value = { results:rows, summary, leader, scored:n }; napNightMemo = { key, value }; return value;
}
