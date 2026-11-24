// Frankie's nights and weekdays. Pure: no DOM, no network.
// lastNight(): the most recent night from bedtime to the morning wake-up (how long she slept,
//   her longest stretch, wake-ups and night feeds), next to her other recent nights.
// weekdayLinks(): is there a day-of-the-week pattern? For night sleep, bedtime, morning
//   wake-up, naps and ounces, each day's values are compared after taking out her overall
//   trend (babies change week to week), and a shuffle test asks whether the differences
//   between days are bigger than chance would give. Small samples say so instead of guessing.
import { nightsFrom } from './cat-challenges.js';
import { dailySleep, dailyBottles, localDay, dayStart, toOunces } from './baby-history.js';

const MIN = 60000, DAY = 86400000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const stamp = v => typeof v === 'number' ? v : Date.parse(v);
const mean = list => list.length ? list.reduce((s, v) => s + v, 0) / list.length : null;
const weekdayOf = (key, timezone) => new Date(dayStart(key, timezone) + 12 * 3600000).getUTCDay();

// Sleeps and feeds between a bedtime and the morning (or now, if she isn't up yet).
function nightDetail(night, sleeps, feeds, now) {
  const end = night.morning ?? Math.min(+now, night.bedtime + 14 * 3600000);
  const parts = sleeps.filter(s => s.end > night.bedtime && s.start < end).map(s => ({ start:Math.max(s.start, night.bedtime), end:Math.min(s.end, end) })).filter(s => s.end > s.start).sort((a, b) => a.start - b.start);
  const slept = parts.reduce((sum, s) => sum + (s.end - s.start), 0) / MIN;
  const longest = parts.reduce((m, s) => Math.max(m, (s.end - s.start) / MIN), 0);
  let wakeups = 0; for (let i = 1; i < parts.length; i++) if (parts[i].start - parts[i - 1].end >= 5 * MIN) wakeups++;
  const fed = feeds.filter(b => b.at > night.bedtime && b.at < end);
  return { slept, longest, wakeups, feeds:fed.length, ounces:Math.round(fed.reduce((s, b) => s + b.oz, 0) * 10) / 10, end };
}
const prepare = (sleeps, bottles) => ({
  list:sleeps.map(s => ({ start:stamp(s.start), end:stamp(s.end) })).filter(s => Number.isFinite(s.start) && s.end > s.start),
  feeds:bottles.map(b => ({ at:stamp(b.start), oz:toOunces(Number(b.amount) || 0, b.units) })).filter(b => Number.isFinite(b.at))
});

export function lastNight({ sleeps = [], bottles = [], timer = null, timezone = 'America/New_York', now = Date.now() } = {}) {
  const { list, feeds } = prepare(sleeps, bottles);
  // A night in progress counts too (the timer's sleep runs until now).
  const withTimer = timer?.active && Number.isFinite(stamp(timer.start)) ? [...list, { start:stamp(timer.start), end:+now }] : list;
  const nights = nightsFrom(withTimer.map(s => ({ start:s.start, end:s.end })), timezone, +now + 1, 21);
  const last = nights.at(-1);
  if (!last || +now - last.bedtime > 36 * 3600000) return { available:false, reason:'No night logged in the last day and a half.' };
  const detail = nightDetail(last, withTimer, feeds, now), inProgress = !last.morning && !!timer?.active;
  const others = nights.slice(0, -1).filter(n => n.morning).slice(-7).map(n => nightDetail(n, list, feeds, now));
  const avg = others.length >= 3 ? { slept:mean(others.map(n => n.slept)), bedClock:mean(nights.slice(0, -1).filter(n => n.morning).slice(-7).map(n => n.bedClock)) } : null;
  return { available:true, key:last.key, bedtime:new Date(last.bedtime).toISOString(), morning:last.morning ? new Date(last.morning).toISOString() : null, inProgress,
    slept:Math.round(detail.slept), longest:Math.round(detail.longest), wakeups:detail.wakeups, feeds:detail.feeds, ounces:detail.ounces,
    average:avg ? { slept:Math.round(avg.slept), bedClock:Math.round(avg.bedClock), nights:others.length } : null,
    vsAverage:avg ? Math.round(detail.slept - avg.slept) : null };
}

// A small deterministic random generator, so the shuffle test gives the same answer each time.
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; }; }
// How far apart the weekday averages are (weighted by how many of each day there are).
function spread(values, days) {
  const overall = mean(values), sums = Array(7).fill(0), counts = Array(7).fill(0);
  values.forEach((v, i) => { sums[days[i]] += v; counts[days[i]]++; });
  return counts.reduce((s, n, d) => s + (n ? n * (sums[d] / n - overall) ** 2 : 0), 0);
}
// Take out the overall trend (a straight line through time), keeping the average level.
function detrend(points) {
  const n = points.length, mx = mean(points.map(p => p.t)), my = mean(points.map(p => p.v));
  const sxx = points.reduce((s, p) => s + (p.t - mx) ** 2, 0), slope = sxx ? points.reduce((s, p) => s + (p.t - mx) * (p.v - my), 0) / sxx : 0;
  return n ? points.map(p => ({ ...p, v:p.v - slope * (p.t - mx) })) : points;
}
// minEffect: a difference smaller than this isn't worth calling a pattern, however steady it is.
export function weekdayPattern(points, { minPerDay = 2, minTotal = 21, shuffles = 600, seed = 7, minEffect = 0 } = {}) {
  const counts = Array(7).fill(0); points.forEach(p => counts[p.day]++);
  const covered = counts.filter(n => n >= minPerDay).length;
  if (points.length < minTotal || covered < 7) return { verdict:'not-enough', n:points.length, counts };
  const flat = detrend(points), values = flat.map(p => p.v), days = flat.map(p => p.day), overall = mean(values);
  const observed = spread(values, days), random = rng(seed), shuffled = [...days];
  let asBig = 0;
  for (let k = 0; k < shuffles; k++) {
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    if (spread(values, shuffled) >= observed - 1e-9) asBig++;
  }
  const p = (asBig + 1) / (shuffles + 1);
  const byDay = WEEKDAYS.map((name, d) => { const own = values.filter((_, i) => days[i] === d); return { day:d, name, n:own.length, mean:mean(own), diff:mean(own) - overall }; });
  const ranked = [...byDay].sort((a, b) => b.diff - a.diff);
  const big = Math.max(Math.abs(ranked[0].diff), Math.abs(ranked.at(-1).diff)) >= minEffect;
  return { verdict:!big ? 'none' : p < 0.05 ? 'clear' : p < 0.2 ? 'slight' : 'none', p:Math.round(p * 1000) / 1000, n:points.length, overall, byDay, high:ranked[0], low:ranked.at(-1), small:!big };
}

export function weekdayLinks({ sleeps = [], bottles = [], timezone = 'America/New_York', now = Date.now(), days = 60 } = {}) {
  const { list, feeds } = prepare(sleeps, bottles);
  const nights = nightsFrom(list.map(s => ({ start:s.start, end:s.end })), timezone, now, days).filter(n => n.morning);
  const night = nights.map(n => ({ t:n.bedtime, day:weekdayOf(n.key, timezone), v:nightDetail(n, list, feeds, now).slept }));
  const bedtime = nights.map(n => ({ t:n.bedtime, day:weekdayOf(n.key, timezone), v:n.bedClock }));
  const wake = nights.map(n => { const key = localDay(n.morning, timezone); return { t:n.morning, day:weekdayOf(key, timezone), v:n.wakeClock }; });
  const fullDays = dailySleep(sleeps, timezone, days + 1, now).slice(0, -1).filter(d => d.total > 0);
  const naps = fullDays.map(d => ({ t:dayStart(d.key, timezone), day:weekdayOf(d.key, timezone), v:d.nap * 60 }));
  const ounces = dailyBottles(bottles, timezone, days + 1, now).slice(0, -1).filter(d => d.count >= 3).map(d => ({ t:dayStart(d.key, timezone), day:weekdayOf(d.key, timezone), v:d.ounces }));
  return {
    night:{ label:'Night sleep', unit:'min', of:'nights', ...weekdayPattern(night, { minEffect:20 }) },
    bedtime:{ label:'Bedtime', unit:'clock', of:'nights', ...weekdayPattern(bedtime, { minEffect:15 }) },
    wake:{ label:'Morning wake-up', unit:'clock', of:'mornings', ...weekdayPattern(wake, { minEffect:15 }) },
    naps:{ label:'Naps', unit:'min', of:'days', ...weekdayPattern(naps, { minEffect:20 }) },
    ounces:{ label:'Ounces', unit:'oz', of:'days', ...weekdayPattern(ounces, { minEffect:1.5 }) }
  };
}
