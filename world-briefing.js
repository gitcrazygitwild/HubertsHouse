// Today → "The world, briefly": top headlines, one good-news story, and a few big
// market and interest-rate numbers from the server's half-hourly cache
// (functions/briefing.js). Tap a number for its chart: 1W, 1M, 1Y, 5Y or All.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { renderHTML } from './dom.js';
import { briefingHTML, sampleBriefing, sampleMarketHistory, rangePoints, chartPanelHTML, dateLabel, fullValue } from './world-view.js';

const $ = id => document.getElementById(id);
const REFRESH = 30 * 60000;
export async function initWorldBriefing(app, { demo = false } = {}) {
  const root = $('worldBriefing'); if (!root) return;
  const call = demo || !app ? null : httpsCallable(getFunctions(app, config.functionsRegion), 'briefing', { timeout:60000 });
  const histories = new Map(); let current = null, open = null, range = '1Y', last = 0;
  const draw = () => {
    const panel = $('worldChart'); if (!panel || !open) return;
    const history = histories.get(open); if (!history) return;
    const points = rangePoints(history, range), width = Math.max(300, Math.round(panel.clientWidth || 640));
    panel.innerHTML = chartPanelHTML(history, range, points, width); panel.hidden = false;
    const svg = panel.querySelector('svg'), dot = svg.querySelector('.world-crosshair'), readout = panel.querySelector('.world-chart-readout');
    const [x0, w] = [Number(svg.dataset.x0), Number(svg.dataset.w)], t0 = points[0].t, t1 = points.at(-1).t;
    const geometry = svg.querySelector('.world-chart-line').getAttribute('d').split(/[ML]/).filter(Boolean).map(pair => pair.split(',').map(Number));
    const show = index => {
      const point = points[index], [px, py] = geometry[index];
      dot.setAttribute('visibility', 'visible'); dot.querySelector('line').setAttribute('x1', px); dot.querySelector('line').setAttribute('x2', px);
      dot.querySelector('circle').setAttribute('cx', px); dot.querySelector('circle').setAttribute('cy', py);
      readout.textContent = `${dateLabel(point, true)} · ${fullValue(point.v, history.kind)}`; svg.dataset.index = index;
    };
    const nearest = clientX => {
      const box = svg.getBoundingClientRect(), scale = box.width ? width / box.width : 1, t = t0 + ((clientX - box.left) * scale - x0) / w * (t1 - t0);
      let best = 0; points.forEach((point, i) => { if (Math.abs(point.t - t) < Math.abs(points[best].t - t)) best = i; }); return best;
    };
    svg.addEventListener('pointermove', e => show(nearest(e.clientX)));
    svg.addEventListener('pointerleave', () => { dot.setAttribute('visibility', 'hidden'); readout.textContent = `${dateLabel(points.at(-1), true)} · ${fullValue(points.at(-1).v, history.kind)}`; });
    svg.addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const i = Number(svg.dataset.index ?? points.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1); show(Math.max(0, Math.min(points.length - 1, i))); });
  };
  const openChart = async id => {
    const panel = $('worldChart'); if (!panel) return;
    root.querySelectorAll('[data-market]').forEach(tile => tile.setAttribute('aria-expanded', String(tile.dataset.market === id)));
    if (open === id) { open = null; panel.hidden = true; root.querySelectorAll('[data-market]').forEach(tile => tile.setAttribute('aria-expanded', 'false')); return; }
    open = id; panel.hidden = false;
    if (!histories.has(id)) {
      panel.innerHTML = '<p class="tiny muted">Loading the chart…</p>';
      try { histories.set(id, call ? (await call({ history:id })).data : sampleMarketHistory(current.markets.find(market => market.id === id))); }
      catch { if (open === id) panel.innerHTML = '<p class="tiny muted">That chart couldn’t load. Try again in a minute.</p>'; return; }
    }
    if (open === id) draw();
  };
  root.addEventListener('click', e => {
    const tile = e.target.closest('[data-market]'), pick = e.target.closest('[data-range]');
    if (tile) openChart(tile.dataset.market);
    else if (pick) { range = pick.dataset.range; draw(); }
    else if (e.target.closest('[data-chart-close]')) openChart(open);
  });
  let resize; window.addEventListener('resize', () => { clearTimeout(resize); resize = setTimeout(draw, 150); });
  const render = (briefing, options) => {
    current = briefing; renderHTML(root, briefingHTML(briefing, options));
    if (open) { root.querySelectorAll('[data-market]').forEach(tile => tile.setAttribute('aria-expanded', String(tile.dataset.market === open))); draw(); }
  };
  if (!call) { render(sampleBriefing(), { sample:true }); return; }
  const load = async () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < REFRESH) return;
    last = Date.now();
    try { render((await call()).data); }
    catch { if (!root.querySelector('.world-headlines')) renderHTML(root, '<p class="tiny muted">The news and markets briefing couldn’t load. It will try again shortly.</p>'); last = Date.now() - REFRESH + 5 * 60000; }
  };
  await load();
  setInterval(load, 5 * 60000); document.addEventListener('visibilitychange', load);
}
