// Turns Huckleberry history into per-day rows for Frankie's charts. All day
// boundaries are local midnights in the baby's time zone, including DST days.
const DAY = 86400000, MINUTE = 60000, OZ_PER_ML = 1 / 29.5735;
export const toOunces = (amount, units) => units === 'ml' ? amount * OZ_PER_ML : amount;

const cache = new Map(), fmt = (key, timezone, options) => { const id = `${key}|${timezone}`; if (!cache.has(id)) cache.set(id, new Intl.DateTimeFormat(key === 'day' ? 'en-CA' : 'en-US', { timeZone:timezone, ...options })); return cache.get(id); };
function offsetMinutes(stamp, timezone) {
  const name = fmt('offset', timezone, { timeZoneName:'longOffset' }).formatToParts(new Date(stamp)).find(part => part.type === 'timeZoneName').value;
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}
export function localDay(stamp, timezone) {
  return fmt('day', timezone, { year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(stamp));
}
// UTC milliseconds of local midnight for a YYYY-MM-DD key.
export function dayStart(key, timezone) {
  const [y, m, d] = key.split('-').map(Number), guess = Date.UTC(y, m - 1, d);
  let stamp = guess - offsetMinutes(guess, timezone) * MINUTE;
  stamp = guess - offsetMinutes(stamp, timezone) * MINUTE;
  return stamp;
}
export function dayKeys(days, timezone, now = Date.now()) {
  const keys = []; let key = localDay(+now, timezone);
  for (let i = 0; i < days; i++) { keys.unshift(key); key = localDay(dayStart(key, timezone) - DAY / 2, timezone); }
  return keys;
}
const toStamp = value => typeof value === 'number' ? value : Date.parse(value);
// Minutes since local midnight.
export function clockAt(stamp, timezone) {
  const parts = fmt('clock', timezone, { hour:'numeric', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(stamp));
  const get = type => Number(parts.find(part => part.type === type).value);
  return get('hour') * 60 + get('minute');
}
export const DEFAULT_NIGHT_LINE = 19 * 60;
// Frankie's own evening line, learned from her recent nights instead of a fixed
// 7 PM. Each night starts with its main sleep (3h+ beginning between 5 PM and 3 AM)
// plus any segments just before it with under 45 minutes awake in between. The line
// sits 30 minutes before her earlier bedtimes (the 20th percentile), so a late catnap
// before bed still counts as a nap. Sleeps that start after the line are night sleep.
export function nightLine(sleeps, timezone, now = Date.now(), days = 21) {
  const list = [];
  for (const sleep of sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) }))
    .filter(s => Number.isFinite(s.start) && s.end > s.start && s.end <= +now && s.start >= +now - days * DAY).sort((a, b) => a.start - b.start)) {
    const previous = list.at(-1);
    if (previous && sleep.start <= previous.end) previous.end = Math.max(previous.end, sleep.end); else list.push(sleep);
  }
  const evening = stamp => { const clock = clockAt(stamp, timezone); return clock < 6 * 60 ? clock + 1440 : clock; }; // 1 AM → 25:00
  const nights = new Map();
  list.forEach((sleep, index) => {
    const clock = evening(sleep.start);
    if (sleep.end - sleep.start < 3 * 3600000 || clock < 17 * 60 || clock >= 27 * 60) return;
    let first = index;
    while (first > 0 && list[first].start - list[first - 1].end <= 45 * MINUTE && evening(list[first - 1].start) >= 17 * 60) first--;
    const key = localDay(list[first].start - 6 * 3600000, timezone), start = evening(list[first].start);
    nights.set(key, Math.min(nights.get(key) ?? Infinity, start));
  });
  if (nights.size < 3) return DEFAULT_NIGHT_LINE;
  const sorted = [...nights.values()].sort((a, b) => a - b), position = (sorted.length - 1) * 0.2, low = Math.floor(position);
  const early = sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
  return Math.round(Math.min(23.5 * 60, Math.max(18 * 60, early - 30)));
}
// A sleep under four hours that starts between 5 AM and Frankie's evening line is a nap.
export const sleepKind = (sleep, timezone, line = DEFAULT_NIGHT_LINE) => {
  const clock = clockAt(toStamp(sleep.start), timezone);
  return clock >= 5 * 60 && clock < line && toStamp(sleep.end) - toStamp(sleep.start) < 4 * 3600000 ? 'nap' : 'night';
};

function intervals(sleeps) {
  return sleeps.map(sleep => ({ start:Date.parse(sleep.start), end:Date.parse(sleep.end) })).filter(s => Number.isFinite(s.start) && s.end > s.start).sort((a,b) => a.start - b.start);
}
export function dailySleep(sleeps, timezone, days, now = Date.now()) {
  const line = nightLine(sleeps, timezone, now);
  const list = intervals(sleeps).map(sleep => ({ ...sleep, kind:sleepKind(sleep, timezone, line) }));
  return dayKeys(days, timezone, now).map(key => {
    const from = dayStart(key, timezone), to = Math.min(dayStart(localDay(from + DAY * 1.5, timezone), timezone), +now);
    let night = 0, nap = 0, naps = 0;
    for (const sleep of list) {
      const overlap = Math.min(sleep.end, to) - Math.max(sleep.start, from);
      if (overlap <= 0) continue;
      if (sleep.kind === 'nap') { nap += overlap; if (sleep.start >= from) naps++; } else night += overlap;
    }
    return { key, night:night / 3600000, nap:nap / 3600000, total:(night + nap) / 3600000, naps, partial:to < dayStart(localDay(from + DAY * 1.5, timezone), timezone) };
  });
}
export function dailyBottles(bottles, timezone, days, now = Date.now()) {
  const keys = dayKeys(days, timezone, now), byDay = new Map(keys.map(key => [key, { key, ounces:0, count:0 }]));
  for (const bottle of bottles) {
    const stamp = Date.parse(bottle.start); if (!Number.isFinite(stamp) || stamp > +now) continue;
    const row = byDay.get(localDay(stamp, timezone)); if (!row) continue;
    row.ounces += toOunces(bottle.amount, bottle.units); row.count++;
  }
  return keys.map(key => ({ ...byDay.get(key), ounces:Math.round(byDay.get(key).ounces * 10) / 10 }));
}
// One row per day; each block is minutes from local midnight, clipped to the day.
export function timelineRows(sleeps, timezone, days, now = Date.now()) {
  const line = nightLine(sleeps, timezone, now);
  const list = intervals(sleeps).map(sleep => ({ ...sleep, kind:sleepKind(sleep, timezone, line) }));
  return dayKeys(days, timezone, now).map(key => {
    const from = dayStart(key, timezone), next = dayStart(localDay(from + DAY * 1.5, timezone), timezone), length = (next - from) / MINUTE;
    const blocks = list.filter(s => s.end > from && s.start < next).map(s => ({
      from:Math.max(0, (s.start - from) / MINUTE), to:Math.min(length, (s.end - from) / MINUTE), kind:s.kind,
      start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString(), minutes:Math.round((s.end - s.start) / MINUTE)
    }));
    return { key, length, blocks, nowMinute:+now >= from && +now < next ? (+now - from) / MINUTE : null };
  }).reverse();
}
const average = values => values.length ? values.reduce((a,b) => a + b, 0) / values.length : null;
// Headline numbers; today is partial and left out of averages.
export function babySummary({ sleeps = [], bottles = [] }, timezone, now = Date.now()) {
  const sleepDays = dailySleep(sleeps, timezone, 15, now), bottleDays = dailyBottles(bottles, timezone, 15, now);
  const today = { sleep:sleepDays.at(-1), bottles:bottleDays.at(-1) };
  const week = sleepDays.slice(-8, -1).filter(day => day.total > 0), prior = sleepDays.slice(0, 7).filter(day => day.total > 0);
  const weekOz = bottleDays.slice(-8, -1).filter(day => day.count), priorOz = bottleDays.slice(0, 7).filter(day => day.count);
  return { today, avgSleep:average(week.map(d => d.total)), avgNight:average(week.map(d => d.night)), avgNaps:average(week.map(d => d.naps)),
    avgOunces:average(weekOz.map(d => d.ounces)), priorOunces:average(priorOz.map(d => d.ounces)), priorSleep:average(prior.map(d => d.total)) };
}

// One local day of Frankie, for the newsletter's "yesterday" story: when she got up,
// her naps, bedtime, the night after, bottles and (when known) diapers.
export function dayStory({ sleeps = [], bottles = [] } = {}, diapers, timezone, key, now = Date.now()) {
  const from = dayStart(key, timezone), to = dayStart(localDay(from + DAY * 1.5, timezone), timezone), H = 3600000;
  const line = nightLine(sleeps, timezone, now);
  const list = intervals(sleeps).filter(sleep => sleep.end <= +now).map(sleep => ({ ...sleep, kind:sleepKind(sleep, timezone, line) }));
  const nights = list.filter(sleep => sleep.kind === 'night');
  const wake = nights.filter(sleep => sleep.end >= from + 2 * H && sleep.end < from + 12 * H).at(-1)?.end ?? null;
  const naps = list.filter(sleep => sleep.kind === 'nap' && sleep.start >= from && sleep.start < to);
  const longest = [...naps].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] || null;
  const bed = nights.find(sleep => sleep.start >= from + 12 * H && sleep.start < to + 5 * H)?.start ?? null;
  const night = bed == null ? [] : nights.filter(sleep => sleep.start >= bed && sleep.end < to + 12 * H);
  const dayBottles = bottles.map(bottle => ({ ...bottle, at:Date.parse(bottle.start) })).filter(bottle => bottle.at >= from && bottle.at < to);
  const ounces = dayBottles.map(bottle => toOunces(bottle.amount, bottle.units));
  const dayDiapers = Array.isArray(diapers) ? diapers.filter(item => { const at = Date.parse(item.start); return at >= from && at < to; }) : null;
  const minutes = (a, b) => Math.round((b - a) / MINUTE);
  return {
    key, wake:wake && new Date(wake).toISOString(), bedtime:bed && new Date(bed).toISOString(),
    naps:{ count:naps.length, minutes:naps.reduce((sum, nap) => sum + minutes(nap.start, nap.end), 0), longest:longest && { minutes:minutes(longest.start, longest.end), start:new Date(longest.start).toISOString() } },
    overnight:night.length ? { minutes:night.reduce((sum, sleep) => sum + minutes(sleep.start, sleep.end), 0), woke:new Date(night.at(-1).end).toISOString() } : null,
    bottles:{ count:dayBottles.length, ounces:Math.round(ounces.reduce((a, b) => a + b, 0) * 10) / 10, largest:ounces.length ? Math.round(Math.max(...ounces) * 10) / 10 : 0 },
    diapers:dayDiapers && { count:dayDiapers.length, wet:dayDiapers.filter(item => ['pee', 'both'].includes(item.mode)).length, dirty:dayDiapers.filter(item => ['poo', 'both'].includes(item.mode)).length }
  };
}
