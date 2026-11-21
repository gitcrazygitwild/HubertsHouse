import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyContent } from '../daily-content.js';
import { eventTemplate } from '../event-templates.js';
import { filterTaskItems } from '../household-model.js';
import { checklistProgress, eventsOnDay } from '../calendar-model.js';

process.env.TZ = 'America/New_York';

test('daily moments change at local midnight, stay stable through daylight saving, and include every requested card', () => {
  const early = dailyContent(new Date('2026-11-01T00:01:00-04:00'));
  const late = dailyContent(new Date('2026-11-01T23:59:00-05:00'));
  assert.deepEqual(early, late);
  assert.equal(late.key, '2026-11-01');
  assert.notEqual(late.quote, dailyContent(new Date('2026-11-02T00:00:00-05:00')).quote);
  assert.deepEqual(dailyContent(new Date('2026-03-08T00:01:00-05:00')), dailyContent(new Date('2026-03-08T23:59:00-04:00')));
  const words = new Set();
  for (let day = 1; day <= 14; day++) {
    const entry = dailyContent(new Date(2026, 10, day));
    for (const value of [entry.quote, entry.fact, entry.word.definition, entry.word.example, entry.joke.setup, entry.joke.punchline, entry.mission]) assert.ok(value.length > 8);
    assert.equal(entry.attribution, 'Hubert’s House');
    words.add(entry.word.word);
  }
  assert.equal(words.size, 14);
});

test('event templates respect tomorrow, year boundaries, and the inclusive all-day editor without mutating the clock', () => {
  const now = new Date('2026-12-31T23:45:00-05:00');
  const original = now.getTime();
  const dateNight = eventTemplate('date-night', now);
  assert.equal(dateNight.start.getFullYear(), 2027);
  assert.equal(dateNight.start.getDate(), 1);
  assert.equal(dateNight.start.getHours(), 19);
  assert.equal(dateNight.end - dateNight.start, 7200000);
  const appointment = eventTemplate('appointment', now);
  assert.ok(appointment.start > now);
  assert.equal(appointment.start.getHours(), 0);
  assert.equal(appointment.end - appointment.start, 3600000);
  assert.equal(appointment.checklist.length, 2);
  const dayOff = eventTemplate('day-off', now);
  assert.equal(dayOff.start.getDate(), 31);
  assert.equal(dayOff.start.getHours(), 0);
  assert.equal(dayOff.end.getTime(), dayOff.start.getTime());
  assert.equal(now.getTime(), original);
  assert.throws(() => eventTemplate('missing'), /Unknown/);
});

test('task focus intersects timing with title and list search; completed or undated tasks are never overdue', () => {
  const items = [
    { title: 'Water plants', due: '2026-11-15' },
    { title: 'Book a table', due: '2026-11-13', list: 'Date night' },
    { title: 'Pay bill', due: '2026-11-01', completed: true },
    { title: 'Choose a film', due: '', list: 'Date night' }
  ];
  assert.deepEqual(filterTaskItems(items, { timing: 'overdue', today: '2026-11-15' }), [items[1]]);
  assert.deepEqual(filterTaskItems(items, { timing: 'today', text: ' WATER ', today: '2026-11-15' }), [items[0]]);
  assert.deepEqual(filterTaskItems(items, { timing: 'anytime', text: 'DATE NIGHT' }), [items[3]]);
  assert.deepEqual(filterTaskItems(items, { timing: 'today', text: 'table', today: '2026-11-15' }), []);
});

test('checklist progress ignores empty rows and missing lists; an untimed end spans the next day consistently', () => {
  assert.deepEqual(checklistProgress([{ text: 'Bring ID', done: true }, { text: '', done: true }, { text: 'Confirm time', done: false }, null]), { done: 1, total: 2 });
  assert.deepEqual(checklistProgress(null), { done: 0, total: 0 });
  const late = { start: '2026-11-01T23:30:00-05:00', allDay: false };
  assert.deepEqual(eventsOnDay([late], '2026-11-02'), [late]);
  assert.deepEqual(eventsOnDay([late], '2026-11-03'), []);
});

test('every word of the day says how to say it, with the stressed syllable in capitals', () => {
  const seen = new Set();
  for (let day = 0; day < 14; day++) {
    const { word } = dailyContent(new Date(2026, 0, 1 + day, 12));
    seen.add(word.word);
    assert.match(word.say, /^[a-z]+(-[a-z]+)*$/i, word.word);
    assert.match(word.say, /[A-Z]{2,}/, `${word.word} marks its stressed syllable`);
    assert.ok(word.part && word.definition && word.example, word.word);
  }
  assert.equal(seen.size, 14);
  assert.equal(dailyContent(new Date(2026, 0, 1, 12)).word.say.length > 0, true);
});
