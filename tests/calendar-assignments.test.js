import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssignmentStore,assignmentKey,validateAssignment } from '../functions/calendar-assignments.js';
import { randomBytes } from 'node:crypto';
import { encryptCredential } from '../functions/crypto.js';
import { CalDAV } from '../functions/caldav.js';
import { getFirestore } from '../functions/node_modules/firebase-admin/lib/firestore/index.js';
function database() {
  const records=new Map(),doc=path=>({path,delete:async()=>records.delete(path)}),get=ref=>({exists:records.has(ref.path),data:()=>records.get(ref.path),ref});
  return {records,doc,getAll:async(...refs)=>refs.map(get),runTransaction:async fn=>{let write;const result=await fn({get:async ref=>get(ref),set:(ref,value)=>{write=()=>records.set(ref.path,value);}});write?.();return result;}};
}
test('assignments follow Apple UID through date and resource changes, scoped to the calendar',async()=>{
  const db=database(),store=createAssignmentStore(db),assignment={owner:'hanry',ownerCustom:'',withFrankie:true};
  await store.save('calendar-one','stable-uid',assignment,0);
  const events=[{calendarId:'calendar-one',uid:'stable-uid',token:'old-token',start:'2026-11-15'},{calendarId:'calendar-one',uid:'stable-uid',token:'new-token',start:'2026-11-16'},{calendarId:'calendar-two',uid:'stable-uid',owner:'karena',withFrankie:false},{calendarId:'calendar-one',uid:null,title:'An incomplete imported event'}];
  const result=await store.apply(events);assert.equal(result[0].owner,'hanry');assert.equal(result[1].withFrankie,true);assert.equal(result[0].assignmentVersion,1);
  assert.equal(result[2].owner,'karena');assert.equal(result[2].assignmentVersion,0);assert.equal(result[3].title,events[3].title);
  assert.notEqual(assignmentKey('calendar-one','stable-uid'),assignmentKey('calendar-two','stable-uid'));assert.equal(events[0].owner,undefined);
});
test('stale assignments cannot overwrite a newer owner, and a retry of the same save is safe',async()=>{
  const store=createAssignmentStore(database()),first={owner:'hanry',ownerCustom:'',withFrankie:true},second={owner:'karena',ownerCustom:'',withFrankie:true};
  await store.save('cal','uid',first,0);assert.equal((await store.save('cal','uid',first,0)).assignmentVersion,1);
  await store.save('cal','uid',second,1);await assert.rejects(store.save('cal','uid',first,1),error=>error.code==='aborted');
  assert.equal((await store.apply([{calendarId:'cal',uid:'uid'}]))[0].owner,'karena');
  for(const patch of [{owner:'frankie'},{owner:'custom',withFrankie:true},{withFrankie:'yes'},{ownerCustom:'x'.repeat(101)}])assert.throws(()=>validateAssignment({...first,...patch}));
});
test('private checklists survive owner-only clients and reject stale item updates',async()=>{
  const db=database(),store=createAssignmentStore(db),assignment={owner:'both',ownerCustom:'',withFrankie:true};
  const first={...assignment,checklist:[{id:'snacks',text:'Pack snacks',done:false}]};
  await store.save('cal','uid',first,0,{title:'Family visit',start:'2026-11-16'});
  await store.save('cal','uid',{...assignment,owner:'karena'},1);
  let event=(await store.apply([{calendarId:'cal',uid:'uid'}]))[0];assert.equal(event.checklist[0].text,'Pack snacks');assert.equal(event.assignmentVersion,2);
  await store.save('cal','uid',{...assignment,owner:'karena',checklist:[{id:'snacks',text:'Pack snacks',done:true}]},2);
  await assert.rejects(store.save('cal','uid',{...first,owner:'karena'},2),error=>error.code==='aborted');
  assert.equal((await store.apply([{calendarId:'cal',uid:'uid'}]))[0].checklist[0].done,true);
  for(const checklist of [[{text:'',done:false}],[{text:'x',done:'yes'}],Array.from({length:201},()=>({text:'x',done:false}))])assert.throws(()=>validateAssignment({...assignment,checklist}));
  let selected;
  db.collection=()=>({where:(field,operator,ids)=>{selected=ids;return {get:async()=>({docs:[...db.records.values()].filter(row=>ids.includes(row.calendarId)).map(row=>({data:()=>row}))})};}});
  const lists=await store.lists(['cal']);assert.deepEqual(selected,['cal']);assert.equal(lists[0].title,'Family visit');assert.equal(lists[0].checklistOnly,true);assert.equal((await store.lists(['different-calendar'])).length,0);
});
test('member-only owner edits work for read-only Apple events without a CalDAV write; a partial save is reported honestly',async t=>{
  const {calendarAssign,calendarSave}=await import('../functions/index.js');
  const db=getFirestore(),fake=database(),key=randomBytes(32).toString('base64'),oldKey=process.env.CALENDAR_ENCRYPTION_KEY;
  const originalDoc=db.doc,originalTransaction=db.runTransaction,originalRead=CalDAV.prototype.read,originalPut=CalDAV.prototype.put;
  process.env.CALENDAR_ENCRYPTION_KEY=key;
  t.after(()=>{db.doc=originalDoc;db.runTransaction=originalTransaction;CalDAV.prototype.read=originalRead;CalDAV.prototype.put=originalPut;if(oldKey===undefined)delete process.env.CALENDAR_ENCRYPTION_KEY;else process.env.CALENDAR_ENCRYPTION_KEY=oldKey;});
  const calendar={id:'cal',writable:false,url:'https://p42-caldav.icloud.com/123/home/'},connection={calendars:[calendar],selected:['cal'],credential:encryptCredential({username:'sample@example.com',password:'sample-only'},key,'member')};
  db.doc=path=>path.startsWith('households/')?{get:async()=>({exists:path.endsWith('/member'),data:()=>({active:true})})}:path==='privateCalendarConnections/member'?{get:async()=>({exists:true,data:()=>connection})}:fake.doc(path);
  db.runTransaction=fake.runTransaction;
  const data='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:stable-uid\r\nDTSTART:20261115T140000Z\r\nDTEND:20261115T150000Z\r\nSUMMARY:Appointment\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  let reads=0,writes=0;CalDAV.prototype.read=async()=>{reads++;return {data,etag:'v1'};};CalDAV.prototype.put=async()=>{writes++;};
  const input={calendarId:'cal',token:'resource',uid:'stable-uid',assignmentVersion:0,context:{title:'Appointment',start:'2026-11-15T14:00:00Z',end:'2026-11-15T15:00:00Z'},assignment:{owner:'karena',ownerCustom:'',withFrankie:true,checklist:[{id:'bring-id',text:'Bring ID',done:false}]}};
  const result=await calendarAssign.run({auth:{uid:'member'},data:input});assert.equal(result.assignment.owner,'karena');assert.equal(result.assignment.checklist[0].text,'Bring ID');assert.equal(writes,0);assert.equal(reads,1);
  await assert.rejects(calendarAssign.run({auth:{uid:'outsider'},data:input}),e=>e.code==='permission-denied');assert.equal(reads,1);
  await assert.rejects(calendarAssign.run({auth:{uid:'member'},data:{...input,uid:'replacement'}}),e=>e.code==='aborted');
  calendar.writable=true;db.runTransaction=async()=>{throw new Error('Database temporarily unavailable');};
  const saved=await calendarSave.run({auth:{uid:'member'},data:{calendarId:'cal',token:'resource',etag:'v1',assignmentVersion:1,event:{title:'Appointment updated',notes:'',start:'2026-11-15T14:00:00Z',end:'2026-11-15T15:00:00Z',allDay:false,...input.assignment}}});
  assert.equal(saved.saved,true);assert.equal(saved.assignmentSaved,false);assert.equal(writes,1);assert.match(saved.warning,/saved to Apple Calendar/);
});
