import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { dueReminders, createPush, validSubscription, validPrefs } = await import('../functions/push.js');

const at = (d, h, m = 0) => new Date(`2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`);
// A tiny in-memory Firestore: enough for push.js.
function fakeDb() {
  const store = new Map();
  const ref = path => ({ path, id:path.split('/').pop(),
    async get() { return { exists:store.has(path), data:() => structuredClone(store.get(path)), ref:this, id:this.id }; },
    async set(value, opts) { store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...structuredClone(value) } : structuredClone(value)); },
    async update(value) { if (!store.has(path)) throw new Error('missing'); store.set(path, { ...store.get(path), ...structuredClone(value) }); },
    async delete() { store.delete(path); } });
  return { store,
    doc:path => ref(path),
    collection:name => ({ doc:id => ref(`${name}/${id}`), async get() { return { docs:[...store.keys()].filter(k => k.startsWith(`${name}/`)).map(k => ({ id:k.split('/').pop(), ref:ref(k), data:() => structuredClone(store.get(k)) })) }; } }),
    async runTransaction(fn) { return fn({ get:r => r.get(), set:(r, v) => r.set(v) }); } };
}
const sub = (n = 1) => ({ endpoint:`https://push.example/${n}`, keys:{ p256dh:'BPk', auth:'au' } });

test('what is due: bins at 7 PM the night before, bath at 5:30 PM, the bottle 15–30 minutes ahead while awake', () => {
  // Sunday Nov 29: trash + recycling Monday Nov 30? (recycling every other Monday from Nov 23 → Dec 7) → trash only.
  assert.deepEqual(dueReminders({ now:at(29, 19, 5) }).map(r => [r.kind, r.key, r.body]), [['bins', 'bins:2026-11-30', 'Trash pickup is tomorrow.']]);
  assert.deepEqual(dueReminders({ now:at(29, 18, 50) }).filter(r => r.kind === 'bins'), [], 'not before 7');
  assert.deepEqual(dueReminders({ now:at(29, 19, 20) }).filter(r => r.kind === 'bins'), [], 'only in the 7:00–7:15 run');
  // Bath days default to Sunday and Wednesday.
  assert.equal(dueReminders({ now:at(25, 17, 35) })[0].kind, 'bath');
  assert.deepEqual(dueReminders({ now:at(24, 17, 35) }), [], 'Tuesday is not a bath day');
  assert.deepEqual(dueReminders({ now:at(25, 17, 35), bathDays:[] }), [], 'no bath days set');
  // Bottles every 3 hours; the last at 9:00 AM → next ~12:00 PM.
  const bottles = []; for (let h = 0; h <= 9; h += 3) bottles.push({ start:at(24, h).toISOString(), amount:4, units:'oz' });
  for (let d = 20; d < 24; d++) for (let h = 0; h < 24; h += 3) bottles.push({ start:at(d, h).toISOString(), amount:4, units:'oz' });
  bottles.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const awake = { name:'Frankie', timezone:'America/New_York', bottles, timer:{ active:false } };
  const due = dueReminders({ now:at(24, 11, 38), snapshot:awake }).find(r => r.kind === 'bottle');
  assert.ok(due, 'about 20 minutes ahead'); assert.match(due.body, /^Due around 12:00 PM/); assert.equal(due.key, `bottle:${at(24, 9).toISOString()}`);
  assert.equal(dueReminders({ now:at(24, 11, 50), snapshot:awake }).find(r => r.kind === 'bottle'), undefined, 'too close: the 15-minute window already passed');
  assert.equal(dueReminders({ now:at(24, 11, 38), snapshot:{ ...awake, timer:{ active:true } } }).find(r => r.kind === 'bottle'), undefined, 'not while she sleeps');
});

test('subscribing, choices, a test and turning off', async () => {
  const db = fakeDb(), sent = [], push = createPush({ db, send:async (s, payload) => { sent.push([s.endpoint, JSON.parse(payload)]); } });
  assert.match((await push.handle('m1', { action:'key' })).publicKey, /^[A-Za-z0-9_-]{80,}$/);
  const again = (await push.handle('m1', { action:'key' })).publicKey;
  assert.equal(again, (await createPush({ db }).handle('m1', { action:'key' })).publicKey, 'one key pair, kept');
  assert.deepEqual(await push.handle('m1', { action:'subscribe', subscription:sub(), prefs:{ bottle:false } }), { subscribed:true, prefs:{ bins:true, bath:true, bottle:false } });
  assert.deepEqual(await push.handle('m1', { action:'status', endpoint:sub().endpoint }), { subscribed:true, prefs:{ bins:true, bath:true, bottle:false } });
  await push.handle('m1', { action:'prefs', endpoint:sub().endpoint, prefs:{ bath:false } });
  assert.equal((await push.handle('m1', { action:'test', endpoint:sub().endpoint })).sent, true); assert.equal(sent[0][1].title, 'Reminders are on 🐾');
  assert.deepEqual(await push.handle('m1', { action:'unsubscribe', endpoint:sub().endpoint }), { subscribed:false });
  assert.deepEqual(await push.handle('m1', { action:'status', endpoint:sub().endpoint }), { subscribed:false });
  assert.throws(() => validSubscription({ endpoint:'http://insecure', keys:{ p256dh:'a', auth:'b' } }), /look wrong/);
  assert.deepEqual(validPrefs({ bins:'yes', bath:false }), { bins:true, bath:false, bottle:true });
  assert.ok(![...db.store.values()].some(v => JSON.stringify(v).includes('Frankie')), 'nothing about the baby is stored with a phone');
});

test('the job sends each reminder once, only to phones that want it, and forgets phones that turned them off', async () => {
  const db = fakeDb(), sent = [];
  const push = createPush({ db, send:async s => { if (s.endpoint.endsWith('/3')) { const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push(s.endpoint); } });
  await push.handle('m1', { action:'subscribe', subscription:sub(1) });
  await push.handle('m2', { action:'subscribe', subscription:sub(2), prefs:{ bins:false } });
  await push.handle('m2', { action:'subscribe', subscription:sub(3) });
  let loads = 0; const load = async ({ wantBottle }) => { loads++; assert.equal(wantBottle, true); return { trash:null, bathDays:null, snapshot:null }; };
  const first = await push.run({ now:at(29, 19, 2), load });
  assert.deepEqual(sent, ['https://push.example/1'], 'phone 2 turned bins off; phone 3 is gone');
  assert.equal(first.sent, 1); assert.equal((await db.collection('privatePushSubscriptions').get()).docs.length, 2, 'the gone phone was removed');
  await push.run({ now:at(29, 19, 12), load });
  assert.deepEqual(sent, ['https://push.example/1'], 'not twice');
  assert.equal(loads, 2);
});
