// "Frankie's day" strip on Today: one line from early morning to late evening with her
// sleeps so far, a "now" marker, and each cat's prediction window on its own lane, so
// you can see at a glance how Hubert, Mia and Mack line up. Pure: returns SVG markup.
import { escapeHTML as esc } from './household-model.js';
import { clockAt, localDay, dayStart, nightLine, sleepKind } from './baby-history.js';

const MINUTE = 60000, HOUR = 3600000;
const toStamp = value => typeof value === 'number' ? value : Date.parse(value);
// The visible span: 5 AM to 11 PM today, stretched if now (or a window) runs later.
export function stripRange(timezone, now = Date.now(), windows = [], latest = 30) {
  const day = dayStart(localDay(+now, timezone), timezone);
  let from = day + 5 * HOUR, to = day + 23 * HOUR;
  for (const value of [+now, ...windows.flatMap(w => [toStamp(w.start), toStamp(w.end), toStamp(w.target), toStamp(w.wake), toStamp(w.actual)])].filter(Number.isFinite)) { if (value > to) to = Math.min(value + HOUR, day + latest * HOUR); if (value < from) from = Math.max(value - HOUR, day); }
  return { from, to };
}
// Lane geometry, shared with the Frankie page's cat-name column.
export const STRIP_LANES = { top:44, height:12, gap:5 };
export const CATS = [['hubert', 'Hubert'], ['mia', 'Mia'], ['mack', 'Mack']];
// `scroll`: the Frankie page version. The day is drawn at `pxPerHour` (wider than the screen,
// so it scrolls sideways), always with all three lanes, and `rounds` adds each cat's guess for
// every earlier sleep today ({ wake, actual, hubert, mia, mack }; null = that cat had no call).
export function dayStripSVG({ sleeps = [], timer = null, picks = [], rounds = [], timezone = 'America/New_York', now = Date.now(), width = 640, scroll = false, pxPerHour = 64 } = {}) {
  const roundPicks = rounds.flatMap(r => [{ wake:r.wake, actual:r.actual }, ...CATS.map(([key]) => r[key]).filter(Boolean)]);
  const { from, to } = stripRange(timezone, now, scroll ? [...picks, ...roundPicks] : picks, scroll ? 33 : 30), span = to - from;
  if (scroll) width = Math.max(width, Math.round(span / HOUR * pxPerHour));
  const lanesShown = scroll ? CATS.map(([key, cat]) => ({ key, cat, pick:picks.find(p => p.key === key) || null })) : picks.map(p => ({ key:p.key, cat:p.cat, pick:p }));
  const pad = 8, padLeft = scroll ? 70 : pad, laneTop = STRIP_LANES.top, laneH = STRIP_LANES.height, gap = STRIP_LANES.gap, sleepY = 22, sleepH = 14, height = laneTop + lanesShown.length * (laneH + gap) + 18;
  const x = t => padLeft + Math.max(0, Math.min(1, (t - from) / span)) * (width - padLeft - pad);
  const line = nightLine(sleeps, timezone, now);
  const clock = t => new Date(t).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:timezone });
  // Sleeps today (and the running timer), clipped to the strip.
  const blocks = sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) })).filter(s => s.end > from && s.start < to)
    .concat(timer?.active && Number.isFinite(toStamp(timer.start)) ? [{ start:toStamp(timer.start), end:+now, live:true }] : [])
    .map(s => ({ ...s, kind:sleepKind(s, timezone, line) }));
  const sleepRects = blocks.map(s => `<rect class="strip-sleep ${s.kind}${s.live ? ' live' : ''}" x="${x(s.start).toFixed(1)}" y="${sleepY}" width="${Math.max(2, x(s.end) - x(s.start)).toFixed(1)}" height="${sleepH}" rx="4"><title>${esc(`${s.kind === 'night' ? 'Night sleep' : 'Nap'} ${clock(s.start)}–${s.live ? 'now' : clock(s.end)}`)}</title></rect>`).join('');
  // Hour ticks every 3 hours.
  // Every three hours on the local clock (6a, 9a, noon, 3p…).
  const ticks = [], day = dayStart(localDay(from, timezone), timezone);
  const every = scroll ? 60 : 180;
  for (let t = day; t <= to; t += HOUR) if (t >= from && clockAt(t, timezone) % every === 0) ticks.push(t);
  const nowAt = x(+now), tickMarks = ticks.map(t => { const label = new Date(t).toLocaleTimeString([], { hour:'numeric', timeZone:timezone }).replace(':00', '').replace(' ', '').toLowerCase(); return `<line class="strip-tick" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${sleepY - 4}" y2="${height - 14}"/>${Math.abs(x(t) - nowAt) < 30 ? '' : `<text class="strip-hour" x="${x(t).toFixed(1)}" y="${height - 3}" text-anchor="middle">${esc(label)}</text>`}`; }).join('');
  // One lane per cat: the window as a soft band, the best guess as a dot.
  const guess = (p, key, cat, y, extra = '') => {
    const s = toStamp(p.start), e = toStamp(p.end), t = toStamp(p.target ?? p.start);
    const band = Number.isFinite(s) && Number.isFinite(e) && e > s ? `<rect class="strip-band ${esc(key)}${extra}" x="${x(s).toFixed(1)}" y="${y}" width="${Math.max(3, x(e) - x(s)).toFixed(1)}" height="${laneH}" rx="${laneH / 2}"/>` : '';
    return `${band}<circle class="strip-dot ${esc(key)}${extra}${p.hat ? ' hat' : ''}" cx="${x(t).toFixed(1)}" cy="${y + laneH / 2}" r="4.5"><title>${esc(`${cat}: ${p.label || ''} ${clock(t)}${band ? ` (${clock(s)}–${clock(e)})` : ''}`)}</title></circle>`;
  };
  // A cat with no call for a stretch gets a quiet note instead of a dot.
  const note = (left, right, y, text) => { const mid = (x(left) + x(right)) / 2, room = x(right) - x(left); return `<text class="strip-none" x="${mid.toFixed(1)}" y="${y + laneH - 2}" text-anchor="middle">${esc(room >= 54 ? text : '–')}</text>`; };
  const nowX = x(+now), live = picks.length > 0;
  const lanes = lanesShown.map(({ key, cat, pick }, i) => {
    const y = laneTop + i * (laneH + gap);
    const earlier = scroll ? rounds.map(r => r[key] ? guess(r[key], key, cat, y, ' past') : note(toStamp(r.wake), toStamp(r.actual), y, 'no call')).join('') : '';
    const current = pick ? guess(pick, key, cat, y) : scroll && live ? `<text class="strip-none" x="${(nowX + 6).toFixed(1)}" y="${y + laneH - 2}">no call yet</text>` : '';
    return `<g class="strip-lane">${scroll ? '' : `<text class="strip-cat" x="${pad}" y="${y + laneH - 2}">${esc(cat)}</text>`}${earlier}${current}</g>`;
  }).join('');
  // Where each earlier sleep actually began, so you can see whose dot was closest.
  const actuals = scroll ? rounds.map(r => { const ax = x(toStamp(r.actual)).toFixed(1); return `<line class="strip-actual" x1="${ax}" x2="${ax}" y1="${sleepY + sleepH}" y2="${height - 14}"/>`; }).join('') : '';
  const key = scroll ? '' : `<g class="strip-key" transform="translate(${width - pad - 92} 10)"><rect class="strip-sleep night" width="10" height="8" rx="2" y="-7"/><text x="13">Night</text><rect class="strip-sleep" width="10" height="8" rx="2" x="50" y="-7"/><text x="63">Nap</text></g>`;
  return `<svg class="day-strip${scroll ? ' is-scrolling' : ''}" viewBox="0 0 ${width} ${height}"${scroll ? ` width="${width}" height="${height}" data-now-x="${nowX.toFixed(0)}"` : ''} role="img" aria-label="${esc(`Frankie’s day so far: ${blocks.length} sleep${blocks.length === 1 ? '' : 's'}${picks.length ? `; ${picks.map(p => `${p.cat} ${clock(toStamp(p.target ?? p.start))}`).join(', ')}` : ''}${rounds.length ? `; guesses shown for ${rounds.length} earlier sleep${rounds.length === 1 ? '' : 's'}` : ''}`)}">
    ${tickMarks}${sleepRects}${actuals}${lanes}${key}<line class="strip-now" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="16" y2="${height - 14}"/><text class="strip-now-label" x="${nowX.toFixed(1)}" y="${height - 3}" text-anchor="middle">now</text></svg>`;
}
