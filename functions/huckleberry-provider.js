import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
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
export async function huckleberrySnapshot(client, childId, timezone, cached, forceHistory = false, now = Date.now()) {
  const child = id(childId);
  const [profile, sleepDoc, feedDoc, diaperDoc] = await Promise.all(['childs','sleep','feed','diaper'].map(collection => client.doc(`${collection}/${child}`).get()));
  if (!profile.exists) fail('not-found','This Huckleberry child profile is no longer available.');
  const sleep = sleepDoc.data() || {}, feed = feedDoc.data() || {}, diaper = diaperDoc.data() || {}, details = profile.data();
  let sleeps = cached?.sleeps || [], historyComplete = cached?.historyComplete ?? false, historyCheckedAt = cached?.historyCheckedAt;
  if (forceHistory || !historyCheckedAt || now - Date.parse(historyCheckedAt) > 15 * 60000) {
    const intervals = client.collection(`sleep/${child}/intervals`), from = now - 14 * 86400000;
    const [regular, batches] = await Promise.all([
      intervals.where('start','>=',from / 1000).where('start','<',now / 1000).orderBy('start').limit(500).get(),
      intervals.where('multi','==',true).limit(80).get()
    ]);
    sleeps = normalizeSleepHistory([...regular.docs,...batches.docs],from,now);
    historyComplete = regular.size < 500 && batches.size < 80; historyCheckedAt = new Date(now).toISOString();
  }
  const lastSleep = sleep.prefs?.lastSleep;
  if (lastSleep) sleeps = normalizeSleepHistory(sleeps.map(item => ({start:Date.parse(item.start)/1000,duration:(Date.parse(item.end)-Date.parse(item.start))/1000})).concat(lastSleep),now - 14 * 86400000,now);
  const prediction = details.sweetspot || {}, selected = prediction.selectedNapDay != null && Number.isFinite(Number(prediction.selectedNapDay)) ? String(Math.trunc(Number(prediction.selectedNapDay))) : '';
  const bottle = feed.prefs?.lastBottle, change = diaper.prefs?.lastDiaper;
  return {childId:child,name:String(details.childsName || 'Baby').slice(0,100),timezone,checkedAt:new Date(now).toISOString(),historyCheckedAt,historyComplete,sleeps,
    timer:{active:sleep.timer?.active === true,paused:sleep.timer?.paused === true,start:iso(sleep.timer?.timerStartTime),end:iso(sleep.timer?.timerEndTime),uuid:String(sleep.timer?.uuid || '')},
    sweetspot:{time:iso(prediction.sweetSpotTimes?.[selected]),selectedNapDay:selected || null},
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
  return client.runTransaction(async transaction => {
    const [current, existing] = await Promise.all([transaction.get(parent), transaction.get(interval)]);
    if (existing.exists) return {saved:true,duplicate:true};
    const state = current.data() || {}, timer = state.timer || {}, offset = offsetAt(data.start, timezone);
    if (data.kind === 'sleep-start') {
      if (timer.uuid === hash.slice(0,16)) return {saved:true,duplicate:true};
      if (timer.active) fail('failed-precondition','A sleep timer is already running. Refresh to see it.');
      transaction.set(parent,{timer:{active:true,paused:false,timerStartTime:data.start,timestamp:{seconds},local_timestamp:seconds,uuid:hash.slice(0,16)}},{mergeFields:['timer']});
      return {saved:true};
    }
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
    transaction.create(interval, entry);
    const prefs = {};
    if (!state.prefs?.[field]?.start || epochMs(state.prefs[field].start) <= epochMs(last.start)) {
      prefs[field] = last; prefs.timestamp = {seconds}; prefs.local_timestamp = seconds;
      if (data.kind === 'bottle') Object.assign(prefs,{bottleType:data.bottleType,bottleAmount:data.amount,bottleUnits:data.units});
    }
    if (Object.keys(prefs).length) transaction.set(parent,{prefs},{merge:true});
    if (data.kind === 'sleep-stop') transaction.update(parent,{timer:{active:false,paused:false,timerStartTime:null,uuid:timer.uuid,timestamp:{seconds},local_timestamp:seconds}});
    return {saved:true};
  }, {maxAttempts:3});
}
