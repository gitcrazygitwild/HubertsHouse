import test from 'node:test';
import assert from 'node:assert/strict';
import { eventChecklistGroups,checklistKey } from '../checklists.js';
test('event checklists deduplicate Apple occurrences and prefer a current upcoming event to saved context',()=>{
  const base={icloud:true,calendarId:'calendar',uid:'series',title:'Family visit',owner:'both',checklist:[{text:'Pack snacks',done:false}]};
  const groups=eventChecklistGroups([{...base,id:'saved',checklistOnly:true,start:'2026-01-01'},{...base,id:'old',start:'2026-11-14'},{...base,id:'next',start:'2026-11-17'},{...base,id:'later',start:'2026-11-24'},{id:'local',title:'Clean shower',start:'2026-11-18',checklist:[{text:'Scrub',done:true}]}],new Date('2026-11-16T12:00:00'));
  assert.equal(groups.length,2);assert.equal(groups[0].record.id,'next');assert.equal(groups[0].items[0].list,'Family visit');assert.equal(groups[1].items[0].completed,true);
  assert.notEqual(checklistKey(base.checklist),checklistKey([{text:'Pack snacks',done:true}]));
});
