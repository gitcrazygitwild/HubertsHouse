// Smart-calendar upgrades: natural-language quick add, the ⌘K command palette,
// the live Now & Next line and weather-aware plan flags.
import { escapeHTML as esc, dateKey } from './household-model.js';
import { renderHTML } from './dom.js';
import { parseQuickAdd, describeDraft, parseBabyLog, describeBabyLog } from './quick-add.js';
import { weatherFlags, nextUp, untilText } from './smart-home.js';
import { birthdaysInRange, birthdaysShown } from './birthdays-model.js';
import { isBathDay } from './bath-days.js';
import { pickupOn } from './trash-days.js';
import { catsConsensus } from './baby-model.js';
import { freeEvenings, dateNightDraft } from './free-nights.js';
import { skyState, skyArt } from './sky.js';
import { answerQuestion, isQuestion } from './ask.js';

const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };
const clock = date => new Date(date).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
const dayName = date => new Date(date).toLocaleDateString([], { weekday:'short' });
let ctx, baby = null, forecast = null, litter = null, feeders = null, health = [], lastFlags = [], frankie = null;

// ---------- Quick add ----------
function draftPayload(draft) {
  return { mode:'create', title:draft.title, start:draft.start, end:draft.end, allDay:draft.allDay, owner:draft.owner, withFrankie:draft.withFrankie, type:draft.type, repeat:'none', notes:'', checklist:[] };
}
// ---------- Ask the house ----------
// Questions typed (or said) into the quick-add box or ⌘K get an answer from ask.js.
const askData = () => ({ now:new Date(), events:ctx.getEvents(), baby, frankie, forecast });
export function askHouse(text) { return isQuestion(text) ? answerQuestion(text, askData()) : null; }
const VIEW_NAMES = { frankie:'Frankie', calendar:'Calendar', settings:'Settings', today:'Today' };
export function speak(text, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  if (!synth || !Utterance) return false;
  synth.cancel(); const line = new Utterance(text.replace(/[🛁🎂]/gu, '')); line.lang = 'en-US'; line.rate = 1; synth.speak(line); return true;
}
function showAnswer(result, question, { say = false } = {}) {
  const box = $('askAnswer'); if (!box) return;
  const canSpeak = !!(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance);
  renderHTML(box, `<span class="ask-q">${esc(question)}</span><p class="ask-a">${esc(result.answer)}</p><div class="ask-actions">${canSpeak ? '<button type="button" class="btn" data-ask-speak>🔊 Read aloud</button>' : ''}${result.view && result.view !== 'today' ? `<button type="button" class="btn" data-ask-view="${esc(result.view)}">Open ${esc(VIEW_NAMES[result.view] || result.view)} →</button>` : ''}<button type="button" class="btn ask-close" data-ask-close aria-label="Close the answer">✕</button></div>`);
  box.hidden = false; box.dataset.answer = result.answer;
  if (say) speak(result.answer);
}
function initAsk() {
  const box = $('askAnswer'); if (!box) return;
  box.addEventListener('click', event => {
    if (event.target.closest('[data-ask-speak]')) speak(box.dataset.answer || '');
    else if (event.target.closest('[data-ask-view]')) ctx.showView(event.target.closest('[data-ask-view]').dataset.askView);
    else if (event.target.closest('[data-ask-close]')) { box.hidden = true; globalThis.speechSynthesis?.cancel(); }
  });
  window.addEventListener('hh:frankie', event => { frankie = event.detail || null; });
}

function initQuickAdd() {
  const form = $('quickAddForm'), input = $('quickAddInput'), preview = $('quickAddPreview'), submit = form.querySelector('[type="submit"]');
  // A question that has an answer wins (“how long has Frankie been awake?” is not a wake-up log), then Frankie logs (“frankie bottle 10:30am 4oz”), then calendar plans.
  const update = () => {
    const answer = askHouse(input.value), log = answer ? null : parseBabyLog(input.value), draft = log || answer ? null : parseQuickAdd(input.value);
    preview.textContent = !input.value.trim() ? '' : log ? `↵ ${describeBabyLog(log)}` : answer ? '↵ Ask Hubert’s House' : draft ? `↵ ${describeDraft(draft)}` : 'Add a day or time — “Fri 7pm”, “tomorrow”, “Dec 5” — log for Frankie: “4oz”, “wet”, “nap 1-2:15”, “down 7:40”, “up” — or ask: “what’s on Friday?”';
    preview.dataset.ready = String(!!(log || draft || answer));
    submit.textContent = answer ? 'Ask' : 'Add';
  };
  input.addEventListener('input', () => { delete input.dataset.voice; update(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const answer = askHouse(input.value), log = answer ? null : parseBabyLog(input.value), draft = log || answer ? null : parseQuickAdd(input.value);
    if (log) { if (ctx.logBaby(log) !== false) { input.value = ''; update(); } return; }
    // Asked out loud? Answer out loud too.
    if (answer) { showAnswer(answer, input.value.trim(), { say:input.dataset.voice === '1' }); input.value = ''; delete input.dataset.voice; update(); return; }
    if (!draft) { update(); input.focus(); return; }
    ctx.openDraft(draftPayload(draft)); input.value = ''; update();
  });
  initVoice(form, input, () => { input.dataset.voice = '1'; update(); }, undefined, { notice:ctx.notice || (() => {}) });
}
// Speak instead of typing (where the browser offers speech recognition, e.g. Safari
// and Chrome). The words land in the box with the usual preview; nothing is saved
// until Add is pressed. iPhone home-screen apps list speech recognition but Apple
// blocks it there, so in an installed iPhone app the mic opens the keyboard, whose own
// 🎤 dictation works. In a browser tab it always tries real voice input: a failure says
// exactly why and offers the keyboard for that try, but never locks the mic out (an
// earlier version remembered one failed try forever, e.g. a first-time permission prompt).
const OLD_DICTATION_KEY = 'hh_dictation';
export const dictationMode = ({ win = globalThis } = {}) => {
  const nav = win.navigator || {}, ios = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches;
  return ios && standalone ? 'keyboard' : 'speech';
};
const isIOS = win => { const nav = win.navigator || {}; return /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1); };
// What went wrong, in words, with what to do about it.
export function voiceProblem(error, { ios = false } = {}) {
  const keyboard = 'For now, tap the box and use the 🎤 on your keyboard.';
  if (error === 'not-allowed' || error === 'service-not-allowed') return ios
    ? `Safari isn’t letting this page listen. On iPhone, voice input needs Siri turned on (Settings → Siri), and the microphone allowed for this site (tap “aA” in the address bar → Website Settings → Microphone → Allow). ${keyboard}`
    : `The browser isn’t letting this page use the microphone. Allow it from the lock or site-settings icon next to the address, then try again. ${keyboard}`;
  if (error === 'audio-capture') return `No microphone was found. ${keyboard}`;
  if (error === 'network') return `Voice input needs an internet connection. ${keyboard}`;
  if (error === 'language-not-supported') return `Voice input isn’t available in English on this device. ${keyboard}`;
  return `Voice input stopped before it could listen. Tap 🎤 to try again. ${keyboard}`;
}
export function initVoice(form, input, update, Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, { notice = () => {}, win = globalThis, storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  if (form.querySelector('.smart-mic')) return null;
  try { storage?.removeItem?.(OLD_DICTATION_KEY); } catch {} // undo the old "locked to keyboard" flag
  const mode = Recognition ? dictationMode({ win }) : 'none', ios = isIOS(win);
  // Without speech recognition there's nothing a button adds on desktops; touch keyboards have their own mic.
  if (mode === 'none') return null;
  const mic = document.createElement('button');
  mic.type = 'button'; mic.className = 'btn smart-mic'; mic.textContent = '🎤';
  mic.setAttribute('aria-label', mode === 'keyboard' ? 'Dictate with the keyboard' : 'Say a plan or a Frankie log');
  mic.title = mode === 'keyboard' ? 'Opens the keyboard: tap its 🎤 to dictate' : 'Speak instead of typing';
  form.querySelector('[type="submit"]').before(mic);
  let listening = null;
  mic.addEventListener('click', () => {
    if (mode === 'keyboard') {
      // The tip goes inside the box: a notice at the bottom of the screen sits behind the keyboard.
      input.dataset.placeholder ||= input.placeholder;
      input.placeholder = 'Now tap 🎤 on the keyboard and talk';
      input.classList.add('is-dictating');
      const restore = () => { input.placeholder = input.dataset.placeholder || ''; input.classList.remove('is-dictating'); };
      input.addEventListener('blur', restore, { once:true });
      input.focus(); // inside the tap, so the phone opens its keyboard
      return;
    }
    if (listening) { listening.stop(); return; }
    input.dataset.placeholder ||= input.placeholder; // before it changes to “Listening…”
    const rec = new Recognition(), started = now(); listening = rec;
    let heard = false, failed = null;
    rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    mic.classList.add('is-listening'); mic.setAttribute('aria-pressed', 'true'); input.placeholder = 'Listening…';
    rec.onresult = event => { heard = true; input.value = [...event.results].map(result => result[0].transcript).join(' ').trim(); update(); };
    rec.onerror = event => { failed = event?.error || 'unknown'; };
    rec.onend = () => {
      listening = null; mic.classList.remove('is-listening'); mic.setAttribute('aria-pressed', 'false'); input.placeholder = input.dataset.placeholder || '';
      if (heard) { input.focus(); return; }
      if (failed === 'aborted') return;
      if (failed === 'no-speech' || (!failed && now() - started >= 1000)) return notice('Didn’t catch that. Tap 🎤 and try again, and start talking right after the tap.');
      notice(voiceProblem(failed, { ios }));
    };
    try { rec.start(); } catch { failed = 'service-not-allowed'; rec.onend(); }
  });
  return mic;
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
  const answer = q ? askHouse(q) : null, log = q && !answer ? parseBabyLog(q) : null, draft = q && !log ? parseQuickAdd(q) : null;
  if (log) items.push({ group:'Frankie', icon:'✨', label:describeBabyLog(log), run:() => ctx.logBaby(log), boost:200 });
  if (answer) items.push({ group:'Answer', icon:'💬', label:answer.answer, hint:'↵ show it on Today', run:() => { ctx.showView('today'); showAnswer(answer, q); }, boost:300, answer:true });
  if (draft && !answer) items.push({ group:'Create', icon:'✨', label:`Add “${draft.title}”`, hint:describeDraft(draft).split(' · ').slice(1).join(' · '), run:() => ctx.openDraft(draftPayload(draft)), boost:200 });
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
    renderHTML(list, items.length ? items.map((item, i) => `${item.group !== group ? `<li class="palette-group" role="presentation">${esc(group = item.group)}</li>` : ''}<li role="option" id="palette-${i}" aria-selected="${i === active}" data-index="${i}" class="palette-item${item.answer ? ' is-answer' : ''}"><span class="palette-icon" aria-hidden="true">${esc(item.icon || '•')}</span><span class="palette-label">${esc(item.label)}</span>${item.hint ? `<span class="palette-hint">${esc(item.hint)}</span>` : ''}</li>`).join('') : '<li class="palette-empty">No matches. Try a plan like “Brunch Sun 11am”.</li>');
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
// Small tiles under the page title: what needs attention, the next plan, Frankie, and rain.
// Each tile is an icon, a title you can tap, and a quiet detail; Frankie's spans the row.
const tile = ({ tone = 'plain', icon, link, detail = '', sub = '', wide = false, meter = null }) =>
  `<div class="nn-item nn-${tone}${wide ? ' nn-wide' : ''}"><span class="nn-icon" aria-hidden="true">${icon}</span><span class="nn-body">${link}${detail ? `<span class="nn-muted">${detail}</span>` : ''}${sub ? `<span class="nn-sub">${sub}</span>` : ''}${meter == null ? '' : `<span class="nn-meter${meter > 1 ? ' is-over' : ''}" role="presentation"><i style="width:${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%"></i></span>`}</span></div>`;
const viewLink = (view, html) => `<button type="button" class="nn-link" data-nn-view="${view}">${html}</button>`;
function renderNowNext() {
  const root = $('nowNext'); if (!root) return;
  const now = new Date(), events = ctx.getEvents(), parts = [];
  const eventLink = (event, from, label) => `<button type="button" class="nn-link" data-nn-event="${esc(event.extendedProps?.sourceId || event.id)}" data-nn-occ="${esc(from.toISOString())}">${label}</button>`;
  const { current, next } = nextUp(events, now);
  // Something outside stopped working (Settings → Connections has the details).
  if (health.length) { const a = health[0], short = { 'signed-out':'needs reconnecting', denied:'is refusing access', changed:'may have changed', failed:'didn’t send' }[a.problem] || `not answering since ${clock(a.since)}`;
    parts.push(tile({ tone:'health', icon:'⚠', link:viewLink('settings', `<strong>${esc(a.name)}</strong>`), detail:`${esc(short)}${health.length > 1 ? ` · +${health.length - 1} more` : ''}` })); }
  // Today's birthdays first; otherwise tomorrow's, so there's time to call or send a card.
  if (birthdaysShown()) {
    const start = new Date(now); start.setHours(0, 0, 0, 0); const dayAfter = new Date(start); dayAfter.setDate(dayAfter.getDate() + 2);
    const soon = birthdaysInRange(start, dayAfter), todayKey = dateKey(start), today = soon.filter(b => b.date === todayKey), tomorrow = soon.filter(b => b.date !== todayKey);
    const label = b => b.age ? `${b.name} turns ${b.age}` : `${b.name}’s birthday`;
    if (today.length) parts.push(tile({ tone:'birthday', icon:'🎂', link:viewLink('calendar', `<strong>${esc(today.map(label).join(' · '))}</strong>`), detail:'today' }));
    else if (tomorrow.length) parts.push(tile({ tone:'birthday', icon:'🎂', link:viewLink('calendar', `<strong>${esc(tomorrow.map(label).join(' · '))}</strong>`), detail:'tomorrow' }));
  }
  // Bath night, from the afternoon on (mornings are for the day's plans).
  if (isBathDay(now) && now.getHours() >= 12 && now.getHours() < 22) parts.push(tile({ tone:'bath', icon:'🛁', link:viewLink('settings', '<strong>Bath night</strong>'), detail:'tonight' }));
  // Bin day: the evening before (bins out tonight) and that morning.
  { const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const today = now.getHours() < 12 ? pickupOn(now) : null, next = now.getHours() >= 15 ? pickupOn(tomorrow) : null;
    const name = pickup => esc(pickup.title.replace(/^🗑️ |^♻️ /, ''));
    if (today) parts.push(tile({ tone:'trash', icon:'🗑️', link:viewLink('settings', `<strong>${name(today)}</strong>`), detail:`today${today.moved ? ` (moved for ${esc(today.moved.holiday)})` : ''}` }));
    else if (next) parts.push(tile({ tone:'trash', icon:'🗑️', link:viewLink('settings', '<strong>Bins out tonight</strong>'), detail:`${name(next).toLowerCase()} tomorrow${next.moved ? ` (moved for ${esc(next.moved.holiday)})` : ''}` })); }
  if (current) parts.push(tile({ tone:'now', icon:'<span class="nn-live"></span>', link:eventLink(current.event, current.from, `<span class="nn-kicker">Now:</span> <strong>${esc(current.event.title)}</strong>`), detail:`${current.minutesLeft}m left` }));
  if (next) parts.push(tile({ tone:'next', icon:'◷', link:eventLink(next.event, next.from, `<span class="nn-kicker">Next:</span> <strong>${esc(next.event.title)}</strong>`), detail:`${esc(next.minutesUntil < 1440 ? clock(next.from) : `${dayName(next.from)} ${clock(next.from)}`)} · ${esc(untilText(next.minutesUntil))}` }));
  if (baby) {
    const minutes = stamp => Math.max(0, Math.round((+now - Date.parse(stamp)) / 60000)), hm = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    const asleep = !!baby.timer?.active, status = asleep ? `asleep ${hm(minutes(baby.timer.start))}` : baby.lastWake ? `awake ${hm(minutes(baby.lastWake))}` : 'no sleep logged';
    // Average of the three cats' calls (Hubert, Mia, Mack); hover to see each one.
    const cats = !asleep ? catsConsensus(baby) : null;
    const nap = cats ? `${cats.kind} ~${clock(cats.target)}${cats.picks.length > 1 ? ` (avg of ${cats.picks.length} cats)` : ` (${cats.picks[0].cat})`}` : '';
    const napTitle = cats ? cats.picks.map(p => `${p.cat} ${clock(p.at)}`).join(' · ') + (cats.left.length ? ` · left out: ${cats.left.join(', ')} (a different sleep)` : '') : '';
    const bottle = [baby.lastBottle ? `bottle ${hm(minutes(baby.lastBottle))} ago` : '', baby.nextBottle?.available ? `next ~${clock(baby.nextBottle.target)}${baby.nextBottle.waitingForWake ? ' when she wakes' : ''}` : ''].filter(Boolean).join(' · ');
    // How far through her awake window she is (from waking to the cats' call).
    const wake = Date.parse(baby.lastWake), due = cats ? +new Date(cats.target) : NaN, meter = Number.isFinite(wake) && due > wake ? (+now - wake) / (due - wake) : null;
    parts.push(tile({ tone:asleep ? 'asleep' : 'frankie', icon:asleep ? '☾' : '☀', wide:true, meter,
      link:viewLink('frankie', `${esc(baby.name)} <strong>${esc(status)}</strong>`),
      detail:nap ? `<span${napTitle ? ` title="${esc(napTitle)}"` : ''}>${esc(nap)}</span>` : '', sub:esc(bottle) }));
  }
  if (litter) parts.push(tile({ tone:'device', icon:'🐈', link:viewLink('devices', `<strong>${esc(litter.name)}</strong>`), detail:litter.full ? 'drawer full' : `drawer ${litter.drawer}% full` }));
  if (feeders) parts.push(tile({ tone:'device', icon:'🥣', link:viewLink('devices', `<strong>${esc(feeders.name)}</strong>`), detail:`${feeders.blocked ? 'outlet may be blocked' : 'food low'}${feeders.more ? ` · +${feeders.more} more` : ''}` }));
  const flags = forecast ? weatherFlags(events, forecast.days, now) : [];
  if (flags.length) parts.push(tile({ tone:'rain', icon:'☔', link:eventLink({ id:flags[0].id }, new Date(flags[0].start), `<strong>${esc(flags[0].title)}</strong>`), detail:`${esc(dayName(flags[0].start))} · ${flags[0].rain == null ? esc(flags[0].label) : `${flags[0].rain}% rain`}` }));
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
  initAsk(); initQuickAdd(); initPalette();
  $('nowNext').addEventListener('click', event => {
    const target = event.target.closest('[data-nn-event],[data-nn-view]'); if (!target) return;
    if (target.dataset.nnEvent) ctx.openEvent(target.dataset.nnEvent, target.dataset.nnOcc);
    else ctx.showView(target.dataset.nnView);
  });
  window.addEventListener('hh:baby', event => { baby = event.detail; renderNowNext(); });
  window.addEventListener('hh:birthdays', () => renderNowNext());
  window.addEventListener('hh:litter', event => { litter = event.detail; renderNowNext(); });
  window.addEventListener('hh:feeders', event => { feeders = event.detail; renderNowNext(); });
  window.addEventListener('hh:health', event => { health = event.detail || []; renderNowNext(); });
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
