// Today → "The world, briefly": rendering and chart helpers with no Firebase imports,
// so they can be tested directly. world-briefing.js wires them to the page.
import { escapeHTML as esc } from './household-model.js';
import { marketValue, marketChange, marketDate } from './briefing-format.js';

const DAY = 86400000;
const ago = (value, now) => { const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60000)); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)}h ago`; };
export const RANGES = [['1W', 'Past week', 7], ['1M', 'Past month', 31], ['1Y', 'Past year', 366], ['5Y', 'Past 5 years', 5 * 366], ['All', 'All history', Infinity]];
export function briefingHTML(briefing, { now = Date.now(), sample = false } = {}) {
  const markets = briefing.markets || [], headlines = briefing.headlines || [], good = briefing.goodNews;
  const tiles = markets.map(market => {
    const change = marketChange(market);
    return `<button type="button" class="world-market" data-market="${esc(market.id)}" aria-expanded="false" aria-label="${esc(market.name)} ${esc(marketValue(market))}, ${esc(change.text || 'no change')}. Show chart"><span>${esc(market.name)}</span><strong>${esc(marketValue(market))}</strong><small class="move-${change.tone}">${esc(change.text || ' ')}</small><small class="world-asof">${esc(marketDate(market.date))} · chart</small></button>`;
  }).join('');
  const list = headlines.map(item => `<li><a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><span>${esc(item.source)}</span></li>`).join('');
  return `${tiles ? `<div class="world-markets" aria-label="Markets and rates">${tiles}</div><div id="worldChart" class="world-chart" hidden></div>` : ''}
    ${good ? `<a class="world-good" href="${esc(good.link)}" target="_blank" rel="noopener noreferrer"><span class="world-good-label">☀ Good news</span><strong>${esc(good.title)}</strong><span class="world-good-source">${esc(good.source)}</span></a>` : ''}
    ${list ? `<ol class="world-headlines">${list}</ol>` : '<p class="tiny muted">Headlines are unavailable right now.</p>'}
    <p class="tiny muted world-footer">${sample ? 'Sample headlines and numbers in this preview · ' : ''}Headlines from NPR and BBC World · good news from Good News Network · markets and rates from FRED (St. Louis Fed), as of each date shown${briefing.fetchedAt ? ` · updated ${esc(ago(briefing.fetchedAt, now))}` : ''}${briefing.stale ? ' · couldn’t refresh, showing the last update' : ''}.</p>`;
}

// ---------- Charts ----------
// Points for one range: daily closes up to a year, weekly for 5Y, monthly for All.
// Always at least two points (weekly series like the mortgage rate have few in 1W).
export function rangePoints(history, range, now = Date.now()) {
  const days = RANGES.find(([key]) => key === range)?.[2] ?? 31;
  const source = days <= 366 ? history.daily : days <= 5 * 366 ? history.weekly : history.monthly;
  const list = (source || []).map(point => ({ t:Date.parse(`${point.d}T12:00:00Z`), d:point.d, v:point.v })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.v));
  const latest = Math.max(...(history.daily || []).map(point => Date.parse(`${point.d}T12:00:00Z`)), list.at(-1)?.t || 0);
  // Make sure the newest daily close ends every range.
  const last = history.daily?.at(-1);
  if (last && list.at(-1)?.d !== last.d) list.push({ t:Date.parse(`${last.d}T12:00:00Z`), d:last.d, v:last.v });
  const inRange = days === Infinity ? list : list.filter(point => point.t >= latest - days * DAY);
  return inRange.length >= 2 ? inRange : list.slice(-2);
}
export function rangeChange(points, kind) {
  if (points.length < 2) return { text:'', tone:'flat' };
  const first = points[0].v, last = points.at(-1).v, move = kind === 'index' ? (last - first) / first * 100 : last - first;
  if (Math.abs(move) < 0.005) return { text:'unchanged', tone:'flat' };
  const arrow = move > 0 ? '▲' : '▼', text = `${arrow} ${Math.abs(move).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}${kind === 'index' ? '%' : ' pt'}`;
  return { text, tone:kind === 'index' ? (move > 0 ? 'up' : 'down') : 'flat' };
}
export const shortValue = (value, kind) => kind === 'index' ? value.toLocaleString('en-US', { maximumFractionDigits:value >= 1000 ? 0 : 2 }) : `${value.toFixed(2)}%`;
export const fullValue = (value, kind) => kind === 'index' ? value.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : `${value.toFixed(2)}%`;
export const dateLabel = (point, long) => new Date(point.t).toLocaleDateString('en-US', long ? { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' } : { month:'short', year:'numeric', timeZone:'UTC' });
function ticks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1, raw = span / count, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(m => m >= raw);
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}
// A single-series line: 2px line, recessive grid, a hidden crosshair the pointer moves.
export function chartSVG(points, kind, width = 640, height = 220) {
  const pad = { top:12, right:12, bottom:26, left:kind === 'index' ? 52 : 44 }, w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
  const values = points.map(point => point.v), lo = Math.min(...values), hi = Math.max(...values), room = (hi - lo || Math.abs(hi) * 0.02 || 1) * 0.08;
  const min = lo - room, max = hi + room, t0 = points[0].t, t1 = points.at(-1).t || t0 + 1;
  const x = t => pad.left + (t1 === t0 ? w / 2 : (t - t0) / (t1 - t0) * w), y = v => pad.top + (1 - (v - min) / (max - min)) * h;
  const grid = ticks(min, max).filter(v => v >= min && v <= max).map(v => `<line x1="${pad.left}" x2="${pad.left + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="chart-grid"/><text x="${pad.left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="chart-axis">${esc(shortValue(v, kind))}</text>`).join('');
  const long = t1 - t0 < 400 * DAY, labels = [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)];
  const xLabels = labels.map((point, i) => `<text x="${x(point.t).toFixed(1)}" y="${height - 6}" text-anchor="${['start', 'middle', 'end'][i]}" class="chart-axis">${esc(long ? new Date(point.t).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' }) : dateLabel(point))}</text>`).join('');
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(point.v).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" class="world-chart-svg" role="img" aria-label="Line chart, ${esc(dateLabel(points[0], true))} to ${esc(dateLabel(points.at(-1), true))}" tabindex="0" data-x0="${pad.left}" data-w="${w}">
    ${grid}${xLabels}<path d="${path}" class="world-chart-line"/>
    <g class="world-crosshair" visibility="hidden"><line y1="${pad.top}" y2="${pad.top + h}" class="chart-crosshair"/><circle r="4.5" class="world-chart-dot"/></g>
    <rect x="${pad.left}" y="${pad.top}" width="${w}" height="${h}" fill="transparent" class="world-chart-hit"/></svg>`;
}
export function chartPanelHTML(history, range, points, width) {
  const change = rangeChange(points, history.kind), label = RANGES.find(([key]) => key === range)?.[1] || '';
  const since = history.first ? new Date(`${history.first}T12:00:00Z`).toLocaleDateString('en-US', { month:'short', year:'numeric', timeZone:'UTC' }) : '';
  const rows = [...points].reverse().slice(0, 60).map(point => `<tr><td>${esc(dateLabel(point, true))}</td><td>${esc(fullValue(point.v, history.kind))}</td></tr>`).join('');
  return `<div class="world-chart-head"><div><strong>${esc(history.name)}</strong> <span class="move-${change.tone}">${esc(change.text)}</span> <span class="tiny muted">${esc(range === 'All' && since ? `since ${since}` : label.toLowerCase())}</span></div>
      <div class="home-view-toggle" role="group" aria-label="Chart range">${RANGES.map(([key, name]) => `<button type="button" data-range="${key}" aria-pressed="${key === range}" title="${name}">${key}</button>`).join('')}</div>
      <button type="button" class="btn world-chart-close" data-chart-close aria-label="Close chart">×</button></div>
    <p class="world-chart-readout tiny" aria-live="polite">${esc(dateLabel(points.at(-1), true))} · ${esc(fullValue(points.at(-1).v, history.kind))}</p>
    ${chartSVG(points, history.kind, width)}
    <details class="world-chart-table"><summary class="tiny">Show as a table</summary><table><thead><tr><th>Date</th><th>${history.kind === 'index' ? 'Close' : 'Rate'}</th></tr></thead><tbody>${rows}</tbody></table></details>
    <p class="tiny muted">${history.kind === 'index' ? 'Daily closes' : 'Published values'} from FRED${since ? `, available since ${esc(since)}` : ''}${history.sample ? ' · sample data in this preview' : ''}${history.stale ? ' · showing the last saved history' : ''}.</p>`;
}
// Sample history for the preview: a gentle deterministic random walk.
export function sampleMarketHistory(market, now = Date.now()) {
  let seed = [...market.id].reduce((a, c) => a + c.charCodeAt(0), 0), value = market.value;
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5; };
  const days = []; for (let i = 0; i < 2600; i++) { const d = new Date(now - DAY - i * DAY); if (d.getUTCDay() % 6 === 0) continue; days.push({ d:d.toISOString().slice(0, 10), v:Math.round(value * 100) / 100 }); value = Math.max(0.1, value * (1 - random() * (market.kind === 'index' ? 0.02 : 0.01))); }
  days.reverse();
  const last = (list, key) => [...new Map(list.map(point => [key(point.d), point])).values()];
  return { id:market.id, name:market.name, kind:market.kind, sample:true, first:days[0].d, daily:days.slice(-280), weekly:last(days, d => d.slice(0, 8) + String(Math.floor(Number(d.slice(8)) / 7))), monthly:last(days, d => d.slice(0, 7)) };
}

export function sampleBriefing(now = Date.now()) {
  const day = new Date(now - DAY).toISOString().slice(0, 10);
  const headline = (title, source, n) => ({ title, link:`https://example.com/sample-${n}`, source, published:new Date(now - n * 3600000).toISOString() });
  return { fetchedAt:new Date(now - 6 * 60000).toISOString(), headlines:[
    headline('Sample headline: city council approves new park downtown', 'NPR', 1), headline('Sample headline: leaders meet for climate talks', 'BBC World', 2),
    headline('Sample headline: storm expected to bring heavy rain this weekend', 'NPR', 3), headline('Sample headline: new trade agreement signed', 'BBC World', 4),
    headline('Sample headline: researchers report progress on vaccine', 'NPR', 5), headline('Sample headline: election results due later today', 'BBC World', 6)],
  goodNews:headline('Sample good news: neighbors rebuild a beloved community garden in a weekend', 'Good News Network', 7),
  markets:[{ id:'SP500', name:'S&P 500', kind:'index', value:6012.45, change:24.1, changePct:0.4, date:day }, { id:'DJIA', name:'Dow', kind:'index', value:44210.3, change:-88.2, changePct:-0.2, date:day },
    { id:'NASDAQCOM', name:'Nasdaq', kind:'index', value:19480.12, change:140.6, changePct:0.73, date:day }, { id:'DGS10', name:'10-yr Treasury', kind:'rate', value:4.21, change:-0.03, changePct:null, date:day },
    { id:'DFF', name:'Fed funds', kind:'rate', value:4.33, change:0, changePct:null, date:day }, { id:'MORTGAGE30US', name:'30-yr mortgage', kind:'rate', value:6.84, change:0.05, changePct:null, date:day }] };
}
