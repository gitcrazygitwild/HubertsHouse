// Frankie's page: live status, the nap prediction scoreboard, a 24-hour sleep
// timeline, daily sleep totals and daily bottle ounces. Charts are inline SVG
// with a shared tooltip; every chart also has a table view.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { dailySleep, dailyBottles, timelineRows, babySummary, dayStart } from './baby-history.js';
import { MODELS, scorePredictions } from './prediction-log.js';
import { frankieAwards } from './awards.js';

const $ = id => document.getElementById(id);
let range = 30;
try { range = Number(localStorage.getItem('hh_frankie_range')) || 30; } catch { /* storage may be blocked */ }
const hm = hours => { if (hours == null) return '—'; const total = Math.round(hours * 60); return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`; };
const ago = (stamp, now) => { const minutes = Math.max(0, Math.round((now - Date.parse(stamp)) / 60000)); return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };
const oz = value => value == null ? '—' : `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '')} oz`;
const signed = minutes => minutes === 0 ? 'on time' : `${Math.abs(minutes)}m ${minutes > 0 ? 'late' : 'early'}`;
function dayLabel(key, timezone, style = 'short') {
  const date = new Date(dayStart(key, timezone) + 12 * 3600000);
  return style === 'tick' ? date.toLocaleDateString([], { month:'numeric', day:'numeric', timeZone:timezone }) : date.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric', timeZone:timezone });
}
const clock = (stamp, timezone) => new Date(stamp).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:timezone });

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

function sleepChart(rows, timezone, W = 720) {
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
function bottleChart(rows, timezone, average, W = 720) {
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
function timeline(rows, timezone, W = 720) {
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
const legend = items => `<div class="chart-legend">${items.map(([kind, label]) => `<span><i class="swatch mark-${kind}"></i>${label}</span>`).join('')}</div>`;
const table = (caption, head, rows) => `<details class="chart-table"><summary>Show as table</summary><table><caption class="sr-only">${caption}</caption><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;

function scoreboard(score, timezone) {
  const crown = key => score.leader === key ? '<span class="leader-badge">🏆 Leading</span>' : '';
  const cards = score.summary.map(model => `<article class="score-card score-${model.key}${score.leader === model.key ? ' is-leader' : ''}"><div class="score-head"><span>${esc(model.owner.toUpperCase())}</span>${crown(model.key)}</div><h3>${esc(model.name)}</h3>
    <div class="score-stats"><div><strong>${model.mae == null ? '—' : `±${model.mae}m`}</strong><small>avg miss</small></div><div><strong>${model.hitRate == null ? '—' : `${model.hitRate}%`}</strong><small>within 15m</small></div><div><strong>${model.wins}</strong><small>closest</small></div></div>
    <p class="score-width">${model.avgWidth == null ? 'Picks a single time' : `Avg window ${model.avgWidth} min wide`}</p><p>${model.n ? `${model.n} nap${model.n === 1 ? '' : 's'} scored${model.bias ? ` · usually ${signed(-model.bias).replace('late', 'too late').replace('early', 'too early')}` : ' · no early/late lean'}` : 'No naps scored yet'}</p></article>`).join('');
  const recent = score.results.slice(0, 8).map(row => `<tr><td>${esc(new Date(row.actual).toLocaleDateString([], { weekday:'short', timeZone:timezone }))} ${esc(clock(row.actual, timezone))}</td>${MODELS.map(model => { const r = row.models[model.key]; return `<td class="${r ? r.hit ? 'is-hit' : 'is-miss' : ''}${row.winners.length === 1 && row.winners[0] === model.key ? ' is-best' : ''}">${r ? `${r.hit ? '✓' : '·'} ${esc(signed(r.error))}` : '—'}</td>`; }).join('')}</tr>`).join('');
  return `${cards ? `<div class="score-grid">${cards}</div>` : ''}${recent ? `<div class="score-table-wrap"><table class="score-table"><thead><tr><th>Fell asleep</th>${MODELS.map(m => `<th>${esc(m.name)}</th>`).join('')}</tr></thead><tbody>${recent}</tbody></table></div>` : ''}
    <p class="tiny muted">Hubert’s and Mia’s guesses are recalculated for every wake-up using only the sleep logged before it, so backfilled naps get guesses too. SweetSpot is Huckleberry’s latest prediction captured while Frankie was awake; it stops updating once she falls asleep. A nap counts only when all three have a guess${score.skipped ? ` (${score.skipped} nap${score.skipped === 1 ? '' : 's'} skipped for a missing SweetSpot)` : ''}. Every model is judged on one time: SweetSpot’s time, or the middle of each window. Avg miss, hits (asleep within 15 minutes of that time) and “closest” all use it, so a wide window doesn’t earn easier hits; window widths are shown so a cautious guess is visible. “Late” means Frankie fell asleep after the guess.${score.scoredNaps < 3 ? ' A leader appears after three scored naps.' : ''}</p>`;
}

export function renderFrankie({ snapshot, timezone, predictions = [], demo = false, connected = false }) {
  const root = $('frankieContent'); if (!root) return;
  // The placeholder lives beside the page content and is only shown/hidden, so
  // the chart containers always exist when data arrives.
  const empty = $('frankieEmpty'), ready = !!snapshot;
  root.hidden = !ready; if (empty) empty.hidden = ready;
  if (!ready) { if (empty) renderHTML(empty, `<span class="baby-orbit" aria-hidden="true">☾</span><div><h3>Frankie’s trends will live here.</h3><p>${connected ? 'Loading her history from Huckleberry… If this stays, choose a child profile in Settings and press Refresh on Home.' : 'Connect Huckleberry in Settings to see sleep history, daily ounces and the nap prediction scoreboard.'}</p></div>`); return; }
  if (!['frankieStatus', 'frankieScore', 'frankieTimeline', 'frankieSleep', 'frankieBottles', 'frankieNote'].every(id => $(id))) return;
  const now = Date.now(), sleeps = snapshot.sleeps || [], bottles = snapshot.bottles || [];
  const summary = babySummary({ sleeps, bottles }, timezone, now), last = sleeps.at(-1), timer = snapshot.timer;
  const status = timer?.active ? `Asleep for ${ago(timer.start, now)}` : last ? `Awake for ${ago(last.end, now)}` : 'No sleep logged';
  const change = summary.avgOunces && summary.priorOunces ? Math.round((summary.avgOunces - summary.priorOunces) * 2) / 2 : null;
  const lastBottle = bottles.at(-1);
  renderHTML($('frankieStatus'), `<div class="frankie-tile is-live"><span>${timer?.active ? '☾ Sleeping' : '☀ Awake'}</span><strong>${esc(status)}</strong><small>${timer?.active ? `since ${esc(clock(timer.start, timezone))}` : last ? `since ${esc(clock(last.end, timezone))}` : ''}</small></div>
    <div class="frankie-tile"><span>Sleep today</span><strong>${hm(summary.today.sleep?.total)}</strong><small>${summary.avgSleep ? `7-day avg ${hm(summary.avgSleep)} per day` : 'Building a weekly average'}</small></div>
    <div class="frankie-tile"><span>Bottles today</span><strong>${oz(summary.today.bottles?.ounces)}</strong><small>${summary.today.bottles?.count || 0} bottle${summary.today.bottles?.count === 1 ? '' : 's'}${lastBottle ? ` · last ${esc(ago(lastBottle.start, now))} ago` : ''}</small></div>
    <div class="frankie-tile"><span>Daily average</span><strong>${oz(summary.avgOunces)}</strong><small>${change == null ? 'last 7 full days' : change === 0 ? 'same as the week before' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)} oz vs the week before`}</small></div>`);
  const week = frankieAwards({ sleeps, bottles }, timezone, now);
  if ($('frankieAwards')) {
    renderHTML($('frankieAwards'), week.awards.length ? week.awards.map(award => `<article class="award"><span class="award-icon" aria-hidden="true">${award.icon}</span><div><small>${esc(award.title)}</small><strong>${esc(award.value)}</strong><span>${esc(award.detail)}</span></div></article>`).join('') : '<p class="tiny muted">Awards appear after a few days of logs.</p>');
    $('frankieAwardsRange').textContent = week.awards.length ? `${dayLabel(week.from, timezone)} – ${dayLabel(week.to, timezone)}` : '';
  }
  const score = scorePredictions(predictions, sleeps, timer, timezone);
  renderHTML($('frankieScore'), scoreboard(score, timezone));
  const width = id => Math.max(280, Math.round($(id).clientWidth || 720));
  renderHTML($('frankieTimeline'), timeline(timelineRows(sleeps, timezone, 14, now), timezone, width('frankieTimeline')) + legend([['night', 'Night sleep'], ['nap', 'Nap']]));
  const sleepRows = dailySleep(sleeps, timezone, range, now), bottleRows = dailyBottles(bottles, timezone, range, now);
  const shown = Math.min(range, snapshot.historyDays || range);
  renderHTML($('frankieSleep'), sleepChart(sleepRows.slice(-shown), timezone, width('frankieSleep')) + legend([['night', 'Night'], ['nap', 'Naps']])
    + table('Daily sleep', ['Day', 'Night', 'Naps', 'Total', 'Nap count'], [...sleepRows.slice(-shown)].reverse().map(r => [esc(dayLabel(r.key, timezone)), hm(r.night), hm(r.nap), hm(r.total), r.naps])));
  renderHTML($('frankieBottles'), bottleChart(bottleRows.slice(-shown), timezone, summary.avgOunces, width('frankieBottles'))
    + table('Bottle ounces per day', ['Day', 'Ounces', 'Bottles'], [...bottleRows.slice(-shown)].reverse().map(r => [esc(dayLabel(r.key, timezone)), oz(r.ounces), r.count])));
  document.querySelectorAll('[data-frankie-range]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.frankieRange) === range)));
  $('frankieNote').textContent = `${demo ? 'Sample data · ' : ''}${snapshot.historyComplete === false || snapshot.feedsComplete === false ? 'Some older history was too long to load in full. ' : ''}Up to ${snapshot.historyDays || 14} days from Huckleberry · ${timezone.replaceAll('_', ' ')}.`;
}

export function initFrankie(rerender) {
  document.querySelectorAll('[data-frankie-range]').forEach(button => button.addEventListener('click', () => {
    range = Number(button.dataset.frankieRange); try { localStorage.setItem('hh_frankie_range', String(range)); } catch { /* optional */ }
    rerender();
  }));
  // One tooltip for every chart: hover on desktop, tap on touch screens.
  const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.setAttribute('role', 'status'); tip.hidden = true; document.body.append(tip);
  const show = (target, x, y) => {
    const [title, ...lines] = target.dataset.tip.split('|');
    tip.innerHTML = `<strong>${esc(title)}</strong>${lines.map(line => `<span>${esc(line)}</span>`).join('')}`; tip.hidden = false;
    const box = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - box.width - 8, Math.max(8, x - box.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - box.height - 14)}px`;
    document.querySelectorAll('.is-hovered').forEach(el => el.classList.remove('is-hovered')); target.classList.add('is-hovered');
  };
  const hide = () => { tip.hidden = true; document.querySelectorAll('.is-hovered').forEach(el => el.classList.remove('is-hovered')); };
  const root = $('view-frankie');
  root?.addEventListener('pointermove', e => { const target = e.target.closest?.('[data-tip]'); if (target) show(target, e.clientX, e.clientY); else hide(); });
  root?.addEventListener('pointerleave', hide);
  root?.addEventListener('click', e => { const target = e.target.closest?.('[data-tip]'); if (target) show(target, e.clientX, e.clientY); });
  window.addEventListener('scroll', hide, { passive:true });
  document.addEventListener('pointerdown', event => { if (!event.target.closest?.('[data-tip]')) hide(); });
  window.addEventListener('hashchange', hide);
  // Charts are drawn at their real pixel width so text stays the same size.
  let lastWidth = 0, pending;
  if ('ResizeObserver' in window) new ResizeObserver(entries => { const next = Math.round(entries[0].contentRect.width); if (!next || Math.abs(next - lastWidth) < 8) return; lastWidth = next; clearTimeout(pending); pending = setTimeout(rerender, 120); }).observe(root);
}
