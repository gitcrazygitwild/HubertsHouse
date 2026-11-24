// Frankie's charts: daily sleep, bottle ounces, pumping and the two-week sleep timeline,
// drawn as inline SVG strings (frankie.js puts them on the page and adds the shared tooltip),
// plus the "Show as table" view, the legends and the small formatters they share.
// Moved unchanged from frankie.js. Pure: no DOM.
import { escapeHTML as esc } from './household-model.js';
import { dayStart } from './baby-history.js';

export const hm = hours => { if (hours == null) return '—'; const total = Math.round(hours * 60); return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`; };
export const oz = value => value == null ? '—' : `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '')} oz`;
export function dayLabel(key, timezone, style = 'short') {
  const date = new Date(dayStart(key, timezone) + 12 * 3600000);
  return style === 'tick' ? date.toLocaleDateString([], { month:'numeric', day:'numeric', timeZone:timezone }) : date.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric', timeZone:timezone });
}
export const clock = (stamp, timezone) => new Date(stamp).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:timezone });


function niceMax(value, step) { return Math.max(step, Math.ceil(value / step) * step); }
// Bar path with a 4px rounded top and a square base on the baseline.
function bar(x, y, width, height, radius = 4) {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}
function axis(width, height, pad, max, step, unit) {
  let lines = '';
  for (let v = 0; v <= max; v += step) {
    const y = pad.top + height - (v / max) * height;
    lines += `<line x1="${pad.left}" x2="${pad.left + width}" y1="${y}" y2="${y}" class="chart-grid${v === 0 ? ' chart-base' : ''}"/><text x="${pad.left - 8}" y="${y + 3.5}" class="chart-tick" text-anchor="end">${v}${unit}</text>`;
  }
  return lines;
}
function xTicks(rows, x, slot, y, timezone) {
  const room = Math.floor(rows.length * slot / 46), every = [1, 2, 5, 7, 10, 14, 15, 30].find(step => rows.length / step <= room) || 30;
  return rows.map((row, i) => (rows.length - 1 - i) % every === 0 ? `<text x="${x(i) + slot / 2}" y="${y}" class="chart-tick" text-anchor="middle">${esc(dayLabel(row.key, timezone, 'tick'))}</text>` : '').join('');
}

export function sleepChart(rows, timezone, W = 720) {
  const H = 220, pad = { top:12, right:8, bottom:26, left:40 }, w = W - pad.left - pad.right, h = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...rows.map(r => r.total), 12), 4), slot = w / rows.length, bw = Math.max(2, Math.min(22, slot - 2));
  const x = i => pad.left + i * slot, y = v => (v / max) * h;
  let bars = '';
  rows.forEach((row, i) => {
    const bx = x(i) + (slot - bw) / 2, nightH = y(row.night), napH = y(row.nap), base = pad.top + h;
    const nightTop = base - nightH, gap = row.night && row.nap ? 2 : 0;
    if (row.nap) bars += `<path d="${bar(bx, nightTop - gap - napH, bw, napH)}" class="mark-nap"/>`;
    if (row.night) bars += row.nap ? `<rect x="${bx}" y="${nightTop}" width="${bw}" height="${nightH}" class="mark-night"/>` : `<path d="${bar(bx, nightTop, bw, nightH)}" class="mark-night"/>`;
    const tip = `${dayLabel(row.key, timezone)}${row.partial ? ' · so far' : ''}|Total ${hm(row.total)}|Night ${hm(row.night)}|Naps ${hm(row.nap)} · ${row.naps} nap${row.naps === 1 ? '' : 's'}`;
    bars += `<rect x="${x(i)}" y="${pad.top}" width="${slot}" height="${h}" class="chart-hit" data-tip="${esc(tip)}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Daily sleep, night and naps, last ${rows.length} days">${axis(w, h, pad, max, 4, 'h')}${bars}${xTicks(rows, x, slot, H - 8, timezone)}</svg>`;
}
export function bottleChart(rows, timezone, average, W = 720) {
  const H = 200, pad = { top:12, right:8, bottom:26, left:40 }, w = W - pad.left - pad.right, h = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...rows.map(r => r.ounces), 8), 8), slot = w / rows.length, bw = Math.max(2, Math.min(22, slot - 2));
  const x = i => pad.left + i * slot;
  let bars = '';
  rows.forEach((row, i) => {
    const bh = (row.ounces / max) * h, bx = x(i) + (slot - bw) / 2;
    bars += `<path d="${bar(bx, pad.top + h - bh, bw, bh)}" class="mark-bottle${i === rows.length - 1 ? ' is-today' : ''}"/>`;
    bars += `<rect x="${x(i)}" y="${pad.top}" width="${slot}" height="${h}" class="chart-hit" data-tip="${esc(`${dayLabel(row.key, timezone)}${i === rows.length - 1 ? ' · so far' : ''}|${oz(row.ounces)}|${row.count} bottle${row.count === 1 ? '' : 's'}`)}"/>`;
  });
  const avgLine = average ? (() => { const ay = pad.top + h - (average / max) * h; return `<line x1="${pad.left}" x2="${pad.left + w}" y1="${ay}" y2="${ay}" class="chart-ref"/><text x="${pad.left + 6}" y="${ay - 6}" class="chart-ref-label">7-day avg ${oz(average)}</text>`; })() : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Bottle ounces per day, last ${rows.length} days">${axis(w, h, pad, max, 8, '')}${bars}${avgLine}${xTicks(rows, x, slot, H - 8, timezone)}</svg>`;
}
// Pumped ounces per day, stacked: left, right, then any sessions logged as one total.
export function pumpChart(rows, timezone, average, W = 720) {
  const H = 200, pad = { top:12, right:8, bottom:26, left:40 }, w = W - pad.left - pad.right, h = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...rows.map(r => r.ounces), 8), 8), slot = w / rows.length, bw = Math.max(2, Math.min(22, slot - 2));
  const x = i => pad.left + i * slot;
  let bars = '';
  rows.forEach((row, i) => {
    const bx = x(i) + (slot - bw) / 2, today = i === rows.length - 1 ? ' is-today' : '';
    const parts = [['left', row.left], ['right', row.right], ['unsplit', row.unsplit]].filter(([, v]) => v > 0);
    let top = pad.top + h;
    parts.forEach(([kind, value], j) => {
      const ph = (value / max) * h; top -= ph;
      bars += j === parts.length - 1 ? `<path d="${bar(bx, top, bw, ph)}" class="mark-${kind}${today}"/>` : `<rect x="${bx}" y="${top}" width="${bw}" height="${ph}" class="mark-${kind}${today}"/>`;
    });
    const tip = `${dayLabel(row.key, timezone)}${today ? ' · so far' : ''}|${oz(row.ounces)} · ${row.count} pump${row.count === 1 ? '' : 's'}|Left ${oz(row.left)} · Right ${oz(row.right)}${row.unsplit ? `|Total only ${oz(row.unsplit)}` : ''}`;
    bars += `<rect x="${x(i)}" y="${pad.top}" width="${slot}" height="${h}" class="chart-hit" data-tip="${esc(tip)}"/>`;
  });
  const avgLine = average ? (() => { const ay = pad.top + h - (average / max) * h; return `<line x1="${pad.left}" x2="${pad.left + w}" y1="${ay}" y2="${ay}" class="chart-ref"/><text x="${pad.left + 6}" y="${ay - 6}" class="chart-ref-label">7-day avg ${oz(average)}</text>`; })() : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Ounces pumped per day, left and right, last ${rows.length} days">${axis(w, h, pad, max, 8, '')}${bars}${avgLine}${xTicks(rows, x, slot, H - 8, timezone)}</svg>`;
}
export function timeline(rows, timezone, W = 720) {
  const rowH = 18, gap = 6, pad = { top:6, left:W < 480 ? 64 : 82, right:8, bottom:22 }, w = W - pad.left - pad.right, H = pad.top + rows.length * (rowH + gap) + pad.bottom;
  let body = '';
  for (const hour of [0, 6, 12, 18, 24]) {
    const gx = pad.left + (hour / 24) * w;
    body += `<line x1="${gx}" x2="${gx}" y1="${pad.top - 2}" y2="${H - pad.bottom + 2}" class="chart-grid"/><text x="${gx}" y="${H - 6}" class="chart-tick" text-anchor="middle">${['12a','6a','12p','6p','12a'][hour / 6]}</text>`;
  }
  rows.forEach((row, i) => {
    const ry = pad.top + i * (rowH + gap);
    body += `<text x="${pad.left - 10}" y="${ry + 12.5}" class="chart-tick" text-anchor="end">${esc(W < 480 ? dayLabel(row.key, timezone, 'tick') : dayLabel(row.key, timezone))}</text><rect x="${pad.left}" y="${ry}" width="${w}" height="${rowH}" rx="5" class="timeline-track"/>`;
    for (const block of row.blocks) {
      const bx = pad.left + (block.from / row.length) * w, bw = Math.max(2, ((block.to - block.from) / row.length) * w);
      body += `<rect x="${bx}" y="${ry + 2}" width="${bw}" height="${rowH - 4}" rx="4" class="mark-${block.kind}" data-tip="${esc(`${block.kind === 'nap' ? 'Nap' : 'Night sleep'}|${clock(block.start, timezone)} – ${clock(block.end, timezone)}|${hm(block.minutes / 60)}`)}"/>`;
    }
    if (row.nowMinute != null) { const nx = pad.left + (row.nowMinute / row.length) * w; body += `<line x1="${nx}" x2="${nx}" y1="${ry - 2}" y2="${ry + rowH + 2}" class="timeline-now"/>`; }
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Sleep timeline, last ${rows.length} days">${body}</svg>`;
}
export const legend = items => `<div class="chart-legend">${items.map(([kind, label]) => `<span><i class="swatch mark-${kind}"></i>${label}</span>`).join('')}</div>`;
export const table = (caption, head, rows) => `<details class="chart-table"><summary>Show as table</summary><table><caption class="sr-only">${caption}</caption><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
