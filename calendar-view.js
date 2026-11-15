import { dateKey, escapeHTML as esc } from './household-model.js';
import { localDate, startOfDay, nextDay, eventEnd, eventsOnDay, checklistProgress } from './calendar-model.js';
import { renderHTML } from './dom.js';
import { showView, showNotice } from './household.js';

const $ = id => document.getElementById(id);
const ownerNames = { hanry: 'hanry', karena: 'Karena', both: 'Together', custom: 'Other' };
const ownerOf = event => Object.hasOwn(ownerNames, event.extendedProps?.owner) ? event.extendedProps.owner : 'custom';
const time = date => localDate(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function calendarEventContent({ event, view }) {
  const p = event.extendedProps || {}, owner = ownerOf(event);
  const typeIcons = { trip: '→', wedding: '♡', appointment: '◷', party: '✦' };
  const icon = typeIcons[p.type] || '';
  const wrapper = document.createElement('div'); wrapper.className = 'smart-event';
  const clock = event.allDay ? 'All day' : time(event.start);
  const progress = checklistProgress(p.checklist);
  const progressHTML = progress.total ? `<span class="event-checklist-progress ${progress.done === progress.total ? 'is-complete' : ''}" aria-label="${progress.done} of ${progress.total} checklist items complete"><span aria-hidden="true">✓</span> ${progress.done}/${progress.total}<span class="event-checklist-track" aria-hidden="true"><i style="width:${Math.round(progress.done / progress.total * 100)}%"></i></span></span>` : '';
  wrapper.innerHTML = `<div class="smart-event-time">${esc(clock)}${p.isRepeatOccurrence ? '<span aria-label="Repeating">↻</span>' : ''}</div><span class="smart-event-title">${icon ? `<span class="smart-event-icon" aria-hidden="true">${icon}</span>` : ''}${esc(event.title)}</span>${progressHTML}${view.type.startsWith('timeGrid') ? `<span class="smart-event-owner">${esc(ownerNames[owner])}</span>` : ''}`;
  return { domNodes: [wrapper] };
}

export function initCalendarExperience({ calendar, getEvents, getFilteredEvents, openEvent, addEvent }) {
  let selected = startOfDay(new Date());
  const html = (id, markup) => renderHTML($(id), markup);
  const eventAttrs = event => `data-calendar-event="${esc(event.extendedProps?.sourceId || event.id)}" data-occurrence="${esc(localDate(event.start).toISOString())}"`;
  function selectDay(value, navigate = false) {
    selected = startOfDay(value);
    if (navigate || selected < calendar.view.activeStart || selected >= calendar.view.activeEnd) calendar.gotoDate(selected);
    render();
  }
  function render({ rangeChanged = false } = {}) {
    const now = new Date(), today = dateKey(now), view = calendar.view;
    const height = view.type.startsWith('timeGrid') ? Math.max(440, Math.min(720, window.innerHeight - 270)) : 'auto';
    if (calendar.getOption('height') !== height) calendar.setOption('height', height);
    if (rangeChanged && view.type.startsWith('timeGrid')) requestAnimationFrame(() => calendar.scrollToTime('07:00:00'));
    if (rangeChanged && (selected < view.activeStart || selected >= view.activeEnd || view.type === 'timeGridDay')) selected = startOfDay(calendar.getDate());
    $('calendarTitleText').textContent = view.title;
    $('calendarTitle').setAttribute('aria-label', `${view.title}. Jump to a month`);
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      const active = button.dataset.calendarView === view.type;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-owner]').forEach(button => {
      const active = button.dataset.owner === $('ownerFilter').value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    const allEvents = getEvents(), filtered = getFilteredEvents();
    const rangeCount = filtered.filter(event => localDate(event.start) < view.currentEnd && eventEnd(event) > view.currentStart).length;
    const filteredBy = $('ownerFilter').value;
    $('calendarRangeSummary').textContent = `${rangeCount} plan${rangeCount === 1 ? '' : 's'} in view${filteredBy === 'hanry' || filteredBy === 'karena' ? ' · includes shared plans' : ''}`;
    document.querySelectorAll('.fc-dayGridMonth-view .fc-daygrid-day[data-date]').forEach(cell => {
      const isSelected = cell.dataset.date === dateKey(selected);
      cell.classList.toggle('is-selected-day', isSelected);
      cell.querySelector('.fc-daygrid-day-number')?.setAttribute('aria-pressed', String(isSelected));
    });
    $('selectedDayLabel').textContent = dateKey(selected) === today ? 'TODAY’S LINEUP' : selected.toLocaleDateString([], { weekday: 'long' }).toUpperCase();
    $('selectedDayTitle').textContent = selected.toLocaleDateString([], { month: 'short', day: 'numeric' });
    $('addToDay').setAttribute('aria-label', `Add an event on ${selected.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`);
    const dayEvents = eventsOnDay(filtered, selected);
    html('selectedDayEvents', dayEvents.length ? dayEvents.map(event => {
      const owner = ownerOf(event), label = event.allDay ? 'All day' : localDate(event.start) < selected ? 'Ongoing' : time(event.start);
      return `<button type="button" class="day-event ${owner}" ${eventAttrs(event)}><span class="day-event-time">${esc(label)}</span><span class="day-event-copy"><strong>${esc(event.title)}</strong><small>${esc(ownerNames[owner])}${event.extendedProps?.isRepeatOccurrence ? ' · Repeats' : ''}${event.extendedProps?.icloud ? ' · iCloud' : ''}</small></span></button>`;
    }).join('') : '<div class="empty-state"><strong>A little breathing room.</strong>No plans match this day.<br />Make some room for something good.</div>');

    const next = allEvents.filter(event => eventEnd(event) > now).sort((a, b) => localDate(a.start) - localDate(b.start))[0];
    if (next) {
      const start = localDate(next.start), happening = start <= now;
      const day = dateKey(start) === today ? 'Today' : dateKey(start) === dateKey(nextDay(now)) ? 'Tomorrow' : start.toLocaleDateString([], { month: 'short', day: 'numeric' });
      let countdown = '';
      const minutes = Math.ceil((start - now) / 60000);
      if (!next.allDay && minutes > 0 && minutes < 60) countdown = ` · in ${minutes} min`;
      html('nextEventCard', `<div class="eyebrow next-label">${happening ? next.allDay ? 'HAPPENING TODAY' : 'HAPPENING NOW' : 'UP NEXT'}${esc(countdown.toUpperCase())}</div><button type="button" ${eventAttrs(next)}><h2>${esc(next.title)}</h2><p>${esc(next.allDay ? `${happening ? 'Today' : day} · All day` : `${happening ? 'Now' : day} · ${time(start)}${next.end ? ` – ${time(next.end)}` : ''}`)}</p><span class="next-footer"><span class="next-owner">${esc(ownerNames[ownerOf(next)])}</span><span class="next-arrow" aria-hidden="true">&#8594;</span></span></button>`);
    } else html('nextEventCard', '<span class="next-empty-icon" aria-hidden="true">✳</span><div class="eyebrow">LOOKING GOOD</div><h2>A little room<br />to breathe.</h2><p>Your next plan will appear here.</p>');
  }

  document.querySelectorAll('[data-calendar-view]').forEach(button => button.addEventListener('click', () => {
    const type = button.dataset.calendarView;
    calendar.changeView(type, selected); localStorage.setItem('hh_calendar_view', type);
    render();
  }));
  document.querySelectorAll('[data-owner]').forEach(button => button.addEventListener('click', () => {
    const select = $('ownerFilter'); select.value = button.dataset.owner;
    select.dispatchEvent(new Event('change', { bubbles: true })); render();
  }));
  $('dayPrev').addEventListener('click', () => { const date = new Date(selected); date.setDate(date.getDate() - 1); selectDay(date); });
  $('dayNext').addEventListener('click', () => selectDay(nextDay(selected)));
  $('addToDay').addEventListener('click', () => addEvent(new Date(selected)));
  $('todayBtn').addEventListener('click', () => selectDay(new Date()));
  document.querySelector('.house-main').addEventListener('click', event => {
    const card = event.target.closest('[data-calendar-event]');
    if (card) openEvent(card.dataset.calendarEvent, card.dataset.occurrence);
    const day = event.target.closest('[data-week-day]');
    if (day) { showView('calendar'); selectDay(day.dataset.weekDay, true); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  $('fullscreenBtn').hidden = !document.fullscreenEnabled;
  $('fullscreenBtn').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { showNotice('Full screen is unavailable in this browser. Try Display mode.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreenBtn').setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen');
    $('fullscreenBtn').title = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    calendar.updateSize();
  });
  setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30000);
  render();
  return { render, selectDay };
}
