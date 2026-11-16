import ICAL from 'ical.js';
import { CalendarError } from './caldav.js';
const utc = value => ICAL.Time.fromJSDate(new Date(value), true);
function calendarDocument(data) {
  try { const component = new ICAL.Component(ICAL.parse(data)); if (component.name !== 'vcalendar') throw new Error(); return component; }
  catch { throw new CalendarError('data-loss', 'An iCloud event could not be read.'); }
}
function hasScheduling(component) { return component.hasProperty('attendee') || component.hasProperty('organizer'); }
function localDate(time) { return time.toString().slice(0,10); }
function outputDate(time) { return time.isDate ? `${localDate(time)}T00:00:00` : time.zone?.tzid === 'floating' ? time.toString() : time.toJSDate().toISOString(); }
export function readEvents(object, calendar, start, end) {
  const root = calendarDocument(object.data);
  const components = root.getAllSubcomponents('vevent');
  const masters = components.filter(c => !c.hasProperty('recurrence-id'));
  const records = [];
  const add = (event, occurrence, recurring) => {
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const s = occurrence.startDate, e = occurrence.endDate;
    if (!s || s.toJSDate() >= new Date(end) || (e || s).toJSDate() < new Date(start)) return;
    const exceptions = components.some(c => c.hasProperty('recurrence-id'));
    // Whole-series edits with exceptions and meeting invitations need scheduling semantics.
    // Keep these view-only instead of discarding exceptions or emailing attendees accidentally.
    const readOnlyReason = !calendar.writable ? 'This calendar is read-only.' : hasScheduling(event.component) ? 'Edit invitations in Apple Calendar.' : recurring || exceptions ? 'Edit recurring events in Apple Calendar; all occurrences stay visible here.' : !object.etag ? 'Refresh this event before editing.' : '';
    records.push({
      id:`icloud:${calendar.id}:${object.token}:${s.toString()}`, title:event.summary || '(Untitled)',
      start:outputDate(s), end:outputDate(e), allDay:s.isDate, notes:event.description || '',
      calendarId:calendar.id, calendarName:calendar.name, token:object.token, etag:object.etag || null,
      owner:['hanry','karena','both','custom'].includes(event.component.getFirstPropertyValue('x-huberts-owner')) ? event.component.getFirstPropertyValue('x-huberts-owner') : 'both',
      ownerCustom:String(event.component.getFirstPropertyValue('x-huberts-owner-name') || ''),
      withFrankie:event.component.getFirstPropertyValue('x-huberts-frankie') === 'TRUE' && ['hanry','karena','both'].includes(event.component.getFirstPropertyValue('x-huberts-owner') || 'both'),
      color:calendar.color, uid:event.uid, recurring, readOnlyReason, icloud:true,
      // The existing household editor uses inclusive all-day ends.
      editEnd:s.isDate ? (() => { const last = e.clone(); last.adjust(-1,0,0,0); return `${localDate(last)}T00:00:00`; })() : outputDate(e)
    });
  };
  for (const component of masters) {
    const event = new ICAL.Event(component);
    if (!event.startDate) continue;
    if (event.isRecurring()) {
      const iter = event.iterator(); let next, n = 0;
      while ((next = iter.next())) {
        if (++n > 50000) throw new CalendarError('resource-exhausted', 'A recurring event is too large to expand. Narrow the calendar selection.');
        if (next.toJSDate() >= new Date(end)) break;
        const occurrence = event.getOccurrenceDetails(next); add(occurrence.item, occurrence, true);
        if (records.length > 3000) throw new CalendarError('resource-exhausted', 'Too many events in this date range.');
      }
      // Moved exceptions may fall inside the window even if their original date is outside it.
      for (const exception of components.filter(c => c.hasProperty('recurrence-id') && c.getFirstPropertyValue('uid') === event.uid)) {
        const ex = new ICAL.Event(exception);
        if (!records.some(r => r.uid === ex.uid && r.start === outputDate(ex.startDate))) add(ex, {startDate:ex.startDate,endDate:ex.endDate}, true);
      }
    } else add(event, {startDate:event.startDate,endDate:event.endDate}, false);
  }
  return records;
}
export function writeEvent(payload, existing, uid, now = new Date()) {
  if (!payload || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 500) throw new CalendarError('invalid-argument','Give this event a title under 500 characters.');
  if (typeof payload.notes !== 'string' || payload.notes.length > 20000) throw new CalendarError('invalid-argument','The event notes are too long.');
  if (payload.repeat && payload.repeat !== 'none') throw new CalendarError('failed-precondition','Create repeating iCloud events in Apple Calendar.');
  let root = existing ? calendarDocument(existing) : new ICAL.Component(['vcalendar',[],[]]);
  const components = root.getAllSubcomponents('vevent');
  if (existing && (components.length !== 1 || components[0].hasProperty('rrule') || components[0].hasProperty('rdate') || hasScheduling(components[0]))) throw new CalendarError('failed-precondition','Edit recurring events and invitations in Apple Calendar.');
  if (!existing) { root.addPropertyWithValue('version','2.0'); root.addPropertyWithValue('prodid','-//Huberts House//Household Calendar//EN'); }
  const component = components[0] || new ICAL.Component('vevent'); if (!existing) root.addSubcomponent(component);
  const event = new ICAL.Event(component);
  let start, end;
  if (payload.allDay) {
    const day = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || isNaN(new Date(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) throw new CalendarError('invalid-argument','Choose a valid all-day date.');
      return ICAL.Time.fromDateString(value);
    };
    start = day(payload.startDate); end = day(payload.endDate || payload.startDate);
    if (end.compare(start) < 0) throw new CalendarError('invalid-argument','The end must be after the start.');
    end.adjust(1,0,0,0);
  } else {
    if (!Number.isFinite(Date.parse(payload.start)) || !Number.isFinite(Date.parse(payload.end)) || new Date(payload.end) <= new Date(payload.start)) throw new CalendarError('invalid-argument','The end must be after the start.');
    start = utc(payload.start); end = utc(payload.end);
    // Preserve the original timezone (and its VTIMEZONE) when editing an imported event.
    const zone = existing && event.startDate?.zone;
    if (zone && !['floating','UTC'].includes(zone.tzid)) { start = start.convertToZone(zone); end = end.convertToZone(zone); }
    if (zone?.tzid === 'floating' && !event.startDate.isDate) {
      const local = value => {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new CalendarError('invalid-argument','Choose a valid local event time.');
        return ICAL.Time.fromString(`${value}:00`);
      };
      start = local(payload.startLocal); end = local(payload.endLocal);
      if (end.compare(start) <= 0) throw new CalendarError('invalid-argument','The end must be after the start.');
    }
  }
  event.uid = event.uid || uid; event.summary = payload.title.trim(); event.description = payload.notes;
  if (payload.owner !== undefined) {
    if (!['hanry','karena','both','custom'].includes(payload.owner) || (payload.withFrankie && !['hanry','karena','both'].includes(payload.owner))) throw new CalendarError('invalid-argument','Frankie must be with hanry, Karena, or both.');
    component.updatePropertyWithValue('x-huberts-owner', payload.owner);
    component.updatePropertyWithValue('x-huberts-owner-name', String(payload.ownerCustom || '').slice(0,100));
    component.updatePropertyWithValue('x-huberts-frankie', payload.withFrankie ? 'TRUE' : 'FALSE');
  }
  component.removeAllProperties('duration');
  event.startDate = start; event.endDate = end;
  component.updatePropertyWithValue('dtstamp', utc(now)); component.updatePropertyWithValue('last-modified',utc(now));
  component.updatePropertyWithValue('sequence',Number(component.getFirstPropertyValue('sequence') || 0) + 1);
  if (!existing) component.addPropertyWithValue('created',utc(now));
  return root.toString();
}
export function canDelete(data) {
  const components = calendarDocument(data).getAllSubcomponents('vevent');
  if (components.length !== 1 || components.some(c => c.hasProperty('rrule') || c.hasProperty('rdate') || hasScheduling(c))) throw new CalendarError('failed-precondition','Delete recurring events and invitations in Apple Calendar.');
}
