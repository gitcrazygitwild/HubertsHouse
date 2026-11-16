// Smart-calendar upgrades: natural-language quick add, the ⌘K command palette,
// the live Now & Next line and weather-aware plan flags.
import { escapeHTML as esc, dateKey } from './household-model.js';
import { renderHTML } from './dom.js';
import { parseQuickAdd, describeDraft } from './quick-add.js';
import { weatherFlags, nextUp, untilText } from './smart-home.js';
import { freeEvenings, dateNightDraft } from './free-nights.js';
import { skyState, skyArt } from './sky.js';

const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };
const clock = date => new Date(date).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
const dayName = date => new Date(date).toLocaleDateString([], { weekday:'short' });
let ctx, baby = null, forecast = null, lastFlags = [];

// ---------- Quick add ----------
function draftPayload(draft) {
  return { mode:'create', title:draft.title, start:draft.start, end:draft.end, allDay:draft.allDay, owner:draft.owner, withFrankie:draft.withFrankie, type:draft.type, repeat:'none', notes:'', checklist:[] };
}
function initQuickAdd() {
  const form = $('quickAddForm'), input = $('quickAddInput'), preview = $('quickAddPreview');
  const update = () => {
    const draft = parseQuickAdd(input.value);
    preview.textContent = input.value.trim() ? draft ? `↵ ${describeDraft(draft)}` : 'Add a day or time — “Fri 7pm”, “tomorrow”, “Dec 5”, “next Tuesday at 3”…' : '';
    preview.dataset.ready = String(!!draft);
  };
  input.addEventListener('input', update);
  form.addEventListener('submit', event => {
    event.preventDefault(); const draft = parseQuickAdd(input.value);
    if (!draft) { update(); input.focus(); return; }
    ctx.openDraft(draftPayload(draft)); input.value = ''; update();
  });
}

// ---------- Command palette ----------
function score(text, query) {
  const t = text.toLowerCase(), q = query.toLowerCase().trim();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length / 100;
  const i = t.indexOf(q); if (i >= 0) return 60 - i;
  let p = 0; for (const ch of q) { p = t.indexOf(ch, p); if (p < 0) return 0; p++; }
  return 10;
}
function paletteItems(query) {
  const q = query.trim(), items = [];
  const draft = q ? parseQuickAdd(q) : null;
  if (draft) items.push({ group:'Create', icon:'✨', label:`Add “${draft.title}”`, hint:describeDraft(draft).split(' · ').slice(1).join(' · '), run:() => ctx.openDraft(draftPayload(draft)), boost:200 });
  for (const action of ctx.actions()) items.push({ group:action.group || 'Actions', ...action });
  const now = new Date(), horizon = +now + 60 * 86400000;
  const events = ctx.getEvents().filter(event => new Date(event.end || event.start) >= now && new Date(event.start) <= horizon)
    .sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 200);
  for (const event of events) items.push({ group:'Upcoming plans', icon:'◷', label:event.title, hint:`${new Date(event.start).toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' })}${event.allDay ? '' : ` · ${clock(event.start)}`}`, run:() => ctx.openEvent(event.extendedProps?.sourceId || event.id, new Date(event.start).toISOString()), eventOnly:true });
  if (q && !draft) {
    items.push({ group:'Create', icon:'🛒', label:`Add “${q}” to groceries`, run:() => ctx.addGrocery(q), boost:-5 });
    items.push({ group:'Search', icon:'⌕', label:`Search the calendar for “${q}”`, run:() => ctx.searchCalendar(q), boost:-6 });
  }
  return items.map(item => ({ ...item, rank:(item.eventOnly && !q ? 0 : score(`${item.label} ${item.keywords || ''}`, q)) + (item.boost || 0) }))
    .filter(item => item.rank > 0 || (!q && item.eventOnly)).sort((a, b) => b.rank - a.rank).slice(0, q ? 12 : 14);
}
function initPalette() {
  const dialog = $('paletteDialog'), input = $('paletteInput'), list = $('paletteList');
  let items = [], active = 0;
  const render = () => {
    items = paletteItems(input.value); active = Math.min(active, Math.max(0, items.length - 1));
    let group = '';
    renderHTML(list, items.length ? items.map((item, i) => `${item.group !== group ? `<li class="palette-group" role="presentation">${esc(group = item.group)}</li>` : ''}<li role="option" id="palette-${i}" aria-selected="${i === active}" data-index="${i}" class="palette-item"><span class="palette-icon" aria-hidden="true">${esc(item.icon || '•')}</span><span class="palette-label">${esc(item.label)}</span>${item.hint ? `<span class="palette-hint">${esc(item.hint)}</span>` : ''}</li>`).join('') : '<li class="palette-empty">No matches. Try a plan like “Brunch Sun 11am”.</li>');
    input.setAttribute('aria-activedescendant', items.length ? `palette-${active}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block:'nearest' });
  };
  const run = index => { const item = items[index]; if (!item) return; dialog.close(); setTimeout(() => item.run(), 30); };
  const open = () => { if (!ctx.unlocked() || dialog.open) return; input.value = ''; active = 0; render(); dialog.showModal(); input.focus(); };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % Math.max(1, items.length); render(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); render(); }
    else if (event.key === 'Enter') { event.preventDefault(); run(active); }
  });
  list.addEventListener('click', event => { const item = event.target.closest('[data-index]'); if (item) run(Number(item.dataset.index)); });
  list.addEventListener('pointermove', event => { const item = event.target.closest('[data-index]'); if (item && Number(item.dataset.index) !== active) { active = Number(item.dataset.index); list.querySelectorAll('[aria-selected]').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.index) === active))); } });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); dialog.open ? dialog.close() : open(); }
  });
  $('paletteButton')?.addEventListener('click', open);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll('[data-mod-key]').forEach(el => { el.textContent = mac ? '⌘' : 'Ctrl'; });
}

// ---------- Now & Next ----------
// One quiet line under the page title: the next plan, Frankie, and rain.
function renderNowNext() {
  const root = $('nowNext'); if (!root) return;
  const now = new Date(), events = ctx.getEvents(), parts = [];
  const eventLink = (event, from, label) => `<button type="button" class="nn-link" data-nn-event="${esc(event.extendedProps?.sourceId || event.id)}" data-nn-occ="${esc(from.toISOString())}">${label}</button>`;
  const { current, next } = nextUp(events, now);
  if (current) parts.push(`<span class="nn-item"><span class="nn-live" aria-hidden="true"></span>${eventLink(current.event, current.from, `Now: <strong>${esc(current.event.title)}</strong>`)} <span class="nn-muted">${current.minutesLeft}m left</span></span>`);
  if (next) parts.push(`<span class="nn-item"><span aria-hidden="true">◷</span>${eventLink(next.event, next.from, `Next: <strong>${esc(next.event.title)}</strong>`)} <span class="nn-muted">${esc(next.minutesUntil < 1440 ? clock(next.from) : `${dayName(next.from)} ${clock(next.from)}`)} · ${esc(untilText(next.minutesUntil))}</span></span>`);
  if (baby) {
    const minutes = stamp => Math.max(0, Math.round((+now - Date.parse(stamp)) / 60000)), hm = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    const status = baby.timer?.active ? `asleep ${hm(minutes(baby.timer.start))}` : baby.lastWake ? `awake ${hm(minutes(baby.lastWake))}` : 'no sleep logged';
    const nap = !baby.timer?.active && baby.mia?.available ? ` · nap ~${clock(baby.mia.target)}` : '';
    parts.push(`<span class="nn-item"><span aria-hidden="true">${baby.timer?.active ? '☾' : '☀'}</span><button type="button" class="nn-link" data-nn-view="frankie">${esc(baby.name)} <strong>${esc(status)}</strong></button><span class="nn-muted">${esc(nap)}${baby.lastBottle ? ` · bottle ${esc(hm(minutes(baby.lastBottle)))} ago` : ''}</span></span>`);
  }
  const flags = forecast ? weatherFlags(events, forecast.days, now) : [];
  if (flags.length) parts.push(`<span class="nn-item"><span aria-hidden="true">☔</span>${eventLink({ id:flags[0].id }, new Date(flags[0].start), `<strong>${esc(flags[0].title)}</strong>`)} <span class="nn-muted">${esc(dayName(flags[0].start))} · ${flags[0].rain == null ? esc(flags[0].label) : `${flags[0].rain}% rain`}</span></span>`);
  renderHTML(root, parts.join(''));
  root.hidden = !parts.length;
  lastFlags = flags; markWeather(flags);
}
// ---------- Living sky ----------
function renderSky() {
  const card = document.querySelector('.welcome-card'); if (!card) return;
  const state = skyState(new Date(), forecast?.days?.[0]?.kind);
  if (card.dataset.sky === state.phase && card.dataset.weather === state.weather && card.querySelector('.sky-art')) return;
  card.dataset.sky = state.phase; card.dataset.weather = state.weather;
  card.querySelector('.sky-art')?.remove(); card.insertAdjacentHTML('afterbegin', skyArt(state));
  const greeting = $('skyGreeting'); if (greeting) greeting.textContent = `${state.greeting.toUpperCase()} · AT YOUR PACE`;
}
// ---------- Free nights ----------
function renderFreeNights() {
  const root = $('freeNights'); if (!root) return;
  const nights = freeEvenings(ctx.getEvents(), new Date());
  renderHTML(root, nights.length ? `<span class="free-label">Free nights</span>${nights.map(night => `<button type="button" data-free-night="${night.date.toISOString()}" title="Draft a date night">${esc(night.date.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' }))}</button>`).join('')}` : '<span class="free-label">No free evenings in the next two weeks</span>');
}
// Adds a small rain badge to matching plans on the home calendar.
function markWeather(flags) {
  const keys = new Set(flags.map(flag => `${flag.id}:${flag.date}`));
  document.querySelectorAll('[data-home-event]').forEach(el => {
    const key = `${el.dataset.homeEvent}:${dateKey(new Date(el.dataset.occurrence))}`, has = keys.has(key), badge = el.querySelector('.rain-badge');
    if (has && !badge) { const flag = flags.find(f => `${f.id}:${f.date}` === key); el.insertAdjacentHTML('beforeend', `<span class="rain-badge" title="${esc(flag.rain == null ? flag.label : `${flag.rain}% chance of rain`)}">☔ ${flag.rain == null ? 'rain' : `${flag.rain}%`}</span>`); }
    else if (!has && badge) badge.remove();
  });
}

export function initUpgrades(options) {
  ctx = options;
  initQuickAdd(); initPalette();
  $('nowNext').addEventListener('click', event => {
    const target = event.target.closest('[data-nn-event],[data-nn-view]'); if (!target) return;
    if (target.dataset.nnEvent) ctx.openEvent(target.dataset.nnEvent, target.dataset.nnOcc);
    else ctx.showView(target.dataset.nnView);
  });
  window.addEventListener('hh:baby', event => { baby = event.detail; renderNowNext(); });
  window.addEventListener('hh:forecast', event => { forecast = event.detail; renderNowNext(); renderSky(); });
  window.addEventListener('hh:events', () => requestAnimationFrame(() => { renderNowNext(); renderFreeNights(); }));
  $('freeNights')?.addEventListener('click', event => { const button = event.target.closest('[data-free-night]'); if (button) ctx.openDraft(dateNightDraft(new Date(button.dataset.freeNight))); });
  forecast = window.hhForecast || null;
  // Week navigation re-renders the home calendar; keep rain badges attached.
  const home = document.querySelector('.home-calendar'); let pending;
  if (home) new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(() => markWeather(lastFlags), 60); }).observe(home, { childList:true, subtree:true });
  setInterval(() => { if (document.visibilityState === 'visible') { renderNowNext(); renderSky(); } }, 30000);
  renderNowNext(); renderSky(); renderFreeNights();
}
