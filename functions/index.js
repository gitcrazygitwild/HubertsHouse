import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { warn, info } from 'firebase-functions/logger';
import { CalDAV, CalendarError, resourceToken, appleURL } from './caldav.js';
import { readEvents, writeEvent, canDelete, eventUID } from './ical.js';
import { createAssignmentStore, validateAssignment, assignmentKey } from './calendar-assignments.js';
import { resolveCalendarConnection, sharedView, sharesWithHousehold } from './calendar-share.js';
import { encryptCredential, decryptCredential } from './crypto.js';
import { HuckleberryError } from './huckleberry-provider.js';
import { createHuckleberryHandler } from './huckleberry-service.js';
import { createSmartHome, SmartHomeError } from './smart-home.js';
import { createLitterRobot, LitterRobotError } from './litter-robot.js';
import { createPetLibro, PetLibroError } from './petlibro.js';
initializeApp();
const db = getFirestore();
const assignments = createAssignmentStore(db);
const encryptionKey = defineSecret('CALENDAR_ENCRYPTION_KEY');
const options = { region:'us-central1', secrets:[encryptionKey], timeoutSeconds:120, memory:'256MiB', cpu:'gcf_gen1', concurrency:1, minInstances:0, maxInstances:1, cors:true };
const publicCalendars = calendars => calendars.map(({url,...calendar}) => calendar);
function endpoint(handler, extra = {}) {
  return onCall({ ...options, ...extra }, async request => {
    if (!request.auth) throw new HttpsError('unauthenticated','Sign in to your household first.');
    const member = await db.doc(`households/home/members/${request.auth.uid}`).get();
    if (!member.exists || member.data().active !== true) throw new HttpsError('permission-denied','This account is not a member of the household.');
    try { return await handler(request.auth.uid,request.data || {}); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      if(error instanceof HuckleberryError && error.details?.service==='huckleberry') warn('Huckleberry request rejected',{operation:error.details.operation || 'authentication',reason:error.details.reason,...(error.details.httpStatus !== undefined ? {httpStatus:error.details.httpStatus} : {}),...(error.details.grpcCode !== undefined ? {grpcCode:error.details.grpcCode} : {})});
      if (error instanceof CalendarError || error instanceof HuckleberryError || error instanceof NewsletterError || error instanceof SmartHomeError || error instanceof LitterRobotError || error instanceof PetLibroError) throw new HttpsError(error.code,error.message,error instanceof HuckleberryError ? error.details : undefined);
      // Never log request bodies, credentials, calendar data, or raw provider errors.
      throw new HttpsError('unavailable','The connected service is temporarily unavailable. Try again shortly.');
    }
  });
}
export const huckleberry = endpoint(createHuckleberryHandler({db,key:() => encryptionKey.value()}));
const connectionRef = uid => db.doc(`privateCalendarConnections/${uid}`);
// Your own Apple connection, or the one another member shares with the household.
async function connection(uid) {
  const { ownerUid, data, shared } = await resolveCalendarConnection({ db, uid, members:activeMembers });
  return { data, shared, client:new CalDAV(decryptCredential(data.credential,encryptionKey.value(),ownerUid)) };
}
const ownerOnly = () => new CalendarError('permission-denied','Only the household member who connected Apple Calendar can change it. Connect your own Apple account to manage one.');
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
  const snap = await connectionRef(uid).get();
  if (snap.exists) { const data = snap.data(); return {connected:true,calendars:publicCalendars(data.calendars),selected:data.selected,shareWithHousehold:sharesWithHousehold(data)}; }
  try { const { data, shared } = await resolveCalendarConnection({ db, uid, members:activeMembers }); if (shared) return sharedView(data); }
  catch (error) { if (!(error instanceof CalendarError)) throw error; if (/More than one/.test(error.message)) return {connected:false,note:error.message}; }
  return {connected:false};
});
// The connecting member decides whether their selected calendars are shared.
export const calendarShare = endpoint(async (uid,input) => {
  if (typeof input.shareWithHousehold !== 'boolean') throw new CalendarError('invalid-argument','Choose whether to share your calendars.');
  const snap = await connectionRef(uid).get(); if (!snap.exists) throw ownerOnly();
  await connectionRef(uid).update({shareWithHousehold:input.shareWithHousehold});
  const data = snap.data();
  return {connected:true,calendars:publicCalendars(data.calendars),selected:data.selected,shareWithHousehold:input.shareWithHousehold};
});
export const calendarConnect = endpoint(async (uid,input) => {
  const username = String(input.email || '').trim(); const password = String(input.password || '').trim();
  if (!/^[^\s:@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 254 || !/^[a-z]{4}(?:-[a-z]{4}){3}$/i.test(password)) throw new CalendarError('invalid-argument','Enter your Apple Account email and an app-specific password (xxxx-xxxx-xxxx-xxxx).');
  const client = new CalDAV({username,password});
  const calendars = await client.discover();
  const previous = await connectionRef(uid).get();
  const selected = previous.exists ? (previous.data().selected || []).filter(id => calendars.some(c => c.id === id)).slice(0,6) : [];
  const shareWithHousehold = previous.exists ? sharesWithHousehold(previous.data()) : true; // reconnecting keeps the sharing choice
  await connectionRef(uid).set({credential:encryptCredential({username,password},encryptionKey.value(),uid),calendars,selected,shareWithHousehold,updatedAt:FieldValue.serverTimestamp()});
  return {connected:true,calendars:publicCalendars(calendars),selected,shareWithHousehold};
});
export const calendarSelect = endpoint(async (uid,input) => {
  const {data,shared} = await connection(uid); if (shared) throw ownerOnly();
  if (!Array.isArray(input.selected) || input.selected.length > 6 || !input.selected.every(id => data.calendars.some(c => c.id === id))) throw new CalendarError('invalid-argument','Choose up to six calendars from this account.');
  const selected = [...new Set(input.selected)]; await connectionRef(uid).update({selected});
  return {connected:true,calendars:publicCalendars(data.calendars),selected,shareWithHousehold:sharesWithHousehold(data)};
});
export const calendarDisconnect = endpoint(async uid => {
  if (!(await connectionRef(uid).get()).exists) throw ownerOnly(); // a borrowing member can't disconnect someone else's Apple account
  await connectionRef(uid).delete(); return {connected:false};
});
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

// ---------- Morning newsletter ----------
// A daily home-page digest emailed to each household member at 6:30am ET.
// The sending Gmail account and its app password are entered once in Settings
// and stored encrypted, like the iCloud and Huckleberry connections.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';
import { buildDigest, composeEmail, validatePrefs, validateSender, NewsletterError, HOUSE_TZ, BUDGET, withinTime } from './newsletter.js';
import { selectForecast } from './shared/weather.js';
const senderRef = () => db.doc('privateNewsletterSender/config');
const prefsRef = uid => db.doc(`newsletterPrefs/${uid}`);
// Without explicit timeouts a stuck Gmail connection can hang for ten minutes.
const transport = sender => nodemailer.createTransport({ service:'gmail', auth:{ user:sender.email, pass:sender.password }, connectionTimeout:20000, greetingTimeout:15000, socketTimeout:45000 });
// Gmail's answer, in words a person can act on. Never includes the password.
function mailError(error) {
  if (error?.code === 'EAUTH' || error?.responseCode === 535) return new NewsletterError('failed-precondition', 'Gmail turned down the sending account. Make a new app password in Google and save it under Change.');
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS'].includes(error?.code)) return new NewsletterError('unavailable', 'Gmail didn’t answer in time. Try again in a minute.');
  return new NewsletterError('unavailable', `Gmail didn’t accept the message${error?.responseCode ? ` (code ${error.responseCode})` : ''}. Try again in a minute.`);
}
async function sendMail(mailer, message) {
  const result = await withinTime(mailer.sendMail(message), BUDGET.mail);
  if (result.late) throw new NewsletterError('unavailable', 'Gmail didn’t answer in time. Try again in a minute.');
  if (result.failed) throw mailError(result.error);
}
async function loadSender() {
  const snap = await senderRef().get(); if (!snap.exists) return null;
  return { email:snap.data().email, password:decryptCredential(snap.data().credential, encryptionKey.value(), 'newsletter-sender').password };
}
async function forecastNow() {
  try {
    const [blend, conditions] = await Promise.all(['blend_daily.json', 'conditions_daily.json'].map(async file => {
      const response = await fetch(`https://gitcrazygitwild.github.io/Miateorology/data/${file}`, { signal:AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('forecast'); return response.json();
    }));
    return selectForecast(blend, conditions);
  } catch { return null; }
}
async function icloudEvents(uid, from, to) {
  const result = await withinTime(icloudEventsNow(uid, from, to), BUDGET.icloud, []);
  return { events:result.value || [], late:result.late };
}
async function icloudEventsNow(uid, from, to) {
  try {
    const { data, client } = await connection(uid);
    const grouped = await Promise.all(data.selected.map(async id => { const calendar = calendarFor(data, id); return (await client.events(calendar, from, to)).flatMap(object => readEvents(object, calendar, from, to)); }));
    return assignments.apply(grouped.flat());
  } catch { return []; } // Not connected or iCloud unavailable: household events still go out.
}
const huckleberryHandler = createHuckleberryHandler({ db, key:() => encryptionKey.value() });
// ---------- "The world, briefly": headlines, markets and rates ----------
import { createBriefingService } from './briefing.js';
const briefingService = createBriefingService({ db });
export const briefing = endpoint(async (_uid, input) => {
  try { return await briefingService(input?.history !== undefined ? { history:String(input.history) } : {}); }
  catch (error) { if (error.code === 'invalid-argument') throw new HttpsError('invalid-argument', error.message); throw error; }
});
// Frankie's data for the email. If Huckleberry is slow, fall back to the snapshot the
// app saved most recently (privateBabySnapshots) so her section still goes out.
async function babySnapshot(uids) {
  if (!uids.length) return { snapshot:null, fresh:false };
  // A light snapshot: the history the app last saved (it reloads it every 15 minutes
  // while open) plus Huckleberry's live latest sleep, bottle, diaper and timer. A full
  // reload pulls every archived batch document and ran the instance out of memory.
  const live = await withinTime(huckleberryHandler(uids[0], { action:'snapshot', light:true }), BUDGET.snapshot);
  if (live.value?.sleeps) return { snapshot:live.value, fresh:true };
  const saved = (await db.doc('privateBabySnapshots/household-home').get().catch(() => null))?.data();
  return { snapshot:saved?.sleeps ? saved : null, fresh:false, late:live.late };
}
// Everything one member's email needs, gathered fresh.
async function newsletterFor(uid, shared, progress = () => {}) {
  const prefs = validatePrefs((await prefsRef(uid).get()).data() || {});
  const now = new Date(), from = new Date(now); from.setHours(0, 0, 0, 0); const to = new Date(+from + 15 * 86400000);
  progress('reading Apple Calendar');
  const icloud = await icloudEvents(uid, from, to);
  progress('reading birthdays');
  const bdays = await withinTime(birthdaysFor(uid).catch(() => null), 15000);
  progress('writing the email');
  const skipped = [...shared.skipped, ...(icloud.late ? ['icloud'] : [])];
  const digest = buildDigest({ name:prefs.name, now, household:shared.household, icloud:icloud.events, items:shared.items, forecast:shared.forecast, snapshot:shared.snapshot, predictions:shared.predictions, recent:shared.recent, briefing:shared.briefing, birthdays:bdays.value?.birthdays || [], prefs, skipped });
  return { prefs, email:composeEmail(digest), skipped };
}
// Diapers aren't in the snapshot's history; the recent-logs list has them.
async function babyRecent(uids) {
  if (!uids.length) return { entries:null };
  const result = await withinTime(huckleberryHandler(uids[0], { action:'recent' }), BUDGET.recent);
  return { entries:result.value?.entries || null, late:result.late };
}
async function sharedNewsletterData(uids, progress = () => {}) {
  // Huckleberry calls run one after the other: each opens its own provider client,
  // and two at once on a small instance ran out of memory.
  // Every outside service has a time budget; anything late is left out and named.
  const started = Date.now(), took = {};
  const timed = (name, work) => Promise.resolve(work).finally(() => { took[name] = Date.now() - started; });
  const baby = (async () => {
    progress('reading Frankie’s Huckleberry data');
    const live = await babySnapshot(uids);
    const recent = live.fresh ? await babyRecent(uids) : { entries:null }; // no fresh connection, no second wait
    return { ...live, recent };
  })();
  const [events, items, forecast, babyData, predictions, world] = await Promise.all([
    db.collection('events').get(), db.collection('householdItems').get(), timed('forecast', withinTime(forecastNow(), BUDGET.forecast)), timed('baby', baby),
    db.collection('babyPredictions').orderBy('lastWake', 'desc').limit(400).get(), timed('briefing', withinTime(briefingService(), BUDGET.briefing))
  ]);
  const skipped = [];
  if (forecast.late) skipped.push('forecast');
  if (world.late) skipped.push('briefing');
  if (!babyData.fresh && (babyData.late || babyData.snapshot)) skipped.push('baby'); // slow, or answered with an error while a saved copy exists
  if (babyData.fresh && babyData.recent.late) skipped.push('diapers');
  info('Newsletter data gathered', { ms:took, skipped, babyFallback:!babyData.fresh && !!babyData.snapshot });
  return { household:events.docs.map(d => d.data()), items:items.docs.map(d => d.data()), forecast:forecast.value, snapshot:babyData.snapshot, predictions:predictions.docs.map(d => ({ id:d.id, ...d.data() })), recent:babyData.recent.entries, briefing:world.value, skipped };
}
async function activeMembers() {
  return (await db.collection('households/home/members').where('active', '==', true).get()).docs.map(d => d.id);
}
const testTrail = uid => db.doc(`newsletterLog/test_${uid}`);
export const newsletter = endpoint(async (uid, input) => {
  process.env.TZ = HOUSE_TZ; // dates in the digest are Richmond-local
  const action = input.action;
  if (action === 'status') {
    const [sender, prefs, lastTest] = await Promise.all([senderRef().get(), prefsRef(uid).get(), testTrail(uid).get()]);
    return { senderConfigured:sender.exists, senderEmail:sender.exists ? sender.data().email : '', prefs:validatePrefs(prefs.data() || {}), lastTest:lastTest.exists ? lastTest.data() : null };
  }
  if (action === 'savePrefs') { const prefs = validatePrefs(input.prefs); await prefsRef(uid).set(prefs); return { prefs }; }
  if (action === 'setSender') {
    const sender = validateSender(input);
    try { await transport(sender).verify(); } catch { throw new NewsletterError('failed-precondition', 'Gmail did not accept that address and app password. Check both and try again.'); }
    await senderRef().set({ email:sender.email, credential:encryptCredential({ password:sender.password }, encryptionKey.value(), 'newsletter-sender'), updatedAt:FieldValue.serverTimestamp() });
    return { senderConfigured:true, senderEmail:sender.email };
  }
  if (action === 'clearSender') { await senderRef().delete(); return { senderConfigured:false }; }
  if (action === 'sendTest') {
    // A progress trail in Firestore: if the instance is killed mid-send, the next
    // Settings visit shows the step it stopped at (no secrets, just step names).
    const trail = testTrail(uid), started = Date.now(); let step = 'starting';
    const progress = next => { step = next; trail.set({ step, startedAt:new Date(started).toISOString(), updatedAt:new Date().toISOString(), ms:Date.now() - started, finished:false }, { merge:true }).catch(() => {}); };
    try {
      progress('checking the sending account');
      const sender = await loadSender(); if (!sender) throw new NewsletterError('failed-precondition', 'Set up the sending Gmail account first.');
      const to = (await getAuth().getUser(uid)).email; if (!to) throw new NewsletterError('failed-precondition', 'Your login has no email address.');
      progress('gathering the household’s plans, weather and news');
      const { email, skipped } = await newsletterFor(uid, await sharedNewsletterData(await activeMembers(), progress), progress);
      progress('handing the email to Gmail');
      await sendMail(transport(sender), { from:`Hubert’s House <${sender.email}>`, to, subject:email.subject, html:email.html, text:email.text });
      await trail.set({ step:'sent', finished:true, ok:true, ms:Date.now() - started, updatedAt:new Date().toISOString(), skipped, error:null }, { merge:true }).catch(() => {});
      return { sent:true, to, skipped };
    } catch (error) {
      const failure = error instanceof NewsletterError ? error : new NewsletterError('unavailable', `Something went wrong while ${step} (${String(error?.code || error?.name || 'error').slice(0, 40)}). Try again in a minute.`);
      await trail.set({ finished:true, ok:false, ms:Date.now() - started, updatedAt:new Date().toISOString(), error:failure.message.slice(0, 200) }, { merge:true }).catch(() => {});
      if (!(error instanceof NewsletterError)) warn('Newsletter test failed', { step, reason:error?.code || error?.name || 'error' });
      throw failure;
    }
  }
  throw new NewsletterError('invalid-argument', 'Choose a newsletter action.');
}, { memory:'1GiB', timeoutSeconds:300 });
export const morningNewsletter = onSchedule({ schedule:'30 6 * * *', timeZone:HOUSE_TZ, region:'us-central1', secrets:[encryptionKey], timeoutSeconds:300, memory:'1GiB', cpu:'gcf_gen1', maxInstances:1, retryCount:0 }, async () => {
  process.env.TZ = HOUSE_TZ;
  const sender = await loadSender(); if (!sender) { warn('Newsletter skipped: no sending account configured'); return; }
  const uids = await activeMembers(), shared = await sharedNewsletterData(uids), mailer = transport(sender);
  const day = new Date().toLocaleDateString('en-CA', { timeZone:HOUSE_TZ });
  for (const uid of uids) {
    const log = db.doc(`newsletterLog/${day}_${uid}`);
    try {
      await log.create({ startedAt:FieldValue.serverTimestamp() }); // once per member per day
      const to = (await getAuth().getUser(uid)).email; if (!to) continue;
      const { prefs, email } = await newsletterFor(uid, shared);
      if (!prefs.enabled) { await log.set({ skipped:'disabled' }, { merge:true }); continue; }
      await sendMail(mailer, { from:`Hubert’s House <${sender.email}>`, to, subject:email.subject, html:email.html, text:email.text });
      await log.set({ sentAt:FieldValue.serverTimestamp() }, { merge:true });
    } catch (error) { if (error?.code !== 6) warn('Newsletter not sent to one member', { reason:error?.code || 'send-failed' }); } // 6 = already sent today
  }
});

// ---------- "Hey Siri, Frankie log" ----------
// A public HTTPS address for the Apple Shortcut. Every request must carry a
// personal key (only its SHA-256 is stored, in server-only `siriKeys`); logs are
// read back for confirmation and saved through the guarded Huckleberry path.
import { onRequest } from 'firebase-functions/v2/https';
import { createSiriHandler, newSiriKey, hashSiriKey, SIRI_TZ } from './siri.js';
const siriHandler = createSiriHandler({ db, huckleberry:(uid, input) => huckleberryHandler(uid, input), members:activeMembers });
// More memory and a second instance than the app's callables: a Shortcut that gets a
// platform error page instead of JSON fails with "couldn't convert Rich Text".
export const siri = onRequest({ region:'us-central1', secrets:[encryptionKey], timeoutSeconds:120, memory:'512MiB', cpu:'gcf_gen1', concurrency:1, minInstances:0, maxInstances:2, cors:false }, async (request, response) => {
  process.env.TZ = SIRI_TZ; // "5:15" means Richmond time
  await siriHandler(request, response);
});
const siriURL = () => `https://us-central1-${process.env.GCLOUD_PROJECT || 'huberts-house'}.cloudfunctions.net/siri`;
export const siriSetup = endpoint(async (uid, input) => {
  const mine = await db.collection('siriKeys').where('uid', '==', uid).get();
  if (input.action === 'status') {
    const key = mine.docs[0]?.data();
    return { hasKey:!!key, createdAt:key?.createdAt || null, lastUsedAt:key?.lastUsedAt || null, url:siriURL() };
  }
  if (input.action === 'create' || input.action === 'revoke') {
    // One key per person: making a new key or revoking removes the old one.
    const batch = db.batch(); mine.docs.forEach(doc => batch.delete(doc.ref));
    let key = null;
    if (input.action === 'create') { key = newSiriKey(); batch.set(db.doc(`siriKeys/${hashSiriKey(key)}`), { uid, createdAt:new Date().toISOString(), lastUsedAt:null }); }
    await batch.commit();
    return { hasKey:!!key, key, url:siriURL() };
  }
  throw new NewsletterError('invalid-argument', 'Choose a Siri action.');
});

// Devices page: Philips Hue and Sonos through their official cloud APIs (functions/smart-home.js).
const smartHomeURL = () => `https://us-central1-${process.env.GCLOUD_PROJECT || 'huberts-house'}.cloudfunctions.net/smartHomeAuth`;
const appURL = () => `https://${process.env.GCLOUD_PROJECT || 'huberts-house'}.web.app/`;
const smartHomeService = createSmartHome({ db, key:() => encryptionKey.value(), encrypt:encryptCredential, decrypt:decryptCredential, redirectUri:smartHomeURL() });
export const smartHome = endpoint(async (uid, input = {}) => {
  const { action, provider } = input;
  if (action === 'status') return smartHomeService.status();
  if (action === 'saveApp') return smartHomeService.saveApp(uid, provider, input);
  if (action === 'connect') return smartHomeService.startAuth(uid, provider);
  if (action === 'disconnect') return smartHomeService.disconnect(provider);
  if (action === 'devices') return smartHomeService.devices(provider);
  if (action === 'control') return smartHomeService.control(provider, input.command);
  throw new SmartHomeError('invalid-argument', 'Choose a device action.');
});
// Hue and Sonos send the browser back here after sign-in. It finishes the connection and
// returns to the Devices page with a short result in the address (never a token).
export const smartHomeAuth = onRequest({ region:'us-central1', secrets:[encryptionKey], timeoutSeconds:60, memory:'256MiB', cpu:'gcf_gen1', concurrency:1, minInstances:0, maxInstances:1, cors:false }, async (request, response) => {
  if (request.method !== 'GET') { response.status(405).send('Method not allowed'); return; }
  const { code, state, error } = request.query || {};
  const result = await smartHomeService.finishAuth({ code:typeof code === 'string' ? code : '', state, error }).catch(() => ({ ok:false, message:'Something went wrong. Try connecting again.' }));
  if (!result.ok) warn('Smart home sign-in did not finish', { provider:result.provider || 'unknown' });
  const back = new URLSearchParams({ connected:result.provider || '', ok:result.ok ? '1' : '0', ...(result.ok ? {} : { message:result.message || '' }) });
  response.redirect(302, `${appURL()}?${back}#devices`);
});

// Birthdays from the connected Apple account's Contacts (functions/carddav.js). The
// member who connected Apple turns this on; it's shared with the household only when
// their calendars are. Names and dates are cached server-side for 12 hours.
import { CardDAV } from './carddav.js';
const birthdayCache = ownerUid => db.doc(`privateBirthdays/${ownerUid}`);
const BIRTHDAY_TTL = 12 * 3600000;
async function birthdaysFor(uid, { force = false } = {}) {
  let resolved;
  try { resolved = await resolveCalendarConnection({ db, uid, members:activeMembers }); }
  catch (error) { if (error instanceof CalendarError) return { connected:false, owner:false, enabled:false, birthdays:[] }; throw error; }
  const { ownerUid, data, shared } = resolved, enabled = data.birthdays === true;
  if (!enabled) return { connected:true, owner:!shared, enabled:false, birthdays:[] };
  const cached = (await birthdayCache(ownerUid).get()).data();
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < BIRTHDAY_TTL) return { connected:true, owner:!shared, enabled:true, birthdays:cached.birthdays, fetchedAt:cached.fetchedAt };
  try {
    const birthdays = await new CardDAV(decryptCredential(data.credential, encryptionKey.value(), ownerUid)).birthdays(), fetchedAt = new Date().toISOString();
    await birthdayCache(ownerUid).set({ birthdays, fetchedAt });
    return { connected:true, owner:!shared, enabled:true, birthdays, fetchedAt };
  } catch (error) {
    if (cached && !force) return { connected:true, owner:!shared, enabled:true, birthdays:cached.birthdays, fetchedAt:cached.fetchedAt, stale:true };
    throw error;
  }
}
export const birthdays = endpoint(async (uid, input = {}) => {
  if (input.action === 'set') {
    if (typeof input.enabled !== 'boolean') throw new CalendarError('invalid-argument', 'Choose whether to show birthdays.');
    if (!(await connectionRef(uid).get()).exists) throw new CalendarError('permission-denied', 'Only the household member who connected Apple Calendar can turn on birthdays from their Contacts.');
    await connectionRef(uid).update({ birthdays:input.enabled });
    if (!input.enabled) { await birthdayCache(uid).delete(); return { connected:true, owner:true, enabled:false, birthdays:[] }; }
    try { return await birthdaysFor(uid, { force:true }); }
    catch (error) { await connectionRef(uid).update({ birthdays:false }); throw error; } // couldn't read Contacts: leave it off
  }
  return birthdaysFor(uid, { force:input.force === true });
});

// Litter-Robot (Whisker, unofficial API; functions/litter-robot.js). One household
// connection: the password signs in once and only the encrypted session is kept.
const litterRobotService = createLitterRobot({ db, key:() => encryptionKey.value(), encrypt:encryptCredential, decrypt:decryptCredential });
export const litterRobot = endpoint(async (uid, input = {}) => {
  if (input.action === 'status') return litterRobotService.status();
  if (input.action === 'connect') return litterRobotService.connect(uid, { email:input.email, password:input.password });
  if (input.action === 'disconnect') return litterRobotService.disconnect();
  if (input.action === 'snapshot') return litterRobotService.snapshot({ force:input.force === true });
  if (input.action === 'clean') return litterRobotService.clean(input.robotId);
  throw new LitterRobotError('invalid-argument', 'Choose a Litter-Robot action.');
});

// PetLibro feeders (unofficial API; functions/petlibro.js), on a second PetLibro
// account the feeders are shared with, so the phone app stays signed in.
const petLibroService = createPetLibro({ db, key:() => encryptionKey.value(), encrypt:encryptCredential, decrypt:decryptCredential, log:(message, data) => info(message, data) });
export const petLibro = endpoint(async (uid, input = {}) => {
  if (input.action === 'status') return petLibroService.status();
  if (input.action === 'connect') return petLibroService.connect(uid, { email:input.email, password:input.password });
  if (input.action === 'disconnect') return petLibroService.disconnect();
  if (input.action === 'snapshot') return petLibroService.snapshot({ force:input.force === true });
  if (input.action === 'feed') return petLibroService.feed(input.feederId, input.portions);
  throw new PetLibroError('invalid-argument', 'Choose a PetLibro action.');
});
