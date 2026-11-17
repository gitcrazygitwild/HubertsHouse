import test from 'node:test';
import assert from 'node:assert/strict';
import { selectForecast, forecastCondition, richmondDay, weatherIcon } from '../weather.js';
import { buildWeekBrief } from '../week-brief.js';

process.env.TZ = 'America/New_York';
test('weather chooses today in Richmond instead of the first published day and rejects expired forecasts', () => {
  const now = new Date('2026-11-15T01:00:00Z'); // Still November 14 in Richmond.
  const generatedAt = '2026-11-13T12:00:00-05:00';
  const blend = { generatedAt, days: [
    {date:'2026-11-13',blendedHighF:40,blendedLowF:30},
    {date:'2026-11-14',blendedHighF:54,blendedLowF:36,blendedPrecipProbability:0,blendedWindMph:null},
    {date:'2026-11-15',blendedHighF:60,blendedLowF:40}
  ] };
  const conditions = { generatedAt, days: [{date:'2026-11-14',sources:{nws:{summary:'Sunny'},met:{summary:'Overcast'}}}] };
  const result = selectForecast(blend, conditions, now);
  assert.equal(richmondDay(now), '2026-11-14');
  assert.equal(result.days[0].high, 54);
  assert.equal(result.days[0].kind, 'partly');
  assert.equal(result.days[0].rain, 0);
  assert.equal(result.days[0].wind, null);
  assert.equal(selectForecast({...blend,generatedAt:'2026-11-10T00:00:00Z'},conditions,now),null);
  assert.equal(selectForecast(blend,conditions,new Date('2026-11-18T12:00:00Z')),null);
  // The whole published week is kept (up to seven days), not just four.
  const long = { generatedAt, days:Array.from({length:9}, (_, i) => ({date:`2026-11-${String(14 + i).padStart(2, '0')}`, blendedHighF:50 + i, blendedLowF:30 + i})) };
  assert.equal(selectForecast(long, conditions, now).days.length, 7);
});

test('weather does not turn missing conditions into sunshine, and precipitation signals get the right icons', () => {
  assert.equal(forecastCondition({}).kind,'unknown');
  assert.equal(forecastCondition({consensus:{thunderSignal:'medium',rainSignal:'strong'}}).kind,'storm');
  assert.equal(forecastCondition({sources:{nws:{summary:'Partly Sunny'}}}).kind,'partly');
  assert.equal(forecastCondition({consensus:{snowSignal:'weak'}}).kind,'snow');
  assert.ok(!weatherIcon('<script>').includes('<script>'));
});

test('the weekly brief counts spans once, excludes completed tasks, and only flags overlaps for shared people', () => {
  const event = (id,start,end,owner,allDay=false) => ({id,title:id,start,end,allDay,extendedProps:{owner}});
  const plans = [
    event('hanry work','2026-11-15T10:00:00','2026-11-15T11:00:00','hanry'),
    event('Karena yoga','2026-11-15T10:00:00','2026-11-15T11:00:00','karena'),
    event('Together','2026-11-15T10:30:00','2026-11-15T11:30:00','both'),
    event('Trip','2026-11-16','2026-11-18','both',true),
    event('Next week','2026-11-22T10:00:00','2026-11-22T11:00:00','both')
  ];
  const items = [
    {kind:'chore',due:'2026-11-14',completed:false},
    {kind:'task',due:'2026-11-16',completed:false},
    {kind:'chore',due:'2026-11-16',completed:true},
    {kind:'grocery',due:'2026-11-16',completed:false},
    {kind:'task',due:'2026-11-22',completed:false},
    {kind:'task',due:'',completed:false}
  ];
  const result=buildWeekBrief(plans,items,new Date('2026-11-15T09:00:00'));
  assert.equal(result.plans,4);
  assert.equal(result.due,2);
  assert.equal(result.overdue,1);
  assert.equal(result.overlaps.length,2);
  assert.ok(result.overlaps.every(pair=>pair.titles.includes('Together')));
  assert.deepEqual(result.busiest,{date:'2026-11-15',count:3});
  assert.equal(result.openEvenings.length,5);
  assert.ok(!result.openEvenings.includes('2026-11-16'));
  assert.ok(result.openEvenings.includes('2026-11-18'));
});

test('evening boundaries and adjacent timed events do not create false conflicts', () => {
  const events = [
    {start:'2026-11-15T16:00:00',end:'2026-11-15T17:00:00',extendedProps:{owner:'both'}},
    {start:'2026-11-15T22:00:00',end:'2026-11-15T23:00:00',extendedProps:{owner:'both'}}
  ];
  const result=buildWeekBrief(events,[],new Date('2026-11-15T12:00:00'));
  assert.equal(result.openEvenings.length,7);
  assert.equal(result.overlaps.length,0);
});
