import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { bottleForecast } from '../baby-model.js';
import { guessAisle } from '../household-model.js';
import { dayStory, dayStoryText } from '../baby-history.js';
import { frankieDayText } from '../frankie.js';
import { initVoice } from '../upgrades.js';

const zone = 'UTC', H = 3600000, M = 60000, now = Date.parse('2026-11-17T15:00:00Z');
const at = ms => new Date(ms).toISOString();

test('the next bottle follows Frankie’s own gaps at this time of day', () => {
  // Days: bottles every 3h; nights: every 4.5h. The last bottle was at 1 PM.
  const bottles = [];
  for (let d = 3; d >= 1; d--) {
    const day = now - d * 24 * H - 15 * H; // midnight, d days ago
    for (const h of [1.5, 6, 9, 12, 15, 18, 21]) bottles.push({ start:at(day + h * H), amount:4, units:'oz', type:'Formula' });
  }
  for (const h of [1.5, 6, 9, 12]) bottles.push({ start:at(now - 15 * H + h * H), amount:4, units:'oz', type:'Formula' });
  bottles.push({ start:at(now - 2 * H), amount:5, units:'oz', type:'Formula' }); // 1 PM today
  const next = bottleForecast(bottles, { timezone:zone, now:new Date(now) });
  assert.equal(next.available, true, next.reason); assert.equal(next.matchedTime, true);
  assert.equal(next.typicalMinutes, 180); assert.equal(next.target, at(now + H)); // 4 PM
  assert.equal(next.phase, 'upcoming'); assert.equal(next.last.amount, 5);
  assert.equal(bottleForecast(bottles.slice(0, 2), { timezone:zone, now:new Date(now) }).available, false);
  assert.match(bottleForecast(bottles, { timezone:zone, now:new Date(now + 11 * H) }).reason, /latest bottle/);
});

test('groceries land in a sensible aisle', () => {
  for (const [item, aisle] of [['Oat milk', 'Dairy & eggs'], ['peanut butter', 'Pantry'], ['Ice cream', 'Frozen'], ['bananas', 'Produce'], ['Paper towels', 'Household'],
    ['chicken thighs', 'Meat & fish'], ['sourdough bread', 'Bakery'], ['Cat litter', 'Household'], ['coffee beans', 'Pantry'], ['birthday candles', 'Other'], ['', 'Other']])
    assert.equal(guessAisle(item), aisle, item);
});

test('Frankie’s day reads the same in the app and the newsletter, with today so far', () => {
  const day = now - 15 * H; // midnight UTC today
  const sleeps = [{ start:at(day - 24 * H - 3 * H), end:at(day - 24 * H + 6.5 * H) }, { start:at(day - 24 * H + 9 * H), end:at(day - 24 * H + 10 * H) }, { start:at(day - 3 * H), end:at(day + 6 * H) }, { start:at(day + 9 * H), end:at(day + 10.5 * H) }];
  const bottles = [{ start:at(day - 24 * H + 8 * H), amount:4, units:'oz', type:'Formula' }, { start:at(day + 7 * H), amount:5, units:'oz', type:'Formula' }];
  const story = dayStory({ sleeps, bottles }, null, zone, '2026-11-17', now);
  assert.equal(dayStoryText(story, { name:'Frankie', timezone:zone, label:'So far today' }), 'So far today Frankie was up for the day at 6:00 AM and took 1 nap (1h 30m in all). She had 1 bottle, 5 oz in all.');
  const text = frankieDayText({ name:'Frankie', sleeps, bottles, timer:{ active:false } }, zone, now);
  assert.match(text, /^Frankie’s day 🐾\n\nYesterday Frankie was up for the day at 6:30 AM/);
  assert.match(text, /So far today Frankie was up for the day at 6:00 AM/); assert.match(text, /— from Hubert’s House$/);
});

test('the mic fills the quick-add box and never saves on its own', async () => {
  const dom = new JSDOM('<form><input id="q" placeholder="Add a plan"><button type="submit">Add</button></form>'), w = dom.window;
  globalThis.document = w.document; const form = w.document.querySelector('form'), input = w.document.getElementById('q');
  let started = 0, previews = 0, submitted = 0; form.addEventListener('submit', () => submitted++);
  class FakeRecognition { start() { started++; this.onresult({ results:[[{ transcript:'frankie bottle' }], [{ transcript:'4 oz at 3' }]] }); this.onend(); } stop() {} }
  assert.equal(initVoice(form, input, () => previews++, undefined), null, 'no mic without speech support');
  const mic = initVoice(form, input, () => previews++, FakeRecognition);
  assert.equal(mic.nextElementSibling.type, 'submit'); assert.equal(mic.getAttribute('aria-label'), 'Say a plan or a Frankie log');
  mic.click();
  assert.equal(started, 1); assert.equal(input.value, 'frankie bottle 4 oz at 3'); assert.ok(previews >= 1); assert.equal(submitted, 0);
  assert.equal(input.placeholder, 'Add a plan');
  delete globalThis.document; dom.window.close();
});

test('phones get the compact layout, and night mode is wired in', async () => {
  const [html, css, build] = await Promise.all(['index.html', 'mobile.css', 'scripts/build.mjs'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
  assert.match(html, /href="\.\/mobile\.css\?v=/); assert.match(build, /'mobile\.css'/);
  assert.match(css, /\.baby-predictions, \.score-grid, \.world-markets/); assert.match(css, /data-view\]:not\(\[data-view="today"\]\) \.app-links/);
  assert.match(html, /id="babyNight"[^>]*>🌙 Night mode/); assert.match(html, /id="frankieShare"/);
});
