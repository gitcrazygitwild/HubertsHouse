// A transparent personal-history estimate. No age-based sleep prescription,
// Huckleberry prediction, or population training data enters this calculation.
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
function quantile(values, q) {
  const sorted = [...values].sort((a,b) => a - b), position = (sorted.length - 1) * q;
  const low = Math.floor(position), weight = position - low;
  return sorted[low] * (1 - weight) + sorted[Math.ceil(position)] * weight;
}
export function purrfectWindow({ sleeps = [], timer = null, timezone = 'America/New_York', complete = true } = {}, now = new Date()) {
  const empty = reason => ({ available:false, reason });
  if (!complete) return empty('Sleep history is incomplete. Refresh before estimating.');
  if (timer?.active) return empty('Sleeping now. A new window will appear after wake-up.');
  const intervals = sleeps.map(sleep => ({start:stamp(sleep.start),end:stamp(sleep.end)}))
    .filter(sleep => Number.isFinite(sleep.start) && Number.isFinite(sleep.end) && sleep.end > sleep.start && sleep.end <= +now && sleep.start >= +now - 14 * DAY)
    .sort((a,b) => a.start - b.start);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({...interval});
  }
  const lastWake = merged.at(-1)?.end;
  if (!lastWake || +now - lastWake > 8 * 3600000) return empty('Log a recent sleep and wake-up to find the next window.');
  const current = localParts(+now, timezone), wake = localParts(lastWake, timezone);
  if (current.hour < 6 || current.hour >= 22 || wake.hour < 5) return empty('Overnight wake-ups are outside this model’s daytime estimate.');
  const samples = [];
  for (let index = 1; index < merged.length; index++) {
    const start = merged[index - 1].end, end = merged[index].start;
    const from = localParts(start, timezone), to = localParts(end, timezone);
    const minutes = (end - start) / MINUTE;
    // Exclude overnight gaps and obvious missing-log gaps; thresholds are data
    // quality checks, not recommended wake-window lengths.
    if (from.day !== to.day || from.hour < 5 || to.hour >= 22 || minutes < 10 || minutes > 360) continue;
    samples.push({ minutes, hour:from.hour, day:from.day, end });
  }
  let selected = samples.filter(sample => Math.abs(sample.hour - wake.hour) <= 3);
  let matchedTime = true;
  if (selected.length < 3 || new Set(selected.map(sample => sample.day)).size < 2) { selected = samples; matchedTime = false; }
  selected = selected.sort((a,b) => b.end - a.end).slice(0, 20);
  if (selected.length < 3 || new Set(selected.map(sample => sample.day)).size < 2) return empty('Learning your rhythm: log at least three daytime wake windows across two days.');
  const values = selected.map(sample => sample.minutes), median = quantile(values, .5);
  const low = Math.min(quantile(values, .25), median - 10), high = Math.max(quantile(values, .75), median + 10);
  const start = lastWake + Math.max(1, low) * MINUTE, end = lastWake + high * MINUTE;
  return { available:true, start:new Date(start).toISOString(), end:new Date(end).toISOString(), target:new Date(lastWake + median * MINUTE).toISOString(),
    lastWake:new Date(lastWake).toISOString(), samples:values.length, days:new Set(selected.map(sample => sample.day)).size,
    matchedTime, pattern:high - low > 60 ? 'Varied pattern' : values.length < 7 ? 'Early pattern' : 'Personal pattern',
    phase:+now > end ? 'passed' : +now >= start ? 'within' : 'upcoming' };
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

// Mia's Catnap Forecast: a second, deliberately different estimate.
// Purrfect Window pools recent wake gaps near the same clock time. Mia instead
// (1) indexes wake windows by position in the day (wake→nap 1, nap 1→nap 2…),
// (2) weights recent days more heavily (3-day half-life) with a small growth
// trend, and (3) shortens or lengthens the window based on how the last nap
// compared with that nap's usual length, learned from this baby's own history.
const NIGHT_START_HOUR = 19, NIGHT_END_HOUR = 5;
const isNap = (sleep, timezone) => { const hour = localParts(sleep.start, timezone).hour; return hour >= NIGHT_END_HOUR && hour < NIGHT_START_HOUR && sleep.end - sleep.start < 4 * 3600000; };
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
// Minutes since local midnight; small hours count as late evening (25:00, not 1:00).
const clockOf = (value, timezone) => { const {hour, minute} = localParts(value, timezone); return (hour < 6 ? hour + 24 : hour) * 60 + minute; };
export function indexedWakeWindows(sleeps, timezone, now = new Date(), days = 21) {
  const merged = mergeSleeps(sleeps, now, days), byDay = new Map();
  const entryFor = day => { if (!byDay.has(day)) byDay.set(day, {wake:null,naps:[],bed:null,night:0}); return byDay.get(day); };
  for (const sleep of merged) {
    if (isNap(sleep, timezone)) { entryFor(localParts(sleep.start, timezone).day).naps.push(sleep); continue; }
    const start = localParts(sleep.start, timezone), end = localParts(sleep.end, timezone);
    // A night belongs to the morning it ends: evening segments count toward the next day's night.
    if (start.hour >= 16) { const evening = entryFor(start.day); if (evening.bed == null) evening.bed = sleep.start; }
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
  return {samples, bedtimes, byDay, today};
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
export function miaForecast({ sleeps = [], timer = null, timezone = 'America/New_York', complete = true } = {}, now = new Date()) {
  const empty = reason => ({ available:false, reason });
  if (!complete) return empty('Sleep history is incomplete. Refresh before forecasting.');
  if (timer?.active) return empty('Sleeping now. Mia will forecast after wake-up.');
  const merged = mergeSleeps(sleeps, now, 21), last = merged.at(-1);
  if (!last || +now - last.end > 8 * 3600000) return empty('Log a recent sleep and wake-up for a forecast.');
  const current = localParts(+now, timezone);
  if (current.hour < 6 || current.hour >= 23) return empty('Overnight is outside Mia’s forecast.');
  const {samples, bedtimes, byDay, today} = indexedWakeWindows(sleeps, timezone, now);
  const todays = byDay.get(today) || {naps:[]}, lastWasNap = isNap(last, timezone);
  if (!lastWasNap && localParts(last.end, timezone).hour >= 12) return empty('Overnight is outside Mia’s forecast.');
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
