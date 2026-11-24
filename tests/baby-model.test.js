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
  assert.equal(result.start,'2026-11-15T16:55:00.000Z'); assert.equal(result.end,'2026-11-15T17:05:00.000Z'); // tight: 5 minutes either side
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

test('Today’s top line averages the three cats, leaving out a cat calling a different sleep', async () => {
  const { catsConsensus } = await import('../baby-model.js');
  const at = hm => `2026-11-22T${hm}:00.000Z`;
  const all = catsConsensus({ purr:{ available:true, target:at('00:30'), kind:'bedtime' }, mia:{ available:true, target:at('00:45'), kind:'bedtime' }, huck:{ available:true, time:at('01:00') } });
  assert.equal(all.target, at('00:45')); assert.equal(all.kind, 'bedtime'); assert.deepEqual(all.picks.map(p => p.cat), ['Hubert', 'Mia', 'Mack']);
  // Hubert still calls a late nap while Mia and Mack call bedtime hours later: he's left out.
  const split = catsConsensus({ purr:{ available:true, target:at('20:00'), kind:'nap' }, mia:{ available:true, target:at('23:30'), kind:'bedtime' }, huck:{ available:true, time:at('23:40') } });
  assert.equal(split.target, at('23:35')); assert.equal(split.kind, 'bedtime'); assert.deepEqual(split.left, ['Hubert']);
  // An expired SweetSpot doesn't count; nothing at all gives null.
  assert.deepEqual(catsConsensus({ mia:{ available:true, target:at('15:00'), kind:'nap' }, huck:{ available:true, expired:true, time:at('14:00') } }).picks.map(p => p.cat), ['Mia']);
  assert.equal(catsConsensus({}), null);
});

test('asleep: the next bottle waits for the cats’ averaged wake-up call', async () => {
  const { averageCalls, sleepAwareBottle } = await import('../baby-model.js');
  const at = hm => `2026-11-23T${hm}:00.000Z`;
  // Hubert expects a 4:40 wake-up, Mia and Mack the morning around 7:30: Hubert is the odd one out.
  const wake = averageCalls([{ cat:'Hubert', at:at('04:40') }, { cat:'Mia', at:at('07:50') }, { cat:'Mack', at:at('07:10') }]);
  assert.equal(wake.target, at('07:30')); assert.deepEqual(wake.left.map(p => p.cat), ['Hubert']);
  const forecast = { available:true, target:at('02:00'), start:at('01:30'), end:at('02:30'), typicalMinutes:180, phase:'upcoming' };
  const next = sleepAwareBottle(forecast, wake);
  assert.equal(next.target, at('07:30')); assert.equal(next.waitingForWake, true); assert.deepEqual(next.wakeCats, ['Mia', 'Mack']);
  assert.equal(sleepAwareBottle(forecast, { target:at('01:00') }), forecast, 'waking before the usual gap changes nothing');
  assert.equal(sleepAwareBottle(forecast, null), forecast);
});

test('Hubert guesses when a nap ends: how long her naps around that time of day usually last', () => {
  const tz = 'America/New_York', day = d => `2026-11-${String(d).padStart(2, '0')}`;
  const sleeps = [];
  for (let d = 15; d <= 23; d++) {
    sleeps.push({ start:`${day(d - 1)}T19:30:00-05:00`, end:`${day(d)}T06:30:00-05:00` });
    sleeps.push({ start:`${day(d)}T09:00:00-05:00`, end:`${day(d)}T10:30:00-05:00` }); // morning naps: 90 min
    sleeps.push({ start:`${day(d)}T14:00:00-05:00`, end:`${day(d)}T14:40:00-05:00` }); // afternoon naps: 40 min
  }
  sleeps.push({ start:`${day(23)}T19:30:00-05:00`, end:`${day(24)}T06:30:00-05:00` });
  const morning = purrfectWindow({ sleeps, timer:{ active:true, start:`${day(24)}T09:10:00-05:00` }, timezone:tz }, new Date(`${day(24)}T09:30:00-05:00`));
  assert.equal(morning.available, true); assert.equal(morning.kind, 'wake'); assert.equal(morning.nap, true);
  assert.equal(morning.typicalMinutes, 90); assert.equal(morning.target, new Date(`${day(24)}T10:40:00-05:00`).toISOString());
  const afternoon = purrfectWindow({ sleeps, timer:{ active:true, start:`${day(24)}T14:05:00-05:00` }, timezone:tz }, new Date(`${day(24)}T14:10:00-05:00`));
  assert.equal(afternoon.typicalMinutes, 40, 'matched to naps at that time of day');
  assert.equal(purrfectWindow({ sleeps:sleeps.slice(0, 4), timer:{ active:true, start:`${day(24)}T09:10:00-05:00` }, timezone:tz }, new Date(`${day(24)}T09:30:00-05:00`)).available, false, 'needs a few naps first');
});
