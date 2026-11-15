import { localDate, eventEnd, nextDay } from './calendar-model.js';

// Editor all-day ends include the last day; rendered calendar ends exclude it.
export function overlappingEvents(draft, events) {
  const start = localDate(draft.start);
  const end = draft.allDay ? nextDay(draft.end || draft.start) : draft.end ? localDate(draft.end) : new Date(+start + 3600000);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) return [];
  return events.filter(event => {
    const props = event.extendedProps || {};
    if ((props.sourceId || event.id) === draft.id) return false;
    const owner = props.owner || 'both';
    const samePerson = owner === 'both' || draft.owner === 'both' || (owner === draft.owner && (owner !== 'custom' || props.ownerCustom === draft.ownerCustom));
    return samePerson && localDate(event.start) < end && eventEnd(event) > start;
  }).sort((a, b) => localDate(a.start) - localDate(b.start));
}

export function preferredCalendar(saved, calendars) {
  return calendars.some(calendar => calendar.id === saved && calendar.writable && calendar.selected) ? saved : 'household';
}
