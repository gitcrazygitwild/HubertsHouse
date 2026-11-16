import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { CalDAV, CalendarError, resourceToken, appleURL } from './caldav.js';
import { readEvents, writeEvent, canDelete, eventUID } from './ical.js';
import { createAssignmentStore, validateAssignment, assignmentKey } from './calendar-assignments.js';
import { encryptCredential, decryptCredential } from './crypto.js';
import { HuckleberryError } from './huckleberry-provider.js';
import { createHuckleberryHandler } from './huckleberry-service.js';
initializeApp();
const db = getFirestore();
const assignments = createAssignmentStore(db);
const encryptionKey = defineSecret('CALENDAR_ENCRYPTION_KEY');
const options = { region:'us-central1', secrets:[encryptionKey], timeoutSeconds:120, memory:'256MiB', cpu:'gcf_gen1', concurrency:1, minInstances:0, maxInstances:1, cors:true };
const publicCalendars = calendars => calendars.map(({url,...calendar}) => calendar);
function endpoint(handler) {
  return onCall(options, async request => {
    if (!request.auth) throw new HttpsError('unauthenticated','Sign in to your household first.');
    const member = await db.doc(`households/home/members/${request.auth.uid}`).get();
    if (!member.exists || member.data().active !== true) throw new HttpsError('permission-denied','This account is not a member of the household.');
    try { return await handler(request.auth.uid,request.data || {}); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof CalendarError || error instanceof HuckleberryError) throw new HttpsError(error.code,error.message);
      // Never log request bodies, credentials, calendar data, or raw provider errors.
      throw new HttpsError('unavailable','The connected service is temporarily unavailable. Try again shortly.');
    }
  });
}
export const huckleberry = endpoint(createHuckleberryHandler({db,key:() => encryptionKey.value()}));
const connectionRef = uid => db.doc(`privateCalendarConnections/${uid}`);
async function connection(uid) {
  const snap = await connectionRef(uid).get(); if (!snap.exists) throw new CalendarError('failed-precondition','Connect your iCloud account first.');
  const data = snap.data();
  return { data, client:new CalDAV(decryptCredential(data.credential,encryptionKey.value(),uid)) };
}
function calendarFor(data,id) {
  const calendar = data.calendars.find(c => c.id === id);
  if (!calendar || !data.selected.includes(id)) throw new CalendarError('permission-denied','Choose a connected calendar.');
  return calendar;
}
function checklistContext(input,calendar,token,uid) {
  if(!input)return undefined; // Older clients can still change an owner.
  if(typeof input.title!=='string' || input.title.length>500 || typeof input.start!=='string' || isNaN(new Date(input.start)) || (input.end && (typeof input.end!=='string' || isNaN(new Date(input.end))))) throw new CalendarError('invalid-argument','Refresh the event before saving its checklist.');
  return {id:`icloud-checklist:${assignmentKey(calendar.id,uid)}`,title:input.title,start:input.start,end:input.end || null,allDay:!!input.allDay,recurring:!!input.recurring,calendarName:calendar.name || 'Apple Calendar',token};
}
export const calendarStatus = endpoint(async uid => {
  const snap = await connectionRef(uid).get(); if (!snap.exists) return {connected:false};
  const data = snap.data();
  return {connected:true,calendars:publicCalendars(data.calendars),selected:data.selected};
});
export const calendarConnect = endpoint(async (uid,input) => {
  const username = String(input.email || '').trim(); const password = String(input.password || '').trim();
  if (!/^[^\s:@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 254 || !/^[a-z]{4}(?:-[a-z]{4}){3}$/i.test(password)) throw new CalendarError('invalid-argument','Enter your Apple Account email and an app-specific password (xxxx-xxxx-xxxx-xxxx).');
  const client = new CalDAV({username,password});
  const calendars = await client.discover();
  const previous = await connectionRef(uid).get();
  const selected = previous.exists ? (previous.data().selected || []).filter(id => calendars.some(c => c.id === id)).slice(0,6) : [];
  await connectionRef(uid).set({credential:encryptCredential({username,password},encryptionKey.value(),uid),calendars,selected,updatedAt:FieldValue.serverTimestamp()});
  return {connected:true,calendars:publicCalendars(calendars),selected};
});
export const calendarSelect = endpoint(async (uid,input) => {
  const {data} = await connection(uid);
  if (!Array.isArray(input.selected) || input.selected.length > 6 || !input.selected.every(id => data.calendars.some(c => c.id === id))) throw new CalendarError('invalid-argument','Choose up to six calendars from this account.');
  const selected = [...new Set(input.selected)]; await connectionRef(uid).update({selected});
  return {connected:true,calendars:publicCalendars(data.calendars),selected};
});
export const calendarDisconnect = endpoint(async uid => { await connectionRef(uid).delete(); return {connected:false}; });
export const calendarEvents = endpoint(async (uid,input) => {
  const start = new Date(input.start), end = new Date(input.end);
  if (isNaN(start) || isNaN(end) || end <= start || end - start > 125 * 86400000) throw new CalendarError('invalid-argument','Choose a date range of up to four months.');
  const {data,client} = await connection(uid);
  const grouped = await Promise.all(data.selected.map(async id => {
    const calendar = calendarFor(data,id); const objects = await client.events(calendar,start,end);
    return objects.flatMap(object => readEvents(object,calendar,start,end));
  }));
  const events = grouped.flat(); if (events.length > 5000) throw new CalendarError('resource-exhausted','Too many events in this range. Select fewer calendars.');
  const [assigned,checklists]=await Promise.all([assignments.apply(events),assignments.lists(data.selected)]);
  return {events:assigned,checklists,checkedAt:new Date().toISOString()};
});
export const calendarAssign = endpoint(async (uid,input) => {
  const assignment=validateAssignment(input.assignment);
  const {data,client}=await connection(uid),calendar=calendarFor(data,input.calendarId);
  // Even a read-only Apple resource can have a household-only assignment.
  const current=await client.read(calendar,input.token),identity=eventUID(current.data);
  if (input.uid!==identity) throw new CalendarError('aborted','This Apple event changed. Refresh before assigning it.');
  return {saved:true,assignment:await assignments.save(calendar.id,identity,assignment,input.assignmentVersion,checklistContext(input.context,calendar,input.token,identity))};
});
export const calendarSave = endpoint(async (uid,input) => {
  const assignment=input.event?.owner === undefined ? null : validateAssignment(input.event);
  if(assignment && (!Number.isSafeInteger(input.assignmentVersion ?? 0) || (input.assignmentVersion ?? 0)<0)) throw new CalendarError('invalid-argument','Refresh the household assignment before saving.');
  const {data,client} = await connection(uid); const calendar = calendarFor(data,input.calendarId);
  if (!calendar.writable) throw new CalendarError('permission-denied','This calendar is read-only.');
  let token = input.token, existing;
  if (token) {
    existing = await client.read(calendar,token);
    if (!input.etag || existing.etag !== input.etag) throw new CalendarError('aborted','This event changed in Apple Calendar. Refresh, reopen it, and try again.');
  } else {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId || '')) throw new CalendarError('invalid-argument','Reopen the event editor and try again.');
    token = resourceToken(appleURL(`${calendar.url.replace(/\/?$/, '/')}${input.requestId}.ics`));
  }
  const body = writeEvent(input.event,existing?.data,`${input.requestId}@huberts.house`);
  await client.put(calendar,token,body,input.etag,!existing);
  if (assignment) {
    try { await assignments.save(calendar.id,eventUID(body),assignment,input.assignmentVersion ?? 0,checklistContext({title:input.event.title,start:input.event.allDay ? input.event.startDate+'T00:00:00' : input.event.start,end:input.event.allDay ? input.event.endDate+'T00:00:00' : input.event.end,allDay:input.event.allDay},calendar,token,eventUID(body))); }
    catch { return {saved:true,token,uid:eventUID(body),assignmentSaved:false,warning:'The event was saved to Apple Calendar. Your people and checklist changes are still in this editor; save again to finish them without creating another Apple event.'}; }
  }
  return {saved:true,token,uid:eventUID(body)};
});
export const calendarDelete = endpoint(async (uid,input) => {
  const {data,client} = await connection(uid); const calendar = calendarFor(data,input.calendarId);
  const current = await client.read(calendar,input.token);
  if (!input.etag || current.etag !== input.etag) throw new CalendarError('aborted','This event changed in Apple Calendar. Refresh before deleting it.');
  canDelete(current.data); await client.remove(calendar,input.token,input.etag);
  try { await assignments.remove(calendar.id,eventUID(current.data)); } catch { /* Deletion at Apple already succeeded. */ }
  return {deleted:true};
});
