import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
process.env.TZ = 'America/New_York';
const { buildDigest, composeEmail, eventsInRange, parseWhen, validatePrefs, validateSender } = await import('../functions/newsletter.js');
const { sampleHistory, samplePredictions } = await import('../baby-sample.js');

const now = new Date(2026, 10, 16, 6, 30); // Monday 6:30am in Richmond
const at = (d, h, m = 0) => new Date(2026, 10, 16 + d, h, m).toISOString();
const household = [
  { title:'Coffee with a friend', start:at(0, 10), end:at(0, 11), owner:'karena' },
  { title:'Walk in the park', start:at(0, 16), end:at(0, 17), owner:'both', withFrankie:true },
  { title:'Trash night', start:at(-14, 20), end:at(-14, 20, 15), owner:'hanry', repeat:'weekly' },
  { title:'Old thing', start:at(-30, 9), end:at(-30, 10), owner:'both' }
];
const icloud = [{ title:'Henry in DC', start:'2026-11-17', end:'2026-11-18', allDay:true, owner:'hanry' }, { title:'Dentist', start:at(1, 9), end:at(1, 10), owner:'hanry' }];
const items = [{ kind:'chore', title:'Water the plants', due:'2026-11-16', completed:false, owner:'karena' }, { kind:'chore', title:'Recycling', due:'2026-11-14', completed:false },
  { kind:'chore', title:'Done thing', due:'2026-11-16', completed:true }, { kind:'grocery', title:'Oat milk', completed:false }, { kind:'grocery', title:'Bread', completed:true }];
const forecast = { days:[{ date:'2026-11-16', high:64, low:44, rain:70, kind:'rain', label:'Showers' }, { date:'2026-11-17', high:58, low:40, rain:10, kind:'sun', label:'Clear' }] };

test('all-day dates are local, repeats expand, and old one-offs drop out', () => {
  assert.equal(parseWhen('2026-11-17').getDate(), 17); assert.equal(parseWhen('2026-11-17').getHours(), 0);
  const from = new Date(2026, 10, 16), to = new Date(2026, 10, 23);
  const events = eventsInRange(household, icloud, from, to);
  assert.deepEqual(events.filter(e => e.title === 'Trash night').map(e => e.start.getDate()), [16]);
  assert.ok(!events.some(e => e.title === 'Old thing'));
  assert.equal(events.find(e => e.title === 'Henry in DC').start.getDate(), 17);
});

test('the digest gathers today, tomorrow, chores, groceries, rain and free nights', () => {
  const d = buildDigest({ name:'hanry', now, household, icloud, items, forecast });
  assert.deepEqual(d.today.map(e => e.title), ['Coffee with a friend', 'Walk in the park', 'Trash night']);
  assert.deepEqual(d.tomorrow.map(e => e.title), ['Henry in DC', 'Dentist']);
  assert.deepEqual(d.chores.map(c => [c.title, c.overdue]), [['Water the plants', false], ['Recycling', true]]);
  assert.equal(d.groceries, 1); assert.equal(d.rain[0].title, 'Walk in the park'); assert.ok(d.freeNights.length > 0);
  assert.equal(d.baby, null); assert.equal(d.afterDark, false);
});

test('the email renders every section, escapes text and respects the after-dark choice', async () => {
  const { sleeps, bottles } = sampleHistory(+now);
  const snapshot = { name:'Frankie', timezone:'America/New_York', sleeps, bottles, timer:{ active:false }, sweetspot:{}, checkedAt:now.toISOString() };
  const evil = [...household, { title:'<script>alert(1)</script>', start:at(0, 12), end:at(0, 13) }];
  const d = buildDigest({ name:'hanry', now, household:evil, icloud, items, forecast, snapshot, predictions:samplePredictions(sleeps, 'America/New_York', +now), prefs:{ afterDark:true } });
  const { subject, html, text } = composeEmail(d);
  assert.match(subject, /Monday at Hubert’s House · 64° · 4 plans · Frankie’s day/);
  for (const part of ['Good morning, hanry', 'Today in Richmond', 'Little moments, big love', 'Slept yesterday', 'Around the house', 'Free nights for a date', 'Dad joke', 'After dark', 'Newsletter settings', 'Last week’s awards'])
    assert.ok(html.includes(part), part);
  assert.ok(!html.includes('<script>alert')); assert.ok(html.includes('&lt;script&gt;'));
  assert.match(text, /Dad joke:/);
  const plain = composeEmail(buildDigest({ now, household, icloud, items, forecast }));
  assert.ok(!plain.html.includes('After dark')); assert.ok(plain.html.includes('Good morning.'));
  await writeFile(new URL('../dist-newsletter-sample.html', import.meta.url), html).catch(() => {});
});

test('preferences and sender details are validated', () => {
  assert.deepEqual(validatePrefs({}), { enabled:true, afterDark:false, name:'' });
  assert.deepEqual(validatePrefs({ enabled:false, afterDark:true, name:' Karena ' }), { enabled:false, afterDark:true, name:'Karena' });
  assert.throws(() => validatePrefs({ name:'x'.repeat(41) }));
  assert.deepEqual(validateSender({ email:'house@example.com', password:'abcd efgh ijkl mnop' }), { email:'house@example.com', password:'abcdefghijklmnop' });
  assert.throws(() => validateSender({ email:'nope', password:'abcdefghijklmnop' })); assert.throws(() => validateSender({ email:'a@b.co', password:'short' }));
});
