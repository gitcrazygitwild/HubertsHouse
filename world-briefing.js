// Today → "The world, briefly": top headlines and a few big market and interest-rate
// numbers, from the server's half-hourly cache (functions/briefing.js).
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { marketValue, marketChange, marketDate } from './briefing-format.js';

const $ = id => document.getElementById(id);
const REFRESH = 30 * 60000;
const ago = (value, now) => { const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60000)); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)}h ago`; };

export function briefingHTML(briefing, { now = Date.now(), sample = false } = {}) {
  const markets = briefing.markets || [], headlines = briefing.headlines || [];
  const tiles = markets.map(market => {
    const change = marketChange(market);
    return `<div class="world-market"><span>${esc(market.name)}</span><strong>${esc(marketValue(market))}</strong><small class="move-${change.tone}">${esc(change.text || ' ')}</small><small class="world-asof">${esc(marketDate(market.date))}</small></div>`;
  }).join('');
  const list = headlines.map(item => `<li><a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><span>${esc(item.source)}</span></li>`).join('');
  return `${tiles ? `<div class="world-markets" aria-label="Markets and rates">${tiles}</div>` : ''}
    ${list ? `<ol class="world-headlines">${list}</ol>` : '<p class="tiny muted">Headlines are unavailable right now.</p>'}
    <p class="tiny muted world-footer">${sample ? 'Sample headlines and numbers in this preview · ' : ''}Headlines from NPR and BBC World · markets and rates from FRED (St. Louis Fed), as of each date shown${briefing.fetchedAt ? ` · updated ${esc(ago(briefing.fetchedAt, now))}` : ''}${briefing.stale ? ' · couldn’t refresh, showing the last update' : ''}.</p>`;
}
export function sampleBriefing(now = Date.now()) {
  const day = new Date(now - 86400000).toISOString().slice(0, 10);
  const headline = (title, source, n) => ({ title, link:`https://example.com/sample-${n}`, source, published:new Date(now - n * 3600000).toISOString() });
  return { fetchedAt:new Date(now - 6 * 60000).toISOString(), headlines:[
    headline('Sample headline: city council approves new park downtown', 'NPR', 1), headline('Sample headline: leaders meet for climate talks', 'BBC World', 2),
    headline('Sample headline: storm expected to bring heavy rain this weekend', 'NPR', 3), headline('Sample headline: new trade agreement signed', 'BBC World', 4),
    headline('Sample headline: researchers report progress on vaccine', 'NPR', 5), headline('Sample headline: election results due later today', 'BBC World', 6)],
  markets:[{ id:'SP500', name:'S&P 500', kind:'index', value:6012.45, change:24.1, changePct:0.4, date:day }, { id:'DJIA', name:'Dow', kind:'index', value:44210.3, change:-88.2, changePct:-0.2, date:day },
    { id:'NASDAQCOM', name:'Nasdaq', kind:'index', value:19480.12, change:140.6, changePct:0.73, date:day }, { id:'DGS10', name:'10-yr Treasury', kind:'rate', value:4.21, change:-0.03, changePct:null, date:day },
    { id:'DFF', name:'Fed funds', kind:'rate', value:4.33, change:0, changePct:null, date:day }, { id:'MORTGAGE30US', name:'30-yr mortgage', kind:'rate', value:6.84, change:0.05, changePct:null, date:day }] };
}
export async function initWorldBriefing(app, { demo = false } = {}) {
  const root = $('worldBriefing'); if (!root) return;
  if (demo || !app) { renderHTML(root, briefingHTML(sampleBriefing(), { sample:true })); return; }
  const call = httpsCallable(getFunctions(app, config.functionsRegion), 'briefing', { timeout:60000 });
  let last = 0;
  const load = async () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < REFRESH) return;
    last = Date.now();
    try { renderHTML(root, briefingHTML((await call()).data)); }
    catch { if (!root.querySelector('.world-headlines')) renderHTML(root, '<p class="tiny muted">The news and markets briefing couldn’t load. It will try again shortly.</p>'); last = Date.now() - REFRESH + 5 * 60000; }
  };
  await load();
  setInterval(load, 5 * 60000); document.addEventListener('visibilitychange', load);
}
