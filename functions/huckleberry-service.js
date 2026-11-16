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

// Only this callable can read these collections. Each household login owns its
// connection; neither provider credentials nor raw child documents reach clients.
export function createHuckleberryHandler({ db, key, api = provider, now = Date.now }) {
  const publicState = data => data ? {connected:true,children:data.children,selected:data.selected,timezone:data.timezone} : {connected:false};
  return async (uid, input) => {
    const ref = db.doc(`privateHuckleberryConnections/${uid}`), cacheRef = db.doc(`privateBabySnapshots/${uid}`);
    const action = input.action;
    if (!['status','connect','select','snapshot','write','disconnect'].includes(action)) throw new provider.HuckleberryError('invalid-argument','Choose a Huckleberry action.');
    if (action === 'disconnect') { const batch = db.batch(); batch.delete(ref); batch.delete(cacheRef); await batch.commit(); return {connected:false}; }
    const record = await ref.get(), connection = record.exists ? record.data() : null;
    if (action === 'status') return publicState(connection);
    if (!connection && action !== 'connect') throw new provider.HuckleberryError('failed-precondition','Connect Huckleberry in Settings first.');
    const owner = `huckleberry:${uid}`;
    const connectTimezone=action==='connect' ? api.validTimezone(input.timezone) : null;
    if (action === 'write') api.validateBabyWrite(input.entry, now());
    let session = action === 'connect' ? await api.authenticateHuckleberry(String(input.email || '').trim(),input.password) : await api.refreshHuckleberry(decryptCredential(connection.credential,key(),owner));
    const client = api.huckleberryClient(session);
    try {
      if (action === 'connect') {
        const timezone = connectTimezone, children = await providerCall('children',() => api.huckleberryChildren(client,session.userId));
        if (!children.length) throw new provider.HuckleberryError('failed-precondition','Add a child in Huckleberry, then reconnect.');
        const selected = children.length === 1 ? children[0].id : null;
        const data = {credential:encryptCredential(session,key(),owner),children,selected,timezone,receipts:[]};
        const batch = db.batch(); batch.set(ref,data); batch.delete(cacheRef); await batch.commit();
        return publicState(data);
      }
      await ref.update({credential:encryptCredential(session,key(),owner)});
      if (action === 'select') {
        const children = await providerCall('children',() => api.huckleberryChildren(client,session.userId));
        if (!children.some(child => child.id === input.childId)) throw new provider.HuckleberryError('permission-denied','Choose a child in your connected Huckleberry account.');
        const timezone = api.validTimezone(input.timezone), data = {...connection,children,selected:input.childId,timezone,receipts:[]};
        const batch = db.batch(); batch.update(ref,{children,selected:input.childId,timezone,receipts:[]}); batch.delete(cacheRef); await batch.commit();
        return publicState(data);
      }
      const child = connection.selected;
      if (!child || !connection.children.some(item => item.id === child)) throw new provider.HuckleberryError('failed-precondition','Choose a child profile in Settings.');
      // Recheck current account membership before accessing or mutating a child.
      const children = await providerCall('children',() => api.huckleberryChildren(client,session.userId));
      if (!children.some(item => item.id === child)) throw new provider.HuckleberryError('permission-denied','This child is no longer shared with your Huckleberry account. Choose a profile in Settings.');
      if (action === 'write') {
        if (input.childId !== child) throw new provider.HuckleberryError('aborted','The selected child changed. Reopen the log form.');
        const receipt = `${child}/${input.entry.requestId}/${input.entry.kind}`;
        if (connection.receipts?.includes(receipt)) return {saved:true,duplicate:true};
        const result = await providerCall('write',() => api.writeHuckleberry(client,child,input.entry,connection.timezone,now()));
        // A failed cache invalidation must not misreport a successful provider
        // write. Stable request IDs also make uncertain network retries safe.
        try { const batch = db.batch(); batch.update(ref,{receipts:[...(connection.receipts || []),receipt].slice(-50)}); batch.delete(cacheRef); await batch.commit(); } catch { /* next forced refresh reloads provider data */ }
        return result;
      }
      const cachedDoc = await cacheRef.get(), cached = cachedDoc.exists && cachedDoc.data().childId === child ? cachedDoc.data() : null;
      if (!input.force && cached && now() - Date.parse(cached.checkedAt) < 120000) return cached;
      const snapshot = await providerCall('snapshot',() => api.huckleberrySnapshot(client,child,connection.timezone,cached,input.force === true,now()));
      await cacheRef.set(snapshot); return snapshot;
    } finally { await client.terminate().catch(() => {}); }
  };
}
