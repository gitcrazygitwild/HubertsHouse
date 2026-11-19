import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const { createPetLibro, createPetLibroClient, readFeeder, md5 } = await import('../functions/petlibro.js');
const { encryptCredential, decryptCredential } = await import('../functions/crypto.js');
const view = await import('../feeders-view.js');

const KEY = randomBytes(32).toString('base64'), NOW = Date.parse('2026-11-19T15:00:00Z');
function fakeDb() {
  const docs = new Map();
  return { docs, doc:path => ({ get:async () => ({ exists:docs.has(path), data:() => structuredClone(docs.get(path)) }),
    set:async (data, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...structuredClone(data) } : structuredClone(data)); }, delete:async () => { docs.delete(path); } }) };
}
const json = body => ({ ok:true, status:200, json:async () => body });
const DEVICE = { deviceSn:'AF103X', name:'Breakfast Club', productName:'Granary Smart Feeder', online:true };
function petlibro({ expireOnce = false, badLogin = false } = {}) {
  const calls = []; let expired = expireOnce, logins = 0;
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body), path = url.replace('https://api.us.petlibro.com', '');
    calls.push({ path, body, headers:init.headers });
    if (path === '/member/auth/login') { logins += 1; return json(badLogin ? { code:1001, msg:'account or password error' } : { code:0, data:{ token:`T${logins}` } }); }
    if (expired && path === '/device/device/list') { expired = false; return json({ code:1009, msg:'token expired' }); }
    if (path === '/device/device/list') return json({ code:0, data:[DEVICE] });
    if (path === '/device/device/realInfo') return json({ code:0, data:{ deviceSn:'AF103X', online:true, surplusGrain:false, grainOutletState:true, electricQuantity:84 } });
    if (path === '/device/data/grainStatus') return json({ code:0, data:{ todayFeedingQuantity:6, todayFeedingTimes:2 } });
    if (path === '/device/device/manualFeeding') return json(1);
    return json({ code:404, msg:'nope' });
  };
  return { fetch, calls, logins:() => logins };
}
const service = (fake, db = fakeDb(), log = () => {}) => ({ db, home:createPetLibro({ db, key:() => KEY, encrypt:encryptCredential, decrypt:decryptCredential, client:createPetLibroClient({ fetch:fake.fetch }), now:() => NOW, log }) });

test('a feeder’s readings become a simple shape; missing readings stay hidden', () => {
  assert.deepEqual(readFeeder(DEVICE, { surplusGrain:false, grainOutletState:true, electricQuantity:84 }, { todayFeedingQuantity:6, todayFeedingTimes:2 }),
    { id:'AF103X', name:'Breakfast Club', product:'Granary Smart Feeder', online:true, foodLow:true, dispenserBlocked:false, battery:84, todayPortions:6, todayFeeds:2, isFeeder:true });
  const bare = readFeeder({ deviceSn:'X', productName:'Dockstream Fountain' });
  assert.deepEqual([bare.online, bare.foodLow, bare.battery, bare.todayPortions, bare.isFeeder, bare.name], [null, null, null, null, false, 'Dockstream Fountain']);
});

test('connecting signs in with the MD5 PetLibro expects and never stores the password', async () => {
  const fake = petlibro(), logged = [];
  const { home, db } = service(fake, fakeDb(), (message, data) => logged.push({ message, data }));
  const result = await home.connect('uid1', { email:'You+House@Example.com', password:'kibble-time-42' });
  const login = fake.calls.find(c => c.path === '/member/auth/login');
  assert.equal(login.body.email, 'you+house@example.com'); assert.equal(login.body.password, md5('kibble-time-42')); assert.equal(login.headers.source, 'ANDROID');
  assert.equal(result.feeders[0].foodLow, true); assert.equal(result.feeders[0].todayPortions, 6);
  const stored = JSON.stringify(db.docs.get('privatePetLibro/household'));
  assert.ok(!stored.includes('kibble-time-42') && !stored.includes(md5('kibble-time-42')) && !stored.includes('you+house'));
  assert.equal(decryptCredential(db.docs.get('privatePetLibro/household').credential, KEY, 'petlibro:household').token, 'T1');
  assert.ok(fake.calls.filter(c => c.path !== '/member/auth/login').every(c => c.headers.token === 'T1'));
  // Only field names are logged, never values.
  assert.ok(logged[0].data.fields.includes('surplusGrain')); assert.ok(!JSON.stringify(logged).includes('Breakfast Club'));
  await assert.rejects(service(petlibro({ badLogin:true })).home.connect('u', { email:'a@b.co', password:'x' }), error => error.code === 'permission-denied');
});

test('an expired token signs in again once, transparently', async () => {
  const fake = petlibro(), { home, db } = service(fake);
  await home.connect('u', { email:'a@b.co', password:'pw' });
  const again = petlibro({ expireOnce:true }); // the same household, now with an expiring token
  const second = createPetLibro({ db, key:() => KEY, encrypt:encryptCredential, decrypt:decryptCredential, client:createPetLibroClient({ fetch:again.fetch }), now:() => NOW + 3600000 });
  const snap = await second.snapshot({ force:true });
  assert.equal(snap.feeders.length, 1); assert.equal(again.logins(), 1);
  assert.equal(decryptCredential(db.docs.get('privatePetLibro/household').credential, KEY, 'petlibro:household').token, 'T1');
  assert.equal((await second.status()).needsReconnect, false);
});

test('Feed now sends the portions with a fresh request id, and checks the amount', async () => {
  const fake = petlibro(), { home } = service(fake);
  await home.connect('u', { email:'a@b.co', password:'pw' });
  assert.deepEqual(await home.feed('AF103X', 2), { ok:true, name:'Breakfast Club', portions:2 });
  const feed = fake.calls.find(c => c.path === '/device/device/manualFeeding');
  assert.equal(feed.body.deviceSn, 'AF103X'); assert.equal(feed.body.grainNum, 2); assert.match(feed.body.requestId, /^[0-9a-f]{32}$/);
  await assert.rejects(home.feed('AF103X', 0), /1 to 6 portions/); await assert.rejects(home.feed('AF103X', 9), /1 to 6 portions/);
  await assert.rejects(home.feed('missing', 1), /no longer on the PetLibro account/);
});

test('the card and Settings explain each state, including the second-account step', () => {
  assert.match(view.feedersHTML({ connected:false }), /PetLibro isn’t connected yet/);
  const html = view.feedersHTML(view.sampleFeeders(NOW), { now:NOW });
  assert.match(html, /6 portions today \(about 0.5 cups\) · 2 meals/); assert.match(html, /Food is running low/); assert.match(html, /Feed now/);
  assert.deepEqual(view.feederAlerts({ online:false, foodLow:false, dispenserBlocked:true, battery:12 }), ['Offline: check its power and Wi-Fi', 'The food outlet may be blocked', 'Backup battery at 12%']);
  const settings = view.feederSettingsHTML({ connected:false });
  assert.match(settings, /only one device/); assert.match(settings, /\+house/); assert.match(settings, /second account/);
  assert.ok(!/<script/.test(view.feedersHTML({ connected:true, checkedAt:new Date(NOW).toISOString(), feeders:[{ id:'x', name:'<script>', product:'p', online:true, foodLow:false, dispenserBlocked:false, battery:null, todayPortions:null, todayFeeds:null, isFeeder:true }] })));
});
