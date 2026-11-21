// Is Frankie on pace for her usual day of bottles? The target is her average over recent
// full days. A bottle she just finished doesn't count all at once: each one is credited
// gradually over her usual gap between bottles, so right after a feed she isn't shown as
// "ahead". Past days are scored the same way at the same time of day, so the comparison
// is fair. Pure: no DOM, no network.
import { toOunces, localDay, dayStart, dayKeys } from './baby-history.js';

const MIN = 60000, DAY = 86400000;
const median = list => { const s = [...list].sort((a, b) => a - b), m = (s.length - 1) / 2; return s.length ? (s[Math.floor(m)] + s[Math.ceil(m)]) / 2 : null; };
const round = (n, step = 0.1) => Number((Math.round(n / step) * step).toFixed(2));

// Bottles as { at, oz }, oldest first.
const feeds = bottles => bottles.map(b => ({ at:Date.parse(b.start), oz:toOunces(Number(b.amount) || 0, b.units) })).filter(b => Number.isFinite(b.at) && b.oz > 0).sort((a, b) => a.at - b.at);
// Ounces credited by time t for the bottles in [from, t]: each bottle ramps in over `gap`.
function credited(list, from, t, gap) {
  let sum = 0;
  for (const b of list) { if (b.at < from || b.at > t) continue; sum += b.oz * Math.min(1, (t - b.at) / gap); }
  return sum;
}
export function bottlePace(bottles = [], timezone, now = Date.now(), { days = 7 } = {}) {
  const list = feeds(bottles), today = localDay(+now, timezone), todayStart = dayStart(today, timezone), offset = +now - todayStart;
  // Recent full days with a believable number of bottles.
  const past = dayKeys(days + 1, timezone, +now).slice(0, -1).map(key => {
    const from = dayStart(key, timezone), to = dayStart(localDay(from + DAY * 1.5, timezone), timezone), inDay = list.filter(b => b.at >= from && b.at < to);
    return { key, from, to, bottles:inDay, total:inDay.reduce((s, b) => s + b.oz, 0) };
  }).filter(day => day.bottles.length >= 3);
  if (past.length < 3) return { available:false, reason:'A few more full days of bottles and the pace tracker can start.' };
  const target = past.reduce((s, d) => s + d.total, 0) / past.length;
  // Her usual gap between bottles (daytime and night alike), over the same days.
  const recent = list.filter(b => b.at >= past[0].from && b.at <= +now), gaps = [];
  for (let i = 1; i < recent.length; i++) { const g = recent[i].at - recent[i - 1].at; if (g >= 30 * MIN && g <= 8 * 60 * MIN) gaps.push(g); }
  const gap = Math.min(6 * 60 * MIN, Math.max(60 * MIN, median(gaps) ?? 3 * 60 * MIN));
  // Where she usually is by this time of day, credited the same gradual way.
  const expected = past.reduce((s, d) => s + credited(d.bottles, d.from, d.from + offset, gap), 0) / past.length;
  const todays = list.filter(b => b.at >= todayStart && b.at <= +now);
  const drank = todays.reduce((s, b) => s + b.oz, 0), counted = credited(todays, todayStart, +now, gap);
  const diff = counted - expected, tolerance = Math.max(1, target * 0.08);
  const last = todays.at(-1) || list.filter(b => b.at <= +now).at(-1) || null;
  const nextDue = last ? last.at + gap : null;
  return {
    available:true, target:round(target), days:past.length, gapMinutes:Math.round(gap / MIN),
    drank:round(drank), counted:round(counted), expected:round(expected), diff:round(diff),
    status:Math.abs(diff) <= tolerance ? 'on-track' : diff > 0 ? 'ahead' : 'behind',
    projected:round(Math.max(drank, target + diff), 0.5), remaining:round(Math.max(0, target - drank)),
    lastBottle:last ? { at:new Date(last.at).toISOString(), oz:round(last.oz), settling:round(last.oz - last.oz * Math.min(1, (+now - last.at) / gap)) } : null,
    nextDue:nextDue ? new Date(nextDue).toISOString() : null, count:todays.length
  };
}
