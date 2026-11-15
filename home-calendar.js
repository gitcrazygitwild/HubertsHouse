import { dateKey, escapeHTML as esc } from './household-model.js';
import { localDate, startOfDay, nextDay, eventEnd, eventsOnDay, checklistProgress } from './calendar-model.js';
import { renderHTML } from './dom.js';

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
  return `<button type="button" class="home-week-event owner-${owner}${end <= now ? ' is-past' : ''}${happening ? ' is-happening' : ''}" data-home-event="${esc(props.sourceId || event.id)}" data-occurrence="${esc(start.toISOString())}">
    <span class="home-event-time">${esc(eventTime(event, day))}${happening ? '<span class="home-event-now">Now</span>' : ''}</span>
    <strong>${esc(event.title)}</strong>
    <span class="home-event-meta"><span>${esc(label)}${props.isRepeatOccurrence ? ' · ↻' : ''}${props.icloud ? ' · iCloud' : ''}</span>${progressHTML}</span>
  </button>`;
}

export function initHomeCalendar({ getEvents, openEvent, addEvent, onRangeChange = () => {}, now = () => new Date() }) {
  const $ = id => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  let anchor = startOfDay(now()), followingToday = true, lastRange = '';
  const getRange = () => { const end = new Date(anchor); end.setDate(end.getDate() + 7); return { start: new Date(anchor), end }; };
  function render() {
    const current = now();
    if (followingToday) anchor = startOfDay(current);
    const week = homeCalendarWeek(getEvents(), anchor), today = dateKey(current);
    const last = week.days[6].date;
    const format = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', ...(anchor.getFullYear() !== current.getFullYear() || last.getFullYear() !== current.getFullYear() ? { year: 'numeric' } : {}) });
    text('homeCalendarRange', format.formatRange(anchor, last));
    text('homeCalendarSummary', `${week.count} plan${week.count === 1 ? '' : 's'} · ${followingToday ? 'today + the next six days' : 'seven days together'}`);
    $('homeCalendarToday').classList.toggle('is-current', followingToday);
    renderHTML($('homeWeek'), week.days.map(({ date, events }) => {
      const key = dateKey(date), isToday = key === today;
      const name = date.toLocaleDateString([], { weekday: 'short' });
      const longDate = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      return `<section class="home-week-day${isToday ? ' is-today' : ''}" data-home-date="${key}" aria-label="${esc(longDate)}">
        <button type="button" class="home-day-heading" data-week-day="${key}" aria-label="Open ${esc(longDate)} in the calendar"${isToday ? ' aria-current="date"' : ''}><span>${esc(name)}${isToday ? '<small>Today</small>' : ''}</span><strong>${date.getDate()}</strong></button>
        <div class="home-day-plans">${events.length ? events.map(event => eventCard(event, date, current)).join('') : '<p class="home-day-empty">A little breathing room.</p>'}</div>
        <button type="button" class="home-day-add" data-home-add="${key}" aria-label="Add a plan on ${esc(longDate)}"><span aria-hidden="true">＋</span> Add a plan</button>
      </section>`;
    }).join(''));
    const rangeKey = dateKey(anchor);
    if (rangeKey !== lastRange) { lastRange = rangeKey; onRangeChange(getRange()); }
  }
  function move(days) {
    anchor.setDate(anchor.getDate() + days);
    followingToday = dateKey(anchor) === dateKey(now());
    render();
  }
  $('homeCalendarPrev').addEventListener('click', () => move(-7));
  $('homeCalendarNext').addEventListener('click', () => move(7));
  $('homeCalendarToday').addEventListener('click', () => { followingToday = true; render(); });
  $('homeWeek').addEventListener('click', event => {
    const card = event.target.closest('[data-home-event]');
    if (card) openEvent(card.dataset.homeEvent, card.dataset.occurrence);
    const add = event.target.closest('[data-home-add]');
    if (add) addEvent(localDate(add.dataset.homeAdd));
  });
  render();
  return { render, getRange };
}
