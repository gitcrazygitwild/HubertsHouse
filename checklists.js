import { dateKey } from './household-model.js';
import { localDate } from './calendar-model.js';

export const checklistKey = items => JSON.stringify((items || []).map(item=>({id:item.id || '',text:item.text,done:!!item.done})));
export const eventChecklistKey = record => record.icloud ? `apple:${record.calendarId}:${record.uid}` : `household:${record.id}`;

// Apple occurrences share one checklist. Prefer a freshly loaded occurrence to
// its saved index entry, and the next occurrence to an old one.
export function eventChecklistGroups(records,now=new Date()) {
  const unique=new Map(),today=dateKey(now);
  const distance=record=>{const day=dateKey(localDate(record.checklistDate || record.start));return `${day<today?'1':'0'}:${day<today ? String(9999999999999-+localDate(day)) : day}`;};
  for(const record of records) {
    if(!record.checklist?.some(item=>item.text?.trim()))continue;
    const key=eventChecklistKey(record),previous=unique.get(key);
    if(!previous || (previous.checklistOnly && !record.checklistOnly) || (!!previous.checklistOnly===!!record.checklistOnly && distance(record)<distance(previous))) unique.set(key,record);
  }
  return [...unique].map(([key,record])=>({key,record,title:record.title,owner:record.owner || 'both',due:dateKey(localDate(record.checklistDate || record.start)),items:record.checklist.map((item,index)=>({...item,index,completed:!!item.done,title:item.text,kind:'task',list:record.title,owner:record.owner || 'both',due:dateKey(localDate(record.checklistDate || record.start))}))})).sort((a,b)=>a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}
