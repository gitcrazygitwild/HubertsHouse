import test from 'node:test';
import assert from 'node:assert/strict';
import { dayRing, dayRingHTML } from '../day-ring.js';

const tz = 'America/New_York', now = Date.parse('2026-11-24T12:00:00-05:00');
const iso = (h, m = 0, day = 24) => new Date(`2026-11-${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`).toISOString();

test('the ring keeps only the last 24 hours, clipped at both ends', () => {
  const sleeps = [
    { start:iso(19, 0, 22), end:iso(6, 0, 23) },  // too old
    { start:iso(10, 0, 23), end:iso(13, 0, 23) }, // straddles 24 hours ago (noon yesterday)
    { start:iso(19, 30, 23), end:iso(5, 30) },    // last night
    { start:iso(8, 0), end:iso(9, 15) }           // a nap this morning
  ];
  const ring = dayRing({ sleeps, bottles:[{ start:iso(7), amount:4, units:'oz' }, { start:iso(10, 0, 23), amount:3, units:'oz' }], timezone:tz, now });
  assert.equal(ring.pieces.length, 3);
  assert.equal(ring.pieces[0].minutes, 60, 'clipped to start 24 hours ago');
  assert.equal(ring.slept, 60 + 600 + 75);
  assert.equal(ring.longest, 600);
  assert.equal(ring.pieces.at(-1).kind, 'nap'); assert.equal(ring.pieces[1].kind, 'night');
  assert.deepEqual([ring.bottles, ring.ounces], [1, 4], 'the bottle from 26 hours ago is left out');
});

test('a sleep in progress runs up to now, and the next call shows only when awake and soon', () => {
  const asleep = dayRing({ sleeps:[], timer:{ active:true, start:iso(11, 0) }, timezone:tz, now, next:{ at:iso(13), label:'next nap' } });
  assert.equal(asleep.pieces.length, 1); assert.equal(asleep.pieces[0].minutes, 60); assert.equal(asleep.pieces[0].live, true); assert.equal(asleep.asleep, true);
  const awake = dayRing({ sleeps:[], timezone:tz, now, next:{ at:iso(13), label:'next nap' } });
  assert.equal(awake.next.label, 'next nap');
  assert.equal(dayRing({ sleeps:[], timezone:tz, now, next:{ at:iso(11) } }).next, null, 'a call in the past is not drawn');
});

test('the drawing labels itself and escapes text', () => {
  const ring = dayRing({ sleeps:[{ start:iso(8), end:iso(9) }], bottles:[{ start:iso(7), amount:120, units:'ml' }], timezone:tz, now, next:{ at:iso(13), label:'<b>nap</b>' } });
  const html = dayRingHTML(ring, { timezone:tz, now, status:'3h', since:'since 9:00 AM' });
  assert.match(html, /aria-label="Frankie’s last 24 hours: slept 1h 00m, 1 bottle, 4.1 oz"/);
  assert.match(html, /class="ring-sleep is-nap"/);
  assert.match(html, /&lt;b&gt;nap&lt;\/b&gt;/); assert.doesNotMatch(html, /<b>nap/);
  assert.match(html, /ring-now/);
});
