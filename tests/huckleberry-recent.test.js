import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { huckleberryRecent, changeHuckleberry, RECENT_DAYS } from '../functions/huckleberry-provider.js';
const { FieldValue, Timestamp } = createRequire(new URL('../functions/package.json', import.meta.url))('@google-cloud/firestore');

const now = Date.parse('2026-11-16T20:00:00Z'), H = 3600, s = ms => ms / 1000;
// A small Firestore stand-in: versioned documents, simple queries, and atomic
// batches whose updates and deletes must name the version they read.
function memory(initial) {
  const docs = new Map(Object.entries(structuredClone(initial))), versions = new Map();
  let clock = 1000; const bump = path => versions.set(path, new Timestamp(clock++, 123));
  [...docs.keys()].forEach(bump);
  const snap = path => ({id:path.split('/').at(-1), exists:docs.has(path), data:() => structuredClone(docs.get(path)), updateTime:versions.get(path)});
  const ref = path => ({path, get:async () => snap(path), collection:name => collection(`${path}/${name}`)});
  const collection = base => {
    const query = (filters = [], order = null, max = Infinity) => ({
      doc:id => ref(`${base}/${id}`),
      where:(field, op, value) => { assert.equal(op, '>='); return query([...filters, [field, value]], order, max); },
      orderBy:(field, dir = 'asc') => query(filters, [field, dir], max),
      limit:n => query(filters, order, n),
      async get() {
        let list = [...docs.keys()].filter(path => path.startsWith(`${base}/`) && !path.slice(base.length + 1).includes('/')).map(snap);
        for (const [field, value] of filters) list = list.filter(doc => doc.data()[field] >= value);
        if (order) list = list.filter(doc => doc.data()[order[0]] !== undefined).sort((a, b) => (a.data()[order[0]] - b.data()[order[0]]) * (order[1] === 'desc' ? -1 : 1));
        list = list.slice(0, max); return {docs:list, size:list.length};
      }
    });
    return query();
  };
  const apply = (base, patch) => {
    const next = structuredClone(base);
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.split('.'); let target = next;
      for (const key of keys.slice(0, -1)) target = target[key] ||= {};
      if (value instanceof FieldValue) { assert.ok(FieldValue.delete().isEqual(value)); delete target[keys.at(-1)]; } else target[keys.at(-1)] = structuredClone(value);
    }
    return next;
  };
  return {docs, doc:ref, collection,
    touch(path, patch) { docs.set(path, apply(docs.get(path), patch)); bump(path); },
    batch() {
      const writes = [];
      const check = pre => assert.ok(pre?.lastUpdateTime, 'Changes must name the version they read');
      return {
        update(reference, data, pre) { check(pre); writes.push({kind:'update', path:reference.path, data, pre}); },
        delete(reference, pre) { check(pre); writes.push({kind:'delete', path:reference.path, pre}); },
        async commit() {
          for (const write of writes) if (!docs.has(write.path) || !versions.get(write.path).isEqual(write.pre.lastUpdateTime)) throw Object.assign(new Error('stale'), {code:9});
          for (const write of writes) { if (write.kind === 'delete') { docs.delete(write.path); versions.delete(write.path); } else { docs.set(write.path, apply(docs.get(write.path), write.data)); bump(write.path); } }
        }
      };
    }
  };
}
const household = () => memory({
  'sleep/c':{prefs:{lastSleep:{start:s(now - 3 * H * 1000), duration:3600, offset:-300}}},
  'sleep/c/intervals/s1':{start:s(now - 6 * H * 1000), duration:5400, offset:-300},
  'sleep/c/intervals/s2':{start:s(now - 3 * H * 1000), duration:3600, offset:-300},
  'sleep/c/intervals/old':{start:s(now - 9 * 86400000), duration:3600},
  'sleep/c/intervals/batch':{multi:true, data:{a:{start:s(now - H * 1000), duration:600}}},
  'feed/c':{prefs:{lastBottle:{mode:'bottle', start:s(now - H * 1000), bottleAmount:5, bottleUnits:'oz', bottleType:'Formula'}}},
  'feed/c/intervals/b1':{mode:'bottle', start:s(now - 4 * H * 1000), amount:4, units:'oz', bottleType:'Formula'},
  'feed/c/intervals/b2':{mode:'bottle', start:s(now - H * 1000), amount:5, units:'oz', bottleType:'Formula'},
  'feed/c/intervals/breast':{mode:'breast', start:s(now - 2 * H * 1000), leftDuration:300},
  'diaper/c':{prefs:{lastDiaper:{start:s(now - 30 * 60000), mode:'both'}}},
  'diaper/c/intervals/d1':{start:s(now - 30 * 60000), mode:'both'}
});
const entry = async (client, kind, id) => (await huckleberryRecent(client, 'c', now)).entries.find(item => item.kind === kind && item.id === id);

test('recent logs list sleeps, bottles and diapers newest first, skipping old, batched and breast entries', async () => {
  const client = household(), {days, entries} = await huckleberryRecent(client, 'c', now);
  assert.equal(days, RECENT_DAYS);
  assert.deepEqual(entries.map(item => item.id), ['d1', 'b2', 's2', 'b1', 's1']);
  assert.equal(entries.find(item => item.id === 's2').end, new Date(now - 2 * H * 1000).toISOString());
  assert.deepEqual(entries.find(item => item.id === 'b1'), {kind:'bottle', id:'b1', version:entries.find(item => item.id === 'b1').version, start:new Date(now - 4 * H * 1000).toISOString(), amount:4, units:'oz', bottleType:'Formula'});
  assert.match(entries[0].version, /^\d+\.\d{9}$/);
});

test('editing the newest bottle updates it and the “last bottle” summary Huckleberry keeps', async () => {
  const client = household(), b2 = await entry(client, 'bottle', 'b2');
  const result = await changeHuckleberry(client, 'c', {change:'edit', kind:'bottle', id:'b2', version:b2.version, start:b2.start, amount:6, units:'oz', bottleType:'Breast Milk'}, 'America/New_York', now);
  assert.deepEqual(result, {saved:true});
  assert.equal(client.docs.get('feed/c/intervals/b2').amount, 6); assert.equal(client.docs.get('feed/c/intervals/b2').bottleType, 'Breast Milk');
  assert.equal(client.docs.get('feed/c').prefs.lastBottle.bottleAmount, 6);
  // An older bottle edit leaves the summary alone.
  const b1 = await entry(client, 'bottle', 'b1');
  await changeHuckleberry(client, 'c', {change:'edit', kind:'bottle', id:'b1', version:b1.version, start:b1.start, amount:3, units:'oz', bottleType:'Formula'}, 'America/New_York', now);
  assert.equal(client.docs.get('feed/c').prefs.lastBottle.bottleAmount, 6);
});

test('deleting the newest entry moves the summary to the one before, or clears it', async () => {
  const client = household(), s2 = await entry(client, 'sleep', 's2');
  await changeHuckleberry(client, 'c', {change:'delete', kind:'sleep', id:'s2', version:s2.version}, 'America/New_York', now);
  assert.equal(client.docs.has('sleep/c/intervals/s2'), false);
  assert.equal(client.docs.get('sleep/c').prefs.lastSleep.start, s(now - 6 * H * 1000)); // s1 is newest now
  const d1 = await entry(client, 'diaper', 'd1');
  await changeHuckleberry(client, 'c', {change:'delete', kind:'diaper', id:'d1', version:d1.version}, 'America/New_York', now);
  assert.equal(client.docs.get('diaper/c').prefs.lastDiaper, undefined);
  // Deleting again is harmless.
  assert.deepEqual(await changeHuckleberry(client, 'c', {change:'delete', kind:'diaper', id:'d1', version:d1.version}, 'America/New_York', now), {saved:true, missing:true});
});

test('a sleep edited to be the newest becomes the summary', async () => {
  const client = household(), s1 = await entry(client, 'sleep', 's1');
  const start = new Date(now - 90 * 60000).toISOString(), end = new Date(now - 30 * 60000).toISOString();
  await changeHuckleberry(client, 'c', {change:'edit', kind:'sleep', id:'s1', version:s1.version, start, end}, 'America/New_York', now);
  const last = client.docs.get('sleep/c').prefs.lastSleep;
  assert.equal(last.start, s(Date.parse(start))); assert.equal(last.duration, 3600);
  assert.equal(client.docs.get('sleep/c/intervals/s1').duration, 3600);
});

test('changes refuse stale versions, invalid values and entries that are not listed', async () => {
  const client = household(), b1 = await entry(client, 'bottle', 'b1'), tz = 'America/New_York';
  client.touch('feed/c/intervals/b1', {amount:4.5}); // changed in the Huckleberry app meanwhile
  await assert.rejects(changeHuckleberry(client, 'c', {change:'delete', kind:'bottle', id:'b1', version:b1.version}, tz, now), {code:'aborted'});
  assert.equal(client.docs.has('feed/c/intervals/b1'), true);
  const fresh = await entry(client, 'bottle', 'b1');
  await assert.rejects(changeHuckleberry(client, 'c', {change:'edit', kind:'bottle', id:'b1', version:fresh.version, start:fresh.start, amount:0, units:'oz', bottleType:'Formula'}, tz, now), {code:'invalid-argument'});
  await assert.rejects(changeHuckleberry(client, 'c', {change:'edit', kind:'bottle', id:'b1', version:fresh.version, start:new Date(now + 3600000).toISOString(), amount:4, units:'oz', bottleType:'Formula'}, tz, now), {code:'invalid-argument'});
  const breast = (await client.doc('feed/c/intervals/breast').get()).updateTime, version = `${breast.seconds}.${String(breast.nanoseconds).padStart(9, '0')}`;
  await assert.rejects(changeHuckleberry(client, 'c', {change:'delete', kind:'bottle', id:'breast', version}, tz, now), {code:'failed-precondition'});
  await assert.rejects(changeHuckleberry(client, 'c', {change:'delete', kind:'bottle', id:'../x', version}, tz, now), {code:'invalid-argument'});
  await assert.rejects(changeHuckleberry(client, 'c', {change:'wipe', kind:'bottle', id:'b1', version}, tz, now), {code:'invalid-argument'});
  assert.equal(client.docs.has('feed/c/intervals/breast'), true);
});
