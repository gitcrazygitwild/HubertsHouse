import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOnDay } from '../calendar-view.js';

process.env.TZ = 'America/New_York';

test('the day agenda respects exclusive all-day endings across the 25-hour fall-back day', () => {
  const trip = { id: 'trip', start: '2026-10-31T00:00:00-04:00', end: '2026-11-02T00:00:00-05:00', allDay: true };
  assert.deepEqual(eventsOnDay([trip], '2026-11-01'), [trip]);
  assert.deepEqual(eventsOnDay([trip], '2026-11-02'), []);
  const noEnd = { id: 'one-day', start: '2026-11-01', allDay: true };
  assert.deepEqual(eventsOnDay([noEnd], '2026-11-01'), [noEnd]);
  assert.deepEqual(eventsOnDay([noEnd], '2026-11-02'), []);
});

test('overnight plans appear on both days, with all-day plans above timed plans', () => {
  const overnight = { id: 'overnight', start: '2026-11-01T23:30:00-05:00', end: '2026-11-02T01:00:00-05:00' };
  const morning = { id: 'morning', start: '2026-11-02T08:00:00-05:00', end: '2026-11-02T09:00:00-05:00' };
  const allDay = { id: 'day', start: '2026-11-02', allDay: true };
  assert.deepEqual(eventsOnDay([morning, overnight, allDay], '2026-11-02'), [allDay, overnight, morning]);
  assert.deepEqual(eventsOnDay([overnight], '2026-11-03'), []);
});
