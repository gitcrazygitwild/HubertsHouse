import test from 'node:test';
import assert from 'node:assert/strict';
import { dadJokes, afterDarkJokes, dailyJokes } from '../jokes.js';
import { dailyContent } from '../daily-content.js';

test('every joke has a setup and a punchline, with no repeats', () => {
  for (const list of [dadJokes, afterDarkJokes]) {
    for (const [setup, punchline] of list) { assert.ok(setup.length > 8, setup); assert.ok(punchline.length > 6, punchline); }
    assert.equal(new Set(list.map(([setup]) => setup)).size, list.length);
  }
  assert.ok(dadJokes.length >= 60); assert.ok(afterDarkJokes.length >= 30);
});

test('the daily pair changes each day and the two cycles do not move in lockstep', () => {
  const days = Array.from({ length:120 }, (_, i) => dailyJokes(new Date(2026, 0, 1 + i)));
  assert.notEqual(days[0].joke.setup, days[1].joke.setup);
  assert.notEqual(days[0].afterDark.setup, days[1].afterDark.setup);
  const pairs = new Set(days.map(day => `${day.joke.setup}|${day.afterDark.setup}`));
  assert.equal(pairs.size, 120);
  assert.deepEqual(dailyContent(new Date(2026, 0, 5)).afterDark, dailyJokes(new Date(2026, 0, 5)).afterDark);
});
