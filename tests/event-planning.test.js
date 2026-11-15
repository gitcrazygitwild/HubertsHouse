import test from 'node:test';
import assert from 'node:assert/strict';
import { overlappingEvents, preferredCalendar } from '../event-planning.js';
process.env.TZ = 'America/New_York';
const event = (id, start, end, owner = 'both', allDay = false) => ({id,title:id,start,end,allDay,extendedProps:{sourceId:id,owner}});
test('overlap warnings respect people, existing events, adjacent boundaries and all-day end dates', () => {
 const events = [event('a','2026-11-15T09:00','2026-11-15T10:00','hanry'),event('b','2026-11-15T09:00','2026-11-15T10:00','karena'),event('c','2026-11-15T09:30','2026-11-15T10:30'),event('d','2026-11-16','2026-11-17','both',true)];
 assert.deepEqual(overlappingEvents({start:'2026-11-15T09:15',end:'2026-11-15T09:45',owner:'hanry'},events).map(x=>x.id),['a','c']);
 assert.deepEqual(overlappingEvents({id:'c',start:'2026-11-15T10:00',end:'2026-11-15T11:00',owner:'both'},events),[]);
 assert.deepEqual(overlappingEvents({start:'2026-11-15',end:'2026-11-16',allDay:true,owner:'both'},events).map(x=>x.id),['a','b','c','d']);
 assert.deepEqual(overlappingEvents({start:'2026-11-17',allDay:true,owner:'both'},events),[]);
 assert.deepEqual(overlappingEvents({start:'',end:'',owner:'both'},events),[]);
});
test('a removed, hidden or read-only preferred calendar falls back to the household', () => {
 const calendars = [{id:'apple',writable:true,selected:true},{id:'readonly',writable:false,selected:true},{id:'hidden',writable:true,selected:false}];
 assert.equal(preferredCalendar('apple',calendars),'apple');
 for(const key of ['readonly','hidden','deleted',null]) assert.equal(preferredCalendar(key,calendars),'household');
});
