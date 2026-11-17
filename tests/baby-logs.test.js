import test from 'node:test';
import assert from 'node:assert/strict';
import { logsHTML, describeLog, logKey } from '../baby-logs.js';

const tz = 'America/New_York', now = Date.parse('2026-11-16T20:00:00Z'), day = 86400000;
const bottle = (id, start, amount = 4) => ({kind:'bottle', id, version:'1.000000000', start:new Date(start).toISOString(), amount, units:'oz', bottleType:'Formula'});

test('logs are grouped by day, newest first, with older days behind “Show older”', () => {
  const entries = [0, 1, 2, 3, 4].map(n => bottle(`b${n}`, now - n * day));
  const html = logsHTML({entries, timezone:tz, now});
  assert.match(html, /<h3>Today<\/h3>/); assert.match(html, /<h3>Yesterday<\/h3>/);
  assert.equal((html.match(/class="log-day"/g) || []).length, 2);
  assert.match(html, /Show older \(3\)/);
  assert.equal((logsHTML({entries, timezone:tz, now, showAll:true}).match(/class="log-day"/g) || []).length, 5);
});

test('filters, empty states, descriptions and escaping', () => {
  const entries = [bottle('b1', now), {kind:'diaper', id:'d"1', version:'1.000000000', start:new Date(now).toISOString(), mode:'both'}];
  assert.doesNotMatch(logsHTML({entries, timezone:tz, now, filter:'diaper'}), /formula/);
  assert.match(logsHTML({entries, timezone:tz, now, filter:'sleep'}), /No sleep logs in the last 7 days/);
  assert.match(logsHTML({entries, timezone:tz, now}), /data-log-delete="diaper:d&quot;1"/);
  assert.equal(logKey(entries[0]), 'bottle:b1');
  assert.deepEqual(describeLog({kind:'sleep', start:'2026-11-16T18:00:00Z', end:'2026-11-16T19:25:00Z'}, tz), {icon:'☾', noun:'sleep', what:'Sleep · 1h 25m', when:'1:00 PM – 2:25 PM'});
  assert.equal(describeLog(entries[1], tz).what, 'Wet and dirty diaper');
});
