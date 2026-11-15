// FullCalendar event ends are exclusive. Date-only values are local dates,
// and day boundaries follow the local clock, including daylight-saving days.
export function localDate(value) {
  return new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
}
export function startOfDay(value) { const date = localDate(value); date.setHours(0, 0, 0, 0); return date; }
export function nextDay(value) { const date = startOfDay(value); date.setDate(date.getDate() + 1); return date; }
export function eventEnd(event) {
  if (event.end) return localDate(event.end);
  return event.allDay ? nextDay(event.start) : new Date(localDate(event.start).getTime() + 3600000);
}
export function eventsOnDay(events, day) {
  const start = startOfDay(day), end = nextDay(day);
  return events.filter(event => localDate(event.start) < end && eventEnd(event) > start)
    .sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || localDate(a.start) - localDate(b.start));
}
export function checklistProgress(items = []) {
  const meaningful = (Array.isArray(items) ? items : []).filter(item => String(item?.text || '').trim());
  return { total: meaningful.length, done: meaningful.filter(item => item.done).length };
}
