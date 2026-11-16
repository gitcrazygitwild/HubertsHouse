import test from 'node:test';
import assert from 'node:assert/strict';
import { frankieAwards } from '../awards.js';
import { freeEvenings, dateNightDraft } from '../free-nights.js';
import { skyState, skyArt } from '../sky.js';
import { dayStart } from '../baby-history.js';
process.env.TZ = 'America/New_York';
const NY = 'America/New_York', H = 3600000, iso = ms => new Date(ms).toISOString();

test("Frankie's weekly awards pick the right superlatives from the last seven full days", () => {
  const today = dayStart('2026-11-16', NY), sleeps = [], bottles = [];
  for (let d = 1; d <= 7; d++) {
    const mid = today - d * 24 * H;
    sleeps.push({ start:iso(mid - 4.5 * H), end:iso(mid + (d === 3 ? 5.75 : 6.75) * H) });            // night; Fri wakes earliest
    sleeps.push({ start:iso(mid + 9 * H), end:iso(mid + (d === 2 ? 11.25 : 10) * H) });              // nap 1; Sat is longest
    if (d === 5) sleeps.push({ start:iso(mid + 13 * H), end:iso(mid + 14 * H) }, { start:iso(mid + 16 * H), end:iso(mid + 16.5 * H) });
    bottles.push({ start:iso(mid + 8 * H), amount:d === 4 ? 30 : 24, units:'oz' }, { start:iso(mid + 12 * H), amount:d === 6 ? 7 : 4, units:'oz' });
  }
  sleeps.push({ start:iso(today + 9 * H), end:iso(today + 12 * H) }); // today: not part of the week
  const { awards } = frankieAwards({ sleeps, bottles }, NY, today + 15 * H);
  const by = Object.fromEntries(awards.map(a => [a.title, a]));
  assert.equal(by['Nap of the Week'].value, '2h 15m'); assert.match(by['Nap of the Week'].detail, /^Saturday/);
  assert.equal(by['Early Bird'].value, '5:45 AM'); assert.match(by['Early Bird'].detail, /^Friday/);
  assert.equal(by['Thirstiest Day'].value, '34 oz'); assert.match(by['Thirstiest Day'].detail, /^Thursday/);
  assert.equal(by['Big Gulp'].value, '30 oz');
  assert.equal(by['Nap Queen'].value, '3 naps'); assert.match(by['Nap Queen'].detail, /^Wednesday/);
  assert.equal(by['Longest Stretch'].value, '11h 15m');
  assert.deepEqual(frankieAwards({}, NY).awards, []);
});

test('free evenings skip busy nights, ignore Frankie-only plans and favor weekends', () => {
  const now = new Date(2026, 10, 16, 9); // Monday
  const at = (d, h) => new Date(2026, 10, 16 + d, h).toISOString();
  const events = [
    { title:'Busy Friday', start:at(4, 18), end:at(4, 20), owner:'both' },
    { title:'Trip', start:at(5, 0), end:at(7, 0), allDay:true, extendedProps:{ owner:'both' } },
    { title:'Frankie swim', start:at(11, 18), end:at(11, 19), owner:'frankie' }
  ];
  const nights = freeEvenings(events, now, 14, 3).map(n => n.date.getDate());
  assert.deepEqual(nights, [19, 27, 28]); // next free weekend (Fri 27, Sat 28; the Frankie-only plan doesn't block) plus the soonest Thursday
  const draft = dateNightDraft(new Date(2026, 10, 27));
  assert.equal(draft.start.getHours(), 19); assert.equal(draft.end - draft.start, 2 * H); assert.equal(draft.mode, 'create');
});

test('the sky follows the clock and the weather', () => {
  assert.deepEqual([skyState(new Date(2026, 10, 16, 6)).phase, skyState(new Date(2026, 10, 16, 13)).phase, skyState(new Date(2026, 10, 16, 17)).phase, skyState(new Date(2026, 10, 16, 23)).phase], ['dawn', 'afternoon', 'golden', 'night']);
  const night = skyState(new Date(2026, 10, 16, 23), 'sun'); assert.equal(night.stars, true); assert.equal(night.greeting, 'Good night');
  const rainy = skyState(new Date(2026, 10, 16, 10), 'rain'); assert.equal(rainy.weather, 'rain'); assert.equal(rainy.sun, false);
  assert.match(skyArt(rainy), /sky-drop/); assert.match(skyArt(night), /sky-star/); assert.match(skyArt(night), /sky-moon/);
  assert.match(skyArt(skyState(new Date(2026, 10, 16, 12), 'sun')), /sky-sun/);
});
