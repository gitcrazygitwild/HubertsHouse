import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { weekStory, weekStoryText } = await import('../week-story.js');
const { slideHTML } = await import('../story-view.js');
const { sampleHistory } = await import('../baby-sample.js');

const now = Date.parse('2026-11-24T10:00:00-05:00'), tz = 'America/New_York';

test('the week story: intro, sleep, nights, bottles, awards, then a wrap', () => {
  const story = weekStory({ name:'Frankie', birthdate:'2026-09-01', ...sampleHistory(now) }, tz, now);
  assert.equal(story.available, true);
  assert.deepEqual([story.slides[0].kind, story.slides[1].kind, story.slides[2].kind, story.slides[3].kind, story.slides.at(-1).kind], ['intro', 'sleep', 'nights', 'bottles', 'outro']);
  assert.match(story.slides[0].big, /^Nov 17 – Nov 23$/);
  assert.match(story.slides[0].sub, /^Frankie is 2 months old\.$/);
  assert.equal(story.slides[1].bars.length, 7); assert.equal(story.slides[1].bars.filter(b => b.highlight).length, 1);
  assert.ok(story.slides.some(s => s.kind === 'award'));
  assert.ok(!story.slides.some(s => s.eyebrow === 'MILK MILEAGE'), 'the bottles card already covers the total');
  const text = weekStoryText(story);
  assert.match(text, /^Frankie’s week 🐾 \(Nov 17 – Nov 23\)\n😴 Slept \d+ hours/); assert.match(text, /— from Hubert’s House$/);
});

test('too few days of logs: no story yet', () => {
  const story = weekStory({ name:'Frankie', sleeps:[], bottles:[] }, tz, now);
  assert.equal(story.available, false); assert.match(story.reason, /after a few days of logs/);
});

test('cards escape what they show', () => {
  const html = slideHTML({ kind:'award', tone:'gold', eyebrow:'<B>', icon:'🏆', big:'<i>2h</i>', line:'x & y' });
  assert.match(html, /&lt;B&gt;/); assert.match(html, /&lt;i&gt;2h&lt;\/i&gt;/); assert.match(html, /x &amp; y/);
});
