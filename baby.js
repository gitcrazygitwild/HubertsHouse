import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice, showView } from './household.js';
import { purrfectWindow, huckleberryPrediction } from './baby-model.js';
import { renderHTML } from './dom.js';

const $ = id => document.getElementById(id);
let service, demo = false, connection = {connected:false}, snapshot = null, error = '', busy = false, inFlight, lastAttempt = 0, pendingTimer;
let formChild, formId;
const zone = () => connection.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:zone()}) : '—';
const when = value => value ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone()}) : 'No entry yet';
const inputTime = value => { const date = new Date(value); return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
const message = e => e.code === 'functions/not-found' ? 'The Huckleberry service is not available yet.' : e.message || 'Huckleberry could not be reached. Try again shortly.';
async function call(action, data = {}) { return (await service({action,...data})).data; }
function home() {
  $('babyTitle').textContent = snapshot ? `${snapshot.name}’s little rhythm.` : 'Little rhythms, together.';
  $('babyBadge').textContent = demo ? 'Sample data' : error ? 'Needs attention' : connection.connected ? 'Connected' : 'Connect Huckleberry';
  $('babyError').textContent = error;
  $('babySettingsError').textContent = error;
  $('babyChecked').textContent = snapshot ? `${demo ? 'Sample preview · ' : ''}Checked ${when(snapshot.checkedAt)} · ${zone().replaceAll('_',' ')}. Checks every two minutes while Home or Settings is visible.` : 'Sleep, bottles, and diaper changes in one place.';
  const enabled = !!snapshot && !!connection.selected;
  document.querySelectorAll('[data-baby-log],#babySleep').forEach(button => { button.disabled = busy || !enabled; });
  $('babyRefresh').disabled = busy || !connection.selected;
  $('babySleep').textContent = snapshot?.timer?.active ? '☀ Finish sleep' : '☾ Start sleep';
  if (!snapshot) {
    renderHTML($('babyPredictions'), `<div class="baby-intro"><span class="baby-orbit" aria-hidden="true">☾</span><div><h3>A softer landing for the next nap.</h3><p>${connection.connected ? 'Choose a child profile in Settings, then refresh here.' : 'Connect Huckleberry in Settings to log the little moments and compare two nap estimates.'}</p></div></div>`);
    renderHTML($('babyStats'),''); return;
  }
  const huck = huckleberryPrediction(snapshot), own = purrfectWindow({sleeps:snapshot.sleeps,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  const outdated = Date.now() - Date.parse(snapshot.checkedAt) > 10 * 60000;
  renderHTML($('babyPredictions'), `<article class="nap-card huck-nap"><div class="nap-label"><span>HUCKLEBERRY</span><span>${demo ? 'Sample prediction' : 'SweetSpot®'}</span></div><h3>${huck.available ? esc(time(huck.time)) : 'Waiting for a prediction'}</h3><span class="nap-state">${huck.sleeping ? 'Sleep in progress' : huck.expired ? 'Previous prediction · passed' : huck.staleRead ? 'Saved prediction · stale' : huck.available ? 'Stored in Huckleberry' : 'From your Huckleberry account'}</span><p>${esc(huck.available ? huck.note : huck.reason)} Your Huckleberry plan must include SweetSpot.</p></article>
    <article class="nap-card purr-nap"><div class="nap-label"><span>HUBERT’S PURRFECT WINDOW</span><span aria-hidden="true">🐾</span></div><h3>${own.available ? `${esc(time(own.start))} – ${esc(time(own.end))}` : 'Learning your rhythm'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : own.available ? `${esc(own.pattern)} · ${own.phase === 'passed' ? 'window passed' : own.phase === 'within' ? 'in the window' : 'next daytime window'}` : 'Your own sleep-history estimate'}</span><p>${own.available ? `Based on ${own.samples} logged wake windows across ${own.days} days${own.matchedTime ? ', around this time of day' : ''}. Center: ${esc(time(own.target))}.` : esc(own.reason)}</p></article>`);
  const timer = snapshot.timer, elapsed = timer?.start ? Math.max(0,Math.floor(((timer.paused ? Date.parse(timer.end) : Date.now()) - Date.parse(timer.start)) / 60000)) : 0;
  const latest = snapshot.sleeps.at(-1), bottle = snapshot.lastBottle, diaper = snapshot.lastDiaper;
  renderHTML($('babyStats'), `<div><span>☾ Sleep</span><strong>${timer?.active ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m${timer.paused ? ' · paused' : ' · asleep'}` : latest ? `Awake since ${esc(time(latest.end))}` : 'No sleep logged'}</strong><small>${timer?.active ? `Started ${esc(when(timer.start))}` : latest ? esc(when(latest.end)) : 'Start a timer or log a finished sleep'}</small></div><div><span>◒ Last bottle</span><strong>${bottle ? `${esc(bottle.amount ?? '—')} ${esc(bottle.units)} · ${esc(bottle.type)}` : 'No bottle logged'}</strong><small>${esc(when(bottle?.time))}</small></div><div><span>♡ Last diaper</span><strong>${diaper ? ({pee:'Wet',poo:'Dirty',both:'Wet + dirty',dry:'Dry'}[diaper.mode] || 'Diaper change') : 'No change logged'}</strong><small>${esc(when(diaper?.time))}</small></div>`);
}
function settings() {
  const panel = $('babyConnection');
  if (demo || !config.huckleberryServiceEnabled) {
    panel.innerHTML = `<p>${demo ? 'This preview uses sample baby logs. Try the controls on Home; nothing is sent to Huckleberry.' : 'The private Huckleberry service needs to be deployed before connecting an account.'}</p>`; home(); return;
  }
  if (!connection.connected) {
    panel.innerHTML = `<form id="huckConnectForm" class="connection-form"><p class="tiny muted">Use your Huckleberry app login. This connection currently supports email/password sign-in. Apple and Google sign-in passwords do not work here.</p><label class="field"><span>Huckleberry email</span><input id="huckEmail" type="email" autocomplete="username" required /></label><label class="field"><span>Huckleberry password</span><input id="huckPassword" type="password" autocomplete="current-password" required /></label><label class="field"><span>Baby’s time zone</span><input id="huckZone" value="${esc(zone())}" required placeholder="America/New_York" aria-describedby="huckZoneHint" /></label><p id="huckZoneHint" class="tiny muted">Used for sleep times and daily patterns. It does not change your login. For Eastern time, use America/New_York; daylight saving is handled automatically.</p><button type="submit" class="btn btn-primary">Connect Huckleberry</button></form>`;
    $('huckConnectForm').addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; const form = e.currentTarget;
      const data = {email:$('huckEmail').value,password:$('huckPassword').value,timezone:$('huckZone').value.trim()};
      $('huckPassword').value = ''; busy = true; form.querySelector('button').disabled = true; error = ''; home();
      try { connection = await call('connect',data); snapshot = null; pendingTimer = null; settings(); await refresh(true); showNotice(connection.selected ? 'Huckleberry connected.' : 'Connected. Choose a child profile.'); }
      catch (e) { error = message(e); } finally { data.password = ''; busy = false; form.querySelector('button').disabled = false; home(); }
    });
  } else {
    panel.innerHTML = `<form id="huckProfileForm" class="connection-form"><label class="field"><span>Child profile</span><select id="huckChild" required><option value="">Choose a child</option>${connection.children.map(child => `<option value="${esc(child.id)}" ${connection.selected === child.id ? 'selected' : ''}>${esc(child.name)}</option>`).join('')}</select></label><label class="field"><span>Baby’s time zone</span><input id="huckZone" value="${esc(zone())}" required /></label><div class="connection-actions"><button class="btn btn-primary" type="submit">Save profile</button><button class="btn" id="huckDisconnect" type="button">Disconnect</button></div></form><p class="tiny">Connected for this household login. Each adult can connect their own Huckleberry login with access to the same child.</p>`;
    $('huckProfileForm').addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; busy = true; error = ''; home(); const button = e.currentTarget.querySelector('button'); button.disabled = true;
      try { await inFlight; connection = await call('select',{childId:$('huckChild').value,timezone:$('huckZone').value.trim()}); snapshot = null; pendingTimer = null; settings(); await refresh(true); showNotice('Baby profile saved.'); }
      catch (e) { error = message(e); } finally { busy = false; button.disabled = false; home(); }
    });
    $('huckDisconnect').addEventListener('click', async e => {
      if (busy || !confirm('Disconnect Huckleberry from this household login? Your Huckleberry logs stay in Huckleberry.')) return;
      busy = true; e.target.disabled = true; home();
      try { await inFlight; await call('disconnect'); connection = {connected:false}; snapshot = null; pendingTimer = null; error = ''; settings(); showNotice('Huckleberry disconnected.'); }
      catch (e) { error = message(e); } finally { busy = false; e.target.disabled = false; home(); }
    });
  }
  home();
}
async function refresh(force = false) {
  if (!connection.selected || demo) { home(); return; }
  if (inFlight) { await inFlight; if (!force) return; }
  if (!force && Date.now() - lastAttempt < 120000) { home(); return; }
  lastAttempt = Date.now();
  inFlight = (async () => { try { snapshot = await call('snapshot',{force}); error = ''; } catch (e) { error = message(e); } finally { home(); } })();
  try { await inFlight; } finally { inFlight = null; }
}
function demoWrite(entry) {
  if (entry.kind === 'sleep-start') snapshot.timer = {active:true,start:entry.start,uuid:entry.requestId};
  if (entry.kind === 'sleep-stop') { snapshot.sleeps.push({start:snapshot.timer.start,end:entry.start}); snapshot.timer = {active:false}; }
  if (entry.kind === 'sleep-log') { snapshot.sleeps.push({start:entry.start,end:entry.end}); snapshot.sleeps.sort((a,b) => Date.parse(a.start) - Date.parse(b.start)); }
  if (entry.kind === 'bottle') snapshot.lastBottle = {time:entry.start,amount:entry.amount,units:entry.units,type:entry.bottleType};
  if (entry.kind === 'diaper') snapshot.lastDiaper = {time:entry.start,mode:entry.mode};
  snapshot.checkedAt = new Date().toISOString();
}
async function write(entry, childId) {
  if (demo) demoWrite(entry); else await call('write',{entry,childId});
}
function openLog(kind) {
  if (busy || !snapshot) return;
  formChild = connection.selected; formId = crypto.randomUUID();
  $('babyLogForm').reset(); $('babyLogKind').value = kind; $('babyLogError').textContent = '';
  $('babyLogTitle').textContent = kind === 'bottle' ? 'A little bottle break.' : kind === 'diaper' ? 'Fresh start.' : 'Log a finished sleep.';
  $('babyLogStart').value = inputTime(Date.now() - (kind === 'sleep-log' ? 3600000 : 0)); $('babyLogEnd').value = inputTime(Date.now());
  $('babyLogZone').textContent = `Enter times in this device’s time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
  document.querySelectorAll('[data-log-fields]').forEach(group => { const active = group.dataset.logFields === kind; group.hidden = !active; group.querySelectorAll('input,select').forEach(input => { input.disabled = !active; }); });
  $('babyLogDialog').showModal();
}
function sampleSnapshot() {
  const now = Date.now(), sleeps = [];
  for (let day = 3; day >= 1; day--) for (const hour of [7,10,13,16]) {
    const start = new Date(); start.setDate(start.getDate() - day); start.setHours(hour,0,0,0);
    sleeps.push({start:start.toISOString(),end:new Date(+start + 3600000).toISOString()});
  }
  sleeps.push({start:new Date(now - 105 * 60000).toISOString(),end:new Date(now - 45 * 60000).toISOString()});
  return {childId:'sample-frankie',name:'Frankie',timezone:zone(),checkedAt:new Date().toISOString(),historyComplete:true,sleeps,timer:{active:false},sweetspot:{time:new Date(now + 70 * 60000).toISOString()},lastBottle:{time:new Date(now - 30 * 60000).toISOString(),amount:4,units:'oz',type:'Formula'},lastDiaper:{time:new Date(now - 60 * 60000).toISOString(),mode:'pee'}};
}
export async function initHuckleberry(app, options = {}) {
  demo = !!options.demo; service = app ? httpsCallable(getFunctions(app,config.functionsRegion),'huckleberry',{timeout:120000}) : null;
  if (demo) { connection = {connected:true,selected:'sample-frankie',children:[{id:'sample-frankie',name:'Frankie'}],timezone:zone()}; snapshot = sampleSnapshot(); }
  $('babySettings').addEventListener('click', () => { showView('settings'); $('huckleberrySettings').scrollIntoView?.({behavior:'smooth',block:'start'}); });
  $('babyRefresh').addEventListener('click', async () => { if (busy) return; busy = true; home(); try { await refresh(true); } finally { busy = false; home(); } });
  document.querySelectorAll('[data-baby-log]').forEach(button => button.addEventListener('click', () => openLog(button.dataset.babyLog)));
  $('babySleep').addEventListener('click', async () => {
    if (busy || !snapshot) return; busy = true; error = ''; home();
    const kind = snapshot.timer.active ? 'sleep-stop' : 'sleep-start';
    if (!pendingTimer || pendingTimer.kind !== kind || pendingTimer.timerId !== (snapshot.timer.uuid || null)) pendingTimer = {kind,start:new Date().toISOString(),requestId:crypto.randomUUID(),timerId:snapshot.timer.uuid || null,expectedStart:snapshot.timer.start || null};
    try { await write(pendingTimer,connection.selected); pendingTimer = null; showNotice(demo ? 'Sample sleep updated.' : kind === 'sleep-start' ? 'Sleep started in Huckleberry.' : 'Sleep saved in Huckleberry.'); await refresh(true); }
    catch (e) { error = message(e); } finally { busy = false; home(); }
  });
  $('babyLogCancel').addEventListener('click', () => { if (!busy) $('babyLogDialog').close(); });
  $('babyLogDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('babyLogForm').addEventListener('input', () => { formId = crypto.randomUUID(); });
  $('babyLogForm').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const kind = $('babyLogKind').value, start = new Date($('babyLogStart').value), end = new Date($('babyLogEnd').value);
    if (isNaN(start) || +start > Date.now() + 60000 || +start < Date.now() - 30 * 86400000 || (kind === 'sleep-log' && (isNaN(end) || end <= start || +end > Date.now() + 60000 || end - start > 48 * 3600000))) { $('babyLogError').textContent = 'Choose valid times within the past 30 days. A finished sleep needs an end after its start, within 48 hours.'; return; }
    const entry = {kind,start:start.toISOString(),requestId:formId,notes:$('babyLogNotes').value};
    if (kind === 'sleep-log') entry.end = end.toISOString();
    if (kind === 'bottle') Object.assign(entry,{amount:Number($('babyLogAmount').value),units:$('babyLogUnits').value,bottleType:$('babyLogMilk').value});
    if (kind === 'diaper') entry.mode = $('babyLogDiaper').value;
    const controls = [...e.currentTarget.querySelectorAll('input,textarea,select,button')].filter(control => !control.disabled);
    busy = true; controls.forEach(control => { control.disabled = true; }); $('babyLogError').textContent = ''; home();
    try { await write(entry,formChild); $('babyLogDialog').close(); showNotice(demo ? 'Sample log saved.' : 'Saved in Huckleberry.'); await refresh(true); }
    catch (e) { $('babyLogError').textContent = message(e); }
    finally { busy = false; controls.forEach(control => { control.disabled = false; }); home(); }
  });
  settings();
  if (!demo && config.huckleberryServiceEnabled) {
    try { connection = await call('status'); settings(); await refresh(); } catch (e) { error = message(e); home(); }
  }
  const tick = () => { if (document.visibilityState !== 'visible' || busy) return; home(); if (!$('view-today').classList.contains('hidden') || !$('view-settings').classList.contains('hidden')) refresh(); };
  setInterval(tick,60000); document.addEventListener('visibilitychange',tick);
}
