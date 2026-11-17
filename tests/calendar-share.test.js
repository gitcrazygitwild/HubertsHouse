import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCalendarConnection, sharedView, sharesWithHousehold } from '../functions/calendar-share.js';

const hanry = { credential:{ c:1 }, calendars:[{ id:'family', name:'Family', url:'https://p1/family', writable:true }, { id:'work', name:'Work', url:'https://p1/work', writable:true }], selected:['family'] };
function db(docs) { return { doc:path => ({ get:async () => ({ exists:Object.hasOwn(docs, path), data:() => docs[path] }) }) }; }
const members = list => async () => list;

test("Karena borrows hanry's shared connection; her own connection would win", async () => {
  const docs = { 'privateCalendarConnections/hanry':hanry };
  const k = await resolveCalendarConnection({ db:db(docs), uid:'karena', members:members(['hanry', 'karena']) });
  assert.equal(k.shared, true); assert.equal(k.ownerUid, 'hanry'); assert.equal(k.data, hanry);
  const h = await resolveCalendarConnection({ db:db(docs), uid:'hanry', members:members(['hanry', 'karena']) });
  assert.equal(h.shared, false); assert.equal(h.ownerUid, 'hanry');
  const own = await resolveCalendarConnection({ db:db({ ...docs, 'privateCalendarConnections/karena':{ ...hanry, selected:['work'] } }), uid:'karena', members:members(['hanry', 'karena']) });
  assert.equal(own.shared, false); assert.equal(own.ownerUid, 'karena');
});

test('only selected calendars are shared, without Apple URLs or credentials', () => {
  const view = sharedView(hanry);
  assert.deepEqual(view.calendars, [{ id:'family', name:'Family', writable:true }]); assert.deepEqual(view.selected, ['family']);
  assert.equal(view.shared, true); assert.equal(JSON.stringify(view).includes('credential'), false); assert.equal(JSON.stringify(view).includes('https://'), false);
});

test('sharing can be turned off, removed members are not borrowed, and two offers are never guessed between', async () => {
  const off = { 'privateCalendarConnections/hanry':{ ...hanry, shareWithHousehold:false } };
  await assert.rejects(resolveCalendarConnection({ db:db(off), uid:'karena', members:members(['hanry', 'karena']) }), /Connect your iCloud account first/);
  assert.equal(sharesWithHousehold({}), true); assert.equal(sharesWithHousehold({ shareWithHousehold:false }), false);
  // hanry is no longer an active member: his connection is not offered.
  await assert.rejects(resolveCalendarConnection({ db:db({ 'privateCalendarConnections/hanry':hanry }), uid:'karena', members:members(['karena']) }), /Connect your iCloud/);
  const two = { 'privateCalendarConnections/hanry':hanry, 'privateCalendarConnections/guest':hanry };
  await assert.rejects(resolveCalendarConnection({ db:db(two), uid:'karena', members:members(['hanry', 'guest', 'karena']) }), /More than one household member/);
});
