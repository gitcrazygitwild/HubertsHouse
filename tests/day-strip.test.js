import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStripSVG, stripRange } from '../day-strip.js';

const zone = 'America/New_York', now = Date.parse('2026-11-19T20:00:00Z'); // 3 PM in Richmond
const iso = ms => new Date(ms).toISOString(), H = 3600000;
test('the strip shows today’s sleeps, local hour marks, each cat’s window and now', () => {
  const sleeps = [{ start:iso(now - 20 * H), end:iso(now - 8 * H) }, { start:iso(now - 5 * H), end:iso(now - 4 * H) }];
  const picks = [{ key:'hubert', cat:'Hubert', start:iso(now + H), end:iso(now + 1.3 * H), target:iso(now + 1.15 * H), label:'nap' }, { key:'mia', cat:'Mia', start:iso(now + 0.9 * H), end:iso(now + 1.1 * H), target:iso(now + H) }, { key:'mack', cat:'Mack', target:iso(now + 1.5 * H) }];
  const svg = dayStripSVG({ sleeps, picks, timezone:zone, now, width:600 });
  assert.equal((svg.match(/<title>Night sleep /g) || []).length, 1); assert.equal((svg.match(/<title>Nap /g) || []).length, 1);
  assert.match(svg, /class="strip-key"/);
  for (const hour of ['6am', '9am', '12pm', '6pm', '9pm']) assert.ok(svg.includes(`>${hour}<`), hour);
  assert.ok(!svg.includes('>3pm<'), 'the hour under “now” gives way to the now label');
  assert.equal((svg.match(/class="strip-band /g) || []).length, 2, 'Mack has a single time, no band');
  assert.equal((svg.match(/class="strip-dot /g) || []).length, 3);
  assert.match(svg, /aria-label="Frankie’s day so far: 2 sleeps; Hubert 4:09 PM, Mia 4:00 PM, Mack 4:30 PM"/);
  const { from, to } = stripRange(zone, now);
  assert.equal(new Date(from).getUTCHours(), 10); assert.equal(new Date(to).getUTCHours(), 4); // 5 AM – 11 PM Eastern
  assert.ok(stripRange(zone, Date.parse('2026-11-20T04:30:00Z')).to > to, 'stretches past 11 PM when it’s later');
});
test('with nothing logged for 8+ hours, Hubert and Mia say since when', async () => {
  const { purrfectWindow, miaForecast } = await import('../baby-model.js');
  const sleeps = [{ start:'2026-11-19T04:00:00Z', end:'2026-11-19T13:15:00Z' }]; // woke 8:15 AM Eastern
  const now = new Date('2026-11-20T02:17:00Z'); // 9:17 PM, 13 hours later
  assert.match(purrfectWindow({ sleeps, timezone:'America/New_York' }, now).reason, /Nothing logged since she woke at 8:15 AM, over 12 hours ago\. Log today’s naps and Hubert will forecast again\./);
  assert.match(miaForecast({ sleeps, timezone:'America/New_York' }, now).reason, /since she woke at 8:15 AM.*Mia will forecast again/);
});
test('10 hours after her last logged wake-up, Hubert and Mia still guess', async () => {
  const { purrfectWindow, miaForecast } = await import('../baby-model.js');
  const zone = 'UTC', H = 3600000, DAY = 86400000, base = Date.parse('2026-11-19T00:00:00Z'), sleeps = [];
  for (let d = 8; d >= 0; d--) { const b = base - d * DAY; sleeps.push({ start:b - 5 * H, end:b + 7 * H }); if (d) for (const [a, z] of [[9, 10], [12.5, 14], [16, 16.75]]) sleeps.push({ start:b + a * H, end:b + z * H }); }
  const iso = sleeps.map(s => ({ start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString() }));
  const now = new Date(base + 17 * H); // woke at 7:00, nothing logged since
  assert.equal(purrfectWindow({ sleeps:iso, timezone:zone }, now).available, true);
  assert.equal(miaForecast({ sleeps:iso, timezone:zone }, now).available, true);
});
