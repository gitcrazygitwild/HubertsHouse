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
    const samePerson = (draft.withFrankie && props.withFrankie) || owner === 'both' || draft.owner === 'both' || (owner === draft.owner && (owner !== 'custom' || props.ownerCustom === draft.ownerCustom));
    return samePerson && localDate(event.start) < end && eventEnd(event) > start;
  }).sort((a, b) => localDate(a.start) - localDate(b.start));
}

export function preferredCalendar(saved, calendars) {
  return calendars.some(calendar => calendar.id === saved && calendar.writable && calendar.selected) ? saved : 'household';
}

// Potential clashes in the next seven local calendar days. All-day reminders are excluded.
export function calendarClashes(events, now = new Date()) {
  const until=new Date(now);until.setDate(until.getDate()+7);until.setHours(0,0,0,0);
  const upcoming=events.filter(event=>!event.allDay&&localDate(event.start)<until&&eventEnd(event)>now).sort((a,b)=>localDate(a.start)-localDate(b.start));
  const clashes=[];
  for(let i=0;i<upcoming.length;i++)for(let j=i+1;j<upcoming.length;j++){
    const a=upcoming[i],b=upcoming[j],ap=a.extendedProps||{},bp=b.extendedProps||{};
    if(localDate(b.start)>=eventEnd(a))break;
    if((ap.sourceId||a.id)===(bp.sourceId||b.id)&&+localDate(a.start)===+localDate(b.start))continue;
    const ao=ap.owner||'both',bo=bp.owner||'both';
    const shared=(ap.withFrankie&&bp.withFrankie)||ao==='both'||bo==='both'||(ao===bo&&(ao!=='custom'||ap.ownerCustom===bp.ownerCustom));
    if(shared)clashes.push({a,b});
  }
  return clashes;
}
