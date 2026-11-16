import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherFlags, nextUp, untilText, isOutdoor, catCareStatus, CAT_TASKS } from '../smart-home.js';
import { dateKey } from '../household-model.js';

const now = new Date(2026, 10, 16, 9, 0);
const day = offset => { const d = new Date(now); d.setDate(d.getDate() + offset); return d; };
const at = (offset, hour) => { const d = day(offset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

test('outdoor plans on rainy days are flagged, indoor plans and dry days are not', () => {
  const events = [
    { id:'a', title:'A little time outside', start:at(2, 16), end:at(2, 17) },
    { id:'b', title:'Dentist', start:at(2, 9), end:at(2, 10) },
    { id:'c', title:'Farmers market', start:at(0, 10), end:at(0, 12) },
    { id:'d', title:'Picnic', start:at(9, 12), end:at(9, 14) }
  ];
  const days = [{ date:dateKey(day(0)), rain:10, kind:'sun' }, { date:dateKey(day(2)), rain:65, kind:'rain', label:'A chance of showers' }];
  const flags = weatherFlags(events, days, now);
  assert.deepEqual(flags.map(f => [f.id, f.rain]), [['a', 65]]);
  assert.equal(isOutdoor('Movie night at home'), false); assert.equal(isOutdoor('Zoo with Frankie'), true);
});

test('now and next', () => {
  const events = [{ id:'1', title:'Coffee', start:at(0, 8), end:at(0, 10) }, { id:'2', title:'Lunch', start:at(0, 12), end:at(0, 13) }, { id:'3', title:'All day', start:at(0, 0), allDay:true }];
  const { current, next } = nextUp(events, now);
  assert.equal(current.event.id, '1'); assert.equal(current.minutesLeft, 60);
  assert.equal(next.event.id, '2'); assert.equal(next.minutesUntil, 180);
  assert.equal(untilText(45), 'in 45m'); assert.equal(untilText(135), 'in 2h 15m'); assert.equal(untilText(3000), 'in 2 days');
});

test('cat care knows who is still waiting for a meal', () => {
  const evening = new Date(2026, 10, 16, 18, 0), at7 = { by:'hanry', at:'x' };
  const status = catCareStatus({ hubert_am:at7, mack_am:at7, mia_am:at7, hubert_pm:at7 }, evening);
  assert.deepEqual(status.hungry, ['Mack', 'Mia']); assert.equal(status.done, 4); assert.equal(status.total, CAT_TASKS.length);
  assert.deepEqual(catCareStatus({}, new Date(2026, 10, 16, 5, 0)).hungry, []);
});
