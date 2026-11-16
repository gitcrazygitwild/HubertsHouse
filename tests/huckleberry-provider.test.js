import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { authenticateHuckleberry, huckleberryClient, huckleberrySnapshot, normalizeSleepHistory, normalizeFeedHistory, HISTORY_DAYS, validateBabyWrite, writeHuckleberry } from '../functions/huckleberry-provider.js';
// The exact gRPC copy Firestore uses, resolved from Firestore's own dependency tree.
const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const grpc = createRequire(functionsRequire.resolve('google-gax'))('@grpc/grpc-js');
const now = Date.parse('2026-11-15T15:00:00Z'), start = new Date(now - 3600000).toISOString();
// Queue writes until the transaction callback succeeds, matching atomic commits.
function memory(initial) {
  const docs = new Map(Object.entries(structuredClone(initial))), ref = path => ({path,collection:name => ({doc:id => ref(`${path}/${name}/${id}`)})});
  const get = reference => ({exists:docs.has(reference.path),data:() => structuredClone(docs.get(reference.path))});
  const deep = (base, patch) => { for (const [key,value] of Object.entries(patch)) base[key] = value && typeof value === 'object' && !Array.isArray(value) ? deep(base[key] || {},value) : value; return base; };
  const client = {docs,doc:ref,runTransaction:async callback => {
    const writes = []; const result = await callback({get:async reference => get(reference),
      create:(reference,data) => writes.push(() => { assert.equal(docs.has(reference.path),false); docs.set(reference.path,data); }),
      set:(reference,data,options) => writes.push(() => docs.set(reference.path,options?.merge ? deep(docs.get(reference.path) || {},data) : options?.mergeFields ? {...docs.get(reference.path),...data} : data)),
      update:(reference,data) => writes.push(() => docs.set(reference.path,{...docs.get(reference.path),...data}))});
    writes.forEach(write => write()); return result;
  }}; return client;
}
test('provider auth uses only the Huckleberry session and sanitizes authentication failures', async () => {
  const session = await authenticateHuckleberry('test@example.com','private-password',async (_url,options) => {
    assert.deepEqual(JSON.parse(options.body),{email:'test@example.com',password:'private-password',returnSecureToken:true});
    return {ok:true,json:async () => ({idToken:'example-token',refreshToken:'example-refresh',localId:'example-user',expiresIn:'3600'})};
  });
  assert.equal(session.password,undefined);
  const client = huckleberryClient(session);
  // Check the token the way Firestore's gRPC transport actually reads it. A
  // mismatched google-auth-library returns a Headers object whose keys gRPC
  // cannot enumerate, so the request went out unauthenticated.
  const authClient = await client._settings.auth.getClient();
  const metadata = await grpc.credentials.createFromGoogleCredential(authClient).generateMetadata({service_url:'https://firestore.googleapis.com'});
  assert.deepEqual(metadata.get('authorization'),['Bearer example-token']); assert.equal(client.projectId,'simpleintervals'); await client.terminate();
  await assert.rejects(authenticateHuckleberry('test@example.com','secret',async () => ({ok:false,status:400,json:async () => ({secret:'do not expose'})})),error => error.code === 'unavailable' && !error.message.includes('secret'));
});
test('authentication distinguishes credential rejection, throttling and API restrictions without exposing provider payloads',async()=>{
  const cases=[
    [400,{message:'INVALID_LOGIN_CREDENTIALS'},'unauthenticated','INVALID_LOGIN_CREDENTIALS'],
    [400,{message:'TOO_MANY_ATTEMPTS_TRY_LATER : raw account details'},'resource-exhausted','TOO_MANY_ATTEMPTS_TRY_LATER'],
    [429,{},'resource-exhausted','TOO_MANY_REQUESTS'],
    [403,{message:'Requests from this server are blocked',details:[{reason:'API_KEY_IP_ADDRESS_BLOCKED',metadata:{private:'secret'}}]},'failed-precondition','API_KEY_IP_ADDRESS_BLOCKED'],
    [400,{message:'MISSING_RECAPTCHA_TOKEN'},'failed-precondition','MISSING_RECAPTCHA_TOKEN'],
    [400,{message:'OPERATION_NOT_ALLOWED'},'failed-precondition','OPERATION_NOT_ALLOWED'],
    [503,{message:'secret-user@example.com secret-password'},'unavailable','PROVIDER_UNAVAILABLE'],
    [400,{message:'unknown with secret-password'},'unavailable','UNKNOWN']
  ];
  for(const [status,body,code,reason] of cases)await assert.rejects(authenticateHuckleberry('test@example.com','secret-password',async()=>({ok:false,status,json:async()=>({error:body})})),error=>{
    assert.equal(error.code,code);assert.deepEqual(error.details,{service:'huckleberry',reason,httpStatus:status});
    assert.doesNotMatch(JSON.stringify(error)+error.message,/secret-password|secret-user|raw account details/);return true;
  });
});
test('unreachable and malformed authentication responses never masquerade as a wrong password',async()=>{
  for(const fetcher of [async()=>{throw new Error('network request with secret-password');},async()=>({ok:false,status:502,json:async()=>{throw new Error('not JSON');}}),async()=>({ok:true,json:async()=>null})]) {
    await assert.rejects(authenticateHuckleberry('test@example.com','secret-password',fetcher),error=>error.code==='unavailable' && !error.message.includes('secret-password'));
  }
});
test('sleep normalization handles archived batches, seconds/milliseconds, duplicates and invalid entries', () => {
  const entry = {start:(now - 3600000)/1000,duration:1800};
  const values = normalizeSleepHistory([entry,{multi:true,data:{one:entry,two:{start:now-1800000,duration:900}}},{start:now/1000,duration:-1}],now-86400000,now);
  assert.equal(values.length,2); assert.equal(values[0].end,'2026-11-15T14:30:00.000Z');
});
test('new and backdated bottles are idempotent and preserve newer summaries and unrelated data', async () => {
  const client = memory({'feed/child':{prefs:{lastBottle:{start:now/1000,bottleAmount:5},other:'keep'},timer:{active:true},untouched:42}});
  const entry = {kind:'bottle',requestId:randomUUID(),start,amount:4,units:'oz',bottleType:'Formula'};
  await writeHuckleberry(client,'child',entry,'America/New_York',now); await writeHuckleberry(client,'child',entry,'America/New_York',now);
  assert.equal(client.docs.size,2); assert.equal(client.docs.get('feed/child').prefs.lastBottle.bottleAmount,5);
  assert.equal(client.docs.get('feed/child').timer.active,true); assert.equal(client.docs.get('feed/child').untouched,42);
  const interval = [...client.docs.entries()].find(([key]) => key.includes('/intervals/'))[1];
  assert.equal(interval.start,Date.parse(start)/1000); assert.equal(interval.offset,300); assert.equal(interval.amount,4); assert.equal(interval.units,'oz');
});
test('sleep start, stop and retries preserve details and reject a changed timer atomically', async () => {
  const client = memory({'sleep/child':{prefs:{lastSleep:{start:1,duration:2},other:'keep'},timer:{active:false,details:{old:'discard'}}}});
  const entry = {kind:'sleep-start',requestId:randomUUID(),start};
  await writeHuckleberry(client,'child',entry,'America/New_York',now);
  const timer = client.docs.get('sleep/child').timer; assert.equal(timer.timerStartTime,Date.parse(start)); assert.equal(timer.details,undefined);
  await writeHuckleberry(client,'child',entry,'America/New_York',now); assert.equal(client.docs.size,1);
  const stop = {kind:'sleep-stop',start:new Date(now).toISOString(),requestId:randomUUID(),timerId:'wrong',expectedStart:start};
  await assert.rejects(writeHuckleberry(client,'child',stop,'America/New_York',now),e => e.code === 'aborted'); assert.equal(client.docs.size,1);
  timer.details = {notes:'Keep this sleep note'}; timer.paused = true; timer.timerEndTime = now - 600000;
  stop.timerId = timer.uuid; await writeHuckleberry(client,'child',stop,'America/New_York',now);
  await writeHuckleberry(client,'child',stop,'America/New_York',now);
  assert.equal(client.docs.size,2); assert.equal(client.docs.get('sleep/child').timer.active,false); assert.equal(client.docs.get('sleep/child').prefs.other,'keep');
  const interval = [...client.docs.entries()].find(([key]) => key.includes('/intervals/'))[1];
  assert.equal(interval.duration,3000); assert.equal(interval.details.notes,'Keep this sleep note');
  await writeHuckleberry(client,'child',entry,'America/New_York',now); assert.equal(client.docs.get('sleep/child').timer.active,false,'Retrying start after stop must not restart sleep');
});
test('invalid writes are rejected before touching provider data', () => {
  const base = {kind:'bottle',requestId:randomUUID(),start,amount:4,units:'oz',bottleType:'Formula'};
  for (const patch of [{amount:0},{amount:65},{units:'cups'},{bottleType:'Unknown'},{start:'invalid'},{start:'2030-01-01'},{requestId:'bad'},{kind:'delete'},{notes:'x'.repeat(1001)}]) assert.throws(() => validateBabyWrite({...base,...patch},now));
});
test('snapshot selects the saved SweetSpot and exposes only normalized fields', async () => {
  const records = {'childs/child':{childsName:'Frankie',private:'omit',sweetspot:{selectedNapDay:2,sweetSpotTimes:{2:now+3600000,3:now+7200000}}},'sleep/child':{timer:{active:true,timerStartTime:now-3600000,uuid:'timer'},prefs:{lastSleep:{start:(now-7200000)/1000,duration:1800}}},'feed/child':{prefs:{lastBottle:{start:now/1000,bottleAmount:4,bottleUnits:'oz',bottleType:'Formula'}}}};
  const client = {doc:path => ({get:async () => ({exists:!!records[path],data:() => records[path]})})};
  const snapshot = await huckleberrySnapshot(client,'child','America/New_York',{sleeps:[],bottles:[],historyComplete:true,historyCheckedAt:new Date(now).toISOString()},false,now);
  assert.equal(snapshot.bottles.length,1); assert.equal(snapshot.bottles[0].amount,4);
  assert.equal(snapshot.sweetspot.time,'2026-11-15T16:00:00.000Z'); assert.equal(snapshot.timer.start,start); assert.equal(snapshot.sleeps.length,1); assert.equal(snapshot.lastBottle.amount,4); assert.equal(snapshot.private,undefined);
});

test('bottle history keeps only valid bottle feeds, including archived batches, and drops breast feeds', () => {
  const bottle = {mode:'bottle',start:(now - 3600000)/1000,amount:4,units:'oz',bottleType:'Formula'};
  const values = normalizeFeedHistory([bottle,{multi:true,data:{a:bottle,b:{mode:'bottle',start:now - 7200000,amount:120,units:'ml',bottleType:'Breast Milk'}}},
    {mode:'breast',start:now/1000 - 60,leftDuration:300},{mode:'bottle',start:now/1000 - 60,amount:0,units:'oz'},{mode:'bottle',start:now/1000 - 60,amount:5,units:'cups'},{mode:'bottle',start:now/1000 - 60,amount:99,units:'oz'}],now - 86400000,now);
  assert.deepEqual(values.map(v => [v.amount,v.units,v.type]),[[120,'ml','Breast Milk'],[4,'oz','Formula']]);
});
test(`snapshot reloads ${HISTORY_DAYS} days of sleep and bottle history, and refreshes a cache made before bottles existed`, async () => {
  const records = {'childs/child':{childsName:'Frankie'},'sleep/child':{},'feed/child':{},'diaper/child':{}};
  const queries = [];
  const query = (path, clauses = []) => ({where:(field,op,value) => query(path,[...clauses,[field,op,value]]),orderBy:() => query(path,clauses),limit:() => query(path,clauses),
    get:async () => { queries.push({path,clauses}); const multi = clauses.some(([field]) => field === 'multi');
      const docs = multi ? [] : path.startsWith('sleep') ? [{data:() => ({start:(now - 40 * 86400000)/1000,duration:3600})}] : [{data:() => ({mode:'bottle',start:(now - 50 * 86400000)/1000,amount:3,units:'oz'})}];
      return {docs,size:docs.length}; }});
  const client = {doc:path => ({get:async () => ({exists:!!records[path],data:() => records[path]})}),collection:path => query(path)};
  const snapshot = await huckleberrySnapshot(client,'child','America/New_York',{sleeps:[],historyComplete:true,historyCheckedAt:new Date(now).toISOString()},false,now);
  const range = queries.find(q => q.path === 'feed/child/intervals' && q.clauses.length === 2);
  assert.equal(range.clauses[0][2],(now - HISTORY_DAYS * 86400000)/1000);
  assert.equal(snapshot.sleeps.length,1); assert.equal(snapshot.bottles.length,1); assert.equal(snapshot.feedsComplete,true); assert.equal(snapshot.historyDays,HISTORY_DAYS);
});
