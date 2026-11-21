import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sleepsAfter, removeSleeps, restoreSleeps } from '../functions/huckleberry-provider.js';
import { recoveredEntry, scorePredictions, sweetspotEntry } from '../prediction-log.js';
const { FieldValue } = createRequire(new URL('../functions/package.json', import.meta.url))('@google-cloud/firestore');

const now = Date.parse('2026-11-19T20:00:00Z'), H = 3600000, s = ms => ms / 1000;
// A tiny Firestore stand-in: documents, ordered/filtered queries and batches.
function memory(initial) {
  const docs = new Map(Object.entries(structuredClone(initial)));
  const snap = path => ({ id:path.split('/').at(-1), exists:docs.has(path), data:() => structuredClone(docs.get(path)) });
  const ref = path => ({ path, get:async () => snap(path), collection:name => collection(`${path}/${name}`) });
  const collection = base => {
    const query = (filters = [], order = null, max = Infinity) => ({
      doc:id => ref(`${base}/${id}`), where:(field, op, value) => query([...filters, [field, value]], order, max), orderBy:(field, dir = 'asc') => query(filters, [field, dir], max), limit:n => query(filters, order, n),
      async get() {
        let list = [...docs.keys()].filter(p => p.startsWith(`${base}/`) && !p.slice(base.length + 1).includes('/')).map(snap);
        for (const [field, value] of filters) list = list.filter(d => d.data()[field] >= value);
        if (order) list.sort((a, b) => (a.data()[order[0]] - b.data()[order[0]]) * (order[1] === 'desc' ? -1 : 1));
        return { docs:list.slice(0, max) };
      }
    });
    return query();
  };
  const patch = (base, data) => { const next = structuredClone(base || {}); for (const [path, value] of Object.entries(data)) { const keys = path.split('.'); let t = next; for (const k of keys.slice(0, -1)) t = t[k] ||= {}; if (value instanceof FieldValue) delete t[keys.at(-1)]; else t[keys.at(-1)] = structuredClone(value); } return next; };
  return { docs, doc:ref, batch() { const w = []; return { delete:r => w.push(() => docs.delete(r.path)), set:(r, d) => w.push(() => docs.set(r.path, structuredClone(d))), update:(r, d) => w.push(() => docs.set(r.path, patch(docs.get(r.path), d))), commit:async () => w.forEach(f => f()) }; } };
}
const nap = (startH, minutes, extra = {}) => ({ start:s(now - startH * H), duration:minutes * 60, offset:-300, end_offset:-300, lastUpdated:s(now), ...extra });
const house = () => memory({
  'sleep/c':{ timer:{ active:false }, prefs:{ lastSleep:{ start:s(now - 2 * H), duration:2700, offset:-300 } } },
  'sleep/c/intervals/a':nap(9, 60),                                      // the missed nap ended 8 h ago
  'sleep/c/intervals/b':nap(5, 90, { details:{ notes:'contact nap' } }), // logged after it
  'sleep/c/intervals/c':nap(2, 45)                                       // logged after it
});

test('recovery copies the later sleeps, removes them, and puts them back exactly', async () => {
  const db = house(), before = structuredClone(Object.fromEntries(db.docs));
  const wake = now - 8 * H;
  const saved = await sleepsAfter(db, 'c', wake, now);
  assert.deepEqual(saved.map(x => x.id), ['b', 'c']); assert.equal(saved[0].data.details.notes, 'contact nap');
  await removeSleeps(db, 'c', saved, now);
  assert.ok(!db.docs.has('sleep/c/intervals/b') && !db.docs.has('sleep/c/intervals/c'));
  assert.equal(db.docs.get('sleep/c').prefs.lastSleep.start, s(now - 9 * H), 'Huckleberry now sees the missed nap as the latest sleep');
  const back = await restoreSleeps(db, 'c', saved, now);
  assert.deepEqual(back, { restored:2, alreadyThere:0 });
  for (const id of ['a', 'b', 'c']) assert.deepEqual(db.docs.get(`sleep/c/intervals/${id}`), before[`sleep/c/intervals/${id}`], `${id} is exactly as before`);
  assert.equal(db.docs.get('sleep/c').prefs.lastSleep.start, s(now - 2 * H));
  // Putting back twice is harmless (a retry after a dropped connection).
  assert.deepEqual(await restoreSleeps(db, 'c', saved, now), { restored:0, alreadyThere:2 });
});

test('a sleep logged during the recovery is kept, and a running timer blocks starting one', async () => {
  const db = house(), saved = await sleepsAfter(db, 'c', now - 8 * H, now);
  await removeSleeps(db, 'c', saved, now);
  db.docs.set('sleep/c/intervals/new', nap(0.5, 20));
  await restoreSleeps(db, 'c', saved, now);
  assert.ok(db.docs.has('sleep/c/intervals/new')); assert.equal(db.docs.get('sleep/c').prefs.lastSleep.start, s(now - 0.5 * H));
  const busy = house(); busy.docs.get('sleep/c').timer = { active:true };
  await assert.rejects(sleepsAfter(busy, 'c', now - 8 * H, now), /sleep timer is running/);
  await assert.rejects(sleepsAfter(house(), 'c', now - 40 * 86400000, now), /past 30 days/);
});

test('a recovered SweetSpot must be new and land after that wake-up', () => {
  const wake = '2026-11-19T12:00:00.000Z';
  const entry = recoveredEntry({ lastWake:wake, childId:'c', sweetspot:'2026-11-19T13:40:00.000Z', before:'2026-11-19T19:10:00.000Z', now:new Date(now) });
  assert.deepEqual(entry, { id:`w${Date.parse(wake)}`, lastWake:wake, childId:'c', sweetspot:{ target:'2026-11-19T13:40:00.000Z', loggedAt:new Date(now).toISOString() } });
  assert.equal(recoveredEntry({ lastWake:wake, childId:'c', sweetspot:'2026-11-19T19:10:00.000Z', before:'2026-11-19T19:10:00.000Z' }), null, 'unchanged means Huckleberry hasn’t recalculated');
  assert.equal(recoveredEntry({ lastWake:wake, childId:'c', sweetspot:'2026-11-19T11:00:00.000Z' }), null);
  assert.equal(recoveredEntry({ lastWake:wake, childId:'c', sweetspot:'2026-11-19T23:00:00.000Z' }), null, 'more than 8 hours later');
});

test('the scoreboard lists recent naps missing a SweetSpot', () => {
  // Midnight UTC yesterday, so the naps are daytime whatever time the test runs.
  const day = Math.floor(Date.now() / 86400000) * 86400000 - 86400000, iso = ms => new Date(ms).toISOString(), M = 60000;
  const sleeps = [{ start:iso(day + 7 * H - 600 * M), end:iso(day + 7 * H) }, { start:iso(day + 9 * H), end:iso(day + 10 * H) }, { start:iso(day + 12 * H), end:iso(day + 13 * H) }, { start:iso(day + 15 * H), end:iso(day + 15.5 * H) }];
  const first = sweetspotEntry({ lastWake:sleeps[1].end, childId:'c', sweetspot:{ available:true, time:iso(day + 12 * H) }, timezone:'UTC', sleeps, now:new Date(day + 10 * H + 5 * M) });
  const score = scorePredictions([first], sleeps, null, 'UTC');
  assert.deepEqual(score.missed.map(m => m.lastWake), [sleeps[2].end]);
});
