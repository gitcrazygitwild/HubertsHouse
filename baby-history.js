// Turns Huckleberry history into per-day rows for Frankie's charts. All day
// boundaries are local midnights in the baby's time zone, including DST days.
const DAY = 86400000, MINUTE = 60000, OZ_PER_ML = 1 / 29.5735;
export const toOunces = (amount, units) => units === 'ml' ? amount * OZ_PER_ML : amount;

function offsetMinutes(stamp, timezone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone:timezone, timeZoneName:'longOffset' }).formatToParts(new Date(stamp)).find(part => part.type === 'timeZoneName').value;
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}
export function localDay(stamp, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(stamp));
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
const hourAt = (stamp, timezone) => Number(new Intl.DateTimeFormat('en-US', { timeZone:timezone, hour:'numeric', hourCycle:'h23' }).format(new Date(stamp)));
// Same rule as Mia's forecast: a daytime sleep under four hours is a nap.
export const sleepKind = (sleep, timezone) => { const hour = hourAt(sleep.start, timezone); return hour >= 5 && hour < 19 && sleep.end - sleep.start < 4 * 3600000 ? 'nap' : 'night'; };

function intervals(sleeps) {
  return sleeps.map(sleep => ({ start:Date.parse(sleep.start), end:Date.parse(sleep.end) })).filter(s => Number.isFinite(s.start) && s.end > s.start).sort((a,b) => a.start - b.start);
}
export function dailySleep(sleeps, timezone, days, now = Date.now()) {
  const list = intervals(sleeps).map(sleep => ({ ...sleep, kind:sleepKind(sleep, timezone) }));
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
  const list = intervals(sleeps).map(sleep => ({ ...sleep, kind:sleepKind(sleep, timezone) }));
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
