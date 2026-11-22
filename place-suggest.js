// The event editor's Where box: suggestions while typing (places you've used before,
// then matching towns from Open-Meteo) and a live line showing the weather there.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';

// Places from earlier events that match what's typed (any word may start the match).
export function pastMatches(known = [], query = '', limit = 3) {
  const q = String(query).trim().toLowerCase();
  const list = [...new Set(known.map(k => String(k || '').trim()).filter(Boolean))];
  const hits = q ? list.filter(place => { const low = place.toLowerCase(); return low !== q && (low.startsWith(q) || low.includes(` ${q}`) || low.includes(`,${q}`) || low.includes(`\n${q}`)); }) : list;
  return hits.slice(0, limit).map(place => { const [first, ...rest] = place.split('\n'); return { label:first.trim(), detail:rest.join(', ').trim() || 'Used before', value:place, past:true }; });
}
// The part worth sending to a town search: the first line/part, and not a street address.
export function townQuery(text = '') {
  const first = String(text).split(/[\n,]/)[0].trim();
  return first.length >= 2 && !/^\d/.test(first) ? first : '';
}

export function initPlaceSuggest({ input, list, preview, search, known = () => [], previewText = () => '', delay = 250 } = {}) {
  if (!input || !list) return { refresh() {}, close() {} };
  let items = [], active = -1, timer = null, token = 0, previewTimer = null;
  const hint = preview?.textContent || '';
  const close = () => { list.hidden = true; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const draw = () => {
    if (!items.length || document.activeElement !== input) { close(); return; }
    renderHTML(list, items.map((item, i) => `<button type="button" id="placeOption${i}" class="place-option${i === active ? ' active' : ''}" role="option" aria-selected="${i === active}" data-index="${i}"><span aria-hidden="true">${item.past ? '🕘' : '📍'}</span><span><strong>${esc(item.label)}</strong><small>${esc(item.detail || '')}</small></span></button>`).join(''));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `placeOption${active}`); else input.removeAttribute('aria-activedescendant');
  };
  function refresh() {
    if (!preview) return;
    const text = previewText(input.value.trim());
    preview.textContent = text || hint;
    preview.classList.toggle('has-weather', !!text);
  }
  async function suggest() {
    const typed = input.value, mine = ++token, past = pastMatches(known(), typed);
    items = past; active = -1; draw();
    const q = townQuery(typed);
    if (!q || !search) return;
    const towns = await search(q).catch(() => []);
    if (mine !== token) return; // something newer was typed
    const values = new Set(past.map(p => p.value.toLowerCase()));
    items = [...past, ...towns.filter(t => !values.has(t.value.toLowerCase()) && t.value.toLowerCase() !== typed.trim().toLowerCase())].slice(0, 7);
    draw();
  }
  function pick(index) {
    const item = items[index]; if (!item) return;
    input.value = item.value; token++; close(); refresh();
    input.dispatchEvent(new Event('change', { bubbles:true }));
  }
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', list.id);
  input.addEventListener('input', () => {
    clearTimeout(timer); timer = setTimeout(suggest, delay);
    clearTimeout(previewTimer); previewTimer = setTimeout(refresh, 600);
  });
  input.addEventListener('focus', () => { if (!input.value.trim()) suggest(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', event => {
    if (list.hidden || !items.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % items.length; draw(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + items.length) % items.length; draw(); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(active); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  // pointerdown keeps the focus in the box, so blur doesn't close the list before the tap lands.
  list.addEventListener('pointerdown', event => event.preventDefault());
  list.addEventListener('click', event => { const option = event.target.closest('[data-index]'); if (option) pick(Number(option.dataset.index)); });
  return { refresh, close };
}
