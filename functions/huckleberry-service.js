import { randomUUID } from 'node:crypto';
import { encryptCredential, decryptCredential } from './crypto.js';
import * as provider from './huckleberry-provider.js';

async function providerCall(operation, run) {
  try { return await run(); }
  catch (error) {
    if (error instanceof provider.HuckleberryError) throw error;
    if (error.code === 16) throw new provider.HuckleberryError('unauthenticated','Your Huckleberry session is no longer valid. Reconnect in Settings.',{service:'huckleberry',operation,reason:'PROVIDER_UNAUTHENTICATED',grpcCode:16});
    if (error.code === 7) {
      const message = operation === 'write'
        ? 'Huckleberry blocked this save. Your account connected successfully. Try again later or record this entry in Huckleberry.'
        : operation === 'children'
          ? 'Huckleberry denied access to this account’s child profiles. Check access in the Huckleberry app.'
          : 'Huckleberry denied access to this child’s tracking data. Check that the profile is still shared in Huckleberry.';
      throw new provider.HuckleberryError('permission-denied',message,{service:'huckleberry',operation,reason:'PROVIDER_PERMISSION_DENIED',grpcCode:7});
    }
    throw error;
  }
}

// One server-only connection for this household. The legacy per-login records
// remain untouched during adoption; a disconnect marker prevents re-adoption.
const SHARED_ID = 'household-home';
const SHARED_OWNER = 'huckleberry:household:home';
const changed = () => new provider.HuckleberryError('aborted','The household Huckleberry settings changed. Refresh and try again.');
const checkVersion = (current, expected) => {
  if ((current?.version || null) !== (expected?.version || null)) throw changed();
};
export function createHuckleberryHandler({ db, key, api = provider, now = Date.now }) {
  const publicState = data => data?.credential
    ? {connected:true,scope:'household',connectionVersion:data.version,children:data.children,selected:data.selected,timezone:data.timezone,sweetspotNaps:provider.validNapPlan(data.sweetspotNaps)}
    : {connected:false,scope:'household',connectionVersion:data?.version || null};
  const sharedRef = () => db.doc(`privateHuckleberryConnections/${SHARED_ID}`);
  const sharedCache = () => db.doc(`privateBabySnapshots/${SHARED_ID}`);
  async function loadShared(migrate) {
    const ref = sharedRef(), record = await ref.get();
    if (record.exists || !migrate) return record.exists ? record.data() : null;
    // These are OUR Firestore transactions, authenticated as our service account.
    // The Huckleberry provider still uses guarded ordinary atomic batches.
    return db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) return existing.data();
      const members = await tx.get(db.collection('households/home/members').where('active','==',true));
      if (!members.docs.length) return null;
      const legacy = await tx.getAll(...members.docs.map(member => db.doc(`privateHuckleberryConnections/${member.id}`)));
      const candidates = legacy.filter(doc => doc.exists && doc.data().credential);
      if (!candidates.length) return null;
      if (candidates.length !== 1) throw new provider.HuckleberryError('failed-precondition','More than one Huckleberry account was connected. Connect the account you want to share in Settings.');
      const source = candidates[0], old = source.data(), cache = await tx.get(db.doc(`privateBabySnapshots/${source.id}`));
      const version = randomUUID(), session = decryptCredential(old.credential,key(),`huckleberry:${source.id}`);
      const data = {...old,credential:encryptCredential(session,key(),SHARED_OWNER),version,migratedFrom:source.id};
      tx.set(ref,data);
      if (cache.exists && cache.data().childId === old.selected && cache.data().timezone === old.timezone) {
        tx.set(sharedCache(),{...cache.data(),connectionVersion:version});
      }
      return data;
    });
  }
  const change = (expected, update) => db.runTransaction(async tx => {
    const ref = sharedRef(), record = await tx.get(ref), current = record.exists ? record.data() : null;
    checkVersion(current,expected);
    return update(tx,ref,current);
  });
  return async (uid, input) => {
    // This also protects internal callers such as Siri and the newsletter.
    if (!uid) throw new provider.HuckleberryError('unauthenticated','Sign in to your household first.');
    const member = await db.doc(`households/home/members/${uid}`).get();
    if (!member.exists || member.data().active !== true) throw new provider.HuckleberryError('permission-denied','This account is not a member of the household.');
    const action = input.action;
    if (!['status','connect','select','snapshot','write','recent','change','disconnect'].includes(action)) throw new provider.HuckleberryError('invalid-argument','Choose a Huckleberry action.');
    const connectTimezone = action === 'connect' ? api.validTimezone(input.timezone) : null;
    const connection = await loadShared(!['connect','disconnect'].includes(action)), cacheRef = sharedCache();
    if (input.connectionVersion !== undefined && input.connectionVersion !== (connection?.version || null)) throw changed();
    if (action === 'status') return publicState(connection);
    if (action === 'disconnect') {
      const data = {version:randomUUID(),disconnected:true,updatedBy:uid};
      await change(connection,(tx,ref) => { tx.set(ref,data); tx.delete(cacheRef); });
      return publicState(data);
    }
    if (!connection?.credential && action !== 'connect') throw new provider.HuckleberryError('failed-precondition','Connect the household Huckleberry account in Settings first.');
    if (action === 'write') api.validateBabyWrite(input.entry, now());
    const session = action === 'connect'
      ? await api.authenticateHuckleberry(String(input.email || '').trim(),input.password)
      : await api.refreshHuckleberry(decryptCredential(connection.credential,key(),SHARED_OWNER));
    const client = api.huckleberryClient(session);
    try {
      if (action === 'connect') {
        const children = await providerCall('children',() => api.huckleberryChildren(client,session.userId));
        if (!children.length) throw new provider.HuckleberryError('failed-precondition','Add a child in Huckleberry, then reconnect.');
        const selected = children.length === 1 ? children[0].id : null;
        const data = {credential:encryptCredential(session,key(),SHARED_OWNER),children,selected,timezone:connectTimezone,sweetspotNaps:'4',receipts:[],version:randomUUID(),updatedBy:uid};
        await change(connection,(tx,ref) => { tx.set(ref,data); tx.delete(cacheRef); });
        return publicState(data);
      }
      // Refreshes cannot resurrect a disconnected or replaced connection.
      await change(connection,(tx,ref) => tx.update(ref,{credential:encryptCredential(session,key(),SHARED_OWNER)}));
      if (action === 'select') {
        const children = await providerCall('children',() => api.huckleberryChildren(client,session.userId));
        if (!children.some(child => child.id === input.childId)) throw new provider.HuckleberryError('permission-denied','Choose a child in the household Huckleberry account.');
        const timezone = api.validTimezone(input.timezone), sweetspotNaps = provider.validNapPlan(input.sweetspotNaps ?? connection.sweetspotNaps);
        const patch = {children,selected:input.childId,timezone,sweetspotNaps,version:randomUUID(),updatedBy:uid};
        await change(connection,(tx,ref) => { tx.update(ref,patch); tx.delete(cacheRef); });
        return publicState({...connection,...patch});
      }
      const child = connection.selected;
      if (!child || !connection.children.some(item => item.id === child)) throw new provider.HuckleberryError('failed-precondition','Choose a child profile in Settings.');
      // Recheck provider account membership before accessing or mutating a child.
      const children = await providerCall('children',() => api.huckleberryChildren(client,session.userId));
      if (!children.some(item => item.id === child)) throw new provider.HuckleberryError('permission-denied','This child is no longer shared with the household Huckleberry account. Choose a profile in Settings.');
      if (action === 'recent') return providerCall('recent',() => api.huckleberryRecent(client,child,now()));
      if (action === 'change') {
        // Edit or delete one recent entry. The entry's own version guards against
        // overwriting a change made meanwhile in the Huckleberry app.
        if (input.childId !== child) throw new provider.HuckleberryError('aborted','The selected child changed. Refresh the list.');
        checkVersion((await sharedRef().get()).data(),connection);
        const result = await providerCall('write',() => api.changeHuckleberry(client,child,input.entry,connection.timezone,now()));
        await change(connection,tx => tx.delete(cacheRef)).catch(() => {}); // the next refresh reloads history
        return result;
      }
      if (action === 'write') {
        if (input.childId !== child) throw new provider.HuckleberryError('aborted','The selected child changed. Reopen the log form.');
        const current = (await sharedRef().get()).data();
        checkVersion(current,connection);
        const receipt = `${child}/${input.entry.requestId}/${input.entry.kind}`;
        if (current.receipts?.includes(receipt)) return {saved:true,duplicate:true};
        const result = await providerCall('write',() => api.writeHuckleberry(client,child,input.entry,connection.timezone,now()));
        // A failed local update must not misreport a successful provider write.
        // Merge receipts from both adults; provider IDs also protect retries.
        try {
          await change(connection,(tx,ref,latest) => {
            tx.update(ref,{receipts:[...new Set([...(latest.receipts || []),receipt])].slice(-50)});
            tx.delete(cacheRef);
          });
        } catch { /* next forced refresh reloads provider data */ }
        return result;
      }
      const cachedDoc = await cacheRef.get(), cachedData = cachedDoc.exists ? cachedDoc.data() : null;
      const cached = cachedData?.childId === child && cachedData.connectionVersion === connection.version ? cachedData : null;
      if (!input.force && cached && now() - Date.parse(cached.checkedAt) < 120000) return {...cached,connection:publicState(connection)};
      const snapshot = await providerCall('snapshot',() => api.huckleberrySnapshot(client,child,connection.timezone,cached,input.force === true,now(),connection.sweetspotNaps,input.light === true));
      await change(connection,tx => tx.set(cacheRef,{...snapshot,connectionVersion:connection.version}));
      return {...snapshot,connectionVersion:connection.version,connection:publicState(connection)};
    } finally { await client.terminate().catch(() => {}); }
  };
}
