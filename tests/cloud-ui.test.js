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
 w.eval(source+';window.cloudTest={initCloudCalendar,refreshCloud,setCloudRange};');
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
test("Karena sees hanry's shared calendars without signing in to Apple, and can't change them",async t=>{
 const calls=[];const {dom,doc,api}=await setup(async(name,data)=>{calls.push(name);return name==='calendarStatus'?{connected:true,shared:true,calendars:[{id:'family',name:'Family',writable:true}],selected:['family']}:{events:[],checkedAt:new Date().toISOString()};});t.after(()=>dom.window.close());
 let calendars;await api.initCloudCalendar({}, {onEvents:()=>{},onCalendars:c=>{calendars=c;}});
 const panel=doc.getElementById('icloudPanel');
 assert.match(panel.textContent,/Shared by your household/);assert.match(panel.textContent,/Family/);
 assert.equal(doc.getElementById('calendarChoices'),null);assert.equal(doc.getElementById('disconnectCloud'),null);
 assert.ok(doc.getElementById('appleEmail'),'she can still connect her own account if she wants');
 assert.deepEqual(calendars.selected,['family']);assert.ok(calls.includes('calendarEvents'));
});
test('the connecting member can stop and resume sharing with the household',async t=>{
 const sent=[];const {dom,w,doc,api}=await setup(async(name,data)=>{if(name==='calendarShare')sent.push(data.shareWithHousehold);return name==='calendarStatus'||name==='calendarShare'?{connected:true,calendars:[{id:'family',name:'Family',writable:true}],selected:['family'],shareWithHousehold:name==='calendarShare'?data.shareWithHousehold:true}:{events:[],checkedAt:new Date().toISOString()};});t.after(()=>dom.window.close());
 await api.initCloudCalendar({}, {onEvents:()=>{},onCalendars:()=>{}});
 const box=doc.getElementById('shareCalendars');assert.equal(box.checked,true);
 box.checked=false;box.dispatchEvent(new w.Event('change',{bubbles:true}));await settle();
 box.checked=true;box.dispatchEvent(new w.Event('change',{bubbles:true}));await settle();
 assert.deepEqual(sent,[false,true]);
});
