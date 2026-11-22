import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesAt, startFrom, endFrom } from '../time-dial.js';

const C = 116, R = 92, at = h => [C + R * Math.sin(h / 12 * 2 * Math.PI), C - R * Math.cos(h / 12 * 2 * Math.PI)];
test('the clock face turns a drag position into minutes past 12, in fives', () => {
  assert.equal(minutesAt(...at(0)), 0); assert.equal(minutesAt(...at(3)), 180); assert.equal(minutesAt(...at(6)), 360); assert.equal(minutesAt(...at(9.5)), 570);
  assert.equal(minutesAt(...at(11.99)), 0, 'just before 12 snaps to 12');
  assert.equal(minutesAt(...at(2.04)) % 5, 0);
});
test('dragging the start keeps AM/PM, and dragging past 12 switches it', () => {
  const evening = new Date(2026, 10, 22, 18, 0);
  assert.equal(startFrom(evening, 7 * 60 + 30).getHours(), 19, '6 PM → 7:30 PM');
  const late = new Date(2026, 10, 22, 11, 55);
  assert.equal(startFrom(late, 5, 11 * 60 + 55).getHours(), 12, '11:55 AM past 12 → 12:05 PM');
  assert.equal(startFrom(new Date(2026, 10, 22, 12, 5), 11 * 60 + 50, 5).getHours(), 11, 'and back again');
  assert.equal(startFrom(evening, 6 * 60).getDate(), 22, 'the day never changes');
});
test('the end is the first time at that spot after the start (up to 12 hours)', () => {
  const start = new Date(2026, 10, 22, 18, 0);
  assert.equal((endFrom(start, 8 * 60 + 30) - start) / 60000, 150);
  assert.equal((endFrom(start, 5 * 60) - start) / 60000, 660, '5 o’clock after a 6 PM start is 5 AM');
  assert.equal((endFrom(start, 6 * 60) - start) / 60000, 720, 'the same spot is 12 hours later, never zero');
});
