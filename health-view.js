// Settings → Connections, and the quiet warning on Today when Huckleberry, Publix or the
// morning email stop working. `store` is { subscribe(callback) } with serviceHealth records.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { healthRows, healthAlerts } from './service-health-model.js';

const ICON = { ok:'✓', warning:'⚠', unknown:'·' };
export function healthPanelHTML(records = [], now = Date.now()) {
  return `<ul class="health-list">${healthRows(records, now).map(r => `<li class="health-${r.state}"><span class="health-icon" aria-hidden="true">${ICON[r.state]}</span><span><b>${esc(r.name)}</b><small>${esc(r.text)}</small></span></li>`).join('')}</ul>
    <p class="tiny muted">Checked every time Hubert’s House talks to them. A warning shows here, on Today and in the morning email once a problem lasts more than a few minutes.</p>`;
}
export function memoryHealthStore(records = []) { return { subscribe(cb) { cb(records); } }; }
export function initHealth({ store } = {}) {
  if (!store) return;
  let records = [];
  const draw = () => {
    const panel = document.getElementById('healthPanel'); if (panel) renderHTML(panel, healthPanelHTML(records));
    window.dispatchEvent(new CustomEvent('hh:health', { detail:healthAlerts(records) }));
  };
  store.subscribe(next => { records = (next || []).filter(Boolean); draw(); });
  setInterval(() => { if (document.visibilityState === 'visible' && records.length) draw(); }, 5 * 60000); // "since…" and the quiet period move on
}
