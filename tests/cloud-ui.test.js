import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {escapeHTML} from '../household-model.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
async function setup(call) {
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.setInterval=()=>0;
 Object.assign(w,{config:{calendarServiceEnabled:true,functionsRegion:'us-central1'},getFunctions:()=>({}),httpsCallable:(_functions,name)=>async data=>({data:await call(name,data)}),esc:escapeHTML,showNotice:()=>{}});
 let source=await readFile(new URL('../cloud-calendar.js',import.meta.url),'utf8');source=source.replace(/^import[^\n]+\n/gm,'').replace(/\bexport /g,'');
 w.eval(source+';window.cloudTest={initCloudCalendar,refreshCloud,setCloudRange,saveCloudEvent,saveCloudAssignment,deleteCloudEvent};');
 return {dom,w,doc:w.document,api:w.cloudTest};
}
test('passive Apple checks are deduplicated, while manual refresh and an uncovered range load again',async t=>{
 const calls=[];const {dom,api}=await setup(async(name,data)=>{calls.push({name,data});return name==='calendarStatus'?{connected:true,calendars:[],selected:[]}:{events:[],checkedAt:new Date().toISOString()};});t.after(()=>dom.window.close());
 await api.initCloudCalendar({}, {onEvents:()=>{},onCalendars:()=>{}});
 const reads=()=>calls.filter(call=>call.name==='calendarEvents');assert.equal(reads().length,1);
 await api.refreshCloud({force:false});assert.equal(reads().length,1);
 api.setCloudRange(new Date().toISOString(),new Date(Date.now()+86400000).toISOString());await settle();assert.equal(reads().length,1);
 await api.refreshCloud();assert.equal(reads().length,2);
 api.setCloudRange(new Date(Date.now()+70*86400000).toISOString(),new Date(Date.now()+80*86400000).toISOString());await settle();assert.equal(reads().length,4);
});
test('an Apple password is cleared immediately and never stored in browser storage',async t=>{
 let finish, sent;
 const {dom,w,doc,api}=await setup(async(name,data)=>{
   if(name==='calendarStatus')return {connected:false};
   if(name==='calendarConnect'){sent=data;return new Promise(resolve=>{finish=resolve;});}
 });t.after(()=>dom.window.close());
 await api.initCloudCalendar({}, {onEvents:()=>{},onCalendars:()=>{}});
 doc.getElementById('appleEmail').value='sample@example.com';doc.getElementById('applePassword').value='aaaa-bbbb-cccc-dddd';
 doc.getElementById('icloudForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(doc.getElementById('applePassword').value,'');assert.equal(sent.password,'aaaa-bbbb-cccc-dddd');assert.equal(w.localStorage.length,0);
 finish({connected:true,calendars:[],selected:[]});await settle();assert.equal(doc.getElementById('icloudBadge').textContent,'Connected');
 assert.equal(doc.getElementById('applePassword'),null);
});

test('a household member sees shared events and edit destinations without an Apple password prompt',async t=>{
 const calls=[],events=[],states=[];
 let state={connected:true,scope:'household',canManage:false,connectionVersion:'first',calendars:[{id:'family',name:'Family',writable:true}],selected:['family']};
 const oldEvent={id:'event',calendarId:'family',token:'resource',etag:'etag',uid:'event-uid',title:'Family plan',start:'2026-11-17T14:00:00Z',connectionVersion:'first'};
 const {dom,doc,api}=await setup(async(name,data)=>{
   calls.push({name,data});if(name==='calendarStatus')return state;
   if(name==='calendarEvents')return {events:[oldEvent],checklists:[],checkedAt:new Date().toISOString()};
   if(name==='calendarSave'){if(data.connectionVersion!==state.connectionVersion)throw new Error('Connection changed');return {saved:true};}
 });t.after(()=>dom.window.close());
 await api.initCloudCalendar({}, {onEvents:value=>events.push(value),onCalendars:value=>states.push(value)});
 assert.equal(doc.getElementById('applePassword'),null);assert.equal(doc.getElementById('calendarChoices'),null);assert.equal(doc.getElementById('disconnectCloud'),null);
 assert.match(doc.getElementById('icloudPanel').textContent,/create and edit/);assert.equal(events.at(-1)[0].id,'event');assert.equal(states.at(-1).calendars[0].writable,true);
 await api.saveCloudEvent({title:'Updated'},oldEvent,'family','request');assert.equal(calls.at(-1).data.connectionVersion,'first');
 state={...state,connectionVersion:'second'};await api.refreshCloud();
 await assert.rejects(api.saveCloudEvent({title:'Old draft'},oldEvent,'family','request'),/Connection changed/);
 assert.equal(calls.at(-1).data.connectionVersion,'first','A draft must retain the version of the event it opened');
 state={connected:false,scope:'household',canManage:false,connectionVersion:'disconnected'};await api.refreshCloud();
 assert.equal(events.at(-1).length,0);assert.equal(doc.getElementById('applePassword'),null);assert.match(doc.getElementById('icloudPanel').textContent,/disconnected/);
});
test('calendar owners see the sharing scope and disconnect confirmation names both dashboards',async t=>{
 const calls=[];let state={connected:true,scope:'household',canManage:true,connectionVersion:'first',calendars:[{id:'family',name:'Family',writable:true}],selected:['family']};
 const {dom,w,doc,api}=await setup(async(name,data)=>{
   calls.push({name,data});if(name==='calendarStatus')return state;
   if(name==='calendarEvents')return {events:[],checkedAt:new Date().toISOString()};
   if(name==='calendarDisconnect'){state={connected:false,scope:'household',canManage:true,connectionVersion:'disconnected'};return state;}
 });t.after(()=>dom.window.close());
 await api.initCloudCalendar({}, {onEvents:()=>{},onCalendars:()=>{}});
 assert.match(doc.getElementById('icloudPanel').textContent,/Unselected calendars stay private/);
 let prompt;w.confirm=text=>{prompt=text;return false;};doc.getElementById('disconnectCloud').click();
 assert.match(prompt,/both dashboards/);assert.equal(calls.some(call=>call.name==='calendarDisconnect'),false);
 w.confirm=()=>true;doc.getElementById('disconnectCloud').click();await settle();
 assert.equal(calls.find(call=>call.name==='calendarDisconnect').data.connectionVersion,'first');assert.ok(doc.getElementById('applePassword'));
});
