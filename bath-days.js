// Frankie's bath days: which weekdays are bath nights (a household setting, stored in
// householdSettings/home as bathDays: [0–6], Sunday = 0), and where they show up:
// the calendar, Today and the morning email. No imports, so the newsletter can share it.
export const DEFAULT_BATH_DAYS = [0, 3]; // Sunday and Wednesday
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');
const key = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const BATH_TITLE = '🛁 Bath night';

// Weekday numbers 0–6, unique, in week order. Anything else is dropped.
export function cleanBathDays(value) {
  return Array.isArray(value) ? [...new Set(value.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : null;
}
let days = [...DEFAULT_BATH_DAYS];
export const bathDays = () => days;
// null/undefined (never set) means the default; an empty list means "no bath days".
export function setBathDays(value) { days = value == null ? [...DEFAULT_BATH_DAYS] : cleanBathDays(value) ?? [...DEFAULT_BATH_DAYS]; return days; }

export const isBathDay = (date = new Date(), list = days) => list.includes(new Date(date).getDay());
// "Wednesdays and Sundays", in the order the week runs from Monday.
export function describeBathDays(list = days) {
  if (!list.length) return 'No bath days set';
  if (list.length === 7) return 'Every day';
  const names = [...list].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => `${WEEKDAYS[d]}s`);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
// Every bath day in [start, end).
export function bathDaysInRange(start, end, list = days) {
  const out = [], day = new Date(start); day.setHours(12, 0, 0, 0);
  const stop = new Date(end);
  if (new Date(start).getHours() > 12) day.setDate(day.getDate() + 1);
  for (let guard = 0; day < stop && guard < 800; guard++, day.setDate(day.getDate() + 1)) if (list.includes(day.getDay())) out.push({ date:key(day), title:BATH_TITLE });
  return out;
}
// All-day calendar markers, drawn like holidays: not editable, not filtered by owner.
export function bathEvents(start, end, list = days) {
  return bathDaysInRange(start, end, list).map(b => {
    const next = new Date(`${b.date}T12:00:00`); next.setDate(next.getDate() + 1);
    return { id:`bath:${b.date}`, title:b.title, start:b.date, end:key(next), allDay:true, editable:false, startEditable:false, durationEditable:false, extendedProps:{ holiday:true, bath:true } };
  });
}
// The next bath day from `now` (today counts): { date, label: 'Tonight' | 'Tomorrow' | 'Sunday' }.
export function nextBathDay(now = new Date(), list = days) {
  if (!list.length) return null;
  const day = new Date(now); day.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++, day.setDate(day.getDate() + 1)) if (list.includes(day.getDay())) return { date:key(day), label:i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow' : WEEKDAYS[day.getDay()] };
  return null;
}
