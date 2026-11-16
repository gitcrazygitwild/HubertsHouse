import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {escapeHTML} from '../household-model.js';
import {renderHTML} from '../dom.js';
import {purrfectWindow,huckleberryPrediction,miaForecast} from '../baby-model.js';
import {predictionEntry,scorePredictions,MODELS} from '../prediction-log.js';
const settle = () => new Promise(resolve => setTimeout(resolve,20));
const connection = {connected:true,selected:'child',children:[{id:'child',name:'Frankie'}],timezone:'America/New_York'};
const snapshot = {childId:'child',name:'Frankie',checkedAt:new Date().toISOString(),sleeps:[],historyComplete:true,timer:{active:false},sweetspot:{time:null}};
async function fixture(handler) {
  const dom = new JSDOM(await readFile(new URL('../index.html',import.meta.url),'utf8'),{url:'https://house.test/',runScripts:'outside-only',pretendToBeVisual:true}), w=dom.window, notices=[];
  w.setInterval=()=>0; w.HTMLDialogElement.prototype.showModal=function(){this.open=true;}; w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  Object.assign(w,{config:{huckleberryServiceEnabled:true},getFunctions:()=>({}),httpsCallable:()=>async data=>({data:await handler(data)}),esc:escapeHTML,renderHTML,purrfectWindow,huckleberryPrediction,miaForecast,predictionEntry,scorePredictions,MODELS,renderFrankie:()=>{},initFrankie:()=>{},sampleHistory:()=>({sleeps:[],bottles:[]}),samplePredictions:()=>[],showNotice:value=>notices.push(value),showView:()=>{}});
  const source = (await readFile(new URL('../baby.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/\bexport /g,'');
  w.eval(source+';window.initBaby=initHuckleberry;'); await w.initBaby({}); return {dom,w,doc:w.document,notices};
}
test('Huckleberry password clears immediately; session and baby logs never go to browser storage', async t => {
  let finish, receivedPassword;
  const {dom,w,doc}=await fixture(async data => {
    if (data.action==='status') return {connected:false};
    if (data.action==='connect') { receivedPassword=data.password;return new Promise(resolve=>{finish=resolve;}); }
    if (data.action==='snapshot') return snapshot;
  });t.after(()=>dom.window.close());
  doc.getElementById('huckEmail').value='sample@example.com';doc.getElementById('huckPassword').value='private-password';
  doc.getElementById('huckConnectForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.equal(doc.getElementById('huckPassword').value,'');assert.equal(receivedPassword,'private-password');assert.equal(w.localStorage.length,0);
  finish(connection);await settle();assert.equal(doc.getElementById('huckPassword'),null);assert.equal(doc.getElementById('babyBadge').textContent,'Connected');assert.equal(w.localStorage.length,0);
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
