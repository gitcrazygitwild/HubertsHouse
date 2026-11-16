import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { CalDAV, CalendarError, resourceToken, appleURL } from './caldav.js';
import { readEvents, writeEvent, canDelete } from './ical.js';
import { encryptCredential, decryptCredential } from './crypto.js';
import { HuckleberryError } from './huckleberry-provider.js';
import { createHuckleberryHandler } from './huckleberry-service.js';
initializeApp();
const db = getFirestore();
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
  return {events,checkedAt:new Date().toISOString()};
});
export const calendarSave = endpoint(async (uid,input) => {
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
  return {saved:true,token};
});
export const calendarDelete = endpoint(async (uid,input) => {
  const {data,client} = await connection(uid); const calendar = calendarFor(data,input.calendarId);
  const current = await client.read(calendar,input.token);
  if (!input.etag || current.etag !== input.etag) throw new CalendarError('aborted','This event changed in Apple Calendar. Refresh before deleting it.');
  canDelete(current.data); await client.remove(calendar,input.token,input.etag); return {deleted:true};
});
