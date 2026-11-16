import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createHuckleberryHandler } from '../functions/huckleberry-service.js';
import { encryptCredential, decryptCredential } from '../functions/crypto.js';
import { validTimezone, validateBabyWrite } from '../functions/huckleberry-provider.js';
function fixture() {
  const docs = new Map(['parent','another-parent'].map(uid => [`households/home/members/${uid}`,{active:true}]));
  const key = randomBytes(32).toString('base64');
  const snapshot = path => ({id:path.split('/').at(-1),exists:docs.has(path),data:() => structuredClone(docs.get(path))});
  const ref = path => ({path,get:async () => snapshot(path)});
  const query = (path,field,value) => ({query:true,path,field,value,get:async () => ({docs:[...docs.keys()].filter(key => key.startsWith(path+'/') && key.split('/').length===path.split('/').length+1 && docs.get(key)[field]===value).map(snapshot)})});
  const db = {
    doc:ref,collection:path => ({where:(field,_op,value) => query(path,field,value)}),
    async runTransaction(run) {
      for(let attempt=0;attempt<5;attempt++) {
        const reads=new Map(),writes=[];
        const tx={
          get:async target => {
            if(target.query) return target.get();
            reads.set(target.path,JSON.stringify(docs.get(target.path)));
            return snapshot(target.path);
          },
          getAll:(...refs) => Promise.all(refs.map(target => tx.get(target))),
          set:(target,data) => writes.push(() => docs.set(target.path,structuredClone(data))),
          update:(target,data) => writes.push(() => docs.set(target.path,{...docs.get(target.path),...structuredClone(data)})),
          delete:target => writes.push(() => docs.delete(target.path))
        };
        const result=await run(tx);
        if([...reads].some(([path,value])=>JSON.stringify(docs.get(path))!==value)) continue;
        writes.forEach(write=>write()); return result;
      }
      throw Object.assign(new Error('transaction conflict'),{code:10});
    }
  };
  let children = [{id:'child-one',name:'Frankie'},{id:'child-two',name:'Other child'}], written = 0, read = 0, authenticated=0;
  const api = {validTimezone,validateBabyWrite,authenticateHuckleberry:async (...args) => {assert.equal(args.length,2,'Timezone is never sent to authentication');authenticated++;return {idToken:'secret-token',refreshToken:'secret-refresh',userId:'account',expiresAt:Date.now()+3600000};},refreshHuckleberry:async session => session,
    huckleberryClient:session => { assert.equal(session.idToken,'secret-token'); return {terminate:async () => {}}; },huckleberryChildren:async () => children,
    huckleberrySnapshot:async (_client,childId,timezone) => { read++; return {childId,timezone,checkedAt:new Date().toISOString(),sleeps:[]}; },writeHuckleberry:async () => { written++; return {saved:true}; }};
  const handler = createHuckleberryHandler({db,key:() => key,api});
  return {docs,key,handler,api,db,setChildren:value => {children=value;},counts:() => ({written,read,authenticated})};
}
test('invalid time zones fail before login while valid zones do not change authentication',async()=>{
  const {handler,counts,docs}=fixture();
  await assert.rejects(handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'Not/A_Timezone'}),error=>error.code==='invalid-argument' && /time zone/.test(error.message));
  assert.equal(counts().authenticated,0);assert.equal(docs.size,2);
  for(const timezone of ['America/New_York','America/Los_Angeles'])await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone});
  assert.equal(counts().authenticated,2);
});
test('one encrypted household connection is available to either adult without exposing credentials', async () => {
  const {docs,key,handler} = fixture();
  const result = await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  assert.equal(result.selected,null,'Multiple children require an explicit profile choice');
  assert.equal(result.credential,undefined); assert.equal(result.idToken,undefined);
  const stored = docs.get('privateHuckleberryConnections/household-home');
  assert.equal(JSON.stringify(stored).includes('password'),false); assert.equal(JSON.stringify(stored).includes('secret-token'),false);
  assert.equal(decryptCredential(stored.credential,key,'huckleberry:household:home').userId,'account');
  assert.throws(() => decryptCredential(stored.credential,key,'another-parent'));
  assert.deepEqual(await handler('another-parent',{action:'status'}),result);
  assert.equal(result.scope,'household');
  assert.ok(result.connectionVersion);
});
test('child changes clear snapshots and stale forms cannot write to a different child', async () => {
  const {docs,handler,counts,setChildren} = fixture();
  await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  await assert.rejects(handler('parent',{action:'select',childId:'not-shared',timezone:'America/New_York'}),e => e.code === 'permission-denied');
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  await handler('parent',{action:'snapshot'}); await handler('parent',{action:'snapshot'}); assert.equal(counts().read,1);
  await handler('parent',{action:'select',childId:'child-two',timezone:'America/New_York'}); assert.equal(docs.has('privateBabySnapshots/household-home'),false);
  const chosen = await handler('parent',{action:'select',childId:'child-two',timezone:'America/New_York',sweetspotNaps:'3'});
  assert.equal(chosen.sweetspotNaps,'3'); assert.equal(docs.get('privateHuckleberryConnections/household-home').sweetspotNaps,'3');
  assert.equal((await handler('parent',{action:'status'})).sweetspotNaps,'3');
  await assert.rejects(handler('parent',{action:'select',childId:'child-two',timezone:'America/New_York',sweetspotNaps:'banana'}),e => e.code === 'invalid-argument');
  const entry = {kind:'diaper',mode:'poo',start:new Date().toISOString(),requestId:randomUUID()};
  await assert.rejects(handler('parent',{action:'write',childId:'child-one',entry}),e => e.code === 'aborted'); assert.equal(counts().written,0);
  await handler('parent',{action:'write',childId:'child-two',entry}); await handler('parent',{action:'write',childId:'child-two',entry}); assert.equal(counts().written,1);
  setChildren([{id:'child-one',name:'Frankie'}]);
  await assert.rejects(handler('parent',{action:'snapshot',force:true}),e => e.code === 'permission-denied');
  await handler('another-parent',{action:'disconnect'}); assert.equal(docs.get('privateHuckleberryConnections/household-home').disconnected,true); assert.equal(docs.has('privateBabySnapshots/household-home'),false); assert.equal(counts().written,1,'Disconnect must not delete Huckleberry data');
});
test('the deployed callable wrapper rejects unauthenticated requests before provider access', async () => {
  const { huckleberry } = await import('../functions/index.js');
  await assert.rejects(huckleberry.run({data:{action:'status'}}),e => e.code === 'unauthenticated');
});

test('save permission errors identify the rejected operation without blaming login or exposing provider data', async () => {
  const {handler,api,docs} = fixture();
  await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  api.writeHuckleberry = async () => { throw Object.assign(new Error('raw provider error secret-token private-child-id'),{code:7}); };
  await assert.rejects(handler('parent',{action:'write',childId:'child-one',entry:{kind:'diaper',mode:'poo',start:new Date().toISOString(),requestId:randomUUID()}}),error => {
    assert.equal(error.code,'permission-denied'); assert.match(error.message,/blocked this save/); assert.doesNotMatch(error.message,/Reconnect|shared|secret-token|private-child-id/);
    assert.deepEqual(error.details,{service:'huckleberry',operation:'write',reason:'PROVIDER_PERMISSION_DENIED',grpcCode:7});
    return true;
  });
  assert.deepEqual(docs.get('privateHuckleberryConnections/household-home').receipts,[]);
});

test('expired provider sessions and denied profile reads have distinct safe diagnostics', async () => {
  const {handler,api} = fixture();
  await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  api.huckleberrySnapshot = async () => { throw Object.assign(new Error('private-token'),{code:16}); };
  await assert.rejects(handler('parent',{action:'snapshot',force:true}),error => error.code==='unauthenticated' && error.details.operation==='snapshot' && error.details.grpcCode===16 && /Reconnect/.test(error.message) && !error.message.includes('private-token'));
  api.huckleberryChildren = async () => { throw Object.assign(new Error('private-child'),{code:7}); };
  await assert.rejects(handler('parent',{action:'snapshot',force:true}),error => error.code==='permission-denied' && error.details.operation==='children' && /child profiles/.test(error.message) && !error.message.includes('private-child'));
});

test('private backend storage failures are not mislabeled as a Huckleberry access rejection', async () => {
  const {handler,db} = fixture();
  await handler('parent',{action:'connect',email:'test@example.com',password:'password',timezone:'America/New_York'});
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  const denied=Object.assign(new Error('private storage failure'),{code:7});
  db.runTransaction=async()=>{throw denied;};
  await assert.rejects(handler('parent',{action:'snapshot',force:true}),error => error===denied && !error.details);
});

test('the callable returns only safe provider diagnostics for a rejected login',async t=>{
  const {huckleberry}=await import('../functions/index.js');
  const {getFirestore}=await import('../functions/node_modules/firebase-admin/lib/firestore/index.js');
  const db=getFirestore(),oldDoc=db.doc,oldFetch=globalThis.fetch;
  t.after(()=>{db.doc=oldDoc;globalThis.fetch=oldFetch;});
  db.doc=path=>({get:async()=>({exists:path.startsWith('households/'),data:()=>({active:true})})});
  globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({error:{message:'TOO_MANY_ATTEMPTS_TRY_LATER : do-not-log-password',email:'do-not-log@example.com'}})});
  await assert.rejects(huckleberry.run({auth:{uid:'member'},data:{action:'connect',email:'sample@example.com',password:'do-not-log-password',timezone:'America/New_York'}}),error=>{
    assert.equal(error.code,'resource-exhausted');assert.deepEqual(error.details,{service:'huckleberry',reason:'TOO_MANY_ATTEMPTS_TRY_LATER',httpStatus:400});assert.doesNotMatch(error.message+JSON.stringify(error.details),/do-not-log/);return true;
  });
});

test('either adult can read, log and manage the shared profile and nap plan',async()=>{
  const {handler,counts,docs}=fixture();
  await handler('parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  const selected=await handler('another-parent',{action:'select',childId:'child-one',timezone:'America/Chicago',sweetspotNaps:'3'});
  assert.deepEqual(await handler('parent',{action:'status'}),selected);
  const a=await handler('parent',{action:'snapshot'}), b=await handler('another-parent',{action:'snapshot'});
  assert.deepEqual(a,b);assert.equal(counts().read,1);assert.equal(counts().authenticated,1);
  assert.equal(b.connection.sweetspotNaps,'3');assert.equal(b.timezone,'America/Chicago');
  const entry={kind:'diaper',mode:'pee',start:new Date().toISOString(),requestId:randomUUID()};
  await handler('another-parent',{action:'write',childId:'child-one',connectionVersion:selected.connectionVersion,entry});
  assert.equal(docs.has('privateBabySnapshots/household-home'),false);
  assert.equal((await handler('parent',{action:'write',childId:'child-one',entry})).duplicate,true);
  assert.equal(counts().written,1);
});
function legacyConnection(key,selected='child-one') {
  return {credential:encryptCredential({idToken:'secret-token',refreshToken:'secret-refresh',userId:'account',expiresAt:Date.now()+3600000},key,'huckleberry:parent'),children:[{id:'child-one',name:'Frankie'}],selected,timezone:'America/New_York',sweetspotNaps:'3',receipts:['already-saved']};
}
test('the partner automatically adopts the existing connection without another login or losing history; disconnect stays disconnected',async()=>{
  const {handler,docs,key,counts}=fixture();
  const legacy=legacyConnection(key), history={childId:'child-one',timezone:'America/New_York',checkedAt:new Date().toISOString(),sleeps:[{start:'2026-11-15T15:00:00Z',end:'2026-11-15T16:00:00Z'}]};
  docs.set('privateHuckleberryConnections/parent',structuredClone(legacy));docs.set('privateBabySnapshots/parent',structuredClone(history));
  const adopted=await handler('another-parent',{action:'status'});
  assert.equal(adopted.connected,true);assert.equal(adopted.selected,'child-one');assert.equal(adopted.sweetspotNaps,'3');
  assert.deepEqual(await handler('parent',{action:'status'}),adopted);
  const shared=docs.get('privateHuckleberryConnections/household-home');
  assert.equal(decryptCredential(shared.credential,key,'huckleberry:household:home').userId,'account');
  assert.throws(()=>decryptCredential(shared.credential,key,'huckleberry:another-parent'));
  assert.deepEqual(shared.receipts,['already-saved']);
  const snapshot=await handler('another-parent',{action:'snapshot'});
  assert.deepEqual(snapshot.sleeps,history.sleeps);assert.equal(counts().authenticated,0);assert.equal(counts().read,0);
  assert.deepEqual(docs.get('privateHuckleberryConnections/parent'),legacy);assert.deepEqual(docs.get('privateBabySnapshots/parent'),history);
  await handler('another-parent',{action:'disconnect',connectionVersion:adopted.connectionVersion});
  assert.equal((await handler('parent',{action:'status'})).connected,false);
  assert.equal((await handler('another-parent',{action:'status'})).connected,false);
  assert.equal(docs.get('privateHuckleberryConnections/household-home').credential,undefined);
  assert.equal(docs.has('privateBabySnapshots/household-home'),false);
  assert.equal(counts().written,0);assert.deepEqual(docs.get('privateHuckleberryConnections/parent'),legacy);
  await handler('another-parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  assert.equal((await handler('parent',{action:'status'})).connected,true);
});
test('outsiders and removed members cannot discover or manage the shared connection, including internal callers',async()=>{
  const {handler,docs,counts}=fixture();
  await handler('parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  docs.set('households/home/members/another-parent',{active:false});
  for(const uid of ['outsider','another-parent']) for(const action of ['status','snapshot','select','write','connect','disconnect']) {
    await assert.rejects(handler(uid,{action}),error=>error.code==='permission-denied');
  }
  await assert.rejects(handler(null,{action:'status'}),error=>error.code==='unauthenticated');
  assert.equal(counts().authenticated,1);assert.equal(counts().written,0);
  assert.equal((await handler('parent',{action:'status'})).connected,true);
});
test('migration ignores inactive members and never guesses between multiple active legacy accounts',async()=>{
  const {handler,docs,key}=fixture();
  docs.set('privateHuckleberryConnections/parent',legacyConnection(key));
  docs.set('privateHuckleberryConnections/another-parent',legacyConnection(key));
  await assert.rejects(handler('parent',{action:'status'}),error=>error.code==='failed-precondition' && /More than one/.test(error.message));
  assert.equal(docs.has('privateHuckleberryConnections/household-home'),false);
  docs.set('households/home/members/another-parent',{active:false});
  assert.equal((await handler('parent',{action:'status'})).connected,true);
});
test('stale forms cannot overwrite another adult’s settings or save through a replacement connection',async()=>{
  const {handler,counts}=fixture();
  await handler('parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  const old=await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  const next=await handler('another-parent',{action:'select',childId:'child-one',timezone:'America/Chicago',connectionVersion:old.connectionVersion});
  const entry={kind:'diaper',mode:'pee',start:new Date().toISOString(),requestId:randomUUID()};
  for(const action of ['write','select','disconnect','connect']) {
    await assert.rejects(handler('parent',{action,connectionVersion:old.connectionVersion,childId:'child-one',timezone:'America/New_York',entry}),error=>error.code==='aborted');
  }
  assert.deepEqual(await handler('parent',{action:'status'}),next);assert.equal(counts().written,0);assert.equal(counts().authenticated,1);
});
test('an in-flight snapshot cannot overwrite a newly selected household profile',async()=>{
  const {handler,api,docs}=fixture();
  await handler('parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  let release,started;const begun=new Promise(resolve=>{started=resolve;});
  api.huckleberrySnapshot=async()=>{started();return new Promise(resolve=>{release=()=>resolve({childId:'child-one',sleeps:[]});});};
  const pending=handler('parent',{action:'snapshot',force:true});await begun;
  await handler('another-parent',{action:'select',childId:'child-two',timezone:'America/New_York'});
  release();await assert.rejects(pending,error=>error.code==='aborted');
  assert.equal(docs.has('privateBabySnapshots/household-home'),false);
  assert.equal((await handler('parent',{action:'status'})).selected,'child-two');
});
test('an in-flight credential refresh cannot resurrect a disconnected household',async()=>{
  const {handler,api}=fixture();
  await handler('parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  let release,started;const begun=new Promise(resolve=>{started=resolve;});
  api.refreshHuckleberry=async session=>{started();return new Promise(resolve=>{release=()=>resolve(session);});};
  const pending=handler('parent',{action:'snapshot'});await begun;
  await handler('another-parent',{action:'disconnect'});release();
  await assert.rejects(pending,error=>error.code==='aborted');
  assert.equal((await handler('parent',{action:'status'})).connected,false);
});
test('simultaneous logs retain both adults’ retry receipts',async()=>{
  const {handler,docs,counts}=fixture();
  await handler('parent',{action:'connect',email:'sample@example.com',password:'password',timezone:'America/New_York'});
  await handler('parent',{action:'select',childId:'child-one',timezone:'America/New_York'});
  const entries=['pee','poo'].map(mode=>({kind:'diaper',mode,start:new Date().toISOString(),requestId:randomUUID()}));
  await Promise.all(entries.map((entry,i)=>handler(i?'another-parent':'parent',{action:'write',childId:'child-one',entry})));
  assert.equal(docs.get('privateHuckleberryConnections/household-home').receipts.length,2);
  for(const entry of entries) assert.equal((await handler('another-parent',{action:'write',childId:'child-one',entry})).duplicate,true);
  assert.equal(counts().written,2);
});

test('simultaneous first visits adopt exactly one shared connection',async()=>{
  const {handler,docs,key,counts}=fixture();
  docs.set('privateHuckleberryConnections/parent',legacyConnection(key));
  const [first,second]=await Promise.all(['parent','another-parent'].map(uid=>handler(uid,{action:'status'})));
  assert.deepEqual(first,second);assert.equal(first.connected,true);
  assert.equal(docs.get('privateHuckleberryConnections/household-home').version,first.connectionVersion);
  assert.equal(counts().authenticated,0);
});
