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

test('the newsletter tells Frankie’s yesterday in words and adds headlines and markets', async () => {
  const { dayStory } = await import('../baby-history.js');
  const y = (h, m = 0) => new Date(2026, 10, 15, h, m).toISOString(); // Sunday, yesterday
  const sleeps = [];
  // Three nights at 9:30 PM teach the evening line; the night before yesterday ends 6:45 AM.
  for (let d = 10; d <= 13; d++) sleeps.push({ start:new Date(2026, 10, d, 21, 30).toISOString(), end:new Date(2026, 10, d + 1, 6, 30).toISOString() });
  sleeps.push({ start:new Date(2026, 10, 14, 21, 40).toISOString(), end:y(6, 45) });
  sleeps.push({ start:y(9), end:y(10, 10) }, { start:y(12, 30), end:y(13, 50) }, { start:y(19, 15), end:y(19, 45) }); // last one: a late catnap
  sleeps.push({ start:y(21, 40), end:new Date(2026, 10, 16, 1, 0).toISOString() }, { start:new Date(2026, 10, 16, 1, 20).toISOString(), end:new Date(2026, 10, 16, 6, 10).toISOString() });
  const bottles = [7, 10, 13, 16, 19, 21].map((h, i) => ({ start:y(h), amount:i === 2 ? 5 : 4, units:'oz', type:'Formula' }));
  const diapers = [{ kind:'diaper', start:y(7), mode:'pee' }, { kind:'diaper', start:y(11), mode:'both' }, { kind:'diaper', start:y(15), mode:'poo' }, { kind:'diaper', start:new Date(2026, 10, 16, 2).toISOString(), mode:'pee' }];
  const story = dayStory({ sleeps, bottles }, diapers, 'America/New_York', '2026-11-15', +now);
  assert.equal(story.wake, y(6, 45)); assert.equal(story.bedtime, y(21, 40));
  assert.deepEqual(story.naps, { count:3, minutes:180, longest:{ minutes:80, start:y(12, 30) } });
  assert.deepEqual(story.overnight, { minutes:200 + 290, woke:new Date(2026, 10, 16, 6, 10).toISOString() });
  assert.deepEqual(story.bottles, { count:6, ounces:25, largest:5 });
  assert.deepEqual(story.diapers, { count:3, wet:2, dirty:2 });

  const briefing = { fetchedAt:now.toISOString(), headlines:[{ title:'Storm closes schools & roads', link:'https://www.npr.org/a', source:'NPR' }], goodNews:{ title:'Climbers rescue a seal pup', link:'https://www.goodnewsnetwork.org/seal', source:'Good News Network' },
    markets:[{ id:'SP500', name:'S&P 500', kind:'index', value:7416.59, change:-145.08, changePct:-1.92, date:'2026-11-13' }, { id:'DGS10', name:'10-yr Treasury', kind:'rate', value:5.15, change:0.05, changePct:null, date:'2026-11-13' }] };
  const snapshot = { name:'Frankie', timezone:'America/New_York', sleeps, bottles, timer:{ active:false } };
  const email = composeEmail(buildDigest({ now, household, icloud, items, forecast, snapshot, recent:diapers, briefing }));
  assert.match(email.html, /Yesterday Frankie was up for the day at 6:45 AM, took 3 naps \(3h 0m in all; the longest, 1h 20m, started at 12:30 PM\) and went down for the night at 9:40 PM\./);
  assert.match(email.html, /She had 6 bottles, 25 oz in all and 3 diaper changes \(2 wet, 2 dirty\)\./);
  assert.match(email.html, /Overnight she slept 8h 10m and woke at 6:10 AM\./);
  assert.match(email.html, /☀ Good news/); assert.match(email.html, /Climbers rescue a seal pup/); assert.match(email.text, /Good news: Climbers rescue a seal pup https:\/\/www\.goodnewsnetwork\.org\/seal/);
  assert.match(email.html, /The world, briefly/); assert.match(email.html, /Storm closes schools &amp; roads/); assert.match(email.html, /7,416\.59/); assert.match(email.html, /▼ 1\.92%/); assert.match(email.html, /▲ 0\.05 pt/);
  assert.match(email.text, /Yesterday Frankie was up/); assert.match(email.text, /• Storm closes schools & roads \(NPR\) https:\/\/www\.npr\.org\/a/); assert.match(email.text, /Markets: S&P 500 7,416\.59 ▼ 1\.92%/);
  // No briefing, no diapers: those parts are simply left out.
  const plain = composeEmail(buildDigest({ now, snapshot }));
  assert.doesNotMatch(plain.html, /The world, briefly/); assert.match(plain.html, /She had 6 bottles, 25 oz in all\./);
});

test('the newsletter shows the week’s forecast, each day linked to Miateorology', () => {
  const week = { days:['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map((date, i) => ({ date, high:60 + i, low:40 + i, rain:i === 3 ? 70 : 0, kind:i === 3 ? 'rain' : 'sun', label:i === 3 ? 'Rain in the forecast' : 'Mostly clear' })) };
  const email = composeEmail(buildDigest({ now, forecast:week }));
  assert.equal((email.html.match(/href="https:\/\/gitcrazygitwild\.github\.io\/Miateorology\/"/g) || []).length, 7);
  assert.match(email.html, />Today<\/div>/); assert.match(email.html, />Thu<\/div>/); assert.match(email.html, /🌧️/); assert.match(email.html, />70%<\/div>/);
  assert.match(email.text, /This week: Tue 61°\/41° · Wed 62°\/42° · Thu 63°\/43° 70% · Fri 64°\/44° · Sat 65°\/45° · Sun 66°\/46°/);
});
