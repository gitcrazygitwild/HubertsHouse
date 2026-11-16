import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import ICAL from '../functions/node_modules/ical.js/dist/ical.js';
import { CalDAV, appleURL, resourceURL, resourceToken, parseResponses } from '../functions/caldav.js';
import { readEvents, writeEvent, canDelete } from '../functions/ical.js';
import { encryptCredential, decryptCredential } from '../functions/crypto.js';
const calendar = {id:'cal',url:'https://p42-caldav.icloud.com/123/calendars/home/',name:'Home',color:'#8ba475',writable:true};
const token = resourceToken(`${calendar.url}event.ics`);
const event = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple//EN\r\nBEGIN:VEVENT\r\nUID:apple-event\r\nDTSTAMP:20261114T120000Z\r\nDTSTART:20261115T140000Z\r\nDTEND:20261115T150000Z\r\nSUMMARY:Old title\r\nDESCRIPTION:A note\r\nLOCATION:Favorite cafe\r\nX-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const input = {title:'New title',notes:'First line\nSecond; line, with slash \\',allDay:false,start:'2026-11-15T16:00:00Z',end:'2026-11-15T17:00:00Z'};
test('editing an imported event preserves UID, location, alarms and unknown Apple properties', () => {
  const saved = writeEvent(input,event,'unused');
  const root = new ICAL.Component(ICAL.parse(saved)); const e = root.getFirstSubcomponent('vevent');
  assert.equal(e.getFirstPropertyValue('uid'),'apple-event'); assert.equal(e.getFirstPropertyValue('summary'),'New title');
  assert.equal(e.getFirstPropertyValue('location'),'Favorite cafe'); assert.equal(e.getFirstPropertyValue('description'),input.notes);
  assert.equal(e.getFirstPropertyValue('x-apple-travel-advisory-behavior'),'AUTOMATIC'); assert.equal(e.getAllSubcomponents('valarm').length,1);
});
test('adult and Frankie metadata round-trip through iCloud while existing Apple fields survive', () => {
  const saved = writeEvent({...input,owner:'karena',withFrankie:true},event,'unused');
  const [record] = readEvents({data:saved,token,etag:'v1'},calendar,'2026-11-01','2026-12-01');
  assert.equal(record.owner,'karena'); assert.equal(record.withFrankie,true); assert.match(saved,/LOCATION:Favorite cafe/);
  assert.throws(() => writeEvent({...input,owner:'custom',withFrankie:true},event,'unused'),/Frankie must be with/);
  const edited = writeEvent({...input,title:'A different time'},saved,'unused');
  assert.equal(readEvents({data:edited,token},calendar,'2026-11-01','2026-12-01')[0].withFrankie,true);
});
test('all-day dates stay calendar dates and use an exclusive iCloud end', () => {
  const data = writeEvent({...input,allDay:true,startDate:'2026-11-15',endDate:'2026-11-17'},null,'all-day');
  assert.match(data,/DTSTART;VALUE=DATE:20261115/); assert.match(data,/DTEND;VALUE=DATE:20261118/);
  const [record] = readEvents({data,token,etag:'"v1"'},calendar,'2026-11-01','2026-12-01');
  assert.equal(record.start,'2026-11-15T00:00:00'); assert.equal(record.end,'2026-11-18T00:00:00'); assert.equal(record.editEnd,'2026-11-17T00:00:00');
  assert.throws(() => writeEvent({...input,allDay:true,startDate:'2026-02-31'},null,'bad'),/valid all-day/);
});
test('recurrence exceptions and excluded dates appear correctly and are protected from lossy editing', () => {
  const recurring = event.replace('SUMMARY:Old title','RRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261116T140000Z\r\nSUMMARY:Old title');
  const records = readEvents({data:recurring,token,etag:'"v1"'},calendar,'2026-11-01','2026-12-01');
  assert.equal(records.length,2); assert.ok(records.every(x => x.readOnlyReason.includes('recurring')));
  assert.throws(() => writeEvent(input,recurring,'unused'),/recurring/); assert.throws(() => canDelete(recurring),/recurring/);
});
test('invitations are view-only so changes do not accidentally discard scheduling information', () => {
  const invitation = event.replace('SUMMARY:Old title','ORGANIZER:mailto:host@example.com\r\nATTENDEE:mailto:guest@example.com\r\nSUMMARY:Old title');
  assert.match(readEvents({data:invitation,token,etag:'v1'},calendar,'2026-11-01','2026-12-01')[0].readOnlyReason,/invitations/);
  assert.throws(() => writeEvent(input,invitation,'unused'),/invitations/);
});
test('iCloud timezone definitions preserve the local hour across daylight saving changes', () => {
  const timezone = `BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:DAYLIGHT\r\nDTSTART:20070311T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:20071104T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n`;
  const data = event.replace('BEGIN:VEVENT',`${timezone}BEGIN:VEVENT`).replace('DTSTART:20261115T140000Z','DTSTART;TZID=America/New_York:20260307T090000').replace('DTEND:20261115T150000Z','DTEND;TZID=America/New_York:20260307T100000').replace('SUMMARY:Old title','RRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Old title');
  const records = readEvents({data,token,etag:'"v1"'},calendar,'2026-03-06','2026-03-11');
  assert.deepEqual(records.map(r => r.start),['2026-03-07T14:00:00.000Z','2026-03-08T13:00:00.000Z','2026-03-09T13:00:00.000Z']);
});
test('ETag preconditions protect updates and deletions; creates cannot overwrite existing resources', async () => {
  const calls=[]; const client=new CalDAV({username:'test@example.com',password:'fake'},async (url,options) => {calls.push({url,...options}); return new Response(null,{status:204});});
  await client.put(calendar,token,event,'"v1"'); await client.put(calendar,token,event,null,true); await client.remove(calendar,token,'"v1"');
  assert.equal(calls[0].headers['If-Match'],'"v1"'); assert.equal(calls[1].headers['If-None-Match'],'*'); assert.equal(calls[2].headers['If-Match'],'"v1"');
  const conflict = new CalDAV({username:'test',password:'fake'},async () => new Response(null,{status:412}));
  await assert.rejects(() => conflict.put(calendar,token,event,'"old"'),e => e.code === 'aborted');
  await assert.rejects(() => client.remove(calendar,token,null),e => e.code === 'failed-precondition');
});
test('credentials cannot follow redirects outside Apple or target another calendar', async () => {
  for (const url of ['http://caldav.icloud.com/','https://evil.example/','https://caldav.icloud.com.evil.example/','https://user:pass@caldav.icloud.com/','https://caldav.icloud.com:444/']) assert.throws(() => appleURL(url));
  assert.throws(() => resourceURL(calendar,resourceToken('https://p42-caldav.icloud.com/123/calendars/other/event.ics')));
  let count=0; const client=new CalDAV({username:'test',password:'fake'},async () => {count++;return new Response(null,{status:302,headers:{location:'https://evil.example/'}});});
  await assert.rejects(() => client.request('https://caldav.icloud.com/')); assert.equal(count,1);
});
test('XML parsing uses only successful properties and rejects entity declarations', () => {
  const rows=parseResponses('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/a/</d:href><d:propstat><d:prop><d:displayname>Home &amp; family</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getetag>bad</d:getetag></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>');
  assert.equal(rows[0].props.displayname,'Home & family'); assert.equal(rows[0].props.getetag,undefined);
  assert.throws(() => parseResponses('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><multistatus/>'));
});
test('stored credentials are authenticated, encrypted and bound to their household user', () => {
  const key=randomBytes(32).toString('base64'); const secret={username:'me@example.com',password:'fake-password'};
  const encrypted=encryptCredential(secret,key,'user-1'); assert.ok(!JSON.stringify(encrypted).includes(secret.password));
  assert.deepEqual(decryptCredential(encrypted,key,'user-1'),secret);
  assert.throws(() => decryptCredential(encrypted,key,'user-2'));
  assert.throws(() => decryptCredential({...encrypted,data:Buffer.from('tampered').toString('base64')},key,'user-1'));
});
test('floating events retain wall-clock times on read and edit', () => {
  const floating=event.replace('DTSTART:20261115T140000Z','DTSTART:20261115T090000').replace('DTEND:20261115T150000Z','DTEND:20261115T100000');
  assert.equal(readEvents({data:floating,token,etag:'v1'},calendar,'2026-11-01','2026-12-01')[0].start,'2026-11-15T09:00:00');
  const saved=writeEvent({...input,startLocal:'2026-11-15T11:00',endLocal:'2026-11-15T12:00'},floating,'unused');
  assert.match(saved,/DTSTART:20261115T110000\r?\n/); assert.doesNotMatch(saved,/DTSTART:.*Z/);
});
test('calendar discovery follows the principal and home and recognizes read/write permissions', async () => {
  const response=props => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${calendar.url}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const replies=[response('<d:current-user-principal><d:href>https://p42-caldav.icloud.com/123/principal/</d:href></d:current-user-principal>'),response('<c:calendar-home-set><d:href>https://p42-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set>'),response('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Shared home</d:displayname><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>')];
  const requests=[]; const client=new CalDAV({username:'test',password:'fake'},async (url,options) => { requests.push({url,...options}); return new Response(replies.shift(),{status:207}); });
  const calendars=await client.discover(); assert.equal(calendars.length,1); assert.equal(calendars[0].name,'Shared home'); assert.equal(calendars[0].writable,true); assert.equal(requests[2].headers.Depth,'1');
});
test('moved recurrence exceptions replace the original occurrence without duplication', () => {
  const data=event.replace('SUMMARY:Old title','RRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Old title').replace('END:VCALENDAR','BEGIN:VEVENT\r\nUID:apple-event\r\nRECURRENCE-ID:20261116T140000Z\r\nDTSTART:20261116T180000Z\r\nDTEND:20261116T190000Z\r\nSUMMARY:Moved\r\nEND:VEVENT\r\nEND:VCALENDAR');
  const records=readEvents({data,token,etag:'v1'},calendar,'2026-11-01','2026-12-01');
  assert.equal(records.length,3); assert.equal(records.filter(r => r.title === 'Moved').length,1);
  assert.ok(!records.some(r => r.start === '2026-11-16T14:00:00.000Z'));
});
