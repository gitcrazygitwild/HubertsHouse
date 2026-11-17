import { dateKey, escapeHTML as esc } from './household-model.js';
import { localDate, startOfDay, nextDay, eventEnd, eventsOnDay, checklistProgress } from './calendar-model.js';
import { renderHTML } from './dom.js';
import { holidaysInRange, holidaysEnabled } from './holidays.js';
import { weatherIcon } from './weather-shared.js';

// Each day's Richmond forecast (from weather.js), linked to Miateorology.
export const WEATHER_URL = 'https://gitcrazygitwild.github.io/Miateorology/';
export function dayWeather(forecast, key, units = 'F') {
  const day = forecast?.days?.find(item => item.date === key);
  if (!day || (day.high == null && day.low == null)) return '';
  const degree = value => value == null ? '—' : `${Math.round(units === 'C' ? (value - 32) * 5 / 9 : value)}°`;
  const rain = day.rain != null && day.rain >= 30 ? ` · ${Math.round(day.rain)}%` : '';
  const title = `${day.label || 'Forecast'} · high ${degree(day.high)}, low ${degree(day.low)}${day.rain != null ? ` · ${Math.round(day.rain)}% rain` : ''}. Open Miateorology`;
  return `<a class="home-day-weather weather-${esc(day.kind || 'unknown')}" href="${WEATHER_URL}" target="_blank" rel="noopener noreferrer" title="${esc(title)}" aria-label="${esc(title)}"><span class="home-day-weather-icon" aria-hidden="true">${weatherIcon(day.kind)}</span><span>${degree(day.high)} <small>${degree(day.low)}</small>${rain ? `<small class="home-day-rain">${esc(rain)}</small>` : ''}</span></a>`;
}

const owners = { hanry: 'hanry', karena: 'Karena', both: 'Together', custom: 'Other' };
const time = date => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function homeCalendarWeek(events, anchor) {
  const start = startOfDay(anchor), end = new Date(start);
  end.setDate(end.getDate() + 7);
  const plans = events.filter(event => localDate(event.start) < end && eventEnd(event) > start);
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start); date.setDate(date.getDate() + offset);
    return { date, events: eventsOnDay(plans, date) };
  });
  return { start, end, days, count: plans.length };
}

export function homeCalendarRange(events, anchor, view = 'week') {
  if (view === 'week') return homeCalendarWeek(events, anchor);
  const start = startOfDay(anchor), end = new Date(start);
  if (view === 'month') { start.setDate(1); start.setDate(1 - start.getDay()); end.setTime(+start); end.setDate(end.getDate() + 42); }
  else end.setDate(end.getDate() + 1);
  const plans = events.filter(event => localDate(event.start) < end && eventEnd(event) > start);
  const days = [];
  for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) days.push({ date: new Date(date), events: eventsOnDay(plans, date) });
  return { start, end, days, count: plans.length };
}

function eventTime(event, day) {
  if (event.allDay) return 'All day';
  const start = localDate(event.start), end = eventEnd(event);
  if (start < day) return end > nextDay(day) ? 'Ongoing' : `Until ${time(end)}`;
  if (!event.end) return time(start);
  if (end > nextDay(day)) return `${time(start)} · overnight`;
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatRange(start, end);
}

function eventCard(event, day, now) {
  const props = event.extendedProps || {};
  const owner = Object.hasOwn(owners, props.owner) ? props.owner : 'custom';
  const label = owner === 'custom' ? props.ownerCustom || owners.custom : owners[owner];
  const start = localDate(event.start), end = eventEnd(event);
  const happening = !event.allDay && start <= now && end > now && dateKey(day) === dateKey(now);
  const progress = checklistProgress(props.checklist);
  const progressHTML = progress.total ? `<span class="home-event-checklist" aria-label="${progress.done} of ${progress.total} checklist items complete">✓ ${progress.done}/${progress.total}</span>` : '';
  return `<button type="button" class="home-week-event owner-${owner}${props.withFrankie ? ' with-frankie' : ''}${end <= now ? ' is-past' : ''}${happening ? ' is-happening' : ''}" data-home-event="${esc(props.sourceId || event.id)}" data-occurrence="${esc(start.toISOString())}">
    <span class="home-event-time">${esc(eventTime(event, day))}${happening ? '<span class="home-event-now">Now</span>' : ''}</span>
    <strong>${esc(event.title)}</strong>
    <span class="home-event-meta"><span>${esc(label)}${props.withFrankie ? ' + Frankie' : ''}${props.isRepeatOccurrence ? ' · ↻' : ''}${props.icloud ? ' · iCloud' : ''}</span>${progressHTML}</span>
  </button>`;
}

export function initHomeCalendar({ getEvents, openEvent, addEvent, onRangeChange = () => {}, now = () => new Date() }) {
  const $ = id => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  let anchor = startOfDay(now()), followingToday = true, lastRange = '', view = 'week', selection=null, suppressClickUntil=0, forecast = globalThis.hhForecast || null;
  const units = () => { try { return localStorage.getItem('hh_weather_units') === 'C' ? 'C' : 'F'; } catch { return 'F'; } };
  globalThis.addEventListener?.('hh:forecast', event => { forecast = event.detail; render(); });
  try { const saved = localStorage.getItem('hh_home_calendar_view'); if (['day','week','month'].includes(saved)) view = saved; } catch {}
  const getRange = () => { const { start, end } = homeCalendarRange([], anchor, view); return { start, end }; };
  function render() {
    if (selection) return;
    const current = now();
    if (followingToday) anchor = startOfDay(current);
    const week = homeCalendarRange(getEvents(), anchor, view), today = dateKey(current);
    const holidays=holidaysEnabled() ? holidaysInRange(week.start,week.end) : [];
    const last = week.days.at(-1).date;
    const format = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', ...(anchor.getFullYear() !== current.getFullYear() || last.getFullYear() !== current.getFullYear() ? { year: 'numeric' } : {}) });
    text('homeCalendarTitle', view === 'month' ? 'YOUR MONTH, TOGETHER' : view === 'day' ? 'YOUR DAY, TOGETHER' : 'YOUR WEEK, TOGETHER');
    text('homeCalendarRange', view === 'month' ? anchor.toLocaleDateString([], { month:'long', year:'numeric' }) : view === 'day' ? anchor.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' }) : format.formatRange(anchor, last));
    const summary = view === 'week' ? (followingToday ? 'today + the next six days' : 'seven days together') : view === 'month' ? 'in the month grid' : 'on this day';
    text('homeCalendarSummary', `${week.count} plan${week.count === 1 ? '' : 's'} · ${summary}`);
    $('homeWeek').dataset.calendarMode = view;
    document.querySelectorAll('[data-home-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.homeView === view)));
    for (const [id, direction] of [['homeCalendarPrev','Previous'], ['homeCalendarNext','Next']]) $(id).setAttribute('aria-label', `${direction} ${view === 'week' ? 'seven days' : view}`);
    $('homeCalendarToday').classList.toggle('is-current', followingToday);
    renderHTML($('homeWeek'), week.days.map(({ date, events }) => {
      const key = dateKey(date), isToday = key === today;
      const name = date.toLocaleDateString([], { weekday: 'short' });
      const longDate = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const shown = view === 'month' ? events.slice(0, 3) : events;
      return `<section class="home-week-day${isToday ? ' is-today' : ''}${view === 'month' && date.getMonth() !== anchor.getMonth() ? ' outside-month' : ''}" data-home-date="${key}" aria-label="${esc(longDate)}">
        <button type="button" class="home-day-heading" data-home-add="${key}" aria-label="Add a plan on ${esc(longDate)}"${isToday ? ' aria-current="date"' : ''}><span>${esc(name)}${isToday ? '<small>Today</small>' : ''}</span><strong>${date.getDate()}</strong></button>${dayWeather(forecast, key, units())}
        <div class="home-day-plans">${holidays.filter(holiday=>holiday.date===key).map(holiday=>`<span class="home-holiday" title="${esc(holiday.name)} · ${holiday.federal?'U.S. federal holiday':'Observance'}">✦ ${esc(holiday.name)}</span>`).join('')}${events.length ? shown.map(event => eventCard(event, date, current)).join('') : view === 'month' ? '' : '<p class="home-day-empty">A little breathing room.</p>'}${events.length > shown.length ? `<button type="button" class="home-more" data-week-day="${key}">+ ${events.length - shown.length} more</button>` : ''}</div>
        <button type="button" class="home-day-add" data-home-add="${key}" aria-label="Add a plan on ${esc(longDate)}"><span aria-hidden="true">＋</span> Add a plan</button>
      </section>`;
    }).join(''));
    const rangeKey = `${view}:${dateKey(anchor)}`;
    if (rangeKey !== lastRange) { lastRange = rangeKey; onRangeChange(getRange()); }
  }
  function move(direction) {
    if (view === 'month') { anchor.setDate(1); anchor.setMonth(anchor.getMonth() + direction); }
    else anchor.setDate(anchor.getDate() + direction * (view === 'day' ? 1 : 7));
    followingToday = dateKey(anchor) === dateKey(now());
    render();
  }
  $('homeCalendarPrev').addEventListener('click', () => move(-1));
  $('homeCalendarNext').addEventListener('click', () => move(1));
  document.querySelectorAll('[data-home-view]').forEach(button => button.addEventListener('click', () => {
    view = button.dataset.homeView;
    try { localStorage.setItem('hh_home_calendar_view', view); } catch {}
    render();
  }));
  $('homeCalendarToday').addEventListener('click', () => { followingToday = true; render(); });
  $('homeWeek').addEventListener('click', event => {
    if (Date.now()<suppressClickUntil) {event.preventDefault();event.stopPropagation();return;}
    const card = event.target.closest('[data-home-event]');
    if (card) {openEvent(card.dataset.homeEvent, card.dataset.occurrence);return;}
    const add = event.target.closest('[data-home-add]');
    if (add) {addEvent(localDate(add.dataset.homeAdd));return;}
    if (event.target.closest('button,a,input')) return;
    const day=event.target.closest('[data-home-date]'); if(day) addEvent(localDate(day.dataset.homeDate));
  });
  const grid=$('homeWeek');
  const clearSelection=()=>{selection=null;grid.classList.remove('is-selecting');grid.querySelectorAll('.is-range-selected').forEach(day=>day.classList.remove('is-range-selected'));};
  grid.addEventListener('pointerdown',event=>{
    suppressClickUntil=0;
    if (event.pointerType==='touch' || event.button!==0 || event.target.closest('[data-home-event],.home-more,.home-day-add')) return;
    const cell=event.target.closest('[data-home-date]'); if(!cell)return;
    selection={first:cell.dataset.homeDate,last:cell.dataset.homeDate,id:event.pointerId,moved:false};
  });
  grid.addEventListener('pointermove',event=>{
    if (!selection || selection.id!==event.pointerId) return;
    const cell=document.elementFromPoint?.(event.clientX,event.clientY)?.closest('[data-home-date]');
    if(!cell || !grid.contains(cell))return;
    selection.last=cell.dataset.homeDate; selection.moved=selection.moved || selection.last!==selection.first;
    if(!selection.moved)return;
    if(!selection.captured){grid.setPointerCapture?.(event.pointerId);selection.captured=true;}
    event.preventDefault(); grid.classList.add('is-selecting');
    const [first,last]=[selection.first,selection.last].sort();
    grid.querySelectorAll('[data-home-date]').forEach(day=>day.classList.toggle('is-range-selected',day.dataset.homeDate>=first && day.dataset.homeDate<=last));
  });
  document.addEventListener('pointerup',event=>{
    if(!selection || selection.id!==event.pointerId)return;
    const current=selection; clearSelection();
    if(current.moved){suppressClickUntil=Date.now()+500;const [first,last]=[current.first,current.last].sort();addEvent(localDate(first),localDate(last));}
  });
  grid.addEventListener('pointercancel',clearSelection);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')clearSelection();});
  render();
  return { render, getRange };
}
