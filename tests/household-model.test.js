import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ='America/New_York';

test('pasted groceries skip unchecked duplicates but allow buying a completed item again', async()=>{
 const {groceryBatch}=await import('../household-model.js');
 const result=groceryBatch('• Oat milk\n- apples\nAPPLES\n1. Bread',[{kind:'grocery',title:'oat   milk',completed:false},{kind:'grocery',title:'Bread',completed:true}]);
 assert.deepEqual(result.additions.map(item=>item.title),['apples','Bread']);assert.equal(result.skipped.length,2);
 assert.equal(result.additions[0].category,'Produce');assert.throws(()=>groceryBatch('x\n'.repeat(101)),/100/);
});
test('postponing a monthly chore retains its original anchor and never completes it',async()=>{
 const {postponeItemPatch}=await import('../household-model.js');
 assert.deepEqual(postponeItemPatch({kind:'chore',cadence:'monthly',due:'2026-01-31'},new Date('2026-02-28T12:00:00')),{due:'2026-03-01',anchorDay:31});
});
