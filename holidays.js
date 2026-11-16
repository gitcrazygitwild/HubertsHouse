import { dateKey } from './household-model.js';
import { localDate, nextDay } from './calendar-model.js';

const cache = new Map();
const nth = (year, month, weekday, occurrence) => {
  const first = new Date(year,month,1);
  return new Date(year,month,1 + (weekday - first.getDay() + 7) % 7 + (occurrence - 1) * 7);
};
function easter(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const n=h+l-7*m+114;
  return new Date(year,Math.floor(n/31)-1,n%31+1);
}
export function usHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const holidays = [];
  const add = (name,date,federal=false,fixed=false) => {
    holidays.push({name,date:dateKey(date),federal,observed:false});
    if (federal && fixed && [0,6].includes(date.getDay())) {
      const observed = new Date(date); observed.setDate(date.getDate() + (date.getDay() === 6 ? -1 : 1));
      holidays.push({name:`${name} (observed)`,date:dateKey(observed),federal:true,observed:true});
    }
  };
  add('New Year’s Day',new Date(year,0,1),true,true);
  add('Martin Luther King Jr. Day',nth(year,0,1,3),true);
  add('Presidents’ Day',nth(year,1,1,3),true);
  const memorial = new Date(year,5,0); memorial.setDate(memorial.getDate() - (memorial.getDay()+6)%7);
  add('Memorial Day',memorial,true);
  if (year >= 2021) add('Juneteenth',new Date(year,5,19),true,true);
  add('Independence Day',new Date(year,6,4),true,true);
  add('Labor Day',nth(year,8,1,1),true);
  add('Columbus Day / Indigenous Peoples’ Day',nth(year,9,1,2),true);
  add('Veterans Day',new Date(year,10,11),true,true);
  add('Thanksgiving',nth(year,10,4,4),true);
  add('Christmas Day',new Date(year,11,25),true,true);
  for (const [name,month,day] of [['Valentine’s Day',1,14],['St. Patrick’s Day',2,17],['Halloween',9,31],['Christmas Eve',11,24],['New Year’s Eve',11,31]]) add(name,new Date(year,month,day));
  add('Easter Sunday',easter(year)); add('Mother’s Day',nth(year,4,0,2)); add('Father’s Day',nth(year,5,0,3));
  const election = nth(year,10,1,1); election.setDate(election.getDate()+1); add('Election Day',election);
  holidays.sort((a,b) => a.date.localeCompare(b.date));
  cache.set(year,holidays); return holidays;
}
export function holidaysInRange(start,end) {
  const from = localDate(start), to = localDate(end), first = dateKey(from), last = dateKey(to), holidays = [];
  // Include adjacent years for Jan 1 observed on Dec 31.
  for (let year=from.getFullYear()-1;year<=to.getFullYear()+1;year++) holidays.push(...usHolidays(year));
  return holidays.filter(holiday => holiday.date>=first && holiday.date<last).sort((a,b) => a.date.localeCompare(b.date));
}
export function holidaysEnabled() { try { return localStorage.getItem('hh_holidays') !== '0'; } catch { return true; } }
export function holidayEvents(start,end) {
  if (!holidaysEnabled()) return [];
  return holidaysInRange(start,end).map(holiday => ({id:`holiday:${holiday.date}:${holiday.name}`,title:holiday.name,start:holiday.date,end:dateKey(nextDay(holiday.date)),allDay:true,editable:false,startEditable:false,durationEditable:false,extendedProps:{holiday:true,federal:holiday.federal,observed:holiday.observed}}));
}
