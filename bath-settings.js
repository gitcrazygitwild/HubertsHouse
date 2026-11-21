// Settings → Bath days: pick Frankie's bath nights (shared with the whole household).
// `store` is { subscribe(callback), save(days) }; the preview uses one kept in memory.
import { renderHTML } from './dom.js';
import { showNotice } from './household.js';
import { WEEKDAYS, bathDays, setBathDays, describeBathDays, nextBathDay } from './bath-days.js';

const $ = id => document.getElementById(id);
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, like a paper calendar
export function bathPanelHTML(days = bathDays(), now = new Date()) {
  const next = nextBathDay(now, days);
  return `<div class="bath-days" role="group" aria-label="Bath days">${ORDER.map(d => `<button type="button" class="bath-day" data-bath-day="${d}" aria-pressed="${days.includes(d)}" aria-label="${WEEKDAYS[d]}">${WEEKDAYS[d].slice(0, 3)}</button>`).join('')}</div>
    <p class="tiny muted bath-summary">${describeBathDays(days)}${next ? ` · next: <strong>${next.label === 'Tonight' ? 'tonight' : next.label === 'Tomorrow' ? 'tomorrow' : next.label}</strong>` : ''}. Shows as 🛁 on the calendar, on Today and in the morning email.</p>`;
}
export function memoryBathStore(initial = null) {
  let value = initial, listener;
  return { subscribe(cb) { listener = cb; cb(value); }, async save(days) { value = days; listener?.(value); } };
}
export function initBathDays({ store, onChange = () => {} } = {}) {
  const panel = $('bathPanel');
  if (!store) return;
  const draw = () => { if (panel) renderHTML(panel, bathPanelHTML()); };
  store.subscribe(value => { setBathDays(value); draw(); onChange(); });
  let saving = Promise.resolve();
  panel?.addEventListener('click', event => {
    const button = event.target.closest('[data-bath-day]'); if (!button) return;
    const day = Number(button.dataset.bathDay), next = bathDays().includes(day) ? bathDays().filter(d => d !== day) : [...bathDays(), day];
    setBathDays(next); draw(); onChange(); // show it right away; the saved copy follows
    saving = saving.then(() => store.save(bathDays())).catch(() => showNotice('Bath days couldn’t be saved. Check your connection and try again.'));
  });
}
