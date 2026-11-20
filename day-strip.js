// "Frankie's day" strip on Today: one line from early morning to late evening with her
// sleeps so far, a "now" marker, and each cat's prediction window on its own lane, so
// you can see at a glance how Hubert, Mia and Mack line up. Pure: returns SVG markup.
import { escapeHTML as esc } from './household-model.js';
import { clockAt, localDay, dayStart, nightLine, sleepKind } from './baby-history.js';

const MINUTE = 60000, HOUR = 3600000;
const toStamp = value => typeof value === 'number' ? value : Date.parse(value);
// The visible span: 5 AM to 11 PM today, stretched if now (or a window) runs later.
export function stripRange(timezone, now = Date.now(), windows = []) {
  const day = dayStart(localDay(+now, timezone), timezone);
  let from = day + 5 * HOUR, to = day + 23 * HOUR;
  for (const value of [+now, ...windows.flatMap(w => [toStamp(w.start), toStamp(w.end)])].filter(Number.isFinite)) { if (value > to) to = Math.min(value + HOUR, day + 30 * HOUR); if (value < from) from = Math.max(value - HOUR, day); }
  return { from, to };
}
export function dayStripSVG({ sleeps = [], timer = null, picks = [], timezone = 'America/New_York', now = Date.now(), width = 640 } = {}) {
  const { from, to } = stripRange(timezone, now, picks), span = to - from;
  const pad = 8, laneTop = 30, laneH = 12, gap = 5, sleepY = 8, sleepH = 14, height = laneTop + picks.length * (laneH + gap) + 18;
  const x = t => pad + Math.max(0, Math.min(1, (t - from) / span)) * (width - pad * 2);
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
  for (let t = day; t <= to; t += 3 * HOUR) if (t >= from && clockAt(t, timezone) % 180 === 0) ticks.push(t);
  const tickMarks = ticks.map(t => { const label = new Date(t).toLocaleTimeString([], { hour:'numeric', timeZone:timezone }).replace(':00', '').replace(' ', '').toLowerCase(); return `<line class="strip-tick" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${sleepY - 4}" y2="${height - 14}"/><text class="strip-hour" x="${x(t).toFixed(1)}" y="${height - 3}" text-anchor="middle">${esc(label)}</text>`; }).join('');
  // One lane per cat: the window as a soft band, the best guess as a dot.
  const lanes = picks.map((p, i) => {
    const y = laneTop + i * (laneH + gap), s = toStamp(p.start), e = toStamp(p.end), t = toStamp(p.target ?? p.start);
    const band = Number.isFinite(s) && Number.isFinite(e) && e > s ? `<rect class="strip-band ${esc(p.key)}" x="${x(s).toFixed(1)}" y="${y}" width="${Math.max(3, x(e) - x(s)).toFixed(1)}" height="${laneH}" rx="${laneH / 2}"/>` : '';
    return `<g class="strip-lane"><text class="strip-cat" x="${pad}" y="${y + laneH - 2}">${esc(p.cat)}</text>${band}<circle class="strip-dot ${esc(p.key)}" cx="${x(t).toFixed(1)}" cy="${y + laneH / 2}" r="4.5"><title>${esc(`${p.cat}: ${p.label || ''} ${clock(t)}${band ? ` (${clock(s)}–${clock(e)})` : ''}`)}</title></circle></g>`;
  }).join('');
  const nowX = x(+now);
  return `<svg class="day-strip" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Frankie’s day so far: ${blocks.length} sleep${blocks.length === 1 ? '' : 's'}${picks.length ? `; ${picks.map(p => `${p.cat} ${clock(toStamp(p.target ?? p.start))}`).join(', ')}` : ''}`)}">
    ${tickMarks}${sleepRects}${lanes}<g class="strip-key" transform="translate(${width - pad - 92} ${laneTop - 6})"><rect class="strip-sleep night" width="10" height="8" rx="2" y="-7"/><text x="13">Night</text><rect class="strip-sleep" width="10" height="8" rx="2" x="50" y="-7"/><text x="63">Nap</text></g><line class="strip-now" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="2" y2="${height - 14}"/><text class="strip-now-label" x="${nowX.toFixed(1)}" y="${height - 3}" text-anchor="middle">now</text></svg>`;
}
