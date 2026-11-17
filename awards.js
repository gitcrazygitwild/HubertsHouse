// Frankie's Weekly Awards: playful superlatives from the last seven full days.
import { dailySleep, dailyBottles, dayKeys, dayStart, localDay, sleepKind, nightLine, toOunces } from './baby-history.js';

const MINUTE = 60000;
const hm = minutes => { const m = Math.round(minutes); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const clock = (stamp, timezone) => new Date(stamp).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone:timezone });
const weekday = (key, timezone) => new Date(dayStart(key, timezone) + 12 * 3600000).toLocaleDateString('en-US', { weekday:'long', timeZone:timezone });

export function frankieAwards({ sleeps = [], bottles = [] } = {}, timezone = 'America/New_York', now = Date.now()) {
  const keys = dayKeys(8, timezone, now).slice(0, 7), first = dayStart(keys[0], timezone), last = dayStart(dayKeys(1, timezone, now)[0], timezone);
  const inWeek = stamp => stamp >= first && stamp < last;
  const list = sleeps.map(s => ({ start:Date.parse(s.start), end:Date.parse(s.end) })).filter(s => s.end > s.start && inWeek(s.start));
  const line = nightLine(sleeps, timezone, now);
  const naps = list.filter(s => sleepKind(s, timezone, line) === 'nap'), nights = list.filter(s => sleepKind(s, timezone, line) === 'night');
  const awards = [];
  const longestNap = naps.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (longestNap) awards.push({ icon:'🏆', title:'Nap of the Week', value:hm((longestNap.end - longestNap.start) / MINUTE), detail:`${weekday(localDay(longestNap.start, timezone), timezone)} at ${clock(longestNap.start, timezone)}` });
  const longestStretch = [...list].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (longestStretch && (longestStretch.end - longestStretch.start) >= 3 * 3600000) awards.push({ icon:'🌙', title:'Longest Stretch', value:hm((longestStretch.end - longestStretch.start) / MINUTE), detail:`${clock(longestStretch.start, timezone)} – ${clock(longestStretch.end, timezone)}` });
  // Early Bird: each day's final morning wake-up (a night sleep ending 4am–noon), earliest wins.
  const minutesOfDay = stamp => { const [h, m] = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:timezone }).format(stamp).split(':').map(Number); return h * 60 + m; };
  const wakeByDay = new Map();
  for (const sleep of nights) {
    const minute = minutesOfDay(sleep.end), key = localDay(sleep.end, timezone);
    if (minute < 240 || minute >= 720 || !inWeek(sleep.end)) continue;
    if (!wakeByDay.has(key) || sleep.end > wakeByDay.get(key)) wakeByDay.set(key, sleep.end);
  }
  const early = [...wakeByDay.values()].sort((a, b) => minutesOfDay(a) - minutesOfDay(b))[0];
  if (early) awards.push({ icon:'🐓', title:'Early Bird', value:clock(early, timezone), detail:`${weekday(localDay(early, timezone), timezone)}’s wake-up` });
  const bottleDays = dailyBottles(bottles, timezone, 8, now).slice(0, 7).filter(d => d.count);
  const thirsty = [...bottleDays].sort((a, b) => b.ounces - a.ounces)[0];
  if (thirsty) awards.push({ icon:'🍼', title:'Thirstiest Day', value:`${thirsty.ounces} oz`, detail:`${weekday(thirsty.key, timezone)} · ${thirsty.count} bottles` });
  const biggest = bottles.map(b => ({ stamp:Date.parse(b.start), oz:toOunces(b.amount, b.units) })).filter(b => inWeek(b.stamp)).sort((a, b) => b.oz - a.oz)[0];
  if (biggest) awards.push({ icon:'💪', title:'Big Gulp', value:`${Math.round(biggest.oz * 10) / 10} oz`, detail:`${weekday(localDay(biggest.stamp, timezone), timezone)} at ${clock(biggest.stamp, timezone)}` });
  const sleepDays = dailySleep(sleeps, timezone, 8, now).slice(0, 7).filter(d => d.total > 0);
  const napQueen = [...sleepDays].sort((a, b) => b.naps - a.naps || b.nap - a.nap)[0];
  if (napQueen?.naps) awards.push({ icon:'👑', title:'Nap Queen', value:`${napQueen.naps} naps`, detail:`${weekday(napQueen.key, timezone)} · ${hm(napQueen.nap * 60)} of naps` });
  const totalOz = bottleDays.reduce((sum, d) => sum + d.ounces, 0);
  if (totalOz) awards.push({ icon:'🥛', title:'Milk Mileage', value:`${Math.round(totalOz)} oz`, detail:`about ${Math.round(totalOz / 33.8 * 10) / 10} liters this week` });
  return { from:keys[0], to:keys.at(-1), awards };
}
