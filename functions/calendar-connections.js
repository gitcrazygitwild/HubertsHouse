import { randomUUID } from 'node:crypto';
import { encryptCredential, decryptCredential } from './crypto.js';
import { CalendarError } from './caldav.js';

const PATH = 'privateCalendarConnections/household-home';
const OWNER = 'calendar:household:home';
const changed = () => new CalendarError('aborted','The household Apple calendar connection changed. Refresh and reopen the event or settings.');
const checkVersion = (data, version) => {
  if (version !== undefined && version !== (data?.version || null)) throw changed();
};
export function calendarConnectionState(data, uid) {
  const canManage = !data?.managerUid || data.managerUid === uid;
  if (!data?.credential) return {connected:false,scope:'household',canManage,connectionVersion:data?.version || null};
  // Sharing the selected calendars does not expose the owner's unselected ones.
  const calendars = canManage ? data.calendars : data.calendars.filter(calendar => data.selected.includes(calendar.id));
  return {connected:true,scope:'household',canManage,connectionVersion:data.version,calendars:calendars.map(({url,...calendar}) => calendar),selected:data.selected};
}
export function createCalendarConnections({db,key,discover,now = () => new Date().toISOString()}) {
  const ref = () => db.doc(PATH);
  async function member(uid) {
    if (!uid) throw new CalendarError('unauthenticated','Sign in to your household first.');
    const record = await db.doc(`households/home/members/${uid}`).get();
    if (!record.exists || record.data().active !== true) throw new CalendarError('permission-denied','This account is not a member of the household.');
  }
  async function load(uid) {
    await member(uid);
    const record = await ref().get();
    if (record.exists) return record.data();
    return db.runTransaction(async tx => {
      const existing = await tx.get(ref());
      if (existing.exists) return existing.data();
      const members = await tx.get(db.collection('households/home/members').where('active','==',true));
      if (!members.docs.length) return null;
      const legacy = await tx.getAll(...members.docs.map(person => db.doc(`privateCalendarConnections/${person.id}`)));
      const candidates = legacy.filter(record => record.exists && record.data().credential);
      if (!candidates.length) return null;
      if (candidates.length !== 1) throw new CalendarError('failed-precondition','Several Apple accounts are connected. Ask the household owner to choose which one to share.');
      const source = candidates[0], previous = source.data();
      const data = {...previous,credential:encryptCredential(decryptCredential(previous.credential,key(),source.id),key(),OWNER),managerUid:source.id,version:randomUUID(),migratedFrom:source.id};
      tx.set(ref(),data);
      return data;
    });
  }
  function manage(data,uid) {
    if (data?.managerUid && data.managerUid !== uid) throw new CalendarError('permission-denied','The person who connected Apple manages the connection and calendar selection. You can view and edit the shared calendars.');
  }
  const update = (before,data) => db.runTransaction(async tx => {
    const current = await tx.get(ref());
    checkVersion(current.exists ? current.data() : null,before?.version || null);
    tx.set(ref(),data);
  });
  return {
    async status(uid) { return calendarConnectionState(await load(uid),uid); },
    async open(uid,version) {
      const data = await load(uid);checkVersion(data,version);
      if (!data?.credential) throw new CalendarError('failed-precondition','Connect the household Apple calendar in Settings first.');
      return {data,credentials:decryptCredential(data.credential,key(),OWNER)};
    },
    async assertCurrent(uid,version) { const data = await load(uid);checkVersion(data,version); },
    async connect(uid,credentials,version) {
      const before = await load(uid);checkVersion(before,version);manage(before,uid);
      const calendars = await discover(credentials);
      const selected = (before?.selected || []).filter(id => calendars.some(calendar => calendar.id === id)).slice(0,6);
      const data = {credential:encryptCredential(credentials,key(),OWNER),calendars,selected,managerUid:uid,version:randomUUID(),updatedAt:now()};
      await update(before,data);return calendarConnectionState(data,uid);
    },
    async select(uid,selected,version) {
      const before = await load(uid);checkVersion(before,version);manage(before,uid);
      if (!before?.credential) throw new CalendarError('failed-precondition','Connect Apple Calendar first.');
      if (!Array.isArray(selected) || selected.length > 6 || !selected.every(id => before.calendars.some(calendar => calendar.id === id))) throw new CalendarError('invalid-argument','Choose up to six calendars from this account.');
      const data = {...before,selected:[...new Set(selected)],version:randomUUID(),updatedAt:now()};
      await update(before,data);return calendarConnectionState(data,uid);
    },
    async disconnect(uid,version) {
      const before = await load(uid);checkVersion(before,version);manage(before,uid);
      // Retain a marker so the old per-user recovery copy is never re-adopted.
      const data = {disconnected:true,managerUid:before?.managerUid || uid,version:randomUUID(),updatedAt:now()};
      await update(before,data);return calendarConnectionState(data,uid);
    }
  };
}
