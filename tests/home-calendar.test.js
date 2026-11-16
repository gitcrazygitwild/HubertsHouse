import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { dateKey } from '../household-model.js';
import { homeCalendarWeek, homeCalendarRange, initHomeCalendar } from '../home-calendar.js';

process.env.TZ = 'America/New_York';

test('day and month ranges use local boundaries through DST and leap years', () => {
  const day = homeCalendarRange([],'2026-11-01','day'); assert.equal(day.end-day.start,25*3600000); assert.equal(day.days.length,1);
  const month = homeCalendarRange([],'2028-02-29','month'); assert.equal(month.days.length,42); assert.equal(dateKey(month.start),'2028-01-30'); assert.equal(dateKey(month.end),'2028-03-12');
  assert.equal(month.days.filter(({date}) => date.getMonth() === 1).length,29);
});

test('the home calendar shows seven complete local dates across daylight saving, counting spans only once', () => {
  const trip = { id: 'trip', start: '2026-10-31', end: '2026-11-03', allDay: true };
  const overnight = { id: 'overnight', start: '2026-11-06T23:00:00-05:00', end: '2026-11-07T01:00:00-05:00' };
  const outside = { id: 'outside', start: '2026-11-08T00:00:00-05:00', end: '2026-11-08T01:00:00-05:00' };
  const week = homeCalendarWeek([trip, overnight, outside], '2026-11-01');
  assert.deepEqual(week.days.map(day => dateKey(day.date)), ['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07']);
  assert.equal(week.end - week.start, 169 * 3600000);
  assert.equal(week.count, 2);
  assert.deepEqual(week.days[1].events, [trip]);
  assert.deepEqual(week.days[2].events, []);
  assert.deepEqual(week.days[5].events, [overnight]);
  assert.deepEqual(week.days[6].events, [overnight]);
});

test('an unattended home calendar rolls forward, while a browsed week stays put until Today is chosen', async t => {
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  t.after(() => { globalThis.document = previousDocument; dom.window.close(); });
  let clock = new Date('2026-12-31T23:59:00-05:00');
  const ranges = [], doc = dom.window.document;
  const calendar = initHomeCalendar({ getEvents: () => [], now: () => clock, openEvent() {}, addEvent() {}, onRangeChange: range => ranges.push(range) });
  const firstDate = () => doc.querySelector('.home-week-day').dataset.homeDate;
  assert.equal(firstDate(), '2026-12-31');
  assert.match(doc.getElementById('homeCalendarRange').textContent, /2027/);
  clock = new Date('2027-01-01T00:01:00-05:00'); calendar.render();
  assert.equal(firstDate(), '2027-01-01');
  doc.getElementById('homeCalendarNext').click();
  assert.equal(firstDate(), '2027-01-08');
  const lastRequest = ranges.length;
  clock = new Date('2027-01-02T00:01:00-05:00'); calendar.render();
  assert.equal(firstDate(), '2027-01-08');
  assert.equal(ranges.length, lastRequest, 'Clock ticks must not trigger duplicate calendar requests');
  doc.getElementById('homeCalendarToday').click();
  assert.equal(firstDate(), '2027-01-02');
  assert.equal(dateKey(calendar.getRange().end), '2027-01-09');
});

test('home event cards escape titles, retain the source occurrence, and add to the selected date without changing records', async t => {
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  t.after(() => { globalThis.document = previousDocument; dom.window.close(); });
  const record = { id: 'occurrence', title: '<img src=x onerror=alert(1)>', start: '2026-11-15T23:00:00-05:00', end: '2026-11-16T01:00:00-05:00', extendedProps: { sourceId: 'series', owner: 'both', isRepeatOccurrence: true, checklist: [{ text: 'Bring keys', done: false }] } };
  const before = JSON.stringify(record), opened = [], added = [], doc = dom.window.document;
  const calendar = initHomeCalendar({ getEvents: () => [record], now: () => new Date('2026-11-15T12:00:00-05:00'), openEvent: (...args) => opened.push(args), addEvent: day => added.push(day) });
  assert.equal(doc.querySelector('#homeWeek img'), null);
  const card = doc.querySelector('[data-home-date="2026-11-16"] [data-home-event]');
  assert.match(card.textContent, /Until 1:00 AM/);
  card.focus(); calendar.render();
  assert.equal(doc.activeElement, card);
  card.click();
  assert.deepEqual(opened, [['series', '2026-11-16T04:00:00.000Z']]);
  doc.querySelector('[data-home-add="2026-11-21"]').click();
  assert.equal(dateKey(added[0]), '2026-11-21');
  assert.equal(JSON.stringify(record), before);
});
