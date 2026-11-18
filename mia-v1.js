// Mia's Catnap Forecast, version 1, FROZEN. Do not edit.
// The nap scoreboard judges each model on what it actually predicted at the time.
// Naps before MIA_V2_SINCE (prediction-log.js) were forecast by this version, so
// the scoreboard replays them with this exact code instead of backfilling them
// with a newer model's guesses. Improve the live model in baby-model.js instead.
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
// Mia's Catnap Forecast: a second, deliberately different estimate.
// Purrfect Window pools recent wake gaps near the same clock time. Mia instead
// (1) indexes wake windows by position in the day (wake→nap 1, nap 1→nap 2…),
// (2) weights recent days more heavily (3-day half-life) with a small growth
// trend, and (3) shortens or lengthens the window based on how the last nap
// compared with that nap's usual length, learned from this baby's own history.
// Nap or night follows Frankie's own learned evening line (see nightLine), not a fixed hour.
const isNap = (sleep, timezone, line) => sleepKind(sleep, timezone, line) === 'nap';
function weighted(values, weights) { const total = weights.reduce((a,b) => a + b, 0); return values.reduce((sum,value,index) => sum + value * weights[index], 0) / total; }
function slope(xs, ys, weights) {
  const mx = weighted(xs,weights), my = weighted(ys,weights);
  let num = 0, den = 0; xs.forEach((x,i) => { num += weights[i] * (x - mx) * (ys[i] - my); den += weights[i] * (x - mx) ** 2; });
  return den > 0 ? num / den : 0;
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
// Wake windows labeled by their position in the day.
const nextDay = day => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const previousDay = day => new Date(Date.parse(`${day}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
// Minutes since local midnight; small hours count as late evening (25:00, not 1:00).
const clockOf = (value, timezone) => { const {hour, minute} = localParts(value, timezone); return (hour < 6 ? hour + 24 : hour) * 60 + minute; };
function indexedWakeWindows(sleeps, timezone, now = new Date(), days = 21) {
  const merged = mergeSleeps(sleeps, now, days), byDay = new Map(), line = nightLine(merged, timezone, now, days);
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
  for (const [day, {wake, naps, bed, night}] of byDay) {
    const daysAgo = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / DAY);
    naps.forEach((nap, index) => {
      const from = index === 0 ? wake : naps[index - 1].end;
      if (!from || from >= nap.start) return;
      const minutes = (nap.start - from) / MINUTE;
      if (minutes < 20 || minutes > 360) return; // logging gaps, not real windows
      samples.push({index:index + 1, minutes, previousNap:index === 0 ? null : (naps[index - 1].end - naps[index - 1].start) / MINUTE,
        lastNight:index === 0 && wake && night >= 240 ? night : null, daysAgo, day});
    });
    // Bedtime: the last nap's end → the night's first sleep.
    const lastNap = naps.at(-1);
    if (bed != null && lastNap && lastNap.end < bed) {
      const minutes = (bed - lastNap.end) / MINUTE;
      if (minutes >= 30 && minutes <= 420) bedtimes.push({minutes, naps:naps.length, previousNap:(lastNap.end - lastNap.start) / MINUTE, clock:clockOf(bed, timezone), daysAgo, day});
    }
  }
  return {samples, bedtimes, byDay, today, line};
}
// One learned adjustment: β is the slope of window vs. the factor in Frankie's history
// (with enough samples), scaled by how far today's value is from her usual.
function learnedEffect(pool, field, value, {fallback, low, high, cap}) {
  const known = pool.filter(sample => sample[field] != null);
  if (value == null || known.length < 3) return {effect:0, typical:null};
  const weights = known.map(sample => 0.5 ** (sample.daysAgo / 3));
  const typical = weighted(known.map(sample => sample[field]), weights);
  const beta = known.length >= 6 ? clamp(slope(known.map(s => s[field]), known.map(s => s.minutes), weights), low, high) : fallback;
  return {effect:clamp(beta * (value - typical), -cap, cap), typical};
}
// Recency-weighted average, capped growth trend and weighted spread of a pool of windows.
function windowStats(pool) {
  const weights = pool.map(sample => 0.5 ** (sample.daysAgo / 3)), minutes = pool.map(sample => sample.minutes);
  const base = weighted(minutes, weights);
  // Growth trend, capped so one odd day cannot run away with the forecast.
  const spanDays = Math.max(...pool.map(s => s.daysAgo)) - Math.min(...pool.map(s => s.daysAgo));
  const perDay = pool.length >= 5 && spanDays >= 4 ? clamp(slope(pool.map(s => -s.daysAgo), minutes, weights), -3, 3) : 0;
  const trend = clamp(perDay * weighted(pool.map(s => s.daysAgo), weights), -20, 20);
  const sd = Math.sqrt(weighted(minutes.map(value => (value - base) ** 2), weights));
  return {weights, base, trend, sd};
}
export function miaForecastV1({ sleeps = [], timer = null, timezone = 'America/New_York', complete = true } = {}, now = new Date()) {
  const empty = reason => ({ available:false, reason });
  if (!complete) return empty('Sleep history is incomplete. Refresh before forecasting.');
  if (timer?.active) return empty('Sleeping now. Mia will forecast after wake-up.');
  const merged = mergeSleeps(sleeps, now, 21), last = merged.at(-1);
  if (!last || +now - last.end > 8 * 3600000) return empty('Log a recent sleep and wake-up for a forecast.');
  const current = localParts(+now, timezone);
  if (current.hour >= 1 && current.hour < 5) return empty('Overnight is outside Mia’s forecast.');
  const {samples, bedtimes, byDay, today, line} = indexedWakeWindows(sleeps, timezone, now);
  const todays = byDay.get(today) || {naps:[]}, lastWasNap = isNap(last, timezone, line), lastEnd = localParts(last.end, timezone).hour;
  // After night sleep, only a morning wake-up (4 AM–noon) starts a new day; anything else is a night waking.
  if (!lastWasNap && (lastEnd < 4 || lastEnd >= 12)) return empty('Overnight is outside Mia’s forecast. A sleep that starts after Frankie’s usual evening line counts as night sleep.');
  const napsToday = todays.naps.filter(nap => nap.end <= last.end).length;
  const napNumber = lastWasNap ? napsToday + 1 : 1;
  const previousNap = lastWasNap ? (last.end - last.start) / MINUTE : null;
  const lastNight = !lastWasNap && todays.night >= 240 ? todays.night : null;
  const days = pool => new Set(pool.map(sample => sample.day)).size;
  let pool = samples.filter(sample => sample.index === napNumber), matched = 'exact';
  const exactDays = days(pool);
  if (exactDays < 3) { pool = samples.filter(sample => Math.abs(sample.index - napNumber) <= 1); matched = 'nearby'; }
  const napReady = pool.length >= 3 && days(pool) >= 3;
  let nap = null;
  if (napReady) {
    const stats = windowStats(pool);
    // Nap 2+: a short or long previous nap. Nap 1: a short or long night.
    const napAdjust = learnedEffect(pool, 'previousNap', previousNap, {fallback:0.25, low:0, high:0.5, cap:25});
    const nightAdjust = learnedEffect(pool, 'lastNight', lastNight, {fallback:0.05, low:0, high:0.15, cap:20});
    nap = {...stats, napAdjust, nightAdjust, target:stats.base + stats.trend + napAdjust.effect + nightAdjust.effect};
  }
  // Bedtime comes next once Frankie has had her usual number of naps (unless her history
  // has days with another nap and it still fits), or when another nap would run into
  // her usual bedtime.
  let bed = null;
  if (lastWasNap && bedtimes.length >= 3 && days(bedtimes) >= 3) {
    const weights = bedtimes.map(sample => 0.5 ** (sample.daysAgo / 3));
    const usualNaps = weighted(bedtimes.map(sample => sample.naps), weights), usualClock = weighted(bedtimes.map(sample => sample.clock), weights);
    const napClock = nap ? clockOf(last.end + nap.target * MINUTE, timezone) : Infinity;
    if (napNumber <= Math.round(usualNaps)) { if (nap && napClock >= usualClock - 45) bed = {usualNaps, usualClock}; }
    else if (!(exactDays >= 3 && napClock < usualClock - 60)) bed = {usualNaps, usualClock};
  }
  if (bed) {
    const stats = windowStats(bedtimes);
    const napAdjust = learnedEffect(bedtimes, 'previousNap', previousNap, {fallback:0.25, low:0, high:0.5, cap:25});
    const byWindow = stats.base + stats.trend + napAdjust.effect;
    // Bedtime is partly a wake window and partly a clock routine. Blend the two by how
    // steady each has been for Frankie: the steadier one gets more say.
    const clockSD = Math.sqrt(weighted(bedtimes.map(s => (s.clock - bed.usualClock) ** 2), stats.weights));
    const byClock = bed.usualClock - clockOf(last.end, timezone);
    const windowWeight = 1 / Math.max(stats.sd, 5) ** 2, clockWeight = 1 / Math.max(clockSD, 5) ** 2;
    const share = clockWeight / (windowWeight + clockWeight);
    const target = Math.max(20, byWindow * (1 - share) + byClock * share);
    const spread = clamp(1 / Math.sqrt(windowWeight + clockWeight), 10, 25);
    return finish({kind:'bedtime', target, spread, pool:bedtimes, matched:'bedtime', base:stats.base, trend:stats.trend, napAdjust, nightAdjust:{effect:0, typical:null},
      extra:{usualNaps:Math.round(bed.usualNaps), usualBedtime:new Date(last.end + byClock * MINUTE).toISOString(), clockShare:Math.round(share * 100)}});
  }
  if (!nap) return empty(`Learning: Mia needs wake windows before nap ${napNumber} on at least three days.`);
  return finish({kind:'nap', target:nap.target, spread:clamp(nap.sd, 10, 25), pool, matched, base:nap.base, trend:nap.trend, napAdjust:nap.napAdjust, nightAdjust:nap.nightAdjust, extra:{}});

  function finish({kind, target, spread, pool, matched, base, trend, napAdjust, nightAdjust, extra}) {
    const start = last.end + Math.max(5, target - spread) * MINUTE, end = last.end + (target + spread) * MINUTE;
    const round = value => value == null ? null : Math.round(value);
    return { available:true, kind, start:new Date(start).toISOString(), end:new Date(end).toISOString(), target:new Date(last.end + target * MINUTE).toISOString(),
      lastWake:new Date(last.end).toISOString(), napNumber, napsToday, matched, samples:pool.length, days:days(pool),
      baseMinutes:Math.round(base) || 0, trendMinutes:Math.round(trend) || 0, napMinutes:Math.round(napAdjust.effect) || 0, previousNap:round(previousNap), typicalNap:round(napAdjust.typical),
      nightMinutes:Math.round(nightAdjust.effect) || 0, lastNight:round(lastNight), typicalNight:round(nightAdjust.typical), ...extra,
      confidence:spread >= 22 ? 'Varied' : pool.length < 6 ? 'Learning' : 'Steady',
      phase:+now > end ? 'passed' : +now >= start ? 'within' : 'upcoming' };
  }
}
