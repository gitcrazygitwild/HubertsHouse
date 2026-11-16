// "Find us a free night": evenings in the next two weeks with nothing planned
// for hanry, Karena or both (5–10pm), weekends first.
const DAY = 86400000;
const startOf = date => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const eventStart = event => new Date(event.start);
const eventEnd = event => event.end ? new Date(event.end) : new Date(+eventStart(event) + (event.allDay ? DAY : 3600000));
const forAdults = event => ['hanry', 'karena', 'both', undefined, null, ''].includes(event.extendedProps?.owner ?? event.owner);

export function freeEvenings(events = [], now = new Date(), days = 14, limit = 3) {
  const results = [];
  for (let i = 0; i < days; i++) {
    const day = startOf(now); day.setDate(day.getDate() + i);
    const from = new Date(day), to = new Date(day); from.setHours(17, 0, 0, 0); to.setHours(22, 0, 0, 0);
    if (to <= now) continue;
    const busy = events.some(event => forAdults(event) && eventStart(event) < to && eventEnd(event) > from);
    if (busy) continue;
    const weekday = day.getDay(), score = (weekday === 5 || weekday === 6 ? 0 : weekday === 0 || weekday === 4 ? 1 : 2) * 100 + i;
    results.push({ date:day, score, weekend:weekday === 5 || weekday === 6 });
  }
  return results.sort((a, b) => a.score - b.score).slice(0, limit).sort((a, b) => a.date - b.date);
}
// An editable date-night draft for that evening (nothing saves until the editor does).
export function dateNightDraft(date) {
  const start = new Date(date); start.setHours(19, 0, 0, 0);
  return { mode:'create', title:'Date night', start, end:new Date(+start + 2 * 3600000), allDay:false, owner:'both', type:'general', repeat:'none', notes:'', checklist:[{ text:'Book a sitter', done:false }, { text:'Pick the place', done:false }] };
}
