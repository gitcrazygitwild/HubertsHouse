import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createCalendarConnections} from '../functions/calendar-connections.js';
import {encryptCredential,decryptCredential} from '../functions/crypto.js';
import {CalDAV} from '../functions/caldav.js';

function fixture() {
  const docs=new Map(['owner','partner'].map(uid=>[`households/home/members/${uid}`,{active:true}]));
  const key=randomBytes(32).toString('base64');
  const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),delete:async()=>docs.delete(path)});
  const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
  const query=(path,field,op,value)=>({query:true,get:async()=>({docs:[...docs.keys()].filter(key=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1&&(op==='in'?value.includes(docs.get(key)[field]):docs.get(key)[field]===value)).map(snap)})});
  const db={doc:ref,getAll:async(...refs)=>refs.map(ref=>snap(ref.path)),collection:path=>({where:(field,op,value)=>query(path,field,op,value)}),async runTransaction(run){
    for(let i=0;i<5;i++){
      const reads=new Map(),writes=[];
      const tx={get:async target=>{if(target.query)return target.get();reads.set(target.path,JSON.stringify(docs.get(target.path)));return snap(target.path);},getAll:(...refs)=>Promise.all(refs.map(ref=>tx.get(ref))),set:(ref,value)=>writes.push(()=>docs.set(ref.path,structuredClone(value)))};
      const result=await run(tx);
      if([...reads].some(([path,value])=>JSON.stringify(docs.get(path))!==value))continue;
      writes.forEach(fn=>fn());return result;
    }
    throw Object.assign(new Error('Conflict'),{code:10});
  }};
  const calendars=[{id:'family',name:'Family',writable:true,url:'https://p42-caldav.icloud.com/123/family/'},{id:'private',name:'Private',writable:true,url:'https://p42-caldav.icloud.com/123/private/'},{id:'holidays',name:'Holidays',writable:false,url:'https://p42-caldav.icloud.com/123/holidays/'}];
  const credentials={username:'sample@example.com',password:'aaaa-bbbb-cccc-dddd'};
  const legacy={credential:encryptCredential(credentials,key,'owner'),calendars,selected:['family']};
  docs.set('privateCalendarConnections/owner',structuredClone(legacy));
  let discovers=0;
  const store=createCalendarConnections({db,key:()=>key,discover:async()=>{discovers++;return calendars;}});
  return {db,docs,key,calendars,credentials,legacy,store,discovers:()=>discovers};
}
test('the partner inherits selected writable calendars without another Apple login or changing stable IDs',async()=>{
  const {store,docs,key,legacy,credentials,discovers}=fixture();
  const partner=await store.status('partner'), owner=await store.status('owner');
  assert.equal(partner.connected,true);assert.equal(partner.canManage,false);assert.equal(owner.canManage,true);
  assert.deepEqual(partner.selected,['family']);assert.equal(partner.calendars.length,1);assert.equal(partner.calendars[0].writable,true);
  assert.equal(owner.calendars.length,3);assert.equal(partner.connectionVersion,owner.connectionVersion);
  assert.doesNotMatch(JSON.stringify(partner),/sample@example|aaaa-bbbb|p42-caldav|Private/);
  assert.deepEqual((await store.open('partner')).credentials,credentials);assert.equal(discovers(),0);
  const shared=docs.get('privateCalendarConnections/household-home');
  assert.deepEqual(decryptCredential(shared.credential,key,'calendar:household:home'),credentials);
  assert.throws(()=>decryptCredential(shared.credential,key,'partner'));
  assert.deepEqual(docs.get('privateCalendarConnections/owner'),legacy);
});
test('only the connecting adult manages selection and credentials; a stale selection cannot overwrite a newer one',async()=>{
  const {store,credentials,discovers}=fixture();const before=await store.status('partner');
  await assert.rejects(store.select('partner',['private'],before.connectionVersion),e=>e.code==='permission-denied');
  await assert.rejects(store.disconnect('partner',before.connectionVersion),e=>e.code==='permission-denied');
  await assert.rejects(store.connect('partner',credentials,before.connectionVersion),e=>e.code==='permission-denied');
  assert.equal(discovers(),0);
  const after=await store.select('owner',['family','holidays'],before.connectionVersion);
  const partner=await store.status('partner');assert.deepEqual(partner.selected,after.selected);assert.equal(partner.calendars[1].writable,false);
  await assert.rejects(store.select('owner',['private'],before.connectionVersion),e=>e.code==='aborted');
  await assert.rejects(store.open('partner',before.connectionVersion),e=>e.code==='aborted');
});
test('disconnect never restores the legacy copy and reconnect preserves owner control',async()=>{
  const {store,docs,legacy,credentials}=fixture();const before=await store.status('owner');
  await store.disconnect('owner',before.connectionVersion);
  const partner=await store.status('partner');assert.equal(partner.connected,false);assert.equal(partner.canManage,false);
  assert.deepEqual(docs.get('privateCalendarConnections/owner'),legacy);assert.equal(docs.get('privateCalendarConnections/household-home').credential,undefined);
  await store.connect('owner',credentials,partner.connectionVersion);
  assert.equal((await store.status('partner')).connected,true);
  assert.deepEqual((await store.status('partner')).selected,[],'Reconnecting after disconnect does not silently share calendars');
});
test('outsiders and inactive members cannot access the shared calendar or use internal readers',async()=>{
  const {store,docs,credentials}=fixture();await store.status('owner');docs.set('households/home/members/partner',{active:false});
  for(const uid of ['outsider','partner'])for(const fn of [()=>store.status(uid),()=>store.open(uid),()=>store.select(uid,[]),()=>store.connect(uid,credentials),()=>store.disconnect(uid)])await assert.rejects(fn,e=>e.code==='permission-denied');
  await assert.rejects(store.open(null),e=>e.code==='unauthenticated');
});
test('simultaneous first visits adopt once, while multiple legacy accounts are never guessed',async()=>{
  const {store,docs,legacy}=fixture();const [a,b]=await Promise.all([store.status('owner'),store.status('partner')]);
  assert.equal(a.connectionVersion,b.connectionVersion);
  const other=fixture();other.docs.set('privateCalendarConnections/partner',legacy);
  await assert.rejects(other.store.status('owner'),e=>e.code==='failed-precondition');
  assert.equal(other.docs.has('privateCalendarConnections/household-home'),false);
  assert.ok(docs.get('privateCalendarConnections/household-home'));
});
test('a first connection shares no calendars automatically and reconnect keeps the selected calendars',async()=>{
  const {store,docs,credentials}=fixture();docs.delete('privateCalendarConnections/owner');
  let state=await store.connect('owner',credentials,null);assert.deepEqual(state.selected,[]);
  state=await store.select('owner',['family'],state.connectionVersion);
  state=await store.connect('owner',credentials,state.connectionVersion);
  assert.deepEqual(state.selected,['family']);assert.equal((await store.status('partner')).calendars.length,1);
});

test('the partner can read, create, edit and delete selected Apple events with shared household checklists',async t=>{
  const {calendarStatus,calendarEvents,calendarSave,calendarAssign,calendarDelete}=await import('../functions/index.js');
  const {getFirestore}=await import('../functions/node_modules/firebase-admin/lib/firestore/index.js');
  const live=getFirestore(),f=fixture(),oldKey=process.env.CALENDAR_ENCRYPTION_KEY;
  const methods=['doc','getAll','collection','runTransaction'],old=Object.fromEntries(methods.map(name=>[name,live[name]]));
  const providerMethods=['events','read','put','remove'],original=Object.fromEntries(providerMethods.map(name=>[name,CalDAV.prototype[name]]));
  process.env.CALENDAR_ENCRYPTION_KEY=f.key;for(const method of methods)live[method]=f.db[method];
  t.after(()=>{for(const method of methods)live[method]=old[method];for(const method of providerMethods)CalDAV.prototype[method]=original[method];if(oldKey===undefined)delete process.env.CALENDAR_ENCRYPTION_KEY;else process.env.CALENDAR_ENCRYPTION_KEY=oldKey;});
  let puts=0,removes=0,reads=0;
  const data='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:stable-event\r\nDTSTART:20261117T140000Z\r\nDTEND:20261117T150000Z\r\nSUMMARY:Family plan\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  CalDAV.prototype.events=async calendar=>{assert.equal(calendar.id,'family');return [{token:'event-token',etag:'v1',data}];};
  CalDAV.prototype.read=async()=>{reads++;return {data,etag:'v1'};};
  CalDAV.prototype.put=async()=>{puts++;};CalDAV.prototype.remove=async()=>{removes++;};
  const auth={uid:'partner'},state=await calendarStatus.run({auth,data:{}}),connectionVersion=state.connectionVersion;
  const request={calendarId:'family',token:'event-token',etag:'v1',connectionVersion};
  const event={title:'Family plan updated',notes:'',start:'2026-11-17T14:00:00Z',end:'2026-11-17T15:00:00Z',allDay:false,owner:'both',ownerCustom:'',withFrankie:true,checklist:[{id:'bag',text:'Pack the bag',done:false}]};
  await calendarSave.run({auth,data:{...request,event,assignmentVersion:0}});assert.equal(puts,1);
  const range={start:'2026-11-17T00:00:00Z',end:'2026-11-19T00:00:00Z',connectionVersion};
  const theirs=await calendarEvents.run({auth,data:range}),ours=await calendarEvents.run({auth:{uid:'owner'},data:range});
  assert.deepEqual(theirs.events,ours.events);assert.equal(theirs.events[0].withFrankie,true);assert.equal(theirs.events[0].checklist[0].text,'Pack the bag');assert.equal(theirs.checklists.length,1);
  await calendarAssign.run({auth,data:{...request,uid:'stable-event',assignmentVersion:1,assignment:{...event,checklist:[{id:'bag',text:'Pack the bag',done:true}]}}});
  assert.equal((await calendarEvents.run({auth:{uid:'owner'},data:range})).events[0].checklist[0].done,true);
  await calendarSave.run({auth,data:{calendarId:'family',connectionVersion,requestId:randomUUID(),event}});assert.equal(puts,2);
  const before=reads;
  await assert.rejects(calendarSave.run({auth,data:{...request,calendarId:'private',event}}),e=>e.code==='permission-denied');assert.equal(reads,before);
  await assert.rejects(calendarDelete.run({auth,data:{...request,etag:'stale'}}),e=>e.code==='aborted');assert.equal(removes,0);
  await calendarDelete.run({auth,data:request});assert.equal(removes,1);
  await assert.rejects(calendarEvents.run({auth:{uid:'outsider'},data:range}),e=>e.code==='permission-denied');
});

test('an in-flight Apple reconnect cannot undo a later disconnect',async()=>{
 const {store,db,key,credentials,calendars}=fixture();const state=await store.status('owner');
 let release,started;const begun=new Promise(resolve=>{started=resolve;});
 const pendingStore=createCalendarConnections({db,key:()=>key,discover:async()=>{started();return new Promise(resolve=>{release=()=>resolve(calendars);});}});
 const pending=pendingStore.connect('owner',credentials,state.connectionVersion);await begun;
 await store.disconnect('owner',state.connectionVersion);release();
 await assert.rejects(pending,e=>e.code==='aborted');assert.equal((await store.status('partner')).connected,false);
});
