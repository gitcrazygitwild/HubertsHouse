import test from 'node:test';
import assert from 'node:assert/strict';
import { pickupsInRange, nextPickup, pickupOn, cleanTrash, bigHolidays, trashEvents, describeTrash, DEFAULT_TRASH } from '../trash-days.js';

const day = key => new Date(`${key}T12:00:00`);
test('trash every Monday, recycling every other Monday starting Nov 23, 2026', () => {
  const list = pickupsInRange(day('2026-11-22'), day('2026-12-22'));
  assert.deepEqual(list.map(p => [p.date, p.kinds.join('+')]), [['2026-11-23', 'trash+recycling'], ['2026-11-30', 'trash'], ['2026-12-07', 'trash+recycling'], ['2026-12-14', 'trash'], ['2026-12-21', 'trash+recycling']]);
  assert.equal(list[0].title, '🗑️ Trash & ♻️ recycling'); assert.equal(list[1].title, '🗑️ Trash');
  const next = nextPickup(new Date('2026-11-22T20:00:00'));
  assert.equal(next.date, '2026-11-23'); assert.equal(next.label, 'Tomorrow');
  assert.equal(pickupOn(day('2026-11-24')), null);
  assert.equal(trashEvents(day('2026-11-22'), day('2026-11-29'))[0].id, 'trash:2026-11-23');
  assert.match(describeTrash(), /Trash every Monday · Recycling every other Monday/);
});
test('a big holiday pushes pickup to the next workday', () => {
  assert.equal(bigHolidays(2027).get('2027-05-31'), 'Memorial Day'); assert.equal(bigHolidays(2027).get('2027-09-06'), 'Labor Day');
  assert.equal(bigHolidays(2027).get('2027-12-24'), 'Christmas', 'Christmas on a Saturday is observed Friday');
  const memorial = pickupsInRange(day('2027-05-29'), day('2027-06-05'));
  assert.deepEqual(memorial.map(p => p.date), ['2027-06-01']); assert.deepEqual(memorial[0].moved, { from:'2027-05-31', holiday:'Memorial Day' });
  const noBump = pickupsInRange(day('2027-05-29'), day('2027-06-05'), { ...DEFAULT_TRASH, bump:false });
  assert.deepEqual(noBump.map(p => p.date), ['2027-05-31'], 'the household can turn the rule off');
  // A Thursday pickup on Thanksgiving moves to Friday.
  const thursday = { trash:{ day:4, every:1, anchor:'2026-11-26' }, recycling:{ day:4, every:0, anchor:'2026-11-26' }, bump:true };
  assert.deepEqual(pickupsInRange(day('2026-11-24'), day('2026-11-29'), thursday).map(p => [p.date, p.moved?.holiday]), [['2026-11-27', 'Thanksgiving']]);
});
test('the setting is cleaned: bad values fall back, the known date snaps to the chosen weekday', () => {
  const clean = cleanTrash({ trash:{ day:9, every:5, anchor:'nope' }, recycling:{ day:2, every:2, anchor:'2026-11-23' }, bump:'yes' });
  assert.deepEqual(clean.trash, DEFAULT_TRASH.trash);
  assert.deepEqual(clean.recycling, { day:2, every:2, anchor:'2026-11-24' }, 'Monday the 23rd → the next Tuesday');
  assert.equal(clean.bump, true);
  assert.equal(cleanTrash(null), null);
});
