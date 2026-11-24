import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { answerQuestion, isQuestion, daysAsked } = await import('../ask.js');
const { setBirthdayList } = await import('../birthdays-model.js');

const now = new Date('2026-11-24T10:00:00-05:00'); // a Tuesday
const at = (day, h, m = 0) => new Date(`2026-11-${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`).toISOString();
const events = [
  { id:'a', title:'Farmers’ market', start:at(24, 10, 30), end:at(24, 12), allDay:false },
  { id:'b', title:'Coffee with Sam', start:at(25, 11), end:at(25, 12), allDay:false },
  { id:'c', title:'Dentist', start:at(27, 9), end:at(27, 10), allDay:false },
  { id:'d', title:'Movie night', start:at(28, 19), end:at(28, 21), allDay:false },
  { id:'h', title:'Thanksgiving', start:'2026-11-26', end:'2026-11-27', allDay:true, extendedProps:{ holiday:true } }
];
const baby = { name:'Frankie', timer:{ active:false }, lastWake:at(24, 9, 30), lastBottle:at(24, 8), nextBottle:{ available:true, target:at(24, 11) },
  purr:{ available:true, target:at(24, 11, 0), kind:'nap' }, mia:{ available:true, target:at(24, 11, 10), kind:'nap' }, huck:null };
const frankie = { timezone:'America/New_York', snapshot:{ name:'Frankie', sleeps:[{ start:at(23, 19), end:at(24, 6) }, { start:at(24, 7), end:at(24, 9, 30) }], bottles:[{ start:at(24, 6), amount:4, units:'oz' }, { start:at(24, 8), amount:3.5, units:'oz' }] } };
const forecast = { days:[{ date:'2026-11-24', high:64, low:44, rain:10, label:'Sun & clouds' }, { date:'2026-11-28', high:58, low:40, rain:70, kind:'rain', label:'Rain in the forecast' }, { date:'2026-11-29', high:60, low:42, rain:20 }] };
const ask = q => answerQuestion(q, { now, events, baby, frankie, forecast })?.answer;

test('what counts as a question', () => {
  for (const q of ['When did Frankie last eat?', 'whats on tomorrow', 'is it bath night', 'trash day?']) assert.ok(isQuestion(q), q);
  for (const q of ['dinner fri 7pm', 'frankie bottle 4oz', 'milk']) assert.equal(isQuestion(q), false, q);
  assert.equal(daysAsked('what about friday', now).label, 'on Friday');
  assert.equal(daysAsked('this weekend', now).days.length, 2);
});

test('Frankie: last bottle, how much today, awake, next nap, sleep', () => {
  assert.match(ask('When did Frankie last eat?'), /^Frankie’s last bottle \(3\.5 oz\) was at 8:00 AM, 2h ago\. The next one is due around 11:00 AM\.$/);
  assert.match(ask('How much has she eaten today?'), /^Frankie has had 7\.5 oz today over 2 bottles/);
  assert.equal(ask('How long has Frankie been awake?'), 'Frankie has been awake for 30 minutes, since 9:30 AM.');
  assert.match(ask('When is her next nap?'), /^The cats think Frankie’s next nap is around 11:05 AM \(in 1h 5m\)\. That’s the average of Hubert 11:00 AM and Mia 11:10 AM\.$/);
  assert.match(ask('How much did she sleep last night?'), /^Frankie slept .* yesterday/);
  assert.equal(answerQuestion('is the baby asleep', { now, baby:{ ...baby, timer:{ active:true, start:at(24, 9) } } }).answer, 'Frankie has been asleep for 1h, since 9:00 AM.');
});

test('the calendar: a day, the weekend, free, next, when is', () => {
  assert.equal(ask('What’s on tomorrow?'), 'Tomorrow: Coffee with Sam at 11:00 AM.');
  assert.equal(ask('What do we have Friday?'), 'On Friday: Dentist at 9:00 AM.');
  assert.equal(ask('Are we free Thursday?'), 'Yes, nothing is planned on Thursday.', 'holidays are not plans');
  assert.equal(ask('Anything this weekend?'), 'This weekend: Movie night at 7:00 PM (Saturday).');
  assert.match(ask('What’s next?'), /^Next: Farmers’ market, at 10:30 AM \(in 30m\)\.$/);
  assert.equal(ask('When is the dentist?'), 'Dentist is on Friday, Nov 27 at 9:00 AM.');
  assert.equal(ask('when is the zoo trip'), 'I couldn’t find “zoo trip” on the calendar.');
});

test('around the house: bins, baths, birthdays, weather', () => {
  assert.equal(ask('When is recycling?'), 'Trash and recycling pickup is Monday, Dec 7.');
  assert.equal(ask('trash day?'), 'Trash pickup is Monday, Nov 30.');
  assert.equal(ask('Is it bath night?'), 'No bath tonight. The next one is tomorrow.');
  setBirthdayList([{ name:'Grandma June', month:11, day:27, year:1954 }]);
  assert.equal(ask('Whose birthday is next?'), 'Next up: Grandma June turns 72 on Friday, Nov 27.');
  setBirthdayList([]);
  assert.equal(ask('Will it rain this weekend?'), 'Probably, yes. Saturday: rain in the forecast, high 58°, low 40°, 70% chance of rain. Sunday: high 60°, low 42°, 20% chance of rain.');
  assert.equal(ask('Will it rain Saturday?'), 'Probably, yes. On Saturday in Richmond: rain in the forecast, high 58°, low 40°, 70% chance of rain.');
  assert.equal(ask('What’s the weather today?'), 'Today in Richmond: sun & clouds, high 64°, low 44°, 10% chance of rain.');
});

test('questions it can’t answer return null (the box falls back to adding a plan)', () => {
  assert.equal(answerQuestion('How tall is the Eiffel Tower?', { now }), null);
  assert.equal(answerQuestion('', { now }), null);
});
