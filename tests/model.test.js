import test from 'node:test';
import assert from 'node:assert/strict';
import { completionPatch, nextDue, validateItem, escapeHTML } from '../household-model.js';
test('finishing an overdue recurring chore advances to its next scheduled day without losing its monthly anchor', () => {
  const item = {kind:'chore',due:'2026-01-31',cadence:'monthly',completed:false};
  const first = completionPatch(item,new Date('2026-02-10T12:00:00'));
  assert.equal(first.due,'2026-02-28'); assert.equal(first.anchorDay,31); assert.equal(first.completed,false);
  assert.equal(nextDue({...item,...first},'2026-02-28'),'2026-03-31');
  assert.equal(nextDue({cadence:'weekly',due:'2026-01-05'},'2026-01-21'),'2026-01-26');
});
test('one-off tasks and groceries can be checked and unchecked', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  assert.deepEqual(completionPatch({kind:'task',completed:false},now),{completed:true,lastCompletedAt:now.toISOString()});
  assert.deepEqual(completionPatch({kind:'grocery',completed:true},now),{completed:false,lastCompletedAt:null});
});
test('repeat chores require a real first date; user text is escaped', () => {
  assert.throws(() => validateItem({kind:'chore',title:'Laundry',owner:'both',cadence:'weekly',due:''}),/first due date/);
  assert.throws(() => validateItem({kind:'chore',title:'Laundry',owner:'both',cadence:'weekly',due:'2026-02-31'}),/valid date/);
  assert.equal(escapeHTML('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});
