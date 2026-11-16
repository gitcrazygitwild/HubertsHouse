// Smart-calendar upgrades: natural-language quick add, the ⌘K command palette,
// the live Now & Next strip, weather-aware plan flags and the cat crew tracker.
import { escapeHTML as esc, dateKey } from './household-model.js';
import { renderHTML } from './dom.js';
import { parseQuickAdd, describeDraft } from './quick-add.js';
import { weatherFlags, nextUp, untilText, catCareStatus, CAT_TASKS, CATS } from './smart-home.js';
import { cats, portrait } from './cat-crew.js';

const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };
const clock = date => new Date(date).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
const dayName = date => new Date(date).toLocaleDateString([], { weekday:'short' });
let ctx, baby = null, forecast = null, care = {}, careDay = '', careUnsub = null, lastFlags = [];

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
function renderNowNext() {
  const root = $('nowNext'); if (!root) return;
  const now = new Date(), events = ctx.getEvents(), chips = [];
  const { current, next } = nextUp(events, now);
  if (current) chips.push(`<button type="button" class="nn-chip nn-now" data-nn-event="${esc(current.event.extendedProps?.sourceId || current.event.id)}" data-nn-occ="${esc(current.from.toISOString())}"><span class="nn-dot" aria-hidden="true"></span><span><small>Happening now</small><strong>${esc(current.event.title)}</strong></span><em>${current.minutesLeft}m left</em></button>`);
  if (next) chips.push(`<button type="button" class="nn-chip" data-nn-event="${esc(next.event.extendedProps?.sourceId || next.event.id)}" data-nn-occ="${esc(next.from.toISOString())}"><span class="nn-icon" aria-hidden="true">◷</span><span><small>Next up · ${esc(next.minutesUntil < 1440 ? clock(next.from) : `${dayName(next.from)} ${clock(next.from)}`)}</small><strong>${esc(next.event.title)}</strong></span><em>${esc(untilText(next.minutesUntil))}</em></button>`);
  else if (!current) chips.push('<div class="nn-chip"><span class="nn-icon" aria-hidden="true">✳</span><span><small>Next up</small><strong>Nothing on the calendar this week</strong></span></div>');
  if (baby) {
    const minutes = stamp => Math.max(0, Math.round((+now - Date.parse(stamp)) / 60000)), hm = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    const status = baby.timer?.active ? `Asleep ${hm(minutes(baby.timer.start))}` : baby.lastWake ? `Awake ${hm(minutes(baby.lastWake))}` : 'No sleep logged';
    const window = baby.mia?.available ? `Mia: ${clock(baby.mia.start)}–${clock(baby.mia.end)}` : baby.purr?.available ? `Purrfect: ${clock(baby.purr.start)}–${clock(baby.purr.end)}` : '';
    chips.push(`<button type="button" class="nn-chip nn-baby" data-nn-view="frankie"><span class="nn-icon" aria-hidden="true">${baby.timer?.active ? '☾' : '☀'}</span><span><small>${esc(baby.name)}${window ? ` · ${esc(window)}` : ''}</small><strong>${esc(status)}</strong></span>${baby.lastBottle ? `<em>🍼 ${esc(hm(minutes(baby.lastBottle)))} ago</em>` : ''}</button>`);
  }
  const flags = forecast ? weatherFlags(events, forecast.days, now) : [];
  if (flags.length) chips.push(`<button type="button" class="nn-chip nn-weather" data-nn-event="${esc(flags[0].id)}" data-nn-occ="${esc(flags[0].start)}"><span class="nn-icon" aria-hidden="true">☔</span><span><small>${esc(dayName(flags[0].start))} · ${flags[0].rain == null ? esc(flags[0].label) : `${flags[0].rain}% rain`}</small><strong>${esc(flags[0].title)}</strong></span><em>${flags.length > 1 ? `+${flags.length - 1} more` : 'plan B?'}</em></button>`);
  const cat = catCareStatus(care, now);
  chips.push(`<button type="button" class="nn-chip nn-cats" data-nn-scroll="catCare"><span class="nn-icon" aria-hidden="true">🐾</span><span><small>Cat crew · ${cat.done}/${cat.total}</small><strong>${cat.hungry.length ? `${esc(cat.hungry.length > 1 ? `${cat.hungry.slice(0, -1).join(', ')} & ${cat.hungry.at(-1)}` : cat.hungry[0])} ${cat.hungry.length === 1 ? 'is' : 'are'} waiting` : cat.complete ? 'All taken care of' : 'Fed and happy'}</strong></span></button>`);
  renderHTML(root, chips.join(''));
  lastFlags = flags; markWeather(flags);
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

// ---------- Cat crew tracker ----------
const OWNER_LABEL = { hanry:'hanry', karena:'Karena', '':'' };
function renderCatCare() {
  const root = $('catCareGrid'); if (!root) return;
  const status = catCareStatus(care), tile = task => {
    const done = care[task.key];
    return `<button type="button" class="cat-task${done ? ' is-done' : ''}" data-cat-task="${task.key}" aria-pressed="${!!done}"><span class="cat-task-label">${task.icon ? `<span aria-hidden="true">${task.icon}</span> ` : ''}${esc(task.label)}</span><span class="cat-task-meta">${done ? `✓ ${esc([OWNER_LABEL[done.by] || '', clock(done.at)].filter(Boolean).join(' · '))}` : 'Tap when done'}</span></button>`;
  };
  renderHTML(root, CATS.map(name => {
    const cat = cats.find(c => c.name === name), tasks = CAT_TASKS.filter(task => task.cat === name);
    return `<div class="cat-care-col"><div class="cat-care-name">${portrait(cat)}<strong>${esc(name)}</strong></div>${tasks.map(tile).join('')}</div>`;
  }).join('') + `<div class="cat-care-col cat-care-house"><div class="cat-care-name"><span class="cat-care-house-icon" aria-hidden="true">🏠</span><strong>The house</strong></div>${CAT_TASKS.filter(task => !task.cat).map(tile).join('')}</div>`);
  $('catCareProgress').textContent = `${status.done} of ${status.total} done today`;
  $('catCareProgressBar').style.width = `${Math.round(100 * status.done / status.total)}%`;
  renderNowNext();
}
function watchCatDay() {
  const today = dateKey(new Date());
  if (today === careDay) return;
  careDay = today; careUnsub?.(); care = {};
  careUnsub = ctx.catStore.subscribe(today, record => { care = record || {}; renderCatCare(); });
}
function initCatCare() {
  const owner = $('deviceOwner'); owner.value = read('hh_device_owner') || '';
  owner.addEventListener('change', () => write('hh_device_owner', owner.value));
  $('catCareGrid').addEventListener('click', async event => {
    const button = event.target.closest('[data-cat-task]'); if (!button || button.disabled) return;
    const key = button.dataset.catTask, value = care[key] ? null : { by:read('hh_device_owner') || '', at:new Date().toISOString() };
    button.disabled = true;
    try { await ctx.catStore.set(careDay, key, value); } catch { ctx.notice('The cat crew could not sync. Try again.'); } finally { button.disabled = false; }
  });
  watchCatDay();
}

export function initUpgrades(options) {
  ctx = options;
  initQuickAdd(); initPalette(); initCatCare();
  $('nowNext').addEventListener('click', event => {
    const target = event.target.closest('[data-nn-event],[data-nn-view],[data-nn-scroll]'); if (!target) return;
    if (target.dataset.nnEvent) ctx.openEvent(target.dataset.nnEvent, target.dataset.nnOcc);
    else if (target.dataset.nnView) ctx.showView(target.dataset.nnView);
    else $(target.dataset.nnScroll)?.scrollIntoView?.({ behavior:'smooth', block:'center' });
  });
  window.addEventListener('hh:baby', event => { baby = event.detail; renderNowNext(); });
  window.addEventListener('hh:forecast', event => { forecast = event.detail; renderNowNext(); });
  window.addEventListener('hh:events', () => requestAnimationFrame(renderNowNext));
  forecast = window.hhForecast || null;
  // Week navigation re-renders the home calendar; keep rain badges attached.
  const home = document.querySelector('.home-calendar'); let pending;
  if (home) new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(() => markWeather(lastFlags), 60); }).observe(home, { childList:true, subtree:true });
  setInterval(() => { if (document.visibilityState === 'visible') { watchCatDay(); renderNowNext(); } }, 30000);
  renderNowNext();
}
