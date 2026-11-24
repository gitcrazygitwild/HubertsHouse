import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, createHealth } from '../functions/service-health.js';
import { HuckleberryError } from '../functions/huckleberry-provider.js';
import { healthAlerts, healthRows, describeProblem } from '../service-health-model.js';

// A tiny stand-in for Firestore: doc(path).set(data, {merge}) and runTransaction(get/set).
function fakeDb() {
  const docs = new Map(), writes = [];
  const ref = path => ({ path, set:async (data, opts) => { writes.push(path); docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...data } : data); } });
  return { docs, writes, doc:ref, runTransaction:async fn => fn({ get:async r => ({ exists:docs.has(r.path), data:() => docs.get(r.path) }), set:(r, data, opts) => { writes.push(r.path); docs.set(r.path, opts?.merge ? { ...(docs.get(r.path) || {}), ...data } : data); } }) };
}

test('failures are sorted into kinds; the user’s own mistakes don’t count', () => {
  assert.equal(classifyFailure(new HuckleberryError('unauthenticated', 'x', { reason:'PROVIDER_UNAUTHENTICATED' })), 'signed-out');
  assert.equal(classifyFailure(new HuckleberryError('permission-denied', 'x')), 'denied');
  assert.equal(classifyFailure(new HuckleberryError('invalid-argument', 'x')), null);
  assert.equal(classifyFailure(new HuckleberryError('failed-precondition', 'Connect first')), null);
  assert.equal(classifyFailure(Object.assign(new TypeError('fetch failed'), { cause:{ code:'ECONNRESET' } })), 'unreachable');
  assert.equal(classifyFailure(new SyntaxError('Unexpected token < in JSON')), 'changed');
  assert.equal(classifyFailure(Object.assign(new Error('Publix’s weekly ad came back without any BOGOs'), { code:'unavailable' })), 'changed');
  assert.equal(classifyFailure(Object.assign(new Error('Publix’s weekly ad didn’t answer'), { code:'unavailable' })), 'unreachable');
  assert.equal(classifyFailure(Object.assign(new Error('gRPC'), { code:14 })), 'unreachable');
});

test('the server records when a service stops and starts working again', async () => {
  let t = Date.parse('2026-11-22T14:00:00Z'); const db = fakeDb(), health = createHealth({ db, now:() => new Date(t) });
  assert.equal(await health.track('huckleberry', async () => 'snapshot'), 'snapshot');
  assert.equal(db.docs.get('serviceHealth/huckleberry').lastOk, '2026-11-22T14:00:00.000Z');
  t += 5 * 60000; await health.track('huckleberry', async () => 'again');
  assert.equal(db.writes.length, 1, 'successes are written at most every half hour');
  t += 60000; await assert.rejects(health.track('huckleberry', async () => { throw Object.assign(new Error('down'), { code:14 }); }));
  t += 60000; await assert.rejects(health.track('huckleberry', async () => { throw Object.assign(new Error('down'), { code:14 }); }));
  const failing = db.docs.get('serviceHealth/huckleberry');
  assert.equal(failing.problem, 'unreachable'); assert.equal(failing.failures, 2); assert.equal(failing.failingSince, '2026-11-22T14:06:00.000Z', 'when it started, not the latest failure');
  await assert.rejects(health.track('huckleberry', async () => { throw new HuckleberryError('invalid-argument', 'bad'); }));
  assert.equal(db.docs.get('serviceHealth/huckleberry').failures, 2, 'a typo isn’t an outage');
  t += 60000; await health.track('huckleberry', async () => 'back');
  assert.deepEqual([db.docs.get('serviceHealth/huckleberry').problem, db.docs.get('serviceHealth/huckleberry').failingSince], [null, null], 'the first success after trouble clears it right away');
});

test('warnings: quiet for one blip, plain words once it lasts', () => {
  const now = Date.parse('2026-11-22T19:30:00Z'), tz = 'America/New_York';
  const blip = { service:'huckleberry', problem:'unreachable', failingSince:'2026-11-22T19:25:00Z', failures:1 };
  assert.deepEqual(healthAlerts([blip], now, { timezone:tz }), [], 'five minutes, once: still quiet');
  const down = { ...blip, failingSince:'2026-11-22T19:05:00Z' };
  const [alert] = healthAlerts([down], now, { timezone:tz });
  assert.equal(alert.text, 'Huckleberry hasn’t answered since 2:05 PM.');
  assert.equal(healthAlerts([{ ...blip, failures:2 }], now).length, 1, 'twice in a row shows right away');
  assert.match(describeProblem({ service:'huckleberry', problem:'signed-out', failingSince:down.failingSince }, now, tz), /stopped accepting the saved sign-in.*Reconnect it in Settings/);
  assert.match(describeProblem({ service:'publix', problem:'changed', failingSince:down.failingSince }, now, tz), /Publix is sending something unexpected.*weekly BOGOs/);
  assert.match(describeProblem({ service:'publix', problem:'unreachable', failingSince:'2026-11-20T15:00:00Z' }, now, tz), /since Friday 10:00 AM/);
  const rows = healthRows([down, { service:'publix', lastOk:'2026-11-22T19:00:00Z', problem:null }], now, { timezone:tz });
  assert.deepEqual(rows.map(r => r.state), ['warning', 'ok', 'unknown']); assert.match(rows[1].text, /Working · last checked 2:00 PM/);
});
