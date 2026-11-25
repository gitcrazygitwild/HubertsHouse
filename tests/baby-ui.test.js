import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {escapeHTML} from '../household-model.js';
import {renderHTML} from '../dom.js';
import {purrfectWindow,huckleberryPrediction,miaForecast,bottleForecast,averageCalls,sleepAwareBottle} from '../baby-model.js';
import {sweetspotEntry,sweetspotPatch,previousSweetspot,scorePredictions,recoveredEntry,guessRounds} from '../prediction-log.js';
import {logsHTML,describeLog,logKey} from '../baby-logs.js';
import {currentBedtime,morningPicks,MACK_EXCUSE} from '../cat-challenges.js';
import {dayStripSVG,STRIP_LANES,CATS} from '../day-strip.js';
import {hatGuess,hatSeed,sweetspotQuiet} from '../mack-hat.js';
const settle = () => new Promise(resolve => setTimeout(resolve,20));
const connection = {connected:true,selected:'child',children:[{id:'child',name:'Frankie'}],timezone:'America/New_York'};
const snapshot = {childId:'child',name:'Frankie',checkedAt:new Date().toISOString(),sleeps:[],historyComplete:true,timer:{active:false},sweetspot:{time:null}};
async function fixture(handler) {
  const dom = new JSDOM(await readFile(new URL('../index.html',import.meta.url),'utf8'),{url:'https://house.test/',runScripts:'outside-only',pretendToBeVisual:true}), w=dom.window, notices=[];
  w.setInterval=()=>0; w.HTMLDialogElement.prototype.showModal=function(){this.open=true;}; w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  Object.assign(w,{config:{huckleberryServiceEnabled:true},getFunctions:()=>({}),httpsCallable:()=>async data=>({data:await handler(data)}),esc:escapeHTML,renderHTML,dayStripSVG,STRIP_LANES,CATS,guessRounds,hatGuess,hatSeed,sweetspotQuiet,currentBedtime,morningPicks,MACK_EXCUSE,purrfectWindow,huckleberryPrediction,miaForecast,bottleForecast,averageCalls,sleepAwareBottle,sweetspotEntry,sweetspotPatch,previousSweetspot,scorePredictions,recoveredEntry,logsHTML,describeLog,logKey,renderFrankie:()=>{},initFrankie:()=>{},sampleHistory:()=>({sleeps:[],bottles:[]}),samplePredictions:()=>[],showNotice:value=>notices.push(value),showView:()=>{}});
  // The parts split out of baby.js load first, each in its own scope, exposing its init.
  for (const [file, name] of [['night-mode.js','initNightMode'],['recent-logs.js','initRecentLogs'],['log-sheet.js','initLogSheet'],['nap-recovery.js','initNapRecovery']]) {
    const part = (await readFile(new URL(`../${file}`,import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/\bexport /g,'');
    w.eval(`(() => { ${part}\nwindow.${name}=${name}; })();`);
  }
  const source = (await readFile(new URL('../baby.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/\bexport /g,'');
  w.eval(source+';window.initBaby=initHuckleberry;'); await w.initBaby({}); return {dom,w,doc:w.document,notices};
}
test('Huckleberry password clears immediately; session and baby logs never go to browser storage', async t => {
  let finish, receivedPassword, connected=false;
  const {dom,w,doc}=await fixture(async data => {
    if (data.action==='status') return connected ? connection : {connected:false};
    if (data.action==='connect') { receivedPassword=data.password;return new Promise(resolve=>{finish=resolve;}); }
    if (data.action==='snapshot') return snapshot;
  });t.after(()=>dom.window.close());
  doc.getElementById('huckEmail').value='sample@example.com';doc.getElementById('huckPassword').value='private-password';
  doc.getElementById('huckConnectForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.equal(doc.getElementById('huckPassword').value,'');assert.equal(receivedPassword,'private-password');assert.equal(w.localStorage.length,0);
  connected=true;finish(connection);await settle();assert.equal(doc.getElementById('huckPassword'),null);assert.equal(doc.getElementById('babyBadge').textContent,'Connected');assert.equal(w.localStorage.length,0);
});
test('retrying an uncertain baby save reuses its request ID; refresh failure cannot cause a second save', async t => {
  const writes=[];let snapshots=0;
  const {dom,w,doc,notices}=await fixture(async data => {
    if(data.action==='status')return connection;
    if(data.action==='snapshot'){if(++snapshots>1)throw new Error('Refresh interrupted');return snapshot;}
    if(data.action==='write'){writes.push(structuredClone(data));if(writes.length===1)throw new Error('Save response interrupted');return {saved:true,duplicate:true};}
  });t.after(()=>dom.window.close());
  doc.querySelector('[data-baby-log="diaper"]').click();doc.getElementById('babyLogDiaper').value='poo';
  const submit=()=>doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
  submit();await settle();assert.equal(doc.getElementById('babyLogDialog').open,true);assert.match(doc.getElementById('babyLogError').textContent,/Save response/);
  submit();await settle();assert.equal(writes.length,2);assert.equal(writes[0].entry.requestId,writes[1].entry.requestId);assert.equal(writes[1].childId,'child');
  assert.equal(doc.getElementById('babyLogDialog').open,false);assert.ok(notices.includes('Saved in Huckleberry.'));assert.match(doc.getElementById('babyError').textContent,/Refresh interrupted/);
});

test('the shared profile is editable without another login and profile changes appear after refresh',async t=>{
  let state={...connection,scope:'household',connectionVersion:'first',sweetspotNaps:'4'}, selected;
  const {dom,w,doc,notices}=await fixture(async data=>{
    if(data.action==='status')return state;
    if(data.action==='snapshot')return {...snapshot,childId:state.selected,timezone:state.timezone,connection:state};
    if(data.action==='select') { selected=data;state={...state,timezone:data.timezone,sweetspotNaps:data.sweetspotNaps,connectionVersion:'second'};return state; }
  });t.after(()=>dom.window.close());
  assert.equal(doc.getElementById('huckPassword'),null);
  assert.match(doc.getElementById('babyConnection').textContent,/Shared with your household/);
  doc.getElementById('huckNapPlan').value='3';doc.getElementById('huckZone').value='America/Chicago';
  doc.getElementById('huckProfileForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(selected.connectionVersion,'first');assert.equal(selected.sweetspotNaps,'3');assert.equal(selected.timezone,'America/Chicago');
  assert.ok(notices.includes('Baby settings saved for the household.'));
  state={...state,selected:'other',children:[...state.children,{id:'other',name:'Other child'}],sweetspotNaps:'auto',connectionVersion:'third'};
  doc.getElementById('babyRefresh').click();await settle();
  assert.equal(doc.getElementById('huckChild').value,'other');assert.equal(doc.getElementById('huckNapPlan').value,'auto');
  state={connected:false,scope:'household',connectionVersion:'disconnected'};
  doc.getElementById('babyRefresh').click();await settle();
  assert.ok(doc.getElementById('huckConnectForm'));assert.equal(doc.getElementById('babySleep').disabled,true);
  assert.equal(doc.querySelector('[data-baby-log="diaper"]').disabled,true);
});
test('an open log keeps its original connection version when the other adult changes the profile',async t=>{
  let state={...connection,scope:'household',connectionVersion:'first'}, written;
  const {dom,w,doc}=await fixture(async data=>{
    if(data.action==='status')return state;
    if(data.action==='snapshot')return {...snapshot,connection:state};
    if(data.action==='write'){written=data;throw Object.assign(new Error('The household Huckleberry settings changed. Refresh and try again.'),{code:'functions/aborted'});}
  });t.after(()=>dom.window.close());
  doc.querySelector('[data-baby-log="diaper"]').click();
  state={...state,connectionVersion:'changed'};doc.getElementById('babyRefresh').click();await settle();
  doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(written.connectionVersion,'first');assert.equal(doc.getElementById('babyLogDialog').open,true);
  assert.match(doc.getElementById('babyLogError').textContent,/settings changed/);
});
test('disconnect explains the household impact and can be canceled',async t=>{
  const calls=[];
  const state={...connection,scope:'household',connectionVersion:'first'};
  const {dom,w,doc}=await fixture(async data=>{
    calls.push(data);
    if(data.action==='status')return state;
    if(data.action==='snapshot')return {...snapshot,connection:state};
    if(data.action==='disconnect')return {connected:false,scope:'household',connectionVersion:'disconnected'};
  });t.after(()=>dom.window.close());
  let prompt;w.confirm=text=>{prompt=text;return false;};doc.getElementById('huckDisconnect').click();
  assert.match(prompt,/everyone in the household/);assert.equal(calls.some(c=>c.action==='disconnect'),false);
  w.confirm=()=>true;doc.getElementById('huckDisconnect').click();await settle();
  assert.equal(calls.find(c=>c.action==='disconnect').connectionVersion,'first');assert.ok(doc.getElementById('huckConnectForm'));
});
test('Recent logs load when opened, edit through the log window and delete after confirming', async t => {
  const calls = [], now = Date.now(), at = minutes => new Date(now - minutes * 60000).toISOString();
  const entries = [
    {kind:'bottle',id:'b1',version:'5.000000001',start:at(30),amount:5,units:'oz',bottleType:'Formula'},
    {kind:'diaper',id:'d1',version:'6.000000001',start:at(60),mode:'pee'},
    {kind:'sleep',id:'s1',version:'7.000000001',start:at(180),end:at(120)}];
  const {dom,w,doc,notices} = await fixture(async data => {
    calls.push(data);
    if (data.action === 'status') return {...connection,connectionVersion:'v1'};
    if (data.action === 'snapshot') return snapshot;
    if (data.action === 'recent') return {days:7,entries};
    if (data.action === 'change') return {saved:true};
  }); t.after(() => dom.window.close());
  await settle();
  assert.equal(calls.filter(call => call.action === 'recent').length, 0, 'Nothing loads until the card is opened');
  const details = doc.getElementById('frankieLogsDetails'); details.open = true; details.dispatchEvent(new w.Event('toggle')); await settle();
  const list = doc.getElementById('frankieLogs');
  assert.match(list.textContent, /5 oz formula/); assert.match(list.textContent, /Wet diaper/); assert.match(list.textContent, /Sleep · 1h 0m/);
  doc.querySelector('[data-log-filter="diaper"]').click();
  assert.doesNotMatch(list.textContent, /formula/); assert.match(list.textContent, /Wet diaper/);
  doc.querySelector('[data-log-filter="all"]').click();
  // Edit: the log window opens prefilled and saves a change, not a new entry.
  doc.querySelector('[data-log-edit="bottle:b1"]').click();
  assert.equal(doc.getElementById('babyLogDialog').open, true); assert.equal(doc.getElementById('babyLogTitle').textContent, 'Edit bottle');
  assert.equal(doc.getElementById('babyLogAmount').value, '5'); assert.equal(doc.getElementById('babyLogNotesWrap').hidden, true);
  doc.getElementById('babyLogAmount').value = '6';
  doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit',{cancelable:true})); await settle();
  const edit = calls.find(call => call.action === 'change');
  assert.deepEqual({...edit.entry,start:undefined}, {change:'edit',kind:'bottle',id:'b1',version:'5.000000001',start:undefined,amount:6,units:'oz',bottleType:'Formula'});
  assert.equal(edit.childId, 'child'); assert.equal(edit.connectionVersion, 'v1');
  assert.equal(calls.some(call => call.action === 'write'), false); assert.ok(notices.includes('Updated in Huckleberry.'));
  // Delete asks first; saying no sends nothing.
  let answer = false; w.confirm = message => { assert.match(message, /Wet diaper/); return answer; };
  doc.querySelector('[data-log-delete="diaper:d1"]').click(); await settle();
  assert.equal(calls.filter(call => call.action === 'change').length, 1);
  answer = true; doc.querySelector('[data-log-delete="diaper:d1"]').click(); await settle();
  assert.deepEqual({...calls.filter(call => call.action === 'change').at(-1).entry}, {change:'delete',kind:'diaper',id:'d1',version:'6.000000001'});
  assert.ok(notices.includes('Deleted from Huckleberry.'));
});
