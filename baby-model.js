// Personal-history estimates. Hubert's Purrfect Window uses no age-based sleep
// prescription, Huckleberry prediction or population data. Mia's Catnap Forecast
// may use Frankie's age as a light starting point (see typicalWindow).
import { nightLine, sleepKind } from './baby-history.js';
const MINUTE = 60000, DAY = 86400000;
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
// Building an Intl formatter is slow; reuse one per time zone.
const formatters = new Map();
function localParts(value, timezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',minute:'2-digit',hourCycle:'h23' }));
  const parts = formatters.get(timezone).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type).value;
  return { day:`${get('year')}-${get('month')}-${get('day')}`, hour:Number(get('hour')), minute:Number(get('minute')) };
}
// When nothing has been logged for a while, say since when, so a missed log is obvious.
function staleReason(lastEnd, timezone, who) {
  if (!Number.isFinite(lastEnd)) return `Log a sleep and wake-up so ${who} can forecast.`;
  const { hour, minute } = localParts(lastEnd, timezone), clock = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  return `Nothing logged since she woke at ${clock}, over 12 hours ago. Log today’s naps and ${who} will forecast again.`;
}
// A short sleep that ended in the evening (she fell asleep after her usual cutoff, then
// woke up) is a late catnap for forecasting, not the night: the next thing is bedtime.
// Only the live forecast uses this; history keeps its usual nap/night labels.
// Up at 11 PM or later after her real bedtime is a night waking, so the cats stay quiet.
export const isEveningCatnap = (sleep, timezone) => { if (!sleep || sleep.end - sleep.start >= 3 * 3600000) return false; const hour = localParts(sleep.end, timezone).hour; return hour >= 16 && hour < 23; };
function quantile(values, q) {
  const sorted = [...values].sort((a,b) => a - b), position = (sorted.length - 1) * q;
  const low = Math.floor(position), weight = position - low;
  return sorted[low] * (1 - weight) + sorted[Math.ceil(position)] * weight;
}
// Hubert's Purrfect Window: "what usually happens after waking at this time of day?"
// Daytime: the median of recent wake windows that started around the same clock time,
// with the middle half as the window. Evening: when most wake-ups around this time
// were followed by the night's sleep, the same method forecasts bedtime. Overnight,
// while the sleep timer runs, it forecasts the next wake-up from her night stretches
// that started around the same time of night.
export function purrfectWindow({ sleeps = [], timer = null, timezone = 'America/New_York', complete = true } = {}, now = new Date()) {
  const empty = reason => ({ available:false, reason });
  if (!complete) return empty('Sleep history is incomplete. Refresh before estimating.');
  const merged = mergeSleeps(sleeps, now, 14), line = nightLine(merged, timezone, now, 14);
  const isNight = sleep => sleepKind(sleep, timezone, line) === 'night';
  const nightsOf = list => new Set(list.map(sample => sample.day)).size;
  const finish = (kind, anchor, selected, matchedTime, extra = {}) => {
    const values = selected.map(sample => sample.minutes), median = quantile(values, .5);
    // A tight window around the median: a quarter of her middle-half spread, 5–12 minutes
    // either side. (Scores use the center; the spread still decides "Varied pattern".)
    const spreadIQR = quantile(values, .75) - quantile(values, .25), half = Math.min(12, Math.max(5, spreadIQR / 4));
    const low = median - half, high = median + half;
    const start = anchor + Math.max(1, low) * MINUTE, end = anchor + high * MINUTE;
    return { available:true, kind, start:new Date(start).toISOString(), end:new Date(end).toISOString(), target:new Date(anchor + median * MINUTE).toISOString(),
      ...extra, samples:values.length, days:nightsOf(selected), matchedTime, typicalMinutes:Math.round(median),
      pattern:spreadIQR > 60 ? 'Varied pattern' : values.length < 7 ? 'Early pattern' : 'Personal pattern',
      phase:+now > end ? 'passed' : +now >= start ? 'within' : 'upcoming' };
  };
  if (timer?.active) {
    const began = stamp(timer.start);
    if (timer.paused || !Number.isFinite(began) || !isNight({start:began, end:began + MINUTE})) return empty('Sleeping now. A new window will appear after wake-up.');
    // Night stretches, keyed by the evening they belong to (a 1 AM stretch counts toward the night before).
    const at = clockOf(began, timezone);
    const stretches = merged.filter(isNight).map(sleep => ({minutes:(sleep.end - sleep.start) / MINUTE, clock:clockOf(sleep.start, timezone), day:localParts(sleep.start - 6 * 3600000, timezone).day, end:sleep.end}))
      .filter(sample => sample.minutes >= 20 && sample.minutes <= 16 * 60);
    let selected = stretches.filter(sample => Math.abs(sample.clock - at) <= 90), matchedTime = true;
    if (selected.length < 3 || nightsOf(selected) < 2) selected = stretches.filter(sample => Math.abs(sample.clock - at) <= 180);
    if (selected.length < 3 || nightsOf(selected) < 2) { selected = stretches; matchedTime = false; }
    selected = selected.sort((a, b) => b.end - a.end).slice(0, 20);
    if (selected.length < 3 || nightsOf(selected) < 2) return empty('Learning her nights: Hubert needs at least three logged night stretches across two nights.');
    return finish('wake', began, selected, matchedTime, {sleepStart:new Date(began).toISOString()});
  }
  const last = merged.at(-1), lastWake = last?.end;
  // They keep guessing for up to 12 hours after her last logged wake-up (backfill the naps later).
  if (!lastWake || +now - lastWake > 12 * 3600000) return empty(staleReason(lastWake, timezone, 'Hubert'));
  const current = localParts(+now, timezone), wake = localParts(lastWake, timezone), lastNight = isNight(last) && !isEveningCatnap(last, timezone);
  if ((current.hour >= 1 && current.hour < 5) || wake.hour < 5 || (lastNight && wake.hour >= 12)) return empty('Awake in the night. Hubert forecasts her next wake-up once she’s back asleep (start the sleep timer).');
  const samples = [];
  for (let index = 1; index < merged.length; index++) {
    const before = merged[index - 1], after = merged[index], start = before.end, end = after.start, minutes = (end - start) / MINUTE;
    const from = localParts(start, timezone), bed = isNight(after);
    // Only wake-ups that start a stretch of day: not night wakings. Thresholds are data
    // quality checks (missing logs), not recommended wake-window lengths.
    if (from.hour < 5 || (isNight(before) && from.hour >= 12)) continue;
    if (bed ? minutes < 10 || minutes > 420 : from.day !== localParts(end, timezone).day || minutes < 10 || minutes > 360) continue;
    samples.push({ minutes, hour:from.hour, clock:clockOf(start, timezone), day:from.day, end, bed });
  }
  // What usually followed a wake-up within 90 minutes of this time of day?
  const wakeClock = clockOf(lastWake, timezone), near = samples.filter(sample => Math.abs(sample.clock - wakeClock) <= 90);
  const catnap = isNight(last) && isEveningCatnap(last, timezone), beds = near.filter(sample => sample.bed).length; // only a sleep filed as night
  const bedtime = !lastNight && ((beds >= 2 && beds > near.length / 2) || (catnap && samples.filter(sample => sample.bed).length >= 3));
  const pool = samples.filter(sample => sample.bed === bedtime);
  let selected = pool.filter(sample => Math.abs(sample.hour - wake.hour) <= 3), matchedTime = true;
  if (selected.length < 3 || nightsOf(selected) < 2) { selected = pool; matchedTime = false; }
  selected = selected.sort((a, b) => b.end - a.end).slice(0, 20);
  if (selected.length < 3 || nightsOf(selected) < 2) return empty(bedtime ? 'Learning her evenings: Hubert needs bedtimes on at least two days.' : 'Learning your rhythm: log at least three daytime wake windows across two days.');
  return finish(bedtime ? 'bedtime' : 'nap', lastWake, selected, matchedTime, {lastWake:new Date(lastWake).toISOString()});
}

export function huckleberryPrediction(snapshot, now = new Date()) {
  const value = snapshot?.sweetspot;
  if (!value?.time || !Number.isFinite(Date.parse(value.time))) return { available:false, reason:'No SweetSpot prediction is available from Huckleberry.' };
  const time = Date.parse(value.time), checked = Date.parse(snapshot.checkedAt);
  const latestEnd = Math.max(0, ...(snapshot.sleeps || []).map(sleep => Date.parse(sleep.end)).filter(Number.isFinite));
  const expired = time <= +now || time <= latestEnd;
  const staleRead = !Number.isFinite(checked) || +now - checked > 10 * MINUTE;
  return { available:true, time:value.time, expired, staleRead, sleeping:!!snapshot.timer?.active,
    note:expired ? 'This prediction has passed. Open Huckleberry to refresh its calculation.' : staleRead ? 'Saved prediction; reconnect to check for updates.' : 'Last prediction shared by Huckleberry. Opening its app may be needed to recalculate.' };
}

// Mia's Catnap Forecast (version 2): a second, deliberately different estimate.
// Purrfect Window pools recent wake gaps near the same clock time. Mia instead
// (1) indexes wake windows by position in the day (wake→nap 1, nap 1→nap 2…),
// (2) weights recent days more heavily, trims logging outliers, and follows a growth
//     trend. With Frankie's birthdate, the trend follows her age (windows grow fast
//     in the early months and more slowly later), older babies' history counts for
//     longer, and a light age-typical starting point helps when there is little data,
// (3) shortens or lengthens the window based on the last nap, last night and the last
//     bottle, each only as much as Frankie's own history shows it matters, and
// (4) when a bottle has been given since she woke and she usually falls asleep a
//     steady time after a bottle, leans on that.
// Nap or night follows Frankie's own learned evening line (see nightLine), not a fixed hour.
// Version 1 is frozen in mia-v1.js for the scoreboard (see prediction-log.js).
const isNap = (sleep, timezone, line) => sleepKind(sleep, timezone, line) === 'nap';
function weighted(values, weights) { const total = weights.reduce((a,b) => a + b, 0); return values.reduce((sum,value,index) => sum + value * weights[index], 0) / total; }
function slope(xs, ys, weights) {
  const mx = weighted(xs,weights), my = weighted(ys,weights);
  let num = 0, den = 0; xs.forEach((x,i) => { num += weights[i] * (x - mx) * (ys[i] - my); den += weights[i] * (x - mx) ** 2; });
  return den > 0 ? num / den : 0;
}
// Weighted Pearson correlation.
export function correlation(xs, ys, weights = xs.map(() => 1)) {
  if (xs.length < 3) return 0;
  const mx = weighted(xs, weights), my = weighted(ys, weights);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += weights[i] * (x - mx) * (ys[i] - my); sxx += weights[i] * (x - mx) ** 2; syy += weights[i] * (ys[i] - my) ** 2; });
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
function mergeSleeps(sleeps, now, days) {
  const intervals = sleeps.map(sleep => ({start:stamp(sleep.start),end:stamp(sleep.end)}))
    .filter(sleep => Number.isFinite(sleep.start) && Number.isFinite(sleep.end) && sleep.end > sleep.start && sleep.end <= +now && sleep.start >= +now - days * DAY)
    .sort((a,b) => a.start - b.start);
  const merged = [];
  for (const interval of intervals) { const previous = merged.at(-1); if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end); else merged.push({...interval}); }
  return merged;
}
const nextDay = day => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const previousDay = day => new Date(Date.parse(`${day}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
// Minutes since local midnight; small hours count as late evening (25:00, not 1:00).
const clockOf = (value, timezone) => { const {hour, minute} = localParts(value, timezone); return (hour < 6 ? hour + 24 : hour) * 60 + minute; };

// ---------- Age ----------
// Frankie's age in days from her Huckleberry birthdate, or null.
export function ageInDays(birthdate, now = new Date()) {
  const born = typeof birthdate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthdate) ? Date.parse(`${birthdate}T12:00:00Z`) : stamp(birthdate);
  if (!Number.isFinite(born)) return null;
  const days = (+now - born) / DAY;
  return days >= 0 && days <= 1500 ? days : null;
}
export const ageLabel = days => days == null ? '' : days < 14 ? `${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? '' : 's'} old` : days < 61 ? `${Math.round(days / 7)} weeks old` : `${Math.floor(days / 30.44)} month${Math.floor(days / 30.44) === 1 ? '' : 's'} old`;
// How long history stays relevant: babies change fastest in the first months.
export const halfLifeFor = days => days == null ? 3 : days < 90 ? 3 : days < 180 ? 4 : days < 365 ? 6 : 8;
// A light, age-typical starting point for a wake window (minutes), from common
// pediatric ranges. Used only to start a brand-new nap pattern (two logged windows),
// at the weight of half a day of her data; from three windows on, her history alone
// decides (in testing, any more pull toward "average" made forecasts worse).
const AGE_WINDOWS = [[0,45],[30,60],[60,75],[90,90],[120,105],[150,120],[180,135],[240,165],[300,180],[365,210],[450,240],[540,300],[720,330]];
export function typicalWindow(days, napIndex = 2) {
  if (days == null) return null;
  let i = AGE_WINDOWS.findIndex(([d]) => d > days); if (i === -1) i = AGE_WINDOWS.length; if (i === 0) i = 1;
  const [[d0, m0], [d1, m1]] = i >= AGE_WINDOWS.length ? [AGE_WINDOWS.at(-2), AGE_WINDOWS.at(-1)] : [AGE_WINDOWS[i - 1], AGE_WINDOWS[i]];
  const base = days >= d1 ? m1 : m0 + (m1 - m0) * (days - d0) / (d1 - d0);
  return base * ([0.85, 1, 1.1, 1.15][Math.min(3, Math.max(0, napIndex - 1))]);
}

// ---------- Bottles ----------
const bottleList = (bottles, now) => (bottles || []).map(bottle => ({ t:stamp(bottle.start), oz:toOz(bottle) })).filter(bottle => Number.isFinite(bottle.t) && bottle.t <= +now).sort((a, b) => a.t - b.t);
const toOz = bottle => { const amount = Number(bottle.amount); if (!Number.isFinite(amount) || amount <= 0) return null; return bottle.units === 'ml' ? amount / 29.57 : amount; };
const lastBefore = (list, t) => { let found = null; for (const bottle of list) { if (bottle.t > t) break; found = bottle; } return found; };
const between = (list, from, to) => list.filter(bottle => bottle.t > from && bottle.t <= to);

// Wake windows labeled by their position in the day, with what came before each.
export function indexedWakeWindows(sleeps, timezone, now = new Date(), days = 21, bottles = []) {
  const merged = mergeSleeps(sleeps, now, days), byDay = new Map(), line = nightLine(merged, timezone, now, days), feeds = bottleList(bottles, now);
  const entryFor = day => { if (!byDay.has(day)) byDay.set(day, {wake:null,naps:[],bed:null,night:0}); return byDay.get(day); };
  for (const sleep of merged) {
    if (isNap(sleep, timezone, line)) { entryFor(localParts(sleep.start, timezone).day).naps.push(sleep); continue; }
    const start = localParts(sleep.start, timezone), end = localParts(sleep.end, timezone);
    // A night belongs to the morning it ends: evening segments count toward the next day's night.
    // Bedtime can be after midnight; it still belongs to the evening before.
    if (start.hour >= 16 || start.hour < 5) { const evening = entryFor(start.hour < 5 ? previousDay(start.day) : start.day); if (evening.bed == null) evening.bed = sleep.start; }
    const morning = start.hour >= 12 ? nextDay(start.day) : start.day;
    entryFor(morning).night += (sleep.end - sleep.start) / MINUTE;
    if (end.hour < 12 && end.day === morning) entryFor(morning).wake = sleep.end; // the night ended this morning
  }
  const today = localParts(+now, timezone).day, samples = [], bedtimes = [];
  const context = (from, to) => {
    const before = lastBefore(feeds, from), during = between(feeds, from, to), last = during.at(-1);
    return { lastOz:before && from - before.t <= 4 * 3600000 ? before.oz : null, feedGap:last ? (to - last.t) / MINUTE : null };
  };
  for (const [day, {wake, naps, bed, night}] of byDay) {
    const daysAgo = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / DAY);
    naps.forEach((nap, index) => {
      const from = index === 0 ? wake : naps[index - 1].end;
      if (!from || from >= nap.start) return;
      const minutes = (nap.start - from) / MINUTE;
      if (minutes < 20 || minutes > 360) return; // logging gaps, not real windows
      samples.push({index:index + 1, minutes, from, to:nap.start, napLength:(nap.end - nap.start) / MINUTE, previousNap:index === 0 ? null : (naps[index - 1].end - naps[index - 1].start) / MINUTE,
        lastNight:index === 0 && wake && night >= 240 ? night : null, wakeClock:index === 0 ? clockOf(from, timezone) : null, daysAgo, day, ...context(from, nap.start)});
    });
    // Bedtime: the last nap's end → the night's first sleep.
    const lastNap = naps.at(-1);
    if (bed != null && lastNap && lastNap.end < bed) {
      const minutes = (bed - lastNap.end) / MINUTE;
      if (minutes >= 30 && minutes <= 420) bedtimes.push({minutes, from:lastNap.end, to:bed, naps:naps.length, previousNap:(lastNap.end - lastNap.start) / MINUTE, clock:clockOf(bed, timezone), daysAgo, day, ...context(lastNap.end, bed)});
    }
  }
  return {samples, bedtimes, byDay, today, line};
}
const weightsFor = (pool, halfLife) => pool.map(sample => 0.5 ** (sample.daysAgo / halfLife));
// One learned adjustment: β is the slope of window vs. the factor in Frankie's history
// (with enough samples), scaled by how far today's value is from her usual. With
// `gate`, it only applies once her history shows a real link (|r| ≥ gate, n ≥ 8).
function learnedEffect(pool, field, value, {fallback, low, high, cap, halfLife = 3, gate = 0}) {
  const known = pool.filter(sample => sample[field] != null);
  if (value == null || known.length < 3) return {effect:0, typical:null, r:null};
  const weights = weightsFor(known, halfLife), xs = known.map(s => s[field]), ys = known.map(s => s.minutes);
  const typical = weighted(xs, weights), r = known.length >= 6 ? correlation(xs, ys, weights) : null;
  if (gate && (known.length < 8 || r == null || Math.abs(r) < gate)) return {effect:0, typical, r};
  const beta = known.length >= 6 ? clamp(slope(xs, ys, weights), low, high) : fallback;
  return {effect:clamp(beta * (value - typical), -cap, cap), typical, r};
}
// Drop logging outliers (a forgotten nap makes a 5-hour "window"): beyond 3 robust SDs.
function trimmed(pool) {
  if (pool.length < 6) return pool;
  const values = pool.map(s => s.minutes), median = quantile(values, .5), mad = quantile(values.map(v => Math.abs(v - median)), .5) * 1.4826;
  if (!(mad > 0)) return pool;
  const kept = pool.filter(s => Math.abs(s.minutes - median) <= 3 * Math.max(mad, 8));
  return kept.length >= 3 ? kept : pool;
}
// Recency-weighted average (with the light age prior), growth trend and spread.
function windowStats(pool, { age = null, halfLife = 3, prior = null } = {}) {
  const weights = weightsFor(pool, halfLife), minutes = pool.map(sample => sample.minutes);
  const own = weighted(minutes, weights), total = weights.reduce((a, b) => a + b, 0);
  // The age prior only helps while a nap pattern is new; with real history it just pulls toward average.
  const priorWeight = prior == null || pool.length >= 3 ? 0 : 0.5;
  const base = (own * total + (prior ?? 0) * priorWeight) / (total + priorWeight);
  // Growth trend, capped so one odd day cannot run away with the forecast. With her age,
  // windows grow with log(age): fast early on, gently later.
  const spanDays = Math.max(...pool.map(s => s.daysAgo)) - Math.min(...pool.map(s => s.daysAgo));
  let trend = 0;
  if (pool.length >= 5 && spanDays >= 4) {
    if (age != null && age > 21) {
      const logs = pool.map(s => Math.log(Math.max(14, age - s.daysAgo)));
      const perLog = clamp(slope(logs, minutes, weights), 0, 400);
      trend = clamp(perLog * (Math.log(age) - weighted(logs, weights)), -20, 20);
    } else {
      const perDay = clamp(slope(pool.map(s => -s.daysAgo), minutes, weights), -3, 3);
      trend = clamp(perDay * weighted(pool.map(s => s.daysAgo), weights), -20, 20);
    }
  }
  const sd = Math.sqrt(weighted(minutes.map(value => (value - own) ** 2), weights));
  return {weights, base, own, trend, sd};
}
// Falling asleep after a bottle: how steady is "bottle → asleep" for her, and when
// would that put this nap? Used only if the gap is steadier than the wake window.
// Only a real habit counts: most windows end within an hour of a bottle, the gap is
// much steadier than the wake window itself, and today's bottle is recent enough.
function feedTiming(pool, halfLife, lastWake, lastFeed, now, windowSD) {
  const fed = pool.filter(s => s.feedGap != null && s.feedGap <= 60);
  if (!lastFeed || lastFeed.t <= lastWake || +now - lastFeed.t > 60 * MINUTE || fed.length < 6 || new Set(fed.map(s => s.day)).size < 3 || fed.length < pool.length * 0.6) return null;
  const weights = weightsFor(fed, halfLife), gaps = fed.map(s => s.feedGap), typical = weighted(gaps, weights);
  const sd = Math.sqrt(weighted(gaps.map(g => (g - typical) ** 2), weights));
  if (!(sd < windowSD * 0.6)) return null;
  // Only the bottle that usually comes last before sleep: one given much earlier in
  // the window than her pre-sleep bottle usually is (a mid-window top-up) doesn't count.
  const leads = fed.map(s => s.minutes - s.feedGap), lead = weighted(leads, weights), leadSD = Math.sqrt(weighted(leads.map(l => (l - lead) ** 2), weights));
  if ((lastFeed.t - lastWake) / MINUTE < lead - Math.max(30, 1.5 * leadSD)) return null;
  return { minutes:(lastFeed.t - lastWake) / MINUTE + typical, typical, sd, n:fed.length, at:lastFeed.t };
}
export function miaForecast({ sleeps = [], bottles = [], birthdate = null, timer = null, timezone = 'America/New_York', complete = true } = {}, now = new Date()) {
  const empty = reason => ({ available:false, reason });
  if (!complete) return empty('Sleep history is incomplete. Refresh before forecasting.');
  const age = ageInDays(birthdate, now), halfLife = halfLifeFor(age), lookback = age != null && age >= 180 ? 28 : 21;
  if (timer?.active) return napWake();
  const merged = mergeSleeps(sleeps, now, lookback), last = merged.at(-1);
  if (!last || +now - last.end > 12 * 3600000) return empty(staleReason(last?.end, timezone, 'Mia'));
  const current = localParts(+now, timezone);
  if (current.hour >= 1 && current.hour < 5) return empty('Overnight is outside Mia’s forecast.');
  const {samples, bedtimes, byDay, today, line} = indexedWakeWindows(sleeps, timezone, now, lookback, bottles);
  const todays = byDay.get(today) || {naps:[]}, lastWasNap = isNap(last, timezone, line) || isEveningCatnap(last, timezone), lastEnd = localParts(last.end, timezone).hour;
  // After night sleep, only a morning wake-up (4 AM–noon) starts a new day; anything else is a night waking.
  if (!lastWasNap && (lastEnd < 4 || lastEnd >= 12)) return empty('Overnight is outside Mia’s forecast. A sleep that starts after Frankie’s usual evening line counts as night sleep.');
  const napsToday = todays.naps.filter(nap => nap.end <= last.end).length;
  const napNumber = lastWasNap ? napsToday + 1 : 1;
  const previousNap = lastWasNap ? (last.end - last.start) / MINUTE : null;
  const lastNight = !lastWasNap && todays.night >= 240 ? todays.night : null;
  const feeds = bottleList(bottles, now), before = lastBefore(feeds, last.end), lastFeed = between(feeds, last.end, +now).at(-1) || null;
  const lastOz = before && last.end - before.t <= 4 * 3600000 ? before.oz : null;
  const days = pool => new Set(pool.map(sample => sample.day)).size;
  let pool = samples.filter(sample => sample.index === napNumber), matched = 'exact';
  const exactDays = days(pool);
  if (exactDays < 3) { pool = samples.filter(sample => Math.abs(sample.index - napNumber) <= 1); matched = 'nearby'; }
  pool = trimmed(pool);
  // With her age as a starting point, two days of history are enough to begin.
  const napReady = (pool.length >= 3 && days(pool) >= 3) || (age != null && pool.length >= 2 && days(pool) >= 2);
  let nap = null;
  if (napReady) {
    const stats = windowStats(pool, { age, halfLife, prior:typicalWindow(age, napNumber) });
    // Nap 2+: a short or long previous nap. Nap 1: a short or long night, and an early or late wake-up.
    const napAdjust = learnedEffect(pool, 'previousNap', previousNap, {fallback:0.25, low:0, high:0.5, cap:25, halfLife});
    const nightAdjust = learnedEffect(pool, 'lastNight', lastNight, {fallback:0.05, low:0, high:0.15, cap:20, halfLife});
    const wakeAdjust = napNumber === 1 ? learnedEffect(pool, 'wakeClock', clockOf(last.end, timezone), {fallback:0, low:-0.4, high:0.4, cap:20, halfLife, gate:0.3}) : {effect:0, typical:null, r:null};
    const bottleAdjust = learnedEffect(pool, 'lastOz', lastOz, {fallback:0, low:-15, high:15, cap:15, halfLife, gate:0.3});
    nap = {...stats, napAdjust, nightAdjust, wakeAdjust, bottleAdjust, target:stats.base + stats.trend + napAdjust.effect + nightAdjust.effect + wakeAdjust.effect + bottleAdjust.effect};
  }
  // Bedtime comes next once Frankie has had her usual number of naps (unless her history
  // has days with another nap and it still fits), or when another nap would run into
  // her usual bedtime.
  let bed = null;
  const beds = trimmed(bedtimes);
  if (lastWasNap && beds.length >= 3 && days(beds) >= 3) {
    const weights = weightsFor(beds, halfLife);
    const usualNaps = weighted(beds.map(sample => sample.naps), weights), usualClock = weighted(beds.map(sample => sample.clock), weights);
    const napClock = nap ? clockOf(last.end + nap.target * MINUTE, timezone) : Infinity;
    if (napNumber <= Math.round(usualNaps)) { if (nap && napClock >= usualClock - 45) bed = {usualNaps, usualClock}; }
    else if (!(exactDays >= 3 && napClock < usualClock - 60)) bed = {usualNaps, usualClock};
  }
  const feedNote = feed => feed ? {feedTypical:Math.round(feed.typical), lastFeed:new Date(feed.at).toISOString()} : {};
  if (bed) {
    const stats = windowStats(beds, { age, halfLife });
    const napAdjust = learnedEffect(beds, 'previousNap', previousNap, {fallback:0.25, low:0, high:0.5, cap:25, halfLife});
    const byWindow = stats.base + stats.trend + napAdjust.effect;
    // Bedtime is partly a wake window and partly a clock routine (and, for many babies,
    // the last bottle). Blend them by how steady each has been for Frankie.
    const clockSD = Math.sqrt(weighted(beds.map(s => (s.clock - bed.usualClock) ** 2), stats.weights));
    const byClock = bed.usualClock - clockOf(last.end, timezone);
    const feed = feedTiming(beds, halfLife, last.end, lastFeed, now, stats.sd);
    const parts = [[byWindow, 1 / Math.max(stats.sd, 5) ** 2], [byClock, 1 / Math.max(clockSD, 5) ** 2], ...(feed ? [[feed.minutes, 1 / Math.max(feed.sd, 5) ** 2]] : [])];
    const total = parts.reduce((sum, [, w]) => sum + w, 0);
    const target = Math.max(20, parts.reduce((sum, [value, w]) => sum + value * w, 0) / total);
    const spread = clamp(1 / Math.sqrt(total), 10, 25);
    return finish({kind:'bedtime', target, spread, pool:beds, matched:'bedtime', base:stats.base, trend:stats.trend, napAdjust, nightAdjust:{effect:0, typical:null}, bottleAdjust:{effect:0},
      extra:{usualNaps:Math.round(bed.usualNaps), usualBedtime:new Date(last.end + byClock * MINUTE).toISOString(), clockShare:Math.round(parts[1][1] / total * 100), feedShare:feed && parts[2] ? Math.round(parts[2][1] / total * 100) : 0, ...(parts[2] ? feedNote(feed) : {})}});
  }
  if (!nap) return empty(`Learning: Mia needs wake windows before nap ${napNumber} on at least ${age != null ? 'two' : 'three'} days.`);
  // A bottle since she woke: if "bottle → asleep" is steadier than the wake window, blend it in.
  const feed = feedTiming(pool, halfLife, last.end, lastFeed, now, nap.sd);
  let target = nap.target, spread = clamp(nap.sd, 10, 25), feedShare = 0;
  if (feed) {
    const wWindow = 1 / Math.max(nap.sd, 5) ** 2, wFeed = 1 / Math.max(feed.sd, 5) ** 2;
    feedShare = wFeed / (wWindow + wFeed); target = nap.target * (1 - feedShare) + feed.minutes * feedShare;
    spread = clamp(1 / Math.sqrt(wWindow + wFeed), 10, 25);
  }
  return finish({kind:'nap', target, spread, pool, matched, base:nap.base, trend:nap.trend, napAdjust:nap.napAdjust, nightAdjust:nap.nightAdjust, bottleAdjust:nap.bottleAdjust,
    extra:{wakeMinutes:Math.round(nap.wakeAdjust.effect) || 0, feedShare:Math.round(feedShare * 100), ...(feedShare ? feedNote(feed) : {})}});

  // Asleep: when she'll wake from this nap, from how long this nap of the day usually
  // lasts (recent days count most). Night sleep is the morning challenge (cat-challenges.js).
  function napWake() {
    const began = stamp(timer.start);
    if (timer.paused || !Number.isFinite(began) || +now - began > 6 * 3600000) return empty('Sleeping now. Mia will forecast after wake-up.');
    const {samples, byDay, today, line} = indexedWakeWindows(sleeps, timezone, now, lookback, bottles);
    if (!isNap({start:began, end:began + MINUTE}, timezone, line)) return empty('Asleep for the night: see the morning wake-up calls.');
    const napNumber = (byDay.get(today)?.naps || []).filter(nap => nap.end <= began).length + 1;
    let pool = samples.filter(s => s.index === napNumber && s.napLength >= 10), matched = 'exact';
    if (new Set(pool.map(s => s.day)).size < 3) { pool = samples.filter(s => Math.abs(s.index - napNumber) <= 1 && s.napLength >= 10); matched = 'nearby'; }
    pool = trimmed(pool.map(s => ({ ...s, minutes:s.napLength })));
    if (pool.length < 3) return empty(`Learning: Mia needs nap ${napNumber} logged on a few more days to call the wake-up.`);
    const weights = weightsFor(pool, halfLife), typical = weighted(pool.map(s => s.minutes), weights);
    const sd = Math.sqrt(weighted(pool.map(s => (s.minutes - typical) ** 2), weights)), spread = clamp(sd * 0.4, 5, 10);
    const target = Math.max(+now + MINUTE, began + typical * MINUTE);
    return { available:true, version:2, kind:'wake', napNumber, matched, samples:pool.length, sleepStart:new Date(began).toISOString(), typicalMinutes:Math.round(typical),
      target:new Date(target).toISOString(), start:new Date(target - spread * MINUTE).toISOString(), end:new Date(target + spread * MINUTE).toISOString(),
      confidence:sd >= 30 ? 'Varied' : pool.length < 6 ? 'Learning' : 'Steady', phase:+now > target + spread * MINUTE ? 'passed' : +now >= target - spread * MINUTE ? 'within' : 'upcoming' };
  }
  function finish({kind, target, spread, pool, matched, base, trend, napAdjust, nightAdjust, bottleAdjust, extra}) {
    // A tight window: about 40% of her usual spread, 5–10 minutes either side. (Scores use the center.)
    const shown = clamp(spread * 0.4, 5, 10);
    const start = last.end + Math.max(5, target - shown) * MINUTE, end = last.end + (target + shown) * MINUTE;
    const round = value => value == null ? null : Math.round(value);
    return { available:true, version:2, kind, start:new Date(start).toISOString(), end:new Date(end).toISOString(), target:new Date(last.end + target * MINUTE).toISOString(),
      lastWake:new Date(last.end).toISOString(), napNumber, napsToday, matched, samples:pool.length, days:days(pool),
      baseMinutes:Math.round(base) || 0, trendMinutes:Math.round(trend) || 0, napMinutes:Math.round(napAdjust.effect) || 0, previousNap:round(previousNap), typicalNap:round(napAdjust.typical),
      nightMinutes:Math.round(nightAdjust.effect) || 0, lastNight:round(lastNight), typicalNight:round(nightAdjust.typical),
      bottleMinutes:Math.round(bottleAdjust.effect) || 0, lastOz:lastOz == null ? null : Math.round(lastOz * 10) / 10, ageDays:age == null ? null : Math.floor(age), halfLife, ...extra,
      confidence:spread >= 22 ? 'Varied' : pool.length < 6 ? 'Learning' : 'Steady',
      phase:+now > end ? 'passed' : +now >= start ? 'within' : 'upcoming' };
  }
}

// Bottles and sleep: does anything in Frankie's own logs link them? Plain
// correlations over the last four weeks, reported honestly ("no clear link yet").
export function bottleSleepLinks({ sleeps = [], bottles = [], timezone = 'America/New_York' } = {}, now = new Date()) {
  const {samples, bedtimes, byDay} = indexedWakeWindows(sleeps, timezone, now, 28, bottles), feeds = bottleList(bottles, now);
  const verdict = (r, n) => n < 8 ? 'not-enough' : Math.abs(r) < 0.2 ? 'none' : Math.abs(r) < 0.4 ? 'slight' : 'clear';
  const link = (pairs, unit) => {
    const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]), r = correlation(xs, ys), n = pairs.length;
    return { n, r:Math.round(r * 100) / 100, slope:n >= 3 ? Math.round(slope(xs, ys, xs.map(() => 1)) * 10) / 10 : 0, unit, verdict:verdict(r, n) };
  };
  const windows = [...samples, ...bedtimes];
  // 1. Bottle in the hour before a nap → that nap's length (minutes per oz).
  const napPairs = samples.map(s => { const fed = between(feeds, s.to - 60 * MINUTE, s.to).filter(b => b.oz != null); return fed.length ? [fed.reduce((sum, b) => sum + b.oz, 0), s.napLength] : null; }).filter(Boolean);
  // 2. The last bottle before a wake window → how long she stays awake.
  const windowPairs = windows.filter(s => s.lastOz != null).map(s => [s.lastOz, s.minutes]);
  // 3. Evening ounces (4 PM to bedtime) → the night's sleep.
  const nightPairs = bedtimes.map(s => {
    const night = byDay.get(nextDay(s.day))?.night;
    const evening = feeds.filter(b => b.oz != null && b.t <= s.to && clockOf(b.t, timezone) >= 16 * 60 && b.t > s.to - 6 * 3600000);
    return night >= 240 && evening.length ? [evening.reduce((sum, b) => sum + b.oz, 0), night] : null;
  }).filter(Boolean);
  // 4. Falling asleep after a bottle: how often, and how soon.
  const fed = windows.filter(s => s.feedGap != null && s.feedGap <= 60), gaps = fed.map(s => s.feedGap);
  return { napLength:link(napPairs, 'min per oz'), window:link(windowPairs, 'min per oz'), night:link(nightPairs, 'min per oz'),
    feedToSleep:{ n:fed.length, of:windows.length, share:windows.length ? Math.round(100 * fed.length / windows.length) : 0, typical:gaps.length ? Math.round(quantile(gaps, .5)) : null } };
}

// Next bottle: the median gap between Frankie's recent bottles that started around
// the same time of day (night feeds usually stretch longer), with the middle half
// of those gaps as the window. Her own history only; not feeding advice.
export function bottleForecast(bottles = [], { timezone = 'America/New_York', now = new Date() } = {}) {
  const empty = reason => ({ available:false, reason });
  const list = bottles.map(bottle => ({ t:stamp(bottle.start), amount:bottle.amount, units:bottle.units, type:bottle.type }))
    .filter(bottle => Number.isFinite(bottle.t) && bottle.t <= +now && bottle.t >= +now - 7 * DAY).sort((a, b) => a.t - b.t);
  if (list.length < 4) return empty('Learning: log a few more bottles for a forecast.');
  const last = list.at(-1);
  if (+now - last.t > 10 * 3600000) return empty('Log the latest bottle for a forecast.');
  const minuteOfDay = t => { const { hour, minute } = localParts(t, timezone); return hour * 60 + minute; };
  const apart = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };
  const gaps = [];
  for (let i = 1; i < list.length; i++) {
    const minutes = (list[i].t - list[i - 1].t) / MINUTE;
    if (minutes >= 45 && minutes <= 8 * 60) gaps.push({ minutes, clock:minuteOfDay(list[i - 1].t), t:list[i].t }); // skip top-ups and missing logs
  }
  const at = minuteOfDay(last.t);
  let pool = gaps.filter(gap => apart(gap.clock, at) <= 150), matchedTime = true;
  if (pool.length < 4) { pool = gaps; matchedTime = false; }
  pool = pool.sort((a, b) => b.t - a.t).slice(0, 20);
  if (pool.length < 3) return empty('Learning: log a few more bottles for a forecast.');
  const values = pool.map(gap => gap.minutes), median = quantile(values, .5);
  const low = Math.min(quantile(values, .25), median - 20), high = Math.max(quantile(values, .75), median + 20);
  const start = last.t + Math.max(30, low) * MINUTE, end = last.t + high * MINUTE;
  return { available:true, start:new Date(start).toISOString(), end:new Date(end).toISOString(), target:new Date(last.t + median * MINUTE).toISOString(),
    last:{ time:new Date(last.t).toISOString(), amount:last.amount, units:last.units, type:last.type }, typicalMinutes:Math.round(median), samples:values.length, matchedTime,
    phase:+now > end ? 'overdue' : +now >= start ? 'due' : 'upcoming' };
}

// The cats' pick for Today's top line: the average of Hubert's, Mia's and Mack's next
// sleep (nap or bedtime). A cat calling a different event (more than 90 minutes from the
// middle pick) is left out, so a nap guess isn't averaged with a bedtime guess.
export function catsConsensus({ purr, mia, huck } = {}) {
  const picks = [
    purr?.available && Number.isFinite(stamp(purr.target)) ? { cat:'Hubert', at:stamp(purr.target), kind:purr.kind } : null,
    mia?.available && Number.isFinite(stamp(mia.target)) && ['nap', 'bedtime'].includes(mia.kind) ? { cat:'Mia', at:stamp(mia.target), kind:mia.kind } : null,
    huck?.available && !huck.expired && !huck.sleeping && Number.isFinite(stamp(huck.time)) ? { cat:'Mack', at:stamp(huck.time), kind:null } : null
  ].filter(Boolean);
  if (!picks.length) return null;
  const sorted = [...picks].sort((a, b) => a.at - b.at), middle = sorted[Math.floor((sorted.length - 1) / 2)].at;
  const used = picks.filter(p => Math.abs(p.at - middle) <= 90 * MINUTE);
  const kinds = used.map(p => p.kind).filter(Boolean), bedtime = kinds.filter(k => k === 'bedtime').length;
  const kind = !kinds.length ? 'nap' : bedtime * 2 > kinds.length ? 'bedtime' : bedtime * 2 < kinds.length ? 'nap' : (used.find(p => p.cat === 'Mia')?.kind || kinds[0]);
  return { target:new Date(Math.round(used.reduce((s, p) => s + p.at, 0) / used.length)).toISOString(), kind, picks:used.map(p => ({ cat:p.cat, at:new Date(p.at).toISOString() })), left:picks.filter(p => !used.includes(p)).map(p => p.cat) };
}
