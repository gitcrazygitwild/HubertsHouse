import { createHash } from 'node:crypto';
import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

// Public Firebase configuration, not an account credential. Collection schemas
// are based on Woyken/py-huckleberry-api (MIT); see THIRD_PARTY.md.
const API_KEY = 'AIzaSyApGVHktXeekGyAt-G6dIeWHUkq2oXqcjg';
const PROJECT = 'simpleintervals';
export class HuckleberryError extends Error {
  constructor(code, message, details) { super(message); this.code = code; if(details)this.details=details; }
}
const fail = (code, message) => { throw new HuckleberryError(code, message); };
export const epochMs = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 100000000000 ? value * 1000 : value;
};
const iso = value => { const ms = epochMs(value); return ms && ms > 0 && ms < 8640000000000000 ? new Date(ms).toISOString() : null; };
const id = value => { if (typeof value !== 'string' || !/^[\w-]{1,150}$/.test(value)) fail('invalid-argument','Choose a valid child profile.'); return value; };
// Huckleberry stores one SweetSpot per nap plan (keyed by naps per day). The
// household chooses which plan to follow; "auto" follows the plan selected in
// the Huckleberry app. Unset means 4 naps, as the household asked.
export const DEFAULT_NAP_PLAN = '4';
export function validNapPlan(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_NAP_PLAN;
  const plan = String(value);
  if (plan === 'auto' || /^[1-6]$/.test(plan)) return plan;
  fail('invalid-argument','Choose a SweetSpot nap plan.');
}
export function chooseSweetspot(prediction = {}, napPlan = DEFAULT_NAP_PLAN) {
  const times = prediction.sweetSpotTimes || {};
  const options = Object.keys(times).filter(key => /^\d+$/.test(key) && iso(times[key])).sort((a,b) => Number(a) - Number(b)).map(key => ({naps:Number(key),time:iso(times[key])}));
  const appPlan = prediction.selectedNapDay != null && Number.isFinite(Number(prediction.selectedNapDay)) ? String(Math.trunc(Number(prediction.selectedNapDay))) : '';
  const plan = validNapPlan(napPlan), wanted = plan === 'auto' ? appPlan : plan;
  // Fall back to the app's plan when the chosen plan has no prediction.
  const chosen = options.some(option => String(option.naps) === wanted) ? wanted : appPlan;
  return {time:iso(times[chosen]),selectedNapDay:chosen || null,appNapDay:appPlan || null,plan,usingFallback:!!wanted && chosen !== wanted,options};
}
export function validTimezone(value) {
  try { if (typeof value !== 'string' || value.length > 80) throw new Error(); new Intl.DateTimeFormat('en-US',{timeZone:value}).format(); return value; }
  catch { fail('invalid-argument','Choose a valid time zone.'); }
}
const AUTH_FAILURES = {
  INVALID_LOGIN_CREDENTIALS:['unauthenticated','Huckleberry did not accept this email/password combination. Use the login for the Huckleberry app. If you normally use Apple or Google there, its password does not work in this form.'],
  INVALID_PASSWORD:['unauthenticated','Huckleberry did not accept this email/password combination. Use the login for the Huckleberry app. If you normally use Apple or Google there, its password does not work in this form.'],
  EMAIL_NOT_FOUND:['unauthenticated','Huckleberry did not accept this email/password combination. Use the login for the Huckleberry app. If you normally use Apple or Google there, its password does not work in this form.'],
  USER_DISABLED:['failed-precondition','Huckleberry reports that this account is disabled. Check the account in Huckleberry or contact its support.'],
  TOO_MANY_ATTEMPTS_TRY_LATER:['resource-exhausted','Huckleberry has temporarily blocked sign-in attempts. Stop retrying for now and try again later; changing the time zone will not help.'],
  TOO_MANY_REQUESTS:['resource-exhausted','Huckleberry is limiting sign-in requests. Wait before trying again.'],
  QUOTA_EXCEEDED:['resource-exhausted','Huckleberry’s sign-in service is at its request limit. Try again later.'],
  OPERATION_NOT_ALLOWED:['failed-precondition','Huckleberry’s sign-in service is not allowing password login through this connection. This is a connection limitation, not a time-zone setting.'],
  PASSWORD_LOGIN_DISABLED:['failed-precondition','Huckleberry’s sign-in service is not allowing password login through this connection. This is a connection limitation, not a time-zone setting.'],
  API_KEY_INVALID:['failed-precondition','The Huckleberry connection’s API configuration was rejected. This needs an integration update; changing your password or time zone will not fix it.'],
  API_KEY_SERVICE_BLOCKED:['failed-precondition','Huckleberry’s sign-in service blocked this connection’s API configuration. This needs an integration update.'],
  API_KEY_HTTP_REFERRER_BLOCKED:['failed-precondition','Huckleberry’s sign-in service restricted this connection. This needs an integration update.'],
  API_KEY_IP_ADDRESS_BLOCKED:['failed-precondition','Huckleberry’s sign-in service blocked this server. This needs an integration update.'],
  API_KEY_ANDROID_APP_BLOCKED:['failed-precondition','Huckleberry’s sign-in service restricted this connection to its app. This needs an integration update.'],
  API_KEY_IOS_APP_BLOCKED:['failed-precondition','Huckleberry’s sign-in service restricted this connection to its app. This needs an integration update.'],
  CAPTCHA_CHECK_FAILED:['failed-precondition','Huckleberry requires an extra sign-in check that this connection cannot complete. Check sign-in in the Huckleberry app.'],
  MISSING_RECAPTCHA_TOKEN:['failed-precondition','Huckleberry requires an extra sign-in check that this connection cannot complete. Check sign-in in the Huckleberry app.'],
  INVALID_RECAPTCHA_TOKEN:['failed-precondition','Huckleberry requires an extra sign-in check that this connection cannot complete. Check sign-in in the Huckleberry app.'],
  RECAPTCHA_NOT_ENABLED:['failed-precondition','Huckleberry’s sign-in verification configuration is unavailable. Try again later.'],
  INVALID_EMAIL:['invalid-argument','Huckleberry did not recognize the email format. Check the email entered above.'],
  MISSING_PASSWORD:['invalid-argument','Enter the password used to sign in to Huckleberry.'],
  MISSING_EMAIL:['invalid-argument','Enter the email used to sign in to Huckleberry.']
};
async function authFailure(response) {
  // Only allowlisted reason codes leave the provider boundary. Never forward
  // raw error messages, request bodies, tokens, email addresses, or passwords.
  let payload;try{payload=await response.json();}catch{}
  const error=payload?.error, messageCode=typeof error?.message==='string' ? error.message.split(/[\s:]/,1)[0] : '';
  const candidates=[messageCode,...(Array.isArray(error?.details) ? error.details.map(detail=>detail?.reason) : [])];
  const reason=candidates.find(code=>Object.hasOwn(AUTH_FAILURES,code)) || (response.status===429?'TOO_MANY_REQUESTS':response.status>=500?'PROVIDER_UNAVAILABLE':response.status===403?'CONNECTION_REJECTED':'UNKNOWN');
  const [code,message]=AUTH_FAILURES[reason] || ['unavailable',reason==='CONNECTION_REJECTED' ? 'Huckleberry rejected this connection before sign-in could complete. This may be a service restriction; the time zone is not involved.' : 'Huckleberry sign-in could not complete. The service did not provide a recognized reason. Try again later.'];
  throw new HuckleberryError(code,message,{service:'huckleberry',reason,httpStatus:response.status});
}
export async function authenticateHuckleberry(email, password, fetcher = fetch) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || !password || password.length > 500) fail('invalid-argument','Enter your Huckleberry account email and password.');
  let response;
  try {
    response = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password,returnSecureToken:true}), signal:AbortSignal.timeout(15000)
    });
  } catch { fail('unavailable','The connection to Huckleberry timed out or could not be reached. Try again shortly.'); }
  if (!response.ok) await authFailure(response);
  let result;try{result=await response.json();}catch{fail('unavailable','Huckleberry returned an unreadable sign-in response. Try again shortly.');}
  if (!result?.idToken || !result?.refreshToken || !result?.localId) fail('unavailable','Huckleberry did not return a usable session.');
  return {idToken:result.idToken,refreshToken:result.refreshToken,userId:result.localId,expiresAt:Date.now() + Number(result.expiresIn || 3600) * 1000};
}
export async function refreshHuckleberry(session, fetcher = fetch) {
  if (session.expiresAt > Date.now() + 300000) return session;
  const response = await fetcher(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:session.refreshToken}),signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) fail('unauthenticated','Your Huckleberry session expired. Reconnect in Settings.');
  const result = await response.json();
  if (!result.id_token || !result.refresh_token || result.user_id !== session.userId) fail('unauthenticated','Reconnect your Huckleberry account in Settings.');
  return {idToken:result.id_token,refreshToken:result.refresh_token,userId:session.userId,expiresAt:Date.now() + Number(result.expires_in || 3600) * 1000};
}
export function huckleberryClient(session) {
  if (!session.idToken || !session.userId) fail('unauthenticated','Reconnect your Huckleberry account.');
  const token = new OAuth2Client(); token.setCredentials({access_token:session.idToken,expiry_date:session.expiresAt});
  // Always use the customer's Huckleberry token. Never use this function's
  // Google service account for the third-party project.
  return new Firestore({projectId:PROJECT,auth:new GoogleAuth({authClient:token}),ignoreUndefinedProperties:true});
}
export async function huckleberryChildren(client, userId) {
  const document = await client.doc(`users/${id(userId)}`).get();
  const list = document.data()?.childList;
  if (!Array.isArray(list)) fail('failed-precondition','No child profiles were found in this Huckleberry account.');
  return list.filter(child => child && typeof child.cid === 'string' && /^[\w-]{1,150}$/.test(child.cid)).slice(0,12)
    .map(child => ({id:child.cid,name:String(child.nickname || child.name || 'Child').slice(0,100)}));
}
export function normalizeSleepHistory(documents, from, to) {
  const records = new Map();
  for (const document of documents) {
    const value = typeof document.data === 'function' ? document.data() : document;
    const entries = value?.multi ? Object.values(value.data || {}) : [value];
    for (const entry of entries) {
      const start = epochMs(entry?.start), duration = entry?.duration;
      if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || duration > 48 * 3600 || start < from || start >= to) continue;
      const end = start + duration * 1000;
      if (end > to + 60000) continue;
      records.set(`${start}:${end}`, {start:new Date(start).toISOString(),end:new Date(end).toISOString()});
    }
  }
  return [...records.values()].sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
}
export const HISTORY_DAYS = 60;
const HISTORY_LIMIT = 1000, BATCH_LIMIT = 80;
const BOTTLE_TYPES = ['Formula','Breast Milk','Cow Milk','Soy Milk','Other'];
// Bottle feeds only: amounts are what the daily ounces chart needs. Breast
// feeds carry durations rather than volumes and are left out on purpose.
export function normalizeFeedHistory(documents, from, to) {
  const records = new Map();
  for (const document of documents) {
    const value = typeof document.data === 'function' ? document.data() : document;
    const entries = value?.multi ? Object.values(value.data || {}) : [value];
    for (const entry of entries) {
      if (entry?.mode !== 'bottle') continue;
      const start = epochMs(entry.start), amount = Number(entry.amount), units = entry.units === 'ml' ? 'ml' : entry.units === 'oz' ? 'oz' : null;
      if (!Number.isFinite(start) || start < from || start > to || !units || !Number.isFinite(amount) || amount <= 0 || amount > (units === 'oz' ? 64 : 2000)) continue;
      records.set(`${start}:${amount}:${units}`, {start:new Date(start).toISOString(),amount:Math.round(amount * 100) / 100,units,type:BOTTLE_TYPES.includes(entry.bottleType) ? entry.bottleType : 'Other'});
    }
  }
  return [...records.values()].sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
}
async function intervalHistory(client, path, from, now) {
  const intervals = client.collection(path);
  const [regular, batches] = await Promise.all([
    intervals.where('start','>=',from / 1000).where('start','<',now / 1000).orderBy('start').limit(HISTORY_LIMIT).get(),
    intervals.where('multi','==',true).limit(BATCH_LIMIT).get()
  ]);
  return {docs:[...regular.docs,...batches.docs],complete:regular.size < HISTORY_LIMIT && batches.size < BATCH_LIMIT};
}
// Frankie's birthdate (YYYY-MM-DD) for Mia's age-aware forecast. Huckleberry's field
// isn't documented, so a few likely names and shapes are accepted; anything else is null.
export function readBirthdate(details = {}) {
  for (const key of ['birthdate', 'birthDate', 'dob', 'birthday']) {
    let value = details[key];
    if (value == null || value === '') continue;
    if (typeof value === 'object' && Number.isFinite(value.seconds)) value = value.seconds * 1000;
    else if (typeof value === 'object' && typeof value.toDate === 'function') value = +value.toDate();
    if (typeof value === 'number') value = new Date(value < 1e11 ? value * 1000 : value).toISOString().slice(0, 10);
    if (typeof value === 'string') { const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/); if (match && Date.parse(`${match[0]}T12:00:00Z`) < Date.now()) return match[0]; }
  }
  return null;
}
// `light` (Siri) reuses cached history when there is any, so a voice log stays fast;
// the app refreshes the full history on its next load.
export async function huckleberrySnapshot(client, childId, timezone, cached, forceHistory = false, now = Date.now(), napPlan = DEFAULT_NAP_PLAN, light = false) {
  const child = id(childId);
  const [profile, sleepDoc, feedDoc, diaperDoc] = await Promise.all(['childs','sleep','feed','diaper'].map(collection => client.doc(`${collection}/${child}`).get()));
  if (!profile.exists) fail('not-found','This Huckleberry child profile is no longer available.');
  const sleep = sleepDoc.data() || {}, feed = feedDoc.data() || {}, diaper = diaperDoc.data() || {}, details = profile.data();
  const from = now - HISTORY_DAYS * 86400000;
  // A cache from before bottle history existed has no `bottles` field; reload it.
  let sleeps = cached?.sleeps || [], bottles = cached?.bottles || [], historyComplete = cached?.historyComplete ?? false, feedsComplete = cached?.feedsComplete ?? false, historyCheckedAt = Array.isArray(cached?.bottles) ? cached?.historyCheckedAt : undefined;
  if (forceHistory || !historyCheckedAt || (!light && now - Date.parse(historyCheckedAt) > 15 * 60000)) {
    const [sleepHistory, feedHistory] = await Promise.all([intervalHistory(client,`sleep/${child}/intervals`,from,now),intervalHistory(client,`feed/${child}/intervals`,from,now)]);
    sleeps = normalizeSleepHistory(sleepHistory.docs,from,now); bottles = normalizeFeedHistory(feedHistory.docs,from,now);
    historyComplete = sleepHistory.complete; feedsComplete = feedHistory.complete; historyCheckedAt = new Date(now).toISOString();
  }
  const lastSleep = sleep.prefs?.lastSleep;
  if (lastSleep) sleeps = normalizeSleepHistory(sleeps.map(item => ({start:Date.parse(item.start)/1000,duration:(Date.parse(item.end)-Date.parse(item.start))/1000})).concat(lastSleep),from,now);
  const latestBottle = feed.prefs?.lastBottle;
  if (latestBottle) bottles = normalizeFeedHistory(bottles.map(item => ({mode:'bottle',start:Date.parse(item.start),amount:item.amount,units:item.units,bottleType:item.type})).concat({mode:'bottle',start:latestBottle.start,amount:latestBottle.bottleAmount,units:latestBottle.bottleUnits,bottleType:latestBottle.bottleType}),from,now);
  const sweetspot = chooseSweetspot(details.sweetspot || {}, napPlan);
  const bottle = feed.prefs?.lastBottle, change = diaper.prefs?.lastDiaper;
  return {childId:child,name:String(details.childsName || 'Baby').slice(0,100),birthdate:readBirthdate(details),timezone,checkedAt:new Date(now).toISOString(),historyCheckedAt,historyComplete,feedsComplete,historyDays:HISTORY_DAYS,sleeps,bottles,
    timer:{active:sleep.timer?.active === true,paused:sleep.timer?.paused === true,start:iso(sleep.timer?.timerStartTime),end:iso(sleep.timer?.timerEndTime),uuid:String(sleep.timer?.uuid || '')},
    sweetspot,
    lastBottle:bottle ? {time:iso(bottle.start),amount:Number.isFinite(bottle.bottleAmount) ? bottle.bottleAmount : null,units:bottle.bottleUnits === 'oz' ? 'oz' : 'ml',type:String(bottle.bottleType || 'Bottle').slice(0,60)} : null,
    lastDiaper:change ? {time:iso(change.start),mode:['pee','poo','both','dry'].includes(change.mode) ? change.mode : 'diaper'} : null};
}
function offsetAt(stamp, timezone) {
  const name = new Intl.DateTimeFormat('en-US',{timeZone:timezone,timeZoneName:'longOffset'}).formatToParts(new Date(stamp)).find(part => part.type === 'timeZoneName').value;
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? (match[1] === '+' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}
export function validateBabyWrite(input, now = Date.now()) {
  if (!input || !['sleep-start','sleep-stop','sleep-log','bottle','diaper'].includes(input.kind)) fail('invalid-argument','Choose a baby log type.');
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId || '')) fail('invalid-argument','Reopen the log form and try again.');
  const start = Date.parse(input.start), end = input.end ? Date.parse(input.end) : null;
  if (!Number.isFinite(start) || start > now + 60000 || start < now - 30 * 86400000) fail('invalid-argument','Choose a time within the past 30 days.');
  if (input.kind === 'sleep-log' && (!Number.isFinite(end) || end <= start || end > now + 60000 || end - start > 48 * 3600000)) fail('invalid-argument','Choose a finished sleep lasting less than 48 hours.');
  if (input.kind === 'bottle' && (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > (input.units === 'oz' ? 64 : 2000) || !['oz','ml'].includes(input.units) || !['Formula','Breast Milk','Cow Milk','Soy Milk','Other'].includes(input.bottleType))) fail('invalid-argument','Enter a valid bottle amount, unit, and type.');
  if (input.kind === 'diaper' && !['pee','poo','both','dry'].includes(input.mode)) fail('invalid-argument','Choose wet, dirty, both, or dry.');
  if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 1000)) fail('invalid-argument','Keep notes under 1,000 characters.');
  return {...input,start,end,notes:input.notes?.trim() || ''};
}
export async function writeHuckleberry(client, childId, input, timezone, now = Date.now()) {
  const data = validateBabyWrite(input, now), child = id(childId), collection = data.kind.startsWith('sleep') ? 'sleep' : data.kind === 'bottle' ? 'feed' : 'diaper';
  const parent = client.doc(`${collection}/${child}`), hash = createHash('sha256').update(`${child}/${input.requestId}/${data.kind}`).digest('hex');
  const entryId = collection === 'sleep' ? hash.slice(0,16) : `${data.start}-${hash.slice(0,20)}`;
  const interval = parent.collection('intervals').doc(entryId), seconds = now / 1000;
  // Huckleberry accepts ordinary reads with a Firebase user token, but rejects
  // the server SDK's locking read/write transaction before any write occurs.
  // Use an atomic batch with optimistic document-version preconditions instead.
  // Stable interval IDs and create-only writes make uncertain retries safe.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [current, existing] = await Promise.all([parent.get(), interval.get()]);
    if (existing.exists) return {saved:true,duplicate:true};
    const state = current.data() || {}, timer = state.timer || {}, offset = offsetAt(data.start, timezone);
    const batch = client.batch(), patch = {};
    if (data.kind === 'sleep-start') {
      if (timer.uuid === hash.slice(0,16)) return {saved:true,duplicate:true};
      if (timer.active) fail('failed-precondition','A sleep timer is already running. Refresh to see it.');
      patch.timer = {active:true,paused:false,timerStartTime:data.start,timestamp:{seconds},local_timestamp:seconds,uuid:hash.slice(0,16)};
    } else {
      let entry, last, field;
      if (data.kind === 'sleep-stop') {
        if (!timer.active || !input.timerId || timer.uuid !== input.timerId || epochMs(timer.timerStartTime) !== Date.parse(input.expectedStart)) fail('aborted','This sleep timer changed in Huckleberry. Refresh before stopping it.');
        const start = epochMs(timer.timerStartTime), end = timer.paused ? epochMs(timer.timerEndTime) : data.start;
        if (!start || !end || end <= start || end - start > 48 * 3600000 || end > now + 60000) fail('failed-precondition','Check this sleep timer in Huckleberry before completing it.');
        entry = {start:start / 1000,duration:Math.floor((end - start) / 1000),offset:offsetAt(start,timezone),end_offset:offsetAt(end,timezone),...(timer.details ? {details:timer.details} : {}),lastUpdated:seconds};
        field = 'lastSleep'; last = {start:entry.start,duration:entry.duration,offset:entry.offset};
      } else if (data.kind === 'sleep-log') {
        entry = {start:data.start / 1000,duration:Math.floor((data.end - data.start) / 1000),offset,end_offset:offsetAt(data.end,timezone),lastUpdated:seconds,...(data.notes ? {details:{notes:data.notes}} : {})};
        field = 'lastSleep'; last = {start:entry.start,duration:entry.duration,offset};
      } else if (data.kind === 'bottle') {
        entry = {mode:'bottle',start:data.start / 1000,amount:data.amount,units:data.units,bottleType:data.bottleType,offset,end_offset:offset,lastUpdated:seconds,...(data.notes ? {notes:data.notes} : {})};
        field = 'lastBottle'; last = {mode:'bottle',start:entry.start,bottleType:data.bottleType,bottleAmount:data.amount,bottleUnits:data.units,offset};
      } else {
        entry = {mode:data.mode,start:data.start / 1000,offset,lastUpdated:seconds,...(data.notes ? {notes:data.notes} : {})};
        field = 'lastDiaper'; last = {start:entry.start,mode:data.mode,offset};
      }
      batch.create(interval, entry);
      const prefs = {};
      if (!state.prefs?.[field]?.start || epochMs(state.prefs[field].start) <= epochMs(last.start)) {
        prefs[field] = last; prefs.timestamp = {seconds}; prefs.local_timestamp = seconds;
        if (data.kind === 'bottle') Object.assign(prefs,{bottleType:data.bottleType,bottleAmount:data.amount,bottleUnits:data.units});
      }
      for (const [name,value] of Object.entries(prefs)) patch[`prefs.${name}`] = value;
      if (data.kind === 'sleep-stop') patch.timer = {active:false,paused:false,timerStartTime:null,uuid:timer.uuid,timestamp:{seconds},local_timestamp:seconds};
    }
    if (Object.keys(patch).length) {
      if (current.exists) batch.update(parent,patch,{lastUpdateTime:current.updateTime});
      else {
        // create() takes nested document data, while update() takes field paths.
        const initial = {};
        for (const [path,value] of Object.entries(patch)) {
          if (path.startsWith('prefs.')) (initial.prefs ||= {})[path.slice(6)] = value;
          else initial[path] = value;
        }
        batch.create(parent,initial);
      }
    }
    try { await batch.commit(); return {saved:true}; }
    catch (error) {
      // Concurrent create, stale updateTime, or contention: re-read everything
      // and recheck the timer/newest-summary guards before attempting again.
      if (![6,9,10].includes(error.code)) throw error;
      if (attempt === 2) fail('aborted','Huckleberry changed while saving this entry. Refresh and try again.');
    }
  }
}

// ---------- Recent logs: list, edit, delete ----------
// Only ordinary interval documents are listed. Older entries that Huckleberry has
// folded into "multi" batch documents are left alone (edit those in Huckleberry).
const COLLECTION = {sleep:'sleep', bottle:'feed', diaper:'diaper'};
const LAST_FIELD = {sleep:'lastSleep', bottle:'lastBottle', diaper:'lastDiaper'};
export const RECENT_DAYS = 7;
const version = doc => doc.updateTime ? `${doc.updateTime.seconds}.${String(doc.updateTime.nanoseconds).padStart(9,'0')}` : '';
const toTimestamp = value => {
  const match = /^(\d{1,12})\.(\d{9})$/.exec(String(value || ''));
  if (!match) fail('invalid-argument','Refresh the list and try again.');
  return new Timestamp(Number(match[1]), Number(match[2]));
};
function recentEntry(kind, doc) {
  const value = doc.data() || {}, start = epochMs(value.start);
  if (value.multi || !Number.isFinite(start)) return null;
  const base = {kind, id:doc.id, version:version(doc), start:new Date(start).toISOString()};
  if (kind === 'sleep') {
    const duration = Number(value.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 48 * 3600) return null;
    return {...base, end:new Date(start + duration * 1000).toISOString()};
  }
  if (kind === 'bottle') {
    const amount = Number(value.amount), units = ['oz','ml'].includes(value.units) ? value.units : null;
    if (value.mode !== 'bottle' || !units || !Number.isFinite(amount) || amount <= 0) return null;
    return {...base, amount:Math.round(amount * 100) / 100, units, bottleType:BOTTLE_TYPES.includes(value.bottleType) ? value.bottleType : 'Other'};
  }
  return ['pee','poo','both','dry'].includes(value.mode) ? {...base, mode:value.mode} : null;
}
export async function huckleberryRecent(client, childId, now = Date.now(), days = RECENT_DAYS) {
  const child = id(childId), from = (now - days * 86400000) / 1000;
  const lists = await Promise.all(Object.entries(COLLECTION).map(async ([kind, collection]) => {
    const result = await client.collection(`${collection}/${child}/intervals`).where('start','>=',from).orderBy('start','desc').limit(300).get();
    return result.docs.map(doc => recentEntry(kind, doc)).filter(Boolean);
  }));
  return {days, entries:lists.flat().sort((a, b) => Date.parse(b.start) - Date.parse(a.start))};
}
// The "newest entry" summary Huckleberry keeps in prefs (lastSleep, lastBottle,
// lastDiaper). The app's history merges it in, so it must follow edits and deletes
// or a deleted entry would reappear.
function lastSummary(kind, value) {
  if (kind === 'sleep') return {start:value.start, duration:value.duration, offset:value.offset};
  if (kind === 'bottle') return {mode:'bottle', start:value.start, bottleType:value.bottleType, bottleAmount:value.amount, bottleUnits:value.units, offset:value.offset};
  return {start:value.start, mode:value.mode, offset:value.offset};
}
// input: {change:'edit'|'delete', kind, id, version, ...fields for an edit}
export async function changeHuckleberry(client, childId, input, timezone, now = Date.now()) {
  const child = id(childId), kind = input?.kind, change = input?.change;
  if (!COLLECTION[kind] || !['edit','delete'].includes(change)) fail('invalid-argument','Choose an entry to change.');
  if (typeof input.id !== 'string' || !/^[\w.:-]{1,200}$/.test(input.id)) fail('invalid-argument','Refresh the list and try again.');
  const expected = toTimestamp(input.version);
  let fields = null;
  if (change === 'edit') {
    // Same limits as a new log; the request ID is only needed by new entries.
    const data = validateBabyWrite({...input, kind:kind === 'sleep' ? 'sleep-log' : kind, requestId:'00000000-0000-0000-0000-000000000000', notes:undefined}, now);
    const offset = offsetAt(data.start, timezone), seconds = now / 1000;
    if (kind === 'sleep') fields = {start:data.start / 1000, duration:Math.floor((data.end - data.start) / 1000), offset, end_offset:offsetAt(data.end, timezone), lastUpdated:seconds};
    else if (kind === 'bottle') fields = {start:data.start / 1000, amount:data.amount, units:data.units, bottleType:data.bottleType, offset, end_offset:offset, lastUpdated:seconds};
    else fields = {start:data.start / 1000, mode:data.mode, offset, lastUpdated:seconds};
  }
  const parent = client.doc(`${COLLECTION[kind]}/${child}`), interval = parent.collection('intervals').doc(input.id), field = LAST_FIELD[kind];
  for (let attempt = 0; attempt < 3; attempt++) {
    const [current, existing, newest] = await Promise.all([parent.get(), interval.get(), parent.collection('intervals').orderBy('start','desc').limit(6).get()]);
    if (!existing.exists) { if (change === 'delete') return {saved:true, missing:true}; fail('not-found','This entry is no longer in Huckleberry. Refresh the list.'); }
    if (!existing.updateTime?.isEqual(expected)) fail('aborted','This entry changed in Huckleberry. Refresh the list and try again.');
    const old = existing.data() || {};
    if (old.multi || !recentEntry(kind, existing)) fail('failed-precondition','Edit this older entry in the Huckleberry app.');
    if (epochMs(old.start) < now - 30 * 86400000) fail('failed-precondition','Edit entries older than 30 days in the Huckleberry app.');
    const batch = client.batch();
    if (change === 'delete') batch.delete(interval, {lastUpdateTime:existing.updateTime});
    else batch.update(interval, fields, {lastUpdateTime:existing.updateTime});
    // Recompute the newest entry after this change and keep prefs in step with it.
    const after = newest.docs.filter(doc => doc.id !== input.id).map(doc => ({doc, value:doc.data() || {}}))
      .concat(change === 'edit' ? [{doc:existing, value:{...old, ...fields}}] : [])
      .filter(item => recentEntry(kind, {id:item.doc.id, updateTime:item.doc.updateTime, data:() => item.value}))
      .sort((a, b) => epochMs(b.value.start) - epochMs(a.value.start));
    const state = current.data() || {}, saved = state.prefs?.[field];
    const wasNewest = saved && Math.abs(epochMs(saved.start) - epochMs(old.start)) < 1000;
    const becomesNewest = change === 'edit' && (!saved || epochMs(fields.start * 1000) >= epochMs(saved.start));
    if (current.exists && (wasNewest || becomesNewest)) {
      const seconds = now / 1000, next = after[0] ? lastSummary(kind, after[0].value) : FieldValue.delete();
      batch.update(parent, {[`prefs.${field}`]:next, 'prefs.timestamp':{seconds}, 'prefs.local_timestamp':seconds}, {lastUpdateTime:current.updateTime});
    }
    try { await batch.commit(); return {saved:true}; }
    catch (error) {
      if (![6,9,10].includes(error.code)) throw error;
      if (attempt === 2) fail('aborted','Huckleberry changed while saving. Refresh the list and try again.');
    }
  }
}
