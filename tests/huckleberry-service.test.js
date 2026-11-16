import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createHuckleberryHandler } from '../functions/huckleberry-service.js';
import { decryptCredential } from '../functions/crypto.js';
import { validTimezone, validateBabyWrite } from '../functions/huckleberry-provider.js';
function fixture() {
  const docs = new Map(), key = randomBytes(32).toString('base64'), ref = path => ({path,get:async () => ({exists:docs.has(path),data:() => structuredClone(docs.get(path))}),update:async value => docs.set(path,{...docs.get(path),...value}),set:async value => docs.set(path,value)});
  const db = {doc:ref,batch:() => { const writes = []; return {set:(ref,data) => writes.push(() => docs.set(ref.path,data)),update:(ref,data) => writes.push(() => docs.set(ref.path,{...docs.get(ref.path),...data})),delete:ref => writes.push(() => docs.delete(ref.path)),commit:async () => writes.forEach(write => write())}; }};
  let children = [{id:'child-one',name:'Frankie'},{id:'child-two',name:'Other child'}], written = 0, read = 0;
  const api = {validTimezone,validateBabyWrite,authenticateHuckleberry:async () => ({idToken:'secret-token',refreshToken:'secret-refresh',userId:'account',expiresAt:Date.now()+3600000}),refreshHuckleberry:async session => session,
    huckleberryClient:session => { assert.equal(session.idToken,'secret-token'); return {terminate:async () => {}}; },huckleberryChildren:async () => children,
    huckleberrySnapshot:async (_client,childId,timezone) => { read++; return {childId,timezone,checkedAt:new Date().toISOString(),sleeps:[]}; },writeHuckleberry:async () => { written++; return {saved:true}; }};
  const handler = createHuckleberryHandler({db,key:() => key,api});
  return {docs,key,handler,setChildren:value => {children=value;},counts:() => ({written,read})};
}
test('connections store encrypted sessions, expose no credentials, and isolate household logins', async () => {
  const {docs,key,handler} = fixture();
  const result = await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  assert.equal(result.selected,null,'Multiple children require an explicit profile choice');
  assert.equal(result.credential,undefined); assert.equal(result.idToken,undefined);
  const stored = docs.get('privateHuckleberryConnections/parent');
  assert.equal(JSON.stringify(stored).includes('password'),false); assert.equal(JSON.stringify(stored).includes('secret-token'),false);
  assert.equal(decryptCredential(stored.credential,key,'huckleberry:parent').userId,'account');
  assert.throws(() => decryptCredential(stored.credential,key,'another-parent'));
  assert.deepEqual(await handler('another-parent',{action:'status'}),{connected:false});
  await assert.rejects(handler('another-parent',{action:'snapshot'}),e => e.code === 'failed-precondition');
});
test('child changes clear snapshots and stale forms cannot write to a different child', async () => {
  const {docs,handler,counts,setChildren} = fixture();
  await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  await assert.rejects(handler('parent',{action:'select',childId:'not-shared',timezone:'America/New_York'}),e => e.code === 'permission-denied');
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  await handler('parent',{action:'snapshot'}); await handler('parent',{action:'snapshot'}); assert.equal(counts().read,1);
  await handler('parent',{action:'select',childId:'child-two',timezone:'America/New_York'}); assert.equal(docs.has('privateBabySnapshots/parent'),false);
  const entry = {kind:'diaper',mode:'poo',start:new Date().toISOString(),requestId:randomUUID()};
  await assert.rejects(handler('parent',{action:'write',childId:'child-one',entry}),e => e.code === 'aborted'); assert.equal(counts().written,0);
  await handler('parent',{action:'write',childId:'child-two',entry}); await handler('parent',{action:'write',childId:'child-two',entry}); assert.equal(counts().written,1);
  setChildren([{id:'child-one',name:'Frankie'}]);
  await assert.rejects(handler('parent',{action:'snapshot',force:true}),e => e.code === 'permission-denied');
  await handler('parent',{action:'disconnect'}); assert.equal(docs.size,0); assert.equal(counts().written,1,'Disconnect must not delete Huckleberry data');
});
test('the deployed callable wrapper rejects unauthenticated requests before provider access', async () => {
  const { huckleberry } = await import('../functions/index.js');
  await assert.rejects(huckleberry.run({data:{action:'status'}}),e => e.code === 'unauthenticated');
});
