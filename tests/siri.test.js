import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { planSiriLog, createSiriHandler, hashSiriKey, newSiriKey, readKey, missingKeyHint } = await import('../functions/siri.js');

const now = new Date(2026, 10, 16, 17, 30); // 5:30pm Richmond
const snapshot = { childId:'child', name:'Frankie', timer:{ active:false }, bottles:[{ start:new Date(2026, 10, 16, 14).toISOString(), amount:4, units:'oz', type:'Formula' }] };

test('what you say becomes the right Huckleberry entry and read-back', () => {
  const bottle = planSiriLog({ text:'5 ounces at 5:15', snapshot, now });
  assert.equal(bottle.entry.kind, 'bottle'); assert.equal(bottle.entry.amount, 5); assert.equal(bottle.entry.units, 'oz'); assert.equal(bottle.entry.bottleType, 'Formula');
  assert.equal(new Date(bottle.entry.start).getHours(), 17); assert.equal(new Date(bottle.entry.start).getMinutes(), 15);
  assert.equal(bottle.speak, 'Log a 5-ounce formula bottle for Frankie at 5:15 PM?'); assert.match(bottle.entry.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(planSiriLog({ text:'log a bottle', snapshot, now }).entry.amount, 4); // same as last bottle
  assert.equal(planSiriLog({ text:'120 ml breast milk', snapshot, now }).entry.bottleType, 'Breast Milk');
  assert.equal(planSiriLog({ text:'dirty diaper', snapshot, now }).entry.mode, 'poo');
  assert.match(planSiriLog({ text:'nap from 1 to 2:30', snapshot, now }).speak, /Log a 1 hour 30 minutes sleep for Frankie, 1:00 PM to 2:30 PM\?/);
  assert.match(planSiriLog({ text:'fell asleep at 5:20', snapshot, now }).speak, /Start Frankie’s sleep timer from 5:20 PM/);
  const awake = planSiriLog({ text:'woke up', snapshot:{ ...snapshot, timer:{ active:true, uuid:'t1', start:new Date(2026, 10, 16, 16).toISOString() } }, now });
  assert.equal(awake.entry.kind, 'sleep-stop'); assert.equal(awake.entry.timerId, 't1');
});

test('unclear or impossible requests get a helpful spoken answer instead of a save', () => {
  assert.throws(() => planSiriLog({ text:'', snapshot, now }), /didn’t hear/);
  assert.throws(() => planSiriLog({ text:'what is the weather', snapshot, now }), /didn’t catch that/);
  assert.throws(() => planSiriLog({ text:'diaper change', snapshot, now }), /wet, dirty, both or dry/);
  assert.throws(() => planSiriLog({ text:'woke up', snapshot, now }), /isn’t on a sleep timer/);
  assert.throws(() => planSiriLog({ text:'bottle', snapshot:{ ...snapshot, bottles:[] }, now }), /How much/);
});

test('the same words within ten minutes reuse one request ID, so a double-run cannot save twice', () => {
  const a = planSiriLog({ text:'5 ounces at 5:15', snapshot, now, keyHash:'k' }), b = planSiriLog({ text:'5 Ounces at 5:15 ', snapshot, now:new Date(+now + 60000), keyHash:'k' });
  assert.equal(a.entry.requestId, b.entry.requestId);
  assert.notEqual(a.entry.requestId, planSiriLog({ text:'5 ounces at 5:15', snapshot, now, keyHash:'other' }).entry.requestId);
});

test('keys: random, only hashes stored, Bearer or body', () => {
  const key = newSiriKey(); assert.match(key, /^hh_[A-Za-z0-9_-]{43}$/); assert.notEqual(key, newSiriKey());
  assert.equal(hashSiriKey(key).length, 64); assert.equal(readKey({ authorization:`Bearer ${key}` }), key);
  assert.equal(readKey({}, { key }), key); assert.equal(readKey({ authorization:'Bearer nope' }), null);
});

function harness({ connected = ['owner','partner'], timer, owner = 'owner', active = ['owner','partner'] } = {}) {
  const key = newSiriKey(), docs = new Map([[`siriKeys/${hashSiriKey(key)}`, { uid:owner }]]), writes = [];
  const db = { doc:path => ({ get:async () => ({ exists:docs.has(path), data:() => docs.get(path) }), update:async patch => docs.set(path, { ...docs.get(path), ...patch }) }) };
  const huckleberry = async (uid, input) => {
    if (!connected.includes(uid)) throw Object.assign(new Error('not connected'), { code:'failed-precondition' });
    if (input.action === 'snapshot') return { ...snapshot, timer:timer || snapshot.timer, connection:{connectionVersion:'shared-version'} };
    writes.push({ uid, ...input }); return { saved:true };
  };
  const handler = createSiriHandler({ db, huckleberry, members:async () => active, now:() => now });
  const call = async (body, headers = { authorization:`Bearer ${key}` }, method = 'POST') => {
    let status, json; await handler({ method, headers, body }, { status(code) { status = code; return this; }, json(value) { json = value; } });
    return { status, json };
  };
  return { call, writes, docs, key };
}

test('the endpoint previews first and saves through the shared connection as the key’s owner', async () => {
  const { call, writes, docs, key } = harness();
  const preview = await call({ text:'5 ounces at 5:15' });
  assert.equal(preview.status, 200); assert.equal(preview.json.needsConfirm, true); assert.match(preview.json.speak, /5-ounce formula bottle/); assert.equal(writes.length, 0);
  const saved = await call({ text:'5 ounces at 5:15', confirm:true });
  assert.equal(saved.json.saved, true); assert.match(saved.json.speak, /^Logged 5 ounces of formula at 5:15 PM/);
  assert.equal(writes.length, 1); assert.equal(writes[0].action, 'write'); assert.equal(writes[0].childId, 'child'); assert.equal(writes[0].entry.amount, 5);
  assert.ok(docs.get(`siriKeys/${hashSiriKey(key)}`).lastUsedAt);
  // Karena's key works even if only hanry connected Huckleberry.
  const other = harness({ owner:'partner' }); await other.call({ text:'wet diaper', confirm:true });
  assert.equal(other.writes[0].uid, 'partner');
  assert.equal(other.writes[0].connectionVersion,'shared-version');
});

test('the endpoint refuses missing or revoked keys and non-POST requests, and never saves an unclear request', async () => {
  const { call, writes } = harness();
  assert.equal((await call({ text:'5 oz' }, {})).status, 401);
  assert.equal((await call({ text:'5 oz' }, { authorization:`Bearer ${newSiriKey()}` })).status, 401);
  assert.equal((await call({}, undefined, 'GET')).status, 405);
  const unclear = await call({ text:'hello there', confirm:true });
  assert.equal(unclear.json.ok, false); assert.match(unclear.json.speak, /didn’t catch that/); assert.equal(writes.length, 0);
  const nobody = harness({ connected:[] }); assert.equal((await nobody.call({ text:'5 oz' })).status, 409);
});


test('a removed member’s Siri key cannot borrow another adult’s access',async()=>{
  const removed=harness({owner:'removed',active:['owner','partner']});
  const response=await removed.call({text:'wet diaper',confirm:true});
  assert.equal(response.status,403);assert.equal(removed.writes.length,0);
});

test('keys typed on a phone are found however the header was written', () => {
  const key = newSiriKey();
  for (const value of [`Bearer ${key}`, `bearer ${key}`, `BEARER  ${key} `, key, `Bearer${key}`, `Bearer \u200B${key}\u200B`, `"Bearer ${key}"`, `Bearer “${key}”`])
    assert.equal(readKey({ authorization:value }), key, JSON.stringify(value));
  assert.equal(readKey({ 'x-siri-key':key }), key); assert.equal(readKey({}, { key:` ${key}\n` }), key);
  assert.equal(readKey({ authorization:`Bearer ${key}junk` }), null); assert.equal(readKey({ authorization:`Bearer ${key.slice(0, -3)}` }), null);
  assert.match(missingKeyHint({}), /add a header named Authorization/);
  assert.match(missingKeyHint({ authorization:'Bearer' }), /no Siri key in it/);
  assert.match(missingKeyHint({ authorization:`Bearer ${key.slice(0, -3)}` }), /cut off/);
});
