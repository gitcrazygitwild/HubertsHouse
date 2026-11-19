// PetLibro feeders on the Devices page and their Settings connection (functions/petlibro.js).
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { showNotice, showView } from './household.js';
import { renderHTML } from './dom.js';
import { feedersHTML, feederSettingsHTML, sampleFeeders } from './feeders-view.js';

const $ = id => document.getElementById(id);
const failure = e => e?.code === 'functions/not-found' ? 'The PetLibro service is still deploying. Try again in a few minutes.' : e?.message || 'PetLibro could not be reached.';

export function initFeeders(app, { demo = false } = {}) {
  const panel = $('feederPanel'), settings = $('feederSettingsPanel'), view = $('view-devices');
  if (!panel && !settings) return;
  const call = demo || !app ? null : httpsCallable(getFunctions(app, config.functionsRegion), 'petLibro', { timeout:90000 });
  let state = demo ? sampleFeeders() : { loading:true }, status = demo ? { connected:true, connectedAt:'2026-11-01T12:00:00Z' } : null, last = 0, timer = null, busy = false;
  const draw = () => {
    if (panel) renderHTML(panel, feedersHTML(state));
    if (settings) renderHTML(settings, feederSettingsHTML(status, { demo }));
    const low = (state?.feeders || []).filter(feeder => feeder.foodLow || feeder.dispenserBlocked);
    window.dispatchEvent(new CustomEvent('hh:feeders', { detail:low.length ? { name:low[0].name, blocked:low[0].dispenserBlocked, more:low.length - 1 } : null }));
  };
  async function refresh(force = false) {
    if (!call || (!force && Date.now() - last < 60000)) return; last = Date.now();
    try {
      status = (await call({ action:'status' })).data;
      state = status.connected && !status.needsReconnect ? (await call({ action:'snapshot', force })).data : { connected:false };
    } catch (e) { state = { connected:true, error:failure(e) }; if (e?.code === 'functions/unauthenticated') status = { connected:true, needsReconnect:true }; }
    draw();
  }
  (panel?.closest('section') || panel)?.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.go) { showView(button.dataset.go); return; }
    if (button.hasAttribute('data-feeder-refresh')) { state = { loading:true }; draw(); refresh(true); return; }
    if (button.dataset.feederFeed) {
      const feeder = state.feeders?.find(item => item.id === button.dataset.feederFeed), portions = Number(panel.querySelector(`[data-feeder-portions="${CSS.escape(button.dataset.feederFeed)}"]`)?.value || 1);
      if (!feeder || !confirm(`Dispense ${portions} portion${portions === 1 ? '' : 's'} from ${feeder.name} now?`)) return;
      if (demo) { showNotice(`${feeder.name} is serving ${portions} portion${portions === 1 ? '' : 's'} (preview).`); return; }
      if (busy) return; busy = true; button.disabled = true;
      try { const result = (await call({ action:'feed', feederId:feeder.id, portions })).data; showNotice(`${result.name} is serving ${result.portions} portion${result.portions === 1 ? '' : 's'}. 🐟`); setTimeout(() => refresh(true), 8000); }
      catch (e) { showNotice(failure(e)); } finally { busy = false; if (button.isConnected) button.disabled = false; }
    }
  });
  settings?.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.go) { showView(button.dataset.go); return; }
    if (!button.hasAttribute('data-feeder-disconnect') || !call || busy || !confirm('Disconnect PetLibro from Hubert’s House?')) return;
    busy = true;
    try { await call({ action:'disconnect' }); status = { connected:false }; state = { connected:false }; draw(); showNotice('PetLibro disconnected.'); }
    catch (e) { showNotice(failure(e)); } finally { busy = false; }
  });
  settings?.addEventListener('submit', async event => {
    if (event.target.id !== 'feederForm') return; event.preventDefault();
    if (!call || busy) return; busy = true;
    const form = event.target, button = form.querySelector('button[type=submit]'), data = new FormData(form); button.disabled = true; button.textContent = 'Connecting…';
    try {
      const result = (await call({ action:'connect', email:data.get('email'), password:data.get('password') })).data;
      form.reset(); status = { connected:true, connectedAt:new Date().toISOString() }; state = result; last = Date.now(); draw();
      showNotice(`PetLibro connected: ${result.feeders.length} device${result.feeders.length === 1 ? '' : 's'}. 🐟`);
    } catch (e) { showNotice(failure(e)); if (button.isConnected) { button.disabled = false; button.textContent = 'Connect PetLibro'; } }
    finally { busy = false; }
  });
  draw();
  if (!call) return;
  const visible = () => view && !view.classList.contains('hidden') && document.visibilityState === 'visible';
  const watch = () => { clearInterval(timer); if (visible()) { refresh(); timer = setInterval(() => { if (visible()) refresh(true); }, 3 * 60000); } };
  if (view) new MutationObserver(watch).observe(view, { attributes:true, attributeFilter:['class'] });
  document.addEventListener('visibilitychange', watch);
  refresh(true);
}
