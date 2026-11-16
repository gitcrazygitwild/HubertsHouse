import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, describeDraft } from '../quick-add.js';

const now = new Date(2026, 10, 16, 9, 30); // Monday, Nov 16 2026, 9:30am local
const at = draft => [draft.start.getMonth() + 1, draft.start.getDate(), draft.start.getHours(), draft.start.getMinutes()];

test('weekday, time and Frankie', () => {
  const d = parseQuickAdd('Pediatrician Tue 3pm with Frankie', now);
  assert.deepEqual(at(d), [11, 17, 15, 0]); assert.equal(d.withFrankie, true); assert.equal(d.title, 'Pediatrician'); assert.equal(d.type, 'appointment');
  assert.equal(d.end - d.start, 3600000); assert.equal(d.owner, 'both');
});

test('ranges, durations and people', () => {
  const dinner = parseQuickAdd('dinner with friends fri 7-9pm', now);
  assert.deepEqual(at(dinner), [11, 20, 19, 0]); assert.equal(dinner.end.getHours(), 21); assert.equal(dinner.title, 'Dinner with friends');
  const yoga = parseQuickAdd('Yoga for Karena tomorrow 8am for 90 min', now);
  assert.equal(yoga.owner, 'karena'); assert.deepEqual(at(yoga), [11, 17, 8, 0]); assert.equal((yoga.end - yoga.start) / 60000, 90); assert.equal(yoga.title, 'Yoga');
  const golf = parseQuickAdd('golf hanry sat at 10am for 4 hours', now);
  assert.equal(golf.owner, 'hanry'); assert.deepEqual(at(golf), [11, 21, 10, 0]);
});

test('dates in several formats, all-day plans and next week', () => {
  assert.deepEqual(at(parseQuickAdd('Thanksgiving at mom’s 11/26', now)).slice(0, 2), [11, 26]);
  const trip = parseQuickAdd('Beach trip Dec 5', now);
  assert.equal(trip.allDay, true); assert.equal(trip.type, 'trip'); assert.deepEqual(at(trip).slice(0, 2), [12, 5]);
  assert.deepEqual(at(parseQuickAdd('Date night next friday 7pm', now)), [11, 27, 19, 0]);
  assert.deepEqual(at(parseQuickAdd('Movie tonight', now)), [11, 16, 19, 0]);
  assert.deepEqual(at(parseQuickAdd('Call the vet at 2', now)), [11, 16, 14, 0]);
  assert.deepEqual(at(parseQuickAdd('Coffee 8am', now)), [11, 17, 8, 0]); // 8am already passed today
  assert.equal(parseQuickAdd('just some words', now), null);
});

test('the preview reads naturally', () => {
  assert.match(describeDraft(parseQuickAdd('Swim class sat 9:30am with Frankie and Karena', now), 'en-US'), /Swim class · Sat, Nov 21 · 9:30 AM – 10:30 AM · Karena \+ Frankie/);
});
