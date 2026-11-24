// Frankie's last 24 hours as a clock face: midnight at the top, noon at the bottom. Sleeps
// are arcs around the ring (night and naps in their chart colors), bottles are dots just
// outside it, and the hand points at now. The ring holds a rolling day, so the stretch
// just past the hand is from about 24 hours ago and fades the older it is. The cats' next
// call, when there is one, is a small marker inside the ring. Pure: returns SVG + numbers.
import { clockAt, sleepKind, nightLine, toOunces } from './baby-history.js';

const MIN = 60000, DAY = 86400000, SIZE = 260, C = SIZE / 2, R = 96;
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
const angle = minutes => (minutes / 1440) * 2 * Math.PI; // 0 at the top, clockwise
const at = (minutes, radius) => [C + radius * Math.sin(angle(minutes)), C - radius * Math.cos(angle(minutes))].map(n => Math.round(n * 10) / 10);
const hm = minutes => { const m = Math.round(minutes); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
// An arc along the ring from a clock position, `span` minutes long.
function arc(fromMinutes, span, radius = R) {
  const length = Math.min(span, 1439.9), [x1, y1] = at(fromMinutes, radius), [x2, y2] = at(fromMinutes + length, radius);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${length > 720 ? 1 : 0} 1 ${x2} ${y2}`;
}

// The pieces of the last 24 hours, oldest first.
export function dayRing({ sleeps = [], bottles = [], timer = null, timezone, now = Date.now(), next = null } = {}) {
  const end = +now, start = end - DAY, line = nightLine(sleeps, timezone, end);
  const all = sleeps.map(s => ({ start:stamp(s.start), end:stamp(s.end), source:s })).filter(s => Number.isFinite(s.start) && s.end > s.start);
  if (timer?.active && Number.isFinite(stamp(timer.start))) all.push({ start:stamp(timer.start), end, live:true, source:{ start:timer.start, end:new Date(end).toISOString() } });
  const pieces = all.filter(s => s.end > start && s.start < end).map(s => {
    const from = Math.max(s.start, start), to = Math.min(s.end, end);
    return { from, to, minutes:(to - from) / MIN, kind:sleepKind(s.live ? { start:s.source.start, end:new Date(s.start + 3600000).toISOString() } : s.source, timezone, line), live:!!s.live, age:(end - to) / DAY };
  }).sort((a, b) => a.from - b.from);
  const feeds = bottles.map(b => ({ at:stamp(b.start), oz:toOunces(Number(b.amount) || 0, b.units) })).filter(b => b.at > start && b.at <= end && b.oz > 0).sort((a, b) => a.at - b.at);
  const nextAt = next && Number.isFinite(stamp(next.at)) && stamp(next.at) > end && stamp(next.at) < end + 12 * 3600000 ? stamp(next.at) : null;
  return {
    pieces, feeds, next:nextAt ? { at:nextAt, label:next.label || 'next sleep' } : null,
    slept:pieces.reduce((s, p) => s + p.minutes, 0), napMinutes:pieces.filter(p => p.kind === 'nap').reduce((s, p) => s + p.minutes, 0),
    ounces:Math.round(feeds.reduce((s, b) => s + b.oz, 0) * 10) / 10, bottles:feeds.length,
    longest:pieces.reduce((m, p) => Math.max(m, p.minutes), 0), asleep:!!timer?.active
  };
}

export function dayRingHTML(ring, { timezone, now = Date.now(), status = '', since = '' } = {}) {
  const clock = value => new Date(value).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:timezone });
  const nowAt = clockAt(+now, timezone);
  let face = `<circle cx="${C}" cy="${C}" r="${R + 30}" class="ring-plate"/><circle cx="${C}" cy="${C}" r="${R}" class="ring-track"/>`;
  for (let h = 0; h < 24; h++) {
    const big = h % 6 === 0, [x1, y1] = at(h * 60, R - 13), [x2, y2] = at(h * 60, R - (big ? 21 : 17));
    face += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ring-tick${big ? ' big' : ''}"/>`;
  }
  for (const [h, text] of [[0, '12a'], [6, '6a'], [12, '12p'], [18, '6p']]) { const [x, y] = at(h * 60, R - 31); face += `<text x="${x}" y="${y}" class="ring-hour" text-anchor="middle" dominant-baseline="central">${text}</text>`; }
  // Sleeps: older stretches fade (the ring is a rolling day).
  const sleeps = ring.pieces.map(p => {
    const opacity = (1 - Math.min(0.75, p.age * 0.9)).toFixed(2), from = clockAt(p.from, timezone);
    return `<path d="${arc(from, Math.max(p.minutes, 4))}" class="ring-sleep is-${p.kind}${p.live ? ' is-live' : ''}" style="opacity:${opacity}"><title>${safe(`${p.kind === 'nap' ? 'Nap' : 'Night sleep'} ${clock(p.from)}–${p.live ? 'now' : clock(p.to)} · ${hm(p.minutes)}`)}</title></path>`;
  }).join('');
  const feeds = ring.feeds.map(b => { const [x, y] = at(clockAt(b.at, timezone), R + 18), age = (+now - b.at) / DAY; return `<circle cx="${x}" cy="${y}" r="${(3 + Math.min(4, b.oz * 0.8)).toFixed(1)}" class="ring-bottle" style="opacity:${(1 - Math.min(0.6, age * 0.7)).toFixed(2)}"><title>${safe(`Bottle ${clock(b.at)} · ${Math.round(b.oz * 10) / 10} oz`)}</title></circle>`; }).join('');
  const [hx, hy] = at(nowAt, R + 26), [tx, ty] = at(nowAt, R - 9);
  const hand = `<line x1="${tx}" y1="${ty}" x2="${hx}" y2="${hy}" class="ring-now"/><circle cx="${hx}" cy="${hy}" r="4.5" class="ring-now-dot"/>`;
  let next = '';
  if (ring.next) { const m = clockAt(ring.next.at, timezone), [nx, ny] = at(m, R - 2); next = `<path d="${arc(nowAt, Math.max(2, (ring.next.at - +now) / MIN), R - 2)}" class="ring-next-path"/><circle cx="${nx}" cy="${ny}" r="5" class="ring-next"><title>${safe(`The cats’ call: ${ring.next.label} ~${clock(ring.next.at)}`)}</title></circle>`; }
  const label = `Frankie’s last 24 hours: slept ${hm(ring.slept)}, ${ring.bottles} bottle${ring.bottles === 1 ? '' : 's'}, ${ring.ounces} oz`;
  return `<div class="day-ring"><div class="ring-face"><svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${safe(label)}">${face}${sleeps}${next}${feeds}${hand}</svg>
    <div class="ring-center"><small>${safe(ring.asleep ? 'Sleeping' : 'Awake')}</small><strong>${safe(status)}</strong><span>${safe(since)}</span></div></div>
    <dl class="ring-facts">
      <div><dt>Slept</dt><dd>${hm(ring.slept)}</dd><span>${ring.napMinutes ? `${hm(ring.napMinutes)} of naps` : 'no naps'}</span></div>
      <div><dt>Longest stretch</dt><dd>${ring.longest ? hm(ring.longest) : '—'}</dd><span>in the last 24 hours</span></div>
      <div><dt>Bottles</dt><dd>${ring.ounces} oz</dd><span>${ring.bottles} bottle${ring.bottles === 1 ? '' : 's'}</span></div>
      ${ring.next ? `<div><dt>Cats’ call</dt><dd>${safe(clock(ring.next.at))}</dd><span>${safe(ring.next.label)}</span></div>` : ''}
    </dl>
    <p class="ring-key"><span><i class="is-night"></i>Night</span><span><i class="is-nap"></i>Nap</span><span><i class="is-bottle"></i>Bottle</span><span><i class="is-next"></i>Next call</span><span class="muted">Faded = longer ago · midnight at the top</span></p></div>`;
}
