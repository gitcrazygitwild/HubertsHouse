// Small "smart calendar" helpers shared by the Now & Next strip, weather flags
// and the cat crew tracker. Pure functions; the UI lives in upgrades.js.
import { dateKey } from './household-model.js';

const OUTDOOR = /\b(park|outside|outdoors?|walk|hike|hiking|picnic|zoo|beach|bbq|barbecue|cookout|market|farmers|garden|playground|pool|swim|golf|game|stadium|run|race|5k|bike|biking|fair|festival|patio|lake|river|camp|camping|parade|tailgate|pumpkin|apple picking|fresh air)\b/i;
export const isOutdoor = title => OUTDOOR.test(String(title || ''));
const start = event => new Date(event.start);
const end = event => event.end ? new Date(event.end) : new Date(+start(event) + (event.allDay ? 86400000 : 3600000));

// Outdoor plans on days with a meaningful chance of rain in the forecast.
export function weatherFlags(events = [], days = [], now = new Date(), threshold = 40) {
  const byDate = new Map(days.map(day => [day.date, day]));
  const seen = new Set(), flags = [];
  for (const event of events) {
    if (!isOutdoor(event.title) || end(event) <= now) continue;
    const key = dateKey(start(event)), day = byDate.get(key);
    if (!day) continue;
    const wet = (day.rain ?? 0) >= threshold || ['rain', 'storm', 'snow'].includes(day.kind);
    const id = `${event.extendedProps?.sourceId || event.id}:${key}`;
    if (!wet || seen.has(id)) continue;
    seen.add(id);
    flags.push({ id:event.extendedProps?.sourceId || event.id, title:event.title, start:start(event).toISOString(), date:key, rain:day.rain == null ? null : Math.round(day.rain), label:day.label || 'Rain likely', kind:day.kind });
  }
  return flags.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// The plan happening now (if any) and the next one after it.
export function nextUp(events = [], now = new Date()) {
  const timed = events.filter(event => !event.allDay).map(event => ({ event, from:start(event), to:end(event) }))
    .filter(item => item.to > now && +item.from - +now < 7 * 86400000).sort((a, b) => a.from - b.from);
  const current = timed.find(item => item.from <= now) || null, upcoming = timed.find(item => item.from > now) || null;
  return { current:current && { ...current, minutesLeft:Math.round((current.to - now) / 60000) }, next:upcoming && { ...upcoming, minutesUntil:Math.round((upcoming.from - now) / 60000) } };
}
export function untilText(minutes) {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return `in ${hours}h${rest ? ` ${rest}m` : ''}`;
  const days = Math.round(minutes / 1440); return `in ${days} day${days === 1 ? '' : 's'}`;
}

export const CATS = ['Hubert', 'Mack', 'Mia'];
export const CAT_TASKS = [
  ...CATS.flatMap(cat => [{ key:`${cat.toLowerCase()}_am`, cat, label:'Breakfast', short:'AM' }, { key:`${cat.toLowerCase()}_pm`, cat, label:'Dinner', short:'PM' }]),
  { key:'litter', label:'Litter scooped', icon:'🧹' }, { key:'water', label:'Fresh water', icon:'💧' }
];
export function catCareStatus(record = {}, now = new Date()) {
  const done = CAT_TASKS.filter(task => record[task.key]).length, hour = now.getHours();
  const hungry = CATS.filter(cat => (hour >= 6 && !record[`${cat.toLowerCase()}_am`]) || (hour >= 17 && !record[`${cat.toLowerCase()}_pm`]));
  return { done, total:CAT_TASKS.length, hungry, complete:done === CAT_TASKS.length };
}
