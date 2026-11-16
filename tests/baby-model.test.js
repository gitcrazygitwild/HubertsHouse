import test from 'node:test';
import assert from 'node:assert/strict';
import { purrfectWindow, huckleberryPrediction } from '../baby-model.js';

const now = new Date('2026-11-15T15:30:00Z'); // 10:30 in New York
function history() {
  const sleeps = [];
  for (const day of ['12','13','14']) for (const hour of [11,14,17]) sleeps.push({start:`2026-11-${day}T${hour}:00:00Z`,end:`2026-11-${day}T${hour+1}:00:00Z`});
  sleeps.push({start:'2026-11-15T14:00:00Z',end:'2026-11-15T15:00:00Z'}); return sleeps;
}
test('Purrfect Window uses personal daytime gaps, merges duplicates, and has no prediction input', () => {
  const sleeps = history(), result = purrfectWindow({sleeps},now);
  assert.equal(result.available,true); assert.equal(result.target,'2026-11-15T17:00:00.000Z');
  assert.equal(result.start,'2026-11-15T16:50:00.000Z'); assert.equal(result.end,'2026-11-15T17:10:00.000Z');
  assert.equal(result.samples,6); assert.equal(result.days,3); assert.equal(result.phase,'upcoming');
  assert.deepEqual(purrfectWindow({sleeps:[...sleeps,...sleeps],sweetspot:{time:'2099-01-01'}},now),result);
  assert.equal(purrfectWindow({sleeps},new Date('2026-11-15T17:00Z')).phase,'within');
  assert.equal(purrfectWindow({sleeps},new Date('2026-11-15T18:00Z')).phase,'passed');
});
test('missing, old, incomplete, overnight and active sleep data never invent a nap time', () => {
  const sleeps = history();
  for (const data of [{sleeps:[]},{sleeps:sleeps.slice(-1)},{sleeps:sleeps.slice(0,-1)},{sleeps,complete:false},{sleeps,timer:{active:true}}]) assert.equal(purrfectWindow(data,now).available,false);
  assert.equal(purrfectWindow({sleeps:[...sleeps,{start:'2026-11-16T05:00:00Z',end:'2026-11-16T06:00:00Z'}]},new Date('2026-11-16T06:30:00Z')).available,false);
});
test('local dates exclude overnight gaps across daylight saving and use elapsed minutes', () => {
  const sleeps = [];
  for (const day of ['01','02','03']) for (const hour of [11,14,17]) sleeps.push({start:`2026-11-${day}T${hour}:00:00Z`,end:`2026-11-${day}T${hour+1}:00:00Z`});
  sleeps.push({start:'2026-11-04T14:00:00Z',end:'2026-11-04T15:00:00Z'});
  const result = purrfectWindow({sleeps,timezone:'America/New_York'},new Date('2026-11-04T15:30:00Z'));
  assert.equal(result.target,'2026-11-04T17:00:00.000Z'); assert.equal(result.samples,6);
});
test('Huckleberry stored predictions stay distinct and are marked expired or stale', () => {
  const base = {sweetspot:{time:'2026-11-15T17:00:00Z'},sleeps:history(),checkedAt:now.toISOString()};
  assert.equal(huckleberryPrediction(base,now).expired,false);
  assert.equal(huckleberryPrediction(base,new Date('2026-11-15T18:00Z')).expired,true);
  assert.equal(huckleberryPrediction({...base,checkedAt:'2026-11-15T15:00:00Z'},now).staleRead,true);
  assert.equal(huckleberryPrediction({...base,timer:{active:true}},now).sleeping,true);
  assert.equal(huckleberryPrediction({sweetspot:{time:null}},now).available,false);
});
