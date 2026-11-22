// Settings → Trash & recycling: which weekday, how often, and the holiday rule (shared with
// the whole household). `store` is { subscribe(callback), save(trash) }; the preview keeps one in memory.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { showNotice } from './household.js';
import { trashSettings, setTrash, cleanTrash, nextPickup, pickupsInRange, describeTrash, PICKUP_LOOK } from './trash-days.js';

const $ = id => document.getElementById(id);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortDate = key => new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
function streamHTML(kind, s) {
  const x = s[kind], look = PICKUP_LOOK[kind];
  return `<fieldset class="trash-stream" data-trash-kind="${kind}"><legend>${look.icon} ${look.name}</legend>
    <label class="field"><span>Day</span><select data-trash-field="day">${DAYS.map((d, i) => `<option value="${i}"${i === x.day ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
    <label class="field"><span>How often</span><select data-trash-field="every"><option value="1"${x.every === 1 ? ' selected' : ''}>Every week</option><option value="2"${x.every === 2 ? ' selected' : ''}>Every other week</option><option value="0"${x.every === 0 ? ' selected' : ''}>No pickup</option></select></label>
    <label class="field"${x.every === 2 ? '' : ' hidden'}><span>A day it comes</span><input type="date" data-trash-field="anchor" value="${esc(x.anchor)}" /></label></fieldset>`;
}
export function trashPanelHTML(s = trashSettings(), now = new Date()) {
  const next = nextPickup(now, s), soon = pickupsInRange(now, new Date(+now + 29 * 86400000), s).slice(0, 4);
  return `<div class="trash-grid">${streamHTML('trash', s)}${streamHTML('recycling', s)}</div>
    <label class="check trash-bump"><input type="checkbox" data-trash-field="bump"${s.bump ? ' checked' : ''} /> After a big holiday (New Year’s, Memorial Day, July 4th, Labor Day, Thanksgiving, Christmas), move that pickup to the next workday</label>
    <p class="tiny muted trash-summary">${esc(describeTrash(s))}.${next ? ` Next: <strong>${esc(next.title)}</strong> ${esc(next.label === 'Today' || next.label === 'Tomorrow' ? next.label.toLowerCase() : shortDate(next.date))}.` : ''}</p>
    ${soon.length ? `<ul class="trash-soon">${soon.map(p => `<li><span>${esc(shortDate(p.date))}</span> ${esc(p.title)}${p.moved ? ` <small>moved from ${esc(shortDate(p.moved.from))} for ${esc(p.moved.holiday)}</small>` : ''}</li>`).join('')}</ul>` : ''}`;
}
export function memoryTrashStore(initial = null) {
  let value = initial, listener;
  return { subscribe(cb) { listener = cb; cb(value); }, async save(next) { value = next; listener?.(value); } };
}
export function initTrashDays({ store, onChange = () => {} } = {}) {
  const panel = $('trashPanel');
  if (!store) return;
  const draw = () => { if (panel) renderHTML(panel, trashPanelHTML()); };
  store.subscribe(value => { setTrash(value); draw(); onChange(); });
  let saving = Promise.resolve();
  panel?.addEventListener('change', event => {
    const field = event.target.closest('[data-trash-field]'); if (!field) return;
    const next = structuredClone(trashSettings()), kind = field.closest('[data-trash-kind]')?.dataset.trashKind, name = field.dataset.trashField;
    if (name === 'bump') next.bump = field.checked;
    else if (kind) next[kind][name] = name === 'anchor' ? field.value : Number(field.value);
    const clean = cleanTrash(next);
    setTrash(clean); draw(); onChange(); // show it right away; the saved copy follows
    saving = saving.then(() => store.save(clean)).catch(() => showNotice('Trash days couldn’t be saved. Check your connection and try again.'));
  });
}
