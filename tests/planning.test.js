import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { usHolidays,holidaysInRange,holidayEvents } from '../holidays.js';
import { initEventDateEditor,eventRangeSummary } from '../event-editor.js';
process.env.TZ='America/New_York';
test('federal holidays include observed dates across years, plus common family observances',()=>{
  const holidays=usHolidays(2026),find=name=>holidays.find(item=>item.name===name)?.date;
  assert.equal(find('Thanksgiving'),'2026-11-26');assert.equal(find('Memorial Day'),'2026-05-25');assert.equal(find('Easter Sunday'),'2026-04-05');
  assert.equal(find('Independence Day (observed)'),'2026-07-03');assert.equal(find('Christmas Eve'),'2026-12-24');
  assert.equal(find('Mother’s Day'),'2026-05-10');assert.equal(find('Father’s Day'),'2026-06-21');
  const cross=holidaysInRange('2021-12-31','2022-01-01');assert.equal(cross.filter(item=>item.name==='New Year’s Day (observed)').length,1);
  assert.equal(cross.find(item=>item.name==='New Year’s Eve').federal,false);
  const events=holidayEvents('2026-11-26','2026-11-27');assert.equal(events.length,1);assert.equal(events[0].editable,false);assert.equal(events[0].end,'2026-11-27');
  assert.equal(holidaysInRange('2026-11-27','2026-11-28').length,0);
});
test('event duration survives date changes, inclusive all-day spans and all-day toggles',async t=>{
  const dom=new JSDOM(await readFile(new URL('../index.html',import.meta.url),'utf8'));
  const old=globalThis.document;globalThis.document=dom.window.document;t.after(()=>{globalThis.document=old;dom.window.close();});
  const doc=dom.window.document,editor=initEventDateEditor(),change=id=>doc.getElementById(id).dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  editor.set(false,new Date('2026-10-31T09:00:00'),new Date('2026-10-31T11:00:00'));
  doc.getElementById('evtStartDate').value='2026-11-02';change('evtStartDate');
  assert.equal(doc.getElementById('evtStart').value,'2026-11-02T09:00');assert.equal(doc.getElementById('evtEnd').value,'2026-11-02T11:00');
  doc.querySelector('[data-event-duration="30"]').click();assert.equal(doc.getElementById('evtEndTime').value,'09:30');
  doc.getElementById('evtAllDay').checked=true;change('evtAllDay');assert.equal(doc.getElementById('evtStart').value,'2026-11-02');assert.equal(doc.getElementById('evtStartTime').required,false);
  doc.getElementById('evtAllDay').checked=false;change('evtAllDay');assert.equal(doc.getElementById('evtStartTime').value,'09:00');assert.equal(doc.getElementById('evtEndTime').value,'09:30');
  editor.set(true,new Date('2026-10-31T00:00:00'),new Date('2026-11-02T00:00:00'));assert.match(doc.getElementById('eventDateSummary').textContent,/3 days/);
  doc.getElementById('evtStartDate').value='2026-11-02';change('evtStartDate');assert.equal(doc.getElementById('evtEnd').value,'2026-11-04');
});
test('invalid end times stay visible for correction, and overnight plans require their end date',async t=>{
  const dom=new JSDOM(await readFile(new URL('../index.html',import.meta.url),'utf8')),old=globalThis.document;globalThis.document=dom.window.document;t.after(()=>{globalThis.document=old;dom.window.close();});
  const doc=dom.window.document,editor=initEventDateEditor();editor.set(false,new Date('2026-11-15T22:00:00'),new Date('2026-11-15T23:00:00'));
  doc.getElementById('evtEndTime').value='01:00';doc.getElementById('evtEndTime').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.getElementById('evtEndTime').value,'01:00');assert.equal(doc.getElementById('evtEndTime').validity.valid,false);
  doc.getElementById('evtEndDate').value='2026-11-16';doc.getElementById('evtEndDate').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.getElementById('evtEndTime').validity.valid,true);assert.match(doc.getElementById('eventDateSummary').textContent,/3h/);
  assert.match(eventRangeSummary('2026-11-01','2026-11-01',true),/All day/);
});
