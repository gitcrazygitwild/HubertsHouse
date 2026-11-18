// Litter-Robot on the Devices page and its Settings connection (functions/litter-robot.js).
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { showNotice, showView } from './household.js';
import { renderHTML } from './dom.js';
import { litterHTML, litterSettingsHTML, sampleLitter } from './litter-view.js';

const $ = id => document.getElementById(id);
const failure = e => e?.code === 'functions/not-found' ? 'The Litter-Robot service is still deploying. Try again in a few minutes.' : e?.message || 'Whisker could not be reached.';

export function initLitter(app, { demo = false } = {}) {
  const panel = $('litterPanel'), settings = $('litterSettingsPanel'), view = $('view-devices');
  if (!panel && !settings) return;
  const call = demo || !app ? null : httpsCallable(getFunctions(app, config.functionsRegion), 'litterRobot', { timeout:90000 });
  let state = demo ? sampleLitter() : { loading:true }, status = demo ? { connected:true, connectedAt:'2026-11-01T12:00:00Z' } : null, last = 0, timer = null, busy = false;
  const draw = () => {
    if (panel) renderHTML(panel, litterHTML(state));
    if (settings) renderHTML(settings, litterSettingsHTML(status, { demo }));
    const robot = state?.robots?.[0];
    window.dispatchEvent(new CustomEvent('hh:litter', { detail:robot && (robot.drawerFull || robot.drawer >= 90) ? { name:robot.name, full:robot.drawerFull, drawer:robot.drawer } : null }));
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
    if (button.hasAttribute('data-litter-refresh')) { state = { loading:true }; draw(); refresh(true); return; }
    if (button.dataset.litterClean) {
      const robot = state.robots?.find(item => item.id === button.dataset.litterClean);
      if (!robot || !confirm(`Start a clean cycle on ${robot.name}? Make sure no cat is inside.`)) return;
      if (demo) { showNotice(`${robot.name} is cleaning (preview).`); return; }
      if (busy) return; busy = true; button.disabled = true;
      try { const result = (await call({ action:'clean', robotId:robot.id })).data; showNotice(`${result.name} is cleaning.`); setTimeout(() => refresh(true), 5000); }
      catch (e) { showNotice(failure(e)); } finally { busy = false; if (button.isConnected) button.disabled = false; }
    }
  });
  settings?.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.go) { showView(button.dataset.go); return; }
    if (!button.hasAttribute('data-litter-disconnect') || !call || busy || !confirm('Disconnect Litter-Robot from Hubert’s House?')) return;
    busy = true;
    try { await call({ action:'disconnect' }); status = { connected:false }; state = { connected:false }; draw(); showNotice('Litter-Robot disconnected.'); }
    catch (e) { showNotice(failure(e)); } finally { busy = false; }
  });
  settings?.addEventListener('submit', async event => {
    if (event.target.id !== 'litterForm') return; event.preventDefault();
    if (!call || busy) return; busy = true;
    const form = event.target, button = form.querySelector('button[type=submit]'), data = new FormData(form); button.disabled = true; button.textContent = 'Connecting…';
    try {
      const result = (await call({ action:'connect', email:data.get('email'), password:data.get('password') })).data;
      form.reset(); status = { connected:true, connectedAt:new Date().toISOString() }; state = result; last = Date.now(); draw();
      showNotice(`Litter-Robot connected: ${result.robots.length} robot${result.robots.length === 1 ? '' : 's'}, ${result.cats.length} cat${result.cats.length === 1 ? '' : 's'}. 🐈`);
    } catch (e) { showNotice(failure(e)); if (button.isConnected) { button.disabled = false; button.textContent = 'Connect Litter-Robot'; } }
    finally { busy = false; }
  });
  draw();
  if (!call) return;
  const visible = () => view && !view.classList.contains('hidden') && document.visibilityState === 'visible';
  const watch = () => { clearInterval(timer); if (visible()) { refresh(); timer = setInterval(() => { if (visible()) refresh(true); }, 3 * 60000); } };
  if (view) new MutationObserver(watch).observe(view, { attributes:true, attributeFilter:['class'] });
  document.addEventListener('visibilitychange', watch);
  refresh(true); // once at start, for Settings and the drawer-full heads-up
}
