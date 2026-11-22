import { dateKey } from './household-model.js';
import { localDate } from './calendar-model.js';
import { initTimeDial } from './time-dial.js';

const clock = date => `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
const dayNumber = value => Date.parse(`${value}T00:00:00Z`)/86400000;
export function eventRangeSummary(start,end,allDay) {
  const from = localDate(start), to = localDate(end || start);
  if (isNaN(from) || isNaN(to)) return 'Choose a start and end.';
  if (to < from || (!allDay && +to === +from)) return 'End must be after start. For an overnight plan, choose the next date.';
  const dates = new Intl.DateTimeFormat([], {weekday:'short',month:'short',day:'numeric',...(from.getFullYear() !== to.getFullYear() ? {year:'numeric'} : {})});
  if (allDay) { const days = dayNumber(dateKey(to))-dayNumber(dateKey(from))+1; return `${dates.formatRange(from,to)} · ${days === 1 ? 'All day' : `${days} days, including the end date`}`; }
  const duration = Math.round((to-from)/60000), hours = Math.floor(duration/60), minutes = duration%60;
  const length = `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`.trim();
  const times = new Intl.DateTimeFormat([], {hour:'numeric',minute:'2-digit'});
  return `${dates.formatRange(from,to)} · ${times.formatRange(from,to)} · ${length}`;
}
export function initEventDateEditor({onChange=()=>{}}={}) {
  const $ = id => document.getElementById(id), start=$('evtStart'),end=$('evtEnd'),allDay=$('evtAllDay');
  const fields = ['evtStartDate','evtStartTime','evtEndDate','evtEndTime'].map($);
  let previousTimes=['09:00','10:00'];
  const value = (date,isAllDay) => `${dateKey(date)}${isAllDay ? '' : `T${clock(date)}`}`;
  function render() {
    const isAllDay=allDay.checked, from=start.value ? localDate(start.value) : null, to=end.value ? localDate(end.value) : from;
    fields[0].value = from && !isNaN(from) ? dateKey(from) : ''; fields[2].value = to && !isNaN(to) ? dateKey(to) : '';
    fields[1].value = isAllDay ? previousTimes[0] : from && !isNaN(from) ? clock(from) : '09:00'; fields[3].value = isAllDay ? previousTimes[1] : to && !isNaN(to) ? clock(to) : '10:00';
    fields[1].closest('label').hidden=isAllDay; fields[3].closest('label').hidden=isAllDay;
    fields[1].required=!isAllDay; fields[3].required=!isAllDay;
    $('eventDurations').hidden=isAllDay; $('eventEndDateLabel').textContent=isAllDay ? 'Last day · included' : 'End date';
    fields[2].min=fields[0].value;
    const invalid=from && to && (to<from || (!isAllDay && +to===+from));
    fields[3].setCustomValidity(!isAllDay && invalid ? 'End must be after start. Choose the next end date for an overnight event.' : '');
    fields[2].setCustomValidity(isAllDay && invalid ? 'The last day cannot be before the first.' : '');
    $('eventDateSummary').textContent=eventRangeSummary(start.value,end.value,isAllDay);
    $('eventTimezone').textContent=`Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ')}.`;
    document.querySelectorAll('[data-event-duration]').forEach(button => button.setAttribute('aria-pressed',String(!isAllDay && to-from===Number(button.dataset.eventDuration)*60000)));
    drawDays(from); dial?.draw();
  }
  // Two weeks of day chips (Today, Tomorrow, Tue 24…), redrawn so "Today" is always right.
  function drawDays(from) {
    const box=$('eventDays'); if (!box) return;
    const today=new Date(); today.setHours(12,0,0,0);
    const picked=from && !isNaN(from) ? dateKey(from) : '';
    box.innerHTML=Array.from({length:14},(_,i)=>{ const d=new Date(today); d.setDate(d.getDate()+i);
      const name=i===0?'Today':i===1?'Tomorrow':d.toLocaleDateString([], {weekday:'short'}), num=i>1?`<b>${d.getDate()}</b>`:'';
      return `<button type="button" data-event-date="${i}" aria-pressed="${dateKey(d)===picked}"><span>${name}</span>${num}</button>`; }).join('');
  }
  function set(isAllDay,from,to) {
    allDay.checked=isAllDay; start.type=isAllDay?'date':'datetime-local'; end.type=start.type;
    const first=from && !isNaN(new Date(from)) ? new Date(from) : new Date(), last=to && !isNaN(new Date(to)) ? new Date(to) : new Date(+first+(isAllDay?0:3600000));
    start.value=value(first,isAllDay); end.value=value(last,isAllDay);
    previousTimes=isAllDay?['09:00','10:00']:[clock(first),clock(last)]; render();
  }
  function changed() { render(); onChange(); }
  function moveStart(newValue) {
    const oldStart=localDate(start.value),oldEnd=localDate(end.value),next=localDate(newValue);
    if (isNaN(next)) return;
    let last;
    if (allDay.checked) { last=new Date(next); last.setDate(last.getDate()+Math.max(0,dayNumber(dateKey(oldEnd))-dayNumber(dateKey(oldStart)))); }
    else last=new Date(+next+Math.max(60000,+oldEnd-+oldStart || 3600000));
    start.value=value(next,allDay.checked); end.value=value(last,allDay.checked); changed();
  }
  for (const field of fields) field.addEventListener('change',()=>{
    const startValue=fields[0].value+(allDay.checked?'':`T${fields[1].value}`),endValue=fields[2].value+(allDay.checked?'':`T${fields[3].value}`);
    if (field===fields[0] || field===fields[1]) moveStart(startValue); else {end.value=endValue;changed();}
  });
  allDay.addEventListener('change',()=>{
    const from=fields[0].value,to=fields[2].value;
    if (allDay.checked) previousTimes=[fields[1].value,fields[3].value];
    start.type=allDay.checked?'date':'datetime-local'; end.type=start.type;
    start.value=from+(allDay.checked?'':`T${previousTimes[0] || '09:00'}`); end.value=to+(allDay.checked?'':`T${previousTimes[1] || '10:00'}`);
    if (!allDay.checked && localDate(end.value)<=localDate(start.value)) end.value=value(new Date(+localDate(start.value)+3600000),false);
    changed();
  });
  // Day chips (the strip, and any fixed Today/Tomorrow buttons): one listener for all of them.
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-event-date]'); if (!button || button.disabled || fields[0].disabled) return;
    const date=new Date();date.setDate(date.getDate()+Number(button.dataset.eventDate)); moveStart(dateKey(date)+(allDay.checked?'':`T${fields[1].value || '09:00'}`));
  });
  // The clock dial edits the same fields.
  const dial=$('eventDial') ? initTimeDial($('eventDial'),{
    getRange:()=>({start:localDate(start.value),end:localDate(end.value),allDay:allDay.checked}),
    setStart:date=>moveStart(value(date,false)),
    setEnd:date=>{end.value=value(date,false);changed();},
    isDisabled:()=>fields[1].disabled
  }) : null;
  document.querySelectorAll('[data-event-duration]').forEach(button=>button.addEventListener('click',()=>{end.value=value(new Date(+localDate(start.value)+Number(button.dataset.eventDuration)*60000),false);changed();}));
  for (const field of [start,end]) field.addEventListener('change',changed);
  return {set,render};
}
