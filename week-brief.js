import { dateKey, escapeHTML as esc } from './household-model.js';
import { eventsOnDay, localDate, eventEnd } from './calendar-model.js';
import { renderHTML } from './dom.js';

function sharedPeople(a, b) {
  if (a.extendedProps?.withFrankie && b.extendedProps?.withFrankie) return true;
  const ownerA = a.extendedProps?.owner || 'both', ownerB = b.extendedProps?.owner || 'both';
  if (ownerA === 'both' || ownerB === 'both') return true;
  if (ownerA !== ownerB) return false;
  if (ownerA === 'custom') return (a.extendedProps.ownerCustom || '').toLowerCase() === (b.extendedProps.ownerCustom || '').toLowerCase();
  return true;
}
export function buildWeekBrief(events, items, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  const days = Array.from({ length: 7 }, (_, i) => { const day = new Date(start); day.setDate(day.getDate() + i); return day; });
  const plans = events.filter(event => localDate(event.start) < end && eventEnd(event) > start);
  const counts = days.map(day => ({ date: dateKey(day), count: eventsOnDay(plans, day).length }));
  const busiest = [...counts].sort((a,b) => b.count - a.count)[0];
  const due = items.filter(item => ['chore','task'].includes(item.kind) && !item.completed && /^\d{4}-\d{2}-\d{2}$/.test(item.due || '') && item.due < dateKey(end));
  const overdue = due.filter(item => item.due < dateKey(start));
  const openEvenings = days.filter(day => {
    const from = new Date(day), to = new Date(day); from.setHours(17); to.setHours(22);
    return to > now && !plans.some(event => localDate(event.start) < to && eventEnd(event) > from);
  });
  const timed = plans.filter(event => !event.allDay).sort((a,b) => localDate(a.start) - localDate(b.start));
  const overlaps = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && localDate(timed[j].start) < eventEnd(timed[i]); j++) {
      const overlapStart = new Date(Math.max(localDate(timed[i].start), localDate(timed[j].start), start));
      const overlapEnd = new Date(Math.min(eventEnd(timed[i]), eventEnd(timed[j]), end));
      if (overlapStart < overlapEnd && sharedPeople(timed[i], timed[j])) overlaps.push({ date: dateKey(overlapStart), titles: [timed[i].title, timed[j].title] });
    }
  }
  return { plans: plans.length, due: due.length, overdue: overdue.length, busiest, openEvenings: openEvenings.map(dateKey), overlaps, from: dateKey(start), to: dateKey(days[6]) };
}

export function renderWeekBrief(events, items, now = new Date()) {
  if (!document.getElementById('briefPlans')) return;
  const brief = buildWeekBrief(events, items, now);
  const dayName = day => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long' });
  document.getElementById('briefDates').textContent = `${new Date(`${brief.from}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(`${brief.to}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  document.getElementById('briefPlans').textContent = brief.plans;
  document.getElementById('briefDue').textContent = brief.due;
  document.getElementById('briefEvenings').textContent = brief.openEvenings.length;
  const evening = document.getElementById('briefEveningLink');
  evening.disabled = !brief.openEvenings.length;
  if (brief.openEvenings.length) evening.dataset.weekDay = brief.openEvenings[0]; else delete evening.dataset.weekDay;
  const busiest = brief.busiest.count
    ? `<button type="button" class="brief-insight" data-week-day="${brief.busiest.date}"><span class="brief-insight-icon" aria-hidden="true">▦</span><span><strong>${esc(dayName(brief.busiest.date))} has the most going on</strong><small>${brief.busiest.count} plan${brief.busiest.count === 1 ? '' : 's'} · take a look at the day</small></span><span aria-hidden="true">→</span></button>`
    : '<div class="brief-insight"><span class="brief-insight-icon" aria-hidden="true">✳</span><span><strong>A little room to make plans</strong><small>Your next seven days are clear.</small></span></div>';
  const clashes = brief.overlaps.length ? `<button type="button" class="brief-insight has-overlap" data-week-day="${brief.overlaps[0].date}"><span class="brief-insight-icon" aria-hidden="true">!</span><span><strong>${brief.overlaps.length} schedule overlap${brief.overlaps.length === 1 ? '' : 's'} to check</strong><small>${esc(brief.overlaps[0].titles.join(' + '))}</small></span><span aria-hidden="true">→</span></button>` : '';
  renderHTML(document.getElementById('briefInsights'), busiest + clashes);
  document.getElementById('briefDueNote').textContent = brief.overdue ? `${brief.overdue} overdue · includes chores & checklists` : 'Dated chores & checklists';
}
