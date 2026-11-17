import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice, showView } from './household.js';
import { purrfectWindow, huckleberryPrediction, miaForecast } from './baby-model.js';
import { sweetspotEntry, sweetspotPatch, previousSweetspot, scorePredictions } from './prediction-log.js';
import { sampleHistory, samplePredictions } from './baby-sample.js';
import { renderFrankie, initFrankie } from './frankie.js';
import { renderHTML } from './dom.js';

const $ = id => document.getElementById(id);
let service, demo = false, connection = {connected:false}, snapshot = null, error = '', busy = false, inFlight, lastAttempt = 0, pendingTimer;
let formChild, formVersion, formId, predictionStore = null, predictions = [], lastLogged = '';
const zone = () => connection.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:zone()}) : '—';
const when = value => value ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone()}) : 'No entry yet';
const inputTime = value => { const date = new Date(value); return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
const message = e => e.code === 'functions/not-found' ? 'The Huckleberry service is not available yet.' : e.message || 'Huckleberry could not be reached. Try again shortly.';
async function call(action, data = {}) { return (await service({action,...data})).data; }
function adoptConnection(next) {
  if (JSON.stringify(next) === JSON.stringify(connection)) return;
  connection = next; snapshot = null; pendingTimer = null;
  settings();
}
function home() {
  if ($('huckNapPlanHint')) $('huckNapPlanHint').textContent = napPlanHint();
  $('babyTitle').textContent = snapshot ? `${snapshot.name}’s little rhythm.` : 'Little rhythms, together.';
  $('babyBadge').textContent = demo ? 'Sample data' : error ? 'Needs attention' : connection.connected ? 'Connected' : 'Connect Huckleberry';
  $('babyError').textContent = error;
  $('babySettingsError').textContent = error;
  $('babyChecked').textContent = snapshot ? `${demo ? 'Sample preview · ' : ''}Checked ${when(snapshot.checkedAt)} · ${zone().replaceAll('_',' ')}. Checks every two minutes while Home or Settings is visible.` : 'Sleep, bottles, and diaper changes in one place.';
  const enabled = !!snapshot && !!connection.selected;
  document.querySelectorAll('[data-baby-log],#babySleep').forEach(button => { button.disabled = busy || !enabled; });
  $('babyRefresh').disabled = busy;
  $('babySleep').textContent = snapshot?.timer?.active ? '☀ Finish sleep' : '☾ Start sleep';
  if (!snapshot) {
    renderHTML($('babyPredictions'), `<div class="baby-intro"><span class="baby-orbit" aria-hidden="true">☾</span><div><h3>A softer landing for the next nap.</h3><p>${connection.connected ? 'Choose a child profile in Settings, then refresh here.' : 'Connect Huckleberry in Settings to log the little moments and compare three nap predictions.'}</p></div></div>`);
    renderHTML($('babyStats'),''); renderHTML($('babyScore'),''); frankie(); glance(); return;
  }
  const huck = huckleberryPrediction(snapshot), own = purrfectWindow({sleeps:snapshot.sleeps,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  const mia = miaForecast({sleeps:snapshot.sleeps,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  logPredictions(huck); glance(huck, own, mia);
  const score = scorePredictions(predictions, snapshot.sleeps, snapshot.timer, zone()), leader = score.summary.find(model => model.key === score.leader);
  const hmText = minutes => `${Math.floor(minutes / 60)}h ${minutes % 60}m`, signed = minutes => `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)}m`;
  const miaWhy = !mia.available ? '' : mia.kind === 'bedtime'
    ? [`bedtime usually comes ${hmText(mia.baseMinutes)} after the last nap, around ${time(mia.usualBedtime)}`, mia.clockShare >= 60 ? 'leaning on her steady bedtime routine' : mia.clockShare <= 40 ? 'leaning on her wake window' : '', mia.trendMinutes ? `${signed(mia.trendMinutes)} for this week’s trend` : '', mia.napMinutes ? `${signed(mia.napMinutes)} because the last nap was ${mia.previousNap}m (usually ${mia.typicalNap}m)` : ''].filter(Boolean).join(', ')
    : [`nap ${mia.napNumber} usually comes ${hmText(mia.baseMinutes)} after waking`, mia.trendMinutes ? `${signed(mia.trendMinutes)} for this week’s trend` : '', mia.napMinutes ? `${signed(mia.napMinutes)} because the last nap was ${mia.previousNap}m (usually ${mia.typicalNap}m)` : '', mia.nightMinutes ? `${signed(mia.nightMinutes)} because last night was ${hmText(mia.lastNight)} (usually ${hmText(mia.typicalNight)})` : ''].filter(Boolean).join(', ');
  const miaWhat = mia.kind === 'bedtime' ? `bedtime after ${mia.napsToday} nap${mia.napsToday === 1 ? '' : 's'}` : `nap ${mia.napNumber} of the day`;
  const outdated = Date.now() - Date.parse(snapshot.checkedAt) > 10 * 60000;
  renderHTML($('babyPredictions'), `<article class="nap-card huck-nap"><div class="nap-label"><span>HUCKLEBERRY</span><span>${demo ? 'Sample prediction' : `SweetSpot® · ${esc(napPlanLabel())}`}</span></div><h3>${huck.available ? esc(time(huck.time)) : 'Waiting for a prediction'}</h3><span class="nap-state">${huck.sleeping ? 'Sleep in progress' : huck.expired ? 'Previous prediction · passed' : huck.staleRead ? 'Saved prediction · stale' : huck.available ? 'Stored in Huckleberry' : 'From your Huckleberry account'}</span><p>${esc(huck.available ? huck.note : huck.reason)} Your Huckleberry plan must include SweetSpot.</p></article>
    <article class="nap-card purr-nap"><div class="nap-label"><span>HUBERT’S PURRFECT WINDOW</span><span aria-hidden="true">🐾</span></div><h3>${own.available ? `${esc(time(own.start))} – ${esc(time(own.end))}` : 'Learning your rhythm'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : own.available ? `${esc(own.pattern)} · ${own.phase === 'passed' ? 'window passed' : own.phase === 'within' ? 'in the window' : 'next daytime window'}` : 'Your own sleep-history estimate'}</span><p>${own.available ? `Based on ${own.samples} logged wake windows across ${own.days} days${own.matchedTime ? ', around this time of day' : ''}. Center: ${esc(time(own.target))}.` : esc(own.reason)}</p></article>
    <article class="nap-card mia-nap"><div class="nap-label"><span>MIA’S CATNAP FORECAST</span><span aria-hidden="true">🌤</span></div><h3>${mia.available ? `${esc(time(mia.start))} – ${esc(time(mia.end))}` : 'Gathering clues'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : mia.available ? `${esc(mia.confidence)} · ${esc(miaWhat)} · ${mia.phase === 'passed' ? 'window passed' : mia.phase === 'within' ? 'in the window' : 'up next'}` : 'Nap-by-nap and bedtime forecast'}</span><p>${mia.available ? `${esc(miaWhy.charAt(0).toUpperCase() + miaWhy.slice(1))}. Best guess: ${esc(time(mia.target))}.` : esc(mia.reason)}</p></article>`);
  renderHTML($('babyScore'), score.scoredNaps ? `<button type="button" class="baby-score" data-go="frankie"><span aria-hidden="true">🏆</span><span>${leader ? `<strong>${esc(leader.owner)}’s ${esc(leader.name)}</strong> is most accurate so far · ±${leader.mae} min across ${leader.n} naps` : `${score.scoredNaps} nap${score.scoredNaps === 1 ? '' : 's'} scored · a leader appears after three scored naps`}</span><span class="baby-score-link">Scoreboard →</span></button>` : '');
  const timer = snapshot.timer, elapsed = timer?.start ? Math.max(0,Math.floor(((timer.paused ? Date.parse(timer.end) : Date.now()) - Date.parse(timer.start)) / 60000)) : 0;
  const latest = snapshot.sleeps.at(-1), bottle = snapshot.lastBottle, diaper = snapshot.lastDiaper;
  renderHTML($('babyStats'), `<div><span>☾ Sleep</span><strong>${timer?.active ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m${timer.paused ? ' · paused' : ' · asleep'}` : latest ? `Awake since ${esc(time(latest.end))}` : 'No sleep logged'}</strong><small>${timer?.active ? `Started ${esc(when(timer.start))}` : latest ? esc(when(latest.end)) : 'Start a timer or log a finished sleep'}</small></div><div><span>◒ Last bottle</span><strong>${bottle ? `${esc(bottle.amount ?? '—')} ${esc(bottle.units)} · ${esc(bottle.type)}` : 'No bottle logged'}</strong><small>${esc(when(bottle?.time))}</small></div><div><span>♡ Last diaper</span><strong>${diaper ? ({pee:'Wet',poo:'Dirty',both:'Wet + dirty',dry:'Dry'}[diaper.mode] || 'Diaper change') : 'No change logged'}</strong><small>${esc(when(diaper?.time))}</small></div>`);
  frankie();
}
function frankie() {
  // A chart problem must never break Huckleberry refreshes or look like a login error.
  try { renderFrankie({snapshot,timezone:zone(),predictions,demo,connected:connection.connected}); } catch (e) { console.error('Frankie page could not render', e); }
}
// Shares a small live summary with the Now & Next strip.
function glance(huck, own, mia) {
  window.dispatchEvent(new CustomEvent('hh:baby',{detail:snapshot ? {name:snapshot.name,timer:snapshot.timer,lastWake:snapshot.sleeps.at(-1)?.end,lastBottle:snapshot.bottles?.at(-1)?.start || snapshot.lastBottle?.time,huck,purr:own,mia} : null}));
}
// Save Huckleberry's latest SweetSpot for this wake-up while Frankie is awake.
// Hubert's and Mia's guesses are replayed from history, so they need no saving.
function logPredictions(huck) {
  if (!predictionStore || !snapshot || snapshot.historyComplete === false) return;
  const lastWake = snapshot.sleeps.at(-1)?.end; if (!lastWake) return;
  const entry = sweetspotEntry({lastWake,childId:snapshot.childId,sweetspot:huck,previousTarget:previousSweetspot(predictions,lastWake),timer:snapshot.timer,timezone:zone()});
  if (!entry || !sweetspotPatch(predictions.find(item => item.id === entry.id), entry)) return;
  const signature = `${entry.id}:${entry.sweetspot.target}`;
  if (signature === lastLogged) return;
  lastLogged = signature;
  predictionStore.record(entry).catch(() => { lastLogged = ''; });
}
// Which of Huckleberry's per-plan SweetSpots to follow (default 4 naps).
const PLAN_NAMES = { '4':'4 naps a day', '3':'3 naps a day', auto:'Match the Huckleberry app' };
function napPlanLabel() {
  const s = snapshot?.sweetspot;
  if (!s?.selectedNapDay) return 'Huckleberry';
  return `${s.selectedNapDay}-nap plan${s.usingFallback ? ' (app’s choice)' : ''}`;
}
function napPlanField() {
  const plan = connection.sweetspotNaps || '4';
  return `<label class="field"><span>SweetSpot nap plan</span><select id="huckNapPlan">${Object.entries(PLAN_NAMES).map(([value, label]) => `<option value="${value}" ${plan === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p class="tiny muted" id="huckNapPlanHint">${esc(napPlanHint())}</p>`;
}
function napPlanHint() {
  const options = snapshot?.sweetspot?.options || [];
  return `${options.length ? `Huckleberry’s current predictions: ${options.map(o => `${o.naps} naps · ${time(o.time)}`).join(', ')}.` : 'Huckleberry’s current predictions appear here after a refresh.'} Huckleberry keeps one SweetSpot per nap plan; this choice is used on Home, in the scoreboard and in the newsletter.`;
}
function settings() {
  const panel = $('babyConnection');
  const settingsVersion = connection.connectionVersion;
  if (demo || !config.huckleberryServiceEnabled) {
    panel.innerHTML = `<p>${demo ? 'This preview uses sample baby logs. Try the controls on Home; nothing is sent to Huckleberry.' : 'The private Huckleberry service needs to be deployed before connecting an account.'}</p>`; home(); return;
  }
  if (!connection.connected) {
    panel.innerHTML = `<form id="huckConnectForm" class="connection-form"><p class="tiny muted">Connect once for everyone in your household. Both adults can log entries and manage the shared connection. Use your Huckleberry email/password login; Apple and Google sign-in passwords do not work here.</p><label class="field"><span>Huckleberry email</span><input id="huckEmail" type="email" autocomplete="username" required /></label><label class="field"><span>Huckleberry password</span><input id="huckPassword" type="password" autocomplete="current-password" required /></label><label class="field"><span>Baby’s time zone</span><input id="huckZone" value="${esc(zone())}" required placeholder="America/New_York" aria-describedby="huckZoneHint" /></label><p id="huckZoneHint" class="tiny muted">Used for sleep times and daily patterns. It does not change your login. For Eastern time, use America/New_York; daylight saving is handled automatically.</p><button type="submit" class="btn btn-primary">Connect Huckleberry</button></form>`;
    $('huckConnectForm').addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; const form = e.currentTarget;
      const data = {email:$('huckEmail').value,password:$('huckPassword').value,timezone:$('huckZone').value.trim(),connectionVersion:settingsVersion};
      $('huckPassword').value = ''; busy = true; form.querySelector('button').disabled = true; error = ''; home();
      try { connection = await call('connect',data); snapshot = null; pendingTimer = null; settings(); await refresh(true); showNotice(connection.selected ? 'Huckleberry connected.' : 'Connected. Choose a child profile.'); }
      catch (e) { error = message(e); } finally { data.password = ''; busy = false; form.querySelector('button').disabled = false; home(); }
    });
  } else {
    panel.innerHTML = `<p class="tiny"><strong>Shared with your household.</strong> Your household uses the same child profile, logs, and nap plan. Either of you can change these settings.</p><form id="huckProfileForm" class="connection-form"><label class="field"><span>Child profile</span><select id="huckChild" required><option value="">Choose a child</option>${connection.children.map(child => `<option value="${esc(child.id)}" ${connection.selected === child.id ? 'selected' : ''}>${esc(child.name)}</option>`).join('')}</select></label><label class="field"><span>Baby’s time zone</span><input id="huckZone" value="${esc(zone())}" required /></label>${napPlanField()}<div class="connection-actions"><button class="btn btn-primary" type="submit">Save for household</button><button class="btn" id="huckDisconnect" type="button">Disconnect household</button></div></form><p class="tiny muted">Changes apply to both of you, including Siri and the morning newsletter. Disconnecting here leaves your Huckleberry history intact.</p>`;
    $('huckProfileForm').addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; busy = true; error = ''; home(); const button = e.currentTarget.querySelector('button'); button.disabled = true;
      const selection = {childId:$('huckChild').value,timezone:$('huckZone').value.trim(),sweetspotNaps:$('huckNapPlan').value,connectionVersion:settingsVersion};
      try { await inFlight; connection = await call('select',selection); snapshot = null; pendingTimer = null; settings(); await refresh(true); showNotice('Baby settings saved for the household.'); }
      catch (e) { error = message(e); } finally { busy = false; button.disabled = false; home(); }
    });
    $('huckDisconnect').addEventListener('click', async e => {
      if (busy || !confirm('Disconnect Huckleberry for everyone in the household? Logging and predictions will pause for both of you until either person reconnects. Your Huckleberry history stays intact.')) return;
      busy = true; e.target.disabled = true; home();
      try { await inFlight; connection = await call('disconnect',{connectionVersion:settingsVersion}); snapshot = null; pendingTimer = null; error = ''; settings(); showNotice('Household Huckleberry disconnected.'); }
      catch (e) { error = message(e); } finally { busy = false; e.target.disabled = false; home(); }
    });
  }
  home();
}
async function refresh(force = false) {
  if (demo || !config.huckleberryServiceEnabled) { home(); return; }
  if (inFlight) { await inFlight; if (!force) return; }
  if (!force && Date.now() - lastAttempt < 120000) { home(); return; }
  lastAttempt = Date.now();
  inFlight = (async () => {
    try {
      adoptConnection(await call('status'));
      if (connection.selected) {
        const next = await call('snapshot',{force});
        if (next.connection) adoptConnection(next.connection);
        snapshot = next;
      }
      error = '';
    } catch (e) { error = message(e); }
    finally { home(); }
  })();
  try { await inFlight; } finally { inFlight = null; }
}
function demoWrite(entry) {
  if (entry.kind === 'sleep-start') snapshot.timer = {active:true,start:entry.start,uuid:entry.requestId};
  if (entry.kind === 'sleep-stop') { snapshot.sleeps.push({start:snapshot.timer.start,end:entry.start}); snapshot.timer = {active:false}; }
  if (entry.kind === 'sleep-log') { snapshot.sleeps.push({start:entry.start,end:entry.end}); snapshot.sleeps.sort((a,b) => Date.parse(a.start) - Date.parse(b.start)); }
  if (entry.kind === 'bottle') { snapshot.lastBottle = {time:entry.start,amount:entry.amount,units:entry.units,type:entry.bottleType}; snapshot.bottles.push({start:entry.start,amount:entry.amount,units:entry.units,type:entry.bottleType}); snapshot.bottles.sort((a,b) => Date.parse(a.start) - Date.parse(b.start)); }
  if (entry.kind === 'diaper') snapshot.lastDiaper = {time:entry.start,mode:entry.mode};
  snapshot.checkedAt = new Date().toISOString();
}
async function write(entry, childId, connectionVersion = connection.connectionVersion) {
  if (demo) demoWrite(entry); else await call('write',{entry,childId,connectionVersion});
}
// Start or finish the sleep timer, optionally at an earlier time ("fell asleep 3:40").
async function toggleSleep(at = null, want = null) {
  if (busy || !snapshot) return false;
  const kind = snapshot.timer.active ? 'sleep-stop' : 'sleep-start';
  if (want && want !== kind) { showNotice(want === 'sleep-stop' ? 'Frankie isn’t on a sleep timer right now.' : 'A sleep timer is already running. Finish it first.'); return false; }
  busy = true; error = ''; home();
  const start = (at ? new Date(Math.min(+new Date(at), Date.now())) : new Date()).toISOString();
  if (at || !pendingTimer || pendingTimer.kind !== kind || pendingTimer.timerId !== (snapshot.timer.uuid || null)) pendingTimer = {kind,start,requestId:crypto.randomUUID(),timerId:snapshot.timer.uuid || null,expectedStart:snapshot.timer.start || null};
  try { await write(pendingTimer,connection.selected); pendingTimer = null; showNotice(demo ? 'Sample sleep updated.' : kind === 'sleep-start' ? 'Sleep started in Huckleberry.' : 'Sleep saved in Huckleberry.'); await refresh(true); return true; }
  catch (e) { error = message(e); return false; } finally { busy = false; home(); }
}
// Quick add / ⌘K: a parsed Frankie log opens the prefilled window (timers act directly).
export function logBabyFromText(log) {
  if (!snapshot) { showView('settings'); showNotice('Connect Huckleberry in Settings to log for Frankie.'); return false; }
  if (log.kind === 'sleep-start' || log.kind === 'sleep-stop') return toggleSleep(log.kind === 'sleep-start' || +log.start < Date.now() - 60000 ? log.start : null, log.kind);
  return openLog(log.kind, log);
}
const LOG_LOOK = { bottle:['🍼','Bottle','Save bottle'], diaper:['♡','Diaper change','Save diaper'], 'sleep-log':['☾','Finished sleep','Save sleep'] };
const AMOUNTS = { oz:[2, 3, 4, 5, 6], ml:[60, 90, 120, 150, 180] };
const fmtAmount = (amount, units) => `${Number(amount)} ${units}`;
// The most recent bottle, from history or Huckleberry's own "last bottle".
function lastBottle() {
  const fromHistory = snapshot?.bottles?.at(-1), fromPrefs = snapshot?.lastBottle;
  const pick = !fromPrefs?.time || (fromHistory && Date.parse(fromHistory.start) >= Date.parse(fromPrefs.time)) ? fromHistory && { amount:fromHistory.amount, units:fromHistory.units, type:fromHistory.type } : { amount:fromPrefs.amount, units:fromPrefs.units, type:fromPrefs.type };
  return pick?.amount ? pick : null;
}
function relativeTime(value) {
  const date = new Date(value); if (isNaN(date)) return '';
  const minutes = Math.round((Date.now() - date) / 60000), clock = date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const label = date >= day ? 'Today' : date >= new Date(+day - 86400000) ? 'Yesterday' : date.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
  return minutes <= 1 && minutes >= -1 ? `Now · ${clock}` : `${label} · ${clock}${minutes > 1 && minutes < 600 ? ` · ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`} ago` : ''}`;
}
// Readouts, chip and pill states follow the form's real inputs.
function syncLogForm() {
  const kind = $('babyLogKind').value, start = $('babyLogStart').value, end = $('babyLogEnd').value;
  $('babyLogStartText').textContent = relativeTime(start);
  if (kind === 'sleep-log') {
    const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
    $('babyLogDuration').textContent = Number.isFinite(minutes) && minutes > 0 ? `${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m of sleep` : 'Wake-up must be after sleep started';
  }
  for (const group of document.querySelectorAll('[data-time-chips]')) {
    const input = $(group.dataset.timeChips), minutes = Math.round((Date.now() - new Date(input.value)) / 60000);
    group.querySelectorAll('[data-ago]').forEach(chip => chip.setAttribute('aria-pressed', String(Math.abs(minutes - Number(chip.dataset.ago)) <= 1)));
  }
  for (const group of document.querySelectorAll('[data-pills]')) {
    const value = $(group.dataset.pills).value;
    group.querySelectorAll('[data-value]').forEach(pill => pill.setAttribute('aria-pressed', String(pill.dataset.value === value)));
  }
  const units = $('babyLogUnits').value, amount = Number($('babyLogAmount').value);
  if ($('babyLogAmountChips').dataset.units !== units) {
    $('babyLogAmountChips').dataset.units = units;
    $('babyLogAmountChips').innerHTML = AMOUNTS[units].map(value => `<button type="button" data-amount="${value}">${value} ${units}</button>`).join('');
  }
  $('babyLogAmountChips').querySelectorAll('[data-amount]').forEach(chip => chip.setAttribute('aria-pressed', String(Number(chip.dataset.amount) === amount)));
}
// prefill: {start, end, amount, units, bottleType, mode} from quick add.
function openLog(kind, prefill = {}) {
  if (busy || !snapshot) return false;
  formChild = connection.selected; formVersion = connection.connectionVersion; formId = crypto.randomUUID();
  $('babyLogForm').reset(); $('babyLogKind').value = kind; $('babyLogError').textContent = ''; $('babyLogNotesWrap').open = false;
  const [icon, title, save] = LOG_LOOK[kind]; $('babyLogIcon').textContent = icon; $('babyLogTitle').textContent = title; $('babyLogSave').textContent = save;
  $('babyLogStartLabel').textContent = kind === 'sleep-log' ? 'Fell asleep' : kind === 'diaper' ? 'Changed' : 'When';
  $('babyLogStart').value = inputTime(prefill.start || Date.now() - (kind === 'sleep-log' ? 3600000 : 0)); $('babyLogEnd').value = inputTime(prefill.end || Date.now());
  // New bottles start from the last bottle logged (amount, units, milk).
  const last = lastBottle(), same = $('babyLogSame');
  $('babyLogAmount').value = String(prefill.amount ?? last?.amount ?? 4); $('babyLogUnits').value = prefill.units || last?.units || 'oz';
  $('babyLogMilk').value = prefill.bottleType || last?.type || 'Formula';
  same.hidden = !last; if (last) { same.textContent = `Same as last · ${fmtAmount(last.amount, last.units)} ${last.type || ''}`.trim(); same.dataset.amount = last.amount; same.dataset.units = last.units; same.dataset.type = last.type || 'Formula'; }
  if (prefill.mode) $('babyLogDiaper').value = prefill.mode;
  $('babyLogZone').textContent = `Times are in this device’s time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}).`;
  document.querySelectorAll('[data-log-fields]').forEach(group => { const active = group.dataset.logFields === kind; group.hidden = !active; group.querySelectorAll('input,select').forEach(input => { input.disabled = !active; }); });
  syncLogForm(); $('babyLogDialog').showModal();
  return true;
}
function sampleSnapshot() {
  const now = Date.now(), {sleeps, bottles} = sampleHistory(now), last = bottles.at(-1), wake = Date.parse(sleeps.at(-1).end);
  return {childId:'sample-frankie',name:'Frankie',timezone:zone(),checkedAt:new Date().toISOString(),historyComplete:true,feedsComplete:true,historyDays:45,sleeps,bottles,timer:{active:false},
    sweetspot:{time:new Date(Math.max(now + 20 * 60000, wake + 125 * 60000)).toISOString()},lastBottle:{time:last.start,amount:last.amount,units:last.units,type:last.type},lastDiaper:{time:new Date(now - 60 * 60000).toISOString(),mode:'pee'}};
}
function memoryPredictions(seed) {
  let entries = seed, notify;
  return { subscribe(cb) { notify = cb; cb(entries); }, async record(entry) { const saved = entries.find(item => item.id === entry.id), patch = sweetspotPatch(saved, entry); if (!patch) return; if (saved) Object.assign(saved, patch); else entries = [entry, ...entries]; notify?.(entries); } };
}
export async function initHuckleberry(app, options = {}) {
  demo = !!options.demo; service = app ? httpsCallable(getFunctions(app,config.functionsRegion),'huckleberry',{timeout:120000}) : null;
  if (demo) { connection = {connected:true,selected:'sample-frankie',children:[{id:'sample-frankie',name:'Frankie'}],timezone:zone()}; snapshot = sampleSnapshot(); }
  predictionStore = demo ? memoryPredictions(samplePredictions(snapshot.sleeps, zone())) : options.predictions || null;
  predictionStore?.subscribe(entries => { predictions = (entries || []).filter(entry => !snapshot || !entry.childId || entry.childId === snapshot.childId); home(); });
  initFrankie(frankie);
  $('babyScore').addEventListener('click', e => { if (e.target.closest('[data-go="frankie"]')) showView('frankie'); });
  $('babySettings').addEventListener('click', () => { showView('settings'); $('huckleberrySettings').scrollIntoView?.({behavior:'smooth',block:'start'}); });
  $('babyRefresh').addEventListener('click', async () => { if (busy) return; busy = true; home(); try { await refresh(true); } finally { busy = false; home(); } });
  document.querySelectorAll('[data-baby-log]').forEach(button => button.addEventListener('click', () => openLog(button.dataset.babyLog)));
  $('babySleep').addEventListener('click', () => toggleSleep());
  $('babyLogCancel').addEventListener('click', () => { if (!busy) $('babyLogDialog').close(); });
  $('babyLogDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('babyLogForm').addEventListener('input', () => { formId = crypto.randomUUID(); syncLogForm(); });
  $('babyLogClose').addEventListener('click', () => { if (!busy) $('babyLogDialog').close(); });
  // Chips, stepper and pills set the real inputs, then count as an edit.
  const changed = () => { formId = crypto.randomUUID(); syncLogForm(); };
  $('babyLogForm').addEventListener('click', e => {
    const chip = e.target.closest('[data-ago]'), step = e.target.closest('[data-step]'), amount = e.target.closest('[data-amount]'), pill = e.target.closest('[data-pills] [data-value]'), same = e.target.closest('#babyLogSame');
    if (chip) { const input = $(chip.closest('[data-time-chips]').dataset.timeChips); input.value = inputTime(Date.now() - Number(chip.dataset.ago) * 60000); changed(); }
    else if (step) { const ml = $('babyLogUnits').value === 'ml', input = $('babyLogAmount'), next = Math.max(ml ? 5 : 0.5, Number(input.value || 0) + Number(step.dataset.step) * (ml ? 10 : 0.5)); input.value = String(Math.round(next * 10) / 10); changed(); }
    else if (amount) { $('babyLogAmount').value = amount.dataset.amount; changed(); }
    else if (pill) { $(pill.closest('[data-pills]').dataset.pills).value = pill.dataset.value; changed(); }
    else if (same) { $('babyLogAmount').value = same.dataset.amount; $('babyLogUnits').value = same.dataset.units; $('babyLogMilk').value = same.dataset.type; changed(); }
  });
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
    try { await write(entry,formChild,formVersion); $('babyLogDialog').close(); showNotice(demo ? 'Sample log saved.' : 'Saved in Huckleberry.'); await refresh(true); }
    catch (e) { $('babyLogError').textContent = message(e); }
    finally { busy = false; controls.forEach(control => { control.disabled = false; }); home(); }
  });
  settings();
  if (!demo && config.huckleberryServiceEnabled) {
    await refresh();
  }
  const tick = () => { if (document.visibilityState !== 'visible' || busy) return; home(); if (['today','settings','frankie'].some(view => !$(`view-${view}`).classList.contains('hidden'))) refresh(); };
  setInterval(tick,60000); document.addEventListener('visibilitychange',tick);
}
