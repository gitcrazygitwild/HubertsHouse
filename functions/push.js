// Phone reminders (Web Push): each phone that turns them on is saved in server-only
// `privatePushSubscriptions` with its choices (bins, bath, bottle). A job every 15 minutes
// works out what's due (dueReminders, pure) and sends each reminder once (`sent` keys).
// The signing keys (VAPID) are made on first use and kept in server-only
// `privateSettings/push`; no new Cloud permission or secret is needed.
// Nothing about the baby or the calendar is stored with a subscription.
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { pickupOn, cleanTrash, DEFAULT_TRASH } from './shared/trash-days.js';
import { isBathDay, cleanBathDays, DEFAULT_BATH_DAYS } from './shared/bath-days.js';
import { bottleForecast } from './shared/baby-model.js';

export const PUSH_TZ = 'America/New_York';
export const KINDS = ['bins', 'bath', 'bottle'];
const MIN = 60000;
export class PushError extends Error { constructor(code, message) { super(message); this.code = code; } }
const idFor = endpoint => createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
const localParts = (date, tz = PUSH_TZ) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone:tz, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).formatToParts(date).map(p => [p.type, p.value]));
  return { key:`${parts.year}-${parts.month}-${parts.day}`, minutes:Number(parts.hour) * 60 + Number(parts.minute) };
};
const noonOf = key => new Date(`${key}T12:00:00`);
const clock = (date, tz = PUSH_TZ) => new Date(date).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone:tz });

export function validSubscription(sub) {
  const ok = sub && typeof sub.endpoint === 'string' && sub.endpoint.length < 1000 && /^https:\/\//.test(sub.endpoint)
    && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length < 200 && typeof sub.keys?.auth === 'string' && sub.keys.auth.length < 100;
  if (!ok) throw new PushError('invalid-argument', 'That phone’s notification details look wrong. Turn reminders off and on again.');
  return { endpoint:sub.endpoint, keys:{ p256dh:sub.keys.p256dh, auth:sub.keys.auth } };
}
export const validPrefs = (prefs = {}) => Object.fromEntries(KINDS.map(kind => [kind, prefs[kind] !== false]));

// What's due right now. The job runs every 15 minutes, so each window is 15 minutes wide;
// the `key` makes sure a reminder goes out once even if the job runs twice.
//  · bins: 7 PM the evening before a pickup ("Bins out tonight")
//  · bath: 5:30 PM on bath days
//  · bottle: 15–30 minutes before the next bottle is due, while Frankie is awake
//    (asleep, the wake-up is the cue), once per last bottle
export function dueReminders({ now = new Date(), trash = null, bathDays = null, snapshot = null, tz = PUSH_TZ } = {}) {
  const out = [], { key:today, minutes } = localParts(now, tz);
  if (minutes >= 19 * 60 && minutes < 19 * 60 + 15) {
    const tomorrow = noonOf(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const pickup = pickupOn(tomorrow, cleanTrash(trash) ?? DEFAULT_TRASH);
    if (pickup) out.push({ kind:'bins', key:`bins:${pickup.date}`, title:'Bins out tonight 🗑️', body:`${pickup.kinds.length > 1 ? 'Trash and recycling' : pickup.kinds[0] === 'recycling' ? 'Recycling' : 'Trash'} pickup is tomorrow${pickup.moved ? ` (moved for ${pickup.moved.holiday})` : ''}.`, url:'./#today' });
  }
  if (minutes >= 17 * 60 + 30 && minutes < 17 * 60 + 45 && isBathDay(noonOf(today), cleanBathDays(bathDays) ?? DEFAULT_BATH_DAYS))
    out.push({ kind:'bath', key:`bath:${today}`, title:'Bath night tonight 🛁', body:`It’s ${snapshot?.name || 'Frankie'}’s bath night.`, url:'./#today' });
  if (snapshot?.bottles?.length && !snapshot.timer?.active) {
    const next = bottleForecast(snapshot.bottles, { timezone:snapshot.timezone || tz, now });
    const lead = next.available ? (Date.parse(next.target) - +now) / MIN : null;
    if (lead != null && lead > 15 && lead <= 30) out.push({ kind:'bottle', key:`bottle:${next.last.time}`, title:`${snapshot.name || 'Frankie'}’s next bottle 🍼`, body:`Due around ${clock(next.target, tz)} (she usually goes about ${Math.floor(next.typicalMinutes / 60)}h ${next.typicalMinutes % 60}m between bottles).`, url:'./#frankie' });
  }
  return out;
}

export function createPush({ db, send = (sub, payload, options) => webpush.sendNotification(sub, payload, options), subject = 'https://huberts-house.web.app' }) {
  const subs = () => db.collection('privatePushSubscriptions');
  const keysRef = () => db.doc('privateSettings/push');
  let cached = null;
  async function vapid() {
    if (cached) return cached;
    const ref = keysRef();
    cached = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().publicKey) return snap.data();
      const made = webpush.generateVAPIDKeys(), keys = { publicKey:made.publicKey, privateKey:made.privateKey, createdAt:new Date().toISOString() };
      tx.set(ref, keys); return keys;
    });
    return cached;
  }
  async function deliver(ref, data, note) {
    const keys = await vapid();
    try {
      await send(data.subscription, JSON.stringify(note), { TTL:3600, urgency:'normal', vapidDetails:{ subject, publicKey:keys.publicKey, privateKey:keys.privateKey } });
      return true;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) { await ref.delete(); return false; } // the phone turned them off or reinstalled
      throw error;
    }
  }
  // The callable: key, subscribe, prefs, unsubscribe, test, status.
  async function handle(uid, input = {}) {
    const action = input.action;
    if (action === 'key') return { publicKey:(await vapid()).publicKey };
    if (action === 'subscribe') {
      const subscription = validSubscription(input.subscription), prefs = validPrefs(input.prefs);
      const label = typeof input.label === 'string' ? input.label.slice(0, 60) : '';
      await subs().doc(idFor(subscription.endpoint)).set({ uid, subscription, prefs, label, sent:[], updatedAt:new Date().toISOString() }, { merge:true });
      return { subscribed:true, prefs };
    }
    const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '', ref = subs().doc(idFor(endpoint));
    if (!endpoint) throw new PushError('invalid-argument', 'Which phone? Turn reminders off and on again.');
    const snap = await ref.get();
    if (action === 'status') return snap.exists ? { subscribed:true, prefs:validPrefs(snap.data().prefs) } : { subscribed:false };
    if (!snap.exists) throw new PushError('not-found', 'Reminders aren’t on for this phone. Turn them on again.');
    if (action === 'prefs') { const prefs = validPrefs(input.prefs); await ref.update({ prefs, updatedAt:new Date().toISOString() }); return { subscribed:true, prefs }; }
    if (action === 'unsubscribe') { await ref.delete(); return { subscribed:false }; }
    if (action === 'test') {
      const ok = await deliver(ref, snap.data(), { title:'Reminders are on 🐾', body:'This is how Hubert’s House will tap you on the shoulder.', tag:'test', url:'./#settings' });
      return { sent:ok, subscribed:ok };
    }
    throw new PushError('invalid-argument', 'Unknown reminders action.');
  }
  // The 15-minute job. `load` gives the household settings and (only when a phone wants
  // bottle reminders) Frankie's latest snapshot.
  async function run({ now = new Date(), load }) {
    const all = (await subs().get()).docs; if (!all.length) return { sent:0, phones:0 };
    const wantBottle = all.some(d => validPrefs(d.data().prefs).bottle);
    const { trash, bathDays, snapshot } = await load({ wantBottle });
    const due = dueReminders({ now, trash, bathDays, snapshot });
    let sent = 0;
    for (const doc of all) {
      const data = doc.data(), prefs = validPrefs(data.prefs), already = new Set(data.sent || []);
      const mine = due.filter(r => prefs[r.kind] && !already.has(r.key));
      for (const reminder of mine) {
        if (!(await deliver(doc.ref, data, { title:reminder.title, body:reminder.body, tag:reminder.kind, url:reminder.url }).catch(() => false))) continue;
        already.add(reminder.key); sent++;
      }
      if (mine.length) await doc.ref.update({ sent:[...already].slice(-30) }).catch(() => {});
    }
    return { sent, phones:all.length, due:due.map(r => r.kind) };
  }
  return { handle, run, vapid };
}
