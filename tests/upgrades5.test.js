import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { bottleForecast } from '../baby-model.js';
import { guessAisle } from '../household-model.js';
import { dayStory, dayStoryText } from '../baby-history.js';
import { frankieDayText } from '../frankie.js';
import { initVoice, dictationMode } from '../upgrades.js';

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

test('voice input: the installed iPhone app uses keyboard dictation; a browser tab explains failures and never locks the mic out', async () => {
  const dom = new JSDOM('<form><input id="q" placeholder="Add a plan"><button type="submit">Add</button></form>'), w = dom.window;
  globalThis.document = w.document;
  const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem:k => m.get(k) ?? null, setItem:(k, v) => m.set(k, String(v)), removeItem:k => m.delete(k), m }; };
  const iphone = (standalone) => ({ navigator:{ userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)', standalone }, matchMedia:() => ({ matches:standalone }) });
  const mac = { navigator:{ userAgent:'Mozilla/5.0 (Macintosh) Chrome/131', platform:'MacIntel', maxTouchPoints:0 } };
  const fresh = () => { w.document.body.innerHTML = '<form><input id="q" placeholder="Add a plan"><button type="submit">Add</button></form>'; return [w.document.querySelector('form'), w.document.getElementById('q')]; };
  assert.equal(dictationMode({ win:iphone(true) }), 'keyboard', 'installed iPhone app');
  assert.equal(dictationMode({ win:iphone(false) }), 'speech', 'Safari tab');
  assert.equal(dictationMode({ win:mac }), 'speech');
  // Installed iPhone app: no recognition attempt; the tap focuses the box and explains.
  let started = 0; const notes = [];
  class Never { start() { started++; } stop() {} }
  let [form, input] = fresh();
  const mic = initVoice(form, input, () => {}, Never, { notice:m => notes.push(m), win:iphone(true), storage:memory() });
  assert.equal(mic.getAttribute('aria-label'), 'Dictate with the keyboard');
  mic.click(); assert.equal(started, 0); assert.equal(w.document.activeElement, input);
  assert.match(input.placeholder, /tap 🎤 on the keyboard/, 'the tip shows in the box, above the keyboard'); assert.equal(notes.length, 0, 'no notice hidden behind the keyboard');
  input.dispatchEvent(new w.Event('blur')); assert.equal(input.placeholder, 'Add a plan');
  // Safari tab, blocked: says why (Siri, site microphone setting) and keeps trying next time.
  let tries = 0;
  class Blocked { start() { tries++; this.onerror({ error:'service-not-allowed' }); this.onend(); } stop() {} }
  [form, input] = fresh(); const store = memory({ hh_dictation:'keyboard' }); // locked by the old version
  const mic2 = initVoice(form, input, () => {}, Blocked, { notice:m => notes.push(m), win:iphone(false), storage:store });
  assert.equal(store.m.has('hh_dictation'), false, 'the old lock is cleared');
  mic2.click(); assert.match(notes.at(-1), /Siri turned on.*Website Settings → Microphone → Allow.*keyboard/);
  mic2.click(); assert.equal(tries, 2, 'the next tap tries again'); assert.equal(mic2.getAttribute('aria-label'), 'Say a plan or a Frankie log');
  // A desktop browser gets desktop advice.
  [form, input] = fresh();
  initVoice(form, input, () => {}, Blocked, { notice:m => notes.push(m), win:mac, storage:memory() }).click();
  assert.match(notes.at(-1), /site-settings icon/); assert.doesNotMatch(notes.at(-1), /Siri/);
  // Ending instantly with no reason: "stopped before it could listen"; just not hearing anything: "Didn't catch that".
  let clock = 0; class Silent { start() { clock += 200; this.onend(); } stop() {} }
  [form, input] = fresh();
  initVoice(form, input, () => {}, Silent, { notice:m => notes.push(m), win:iphone(false), storage:memory(), now:() => clock }).click();
  assert.match(notes.at(-1), /stopped before it could listen/);
  class Quiet { start() { this.onerror({ error:'no-speech' }); this.onend(); } stop() {} }
  [form, input] = fresh();
  initVoice(form, input, () => {}, Quiet, { notice:m => notes.push(m), win:iphone(false), storage:memory() }).click();
  assert.match(notes.at(-1), /Didn’t catch that/);
  // Hearing words fills the box.
  class Hears { start() { this.onresult({ results:[[{ transcript:'frankie bottle 4 oz' }]] }); this.onend(); } stop() {} }
  [form, input] = fresh(); let previews = 0;
  initVoice(form, input, () => previews++, Hears, { notice:m => notes.push(m), win:iphone(false), storage:memory() }).click();
  assert.equal(input.value, 'frankie bottle 4 oz'); assert.equal(previews, 1);
  delete globalThis.document; dom.window.close();
});

test('phones get the compact layout, and night mode is wired in', async () => {
  const [html, css, build] = await Promise.all(['index.html', 'mobile.css', 'scripts/build.mjs'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
  assert.match(html, /href="\.\/mobile\.css\?v=/); assert.match(build, /'mobile\.css'/);
  assert.match(css, /\.baby-predictions, \.score-grid, \.world-markets/); assert.match(css, /data-view\]:not\(\[data-view="today"\]\) \.app-links/);
  assert.match(html, /id="babyNight"[^>]*>🌙 Night mode/); assert.match(html, /id="frankieShare"/);
});
