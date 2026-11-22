import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice, showView } from './household.js';
import { purrfectWindow, huckleberryPrediction, miaForecast, bottleForecast, ageLabel } from './baby-model.js';
import { currentBedtime, morningPicks, MACK_EXCUSE } from './cat-challenges.js';
import { sweetspotEntry, sweetspotPatch, previousSweetspot, scorePredictions, recoveredEntry } from './prediction-log.js';
import { sampleHistory, samplePredictions } from './baby-sample.js';
import { renderFrankie, initFrankie } from './frankie.js';
import { renderHTML } from './dom.js';
import { dayStripSVG } from './day-strip.js';
import { logsHTML, describeLog, logKey } from './baby-logs.js';

const $ = id => document.getElementById(id);
let service, demo = false, connection = {connected:false}, snapshot = null, error = '', busy = false, inFlight, lastAttempt = 0, pendingTimer;
let formChild, formVersion, formId, formEdit = null, predictionStore = null, predictions = [], lastLogged = '';
// Frankie page → Recent logs. Loaded only while that card is open.
const logs = {entries:null, filter:'all', showAll:false, loading:false, error:''};
let sampleLogs = null;
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
// Whatever goes wrong in the forecast code, say so on the card instead of leaving it blank.
function home() {
  try { drawHome(); }
  catch (e) {
    console.error('Frankie’s card failed', e);
    renderHTML($('babyPredictions'), `<p class="forecast-problem" role="alert">The predictions couldn’t be drawn: ${esc(e?.message || String(e))}. Tap Refresh; if it keeps happening, send a screenshot to Claude.</p>`);
  }
}
// Frankie page: each cat's window on the day strip, like Today's card, plus one line per cat.
function frankieGuesses(picks, morning) {
  const card = $('frankieGuessCard'), strip = $('frankieStrip'), list = $('frankieGuessList');
  if (!card || !strip || !list) return;
  card.hidden = !snapshot;
  if (!snapshot) return;
  renderHTML(strip, dayStripSVG({ sleeps:snapshot.sleeps, timer:snapshot.timer, picks, timezone:zone(), now:Date.now(), width:Math.max(320, Math.round(strip.clientWidth || card.clientWidth || 640)) }));
  const names = { hubert:'Hubert’s Purrfect Window', mia:'Mia’s Catnap Forecast', mack:'Mack’s borrowed SweetSpot' };
  const rows = ['hubert', 'mia', 'mack'].map(key => {
    const p = picks.find(pick => pick.key === key);
    if (!p) return `<li class="guess-${key} is-quiet"><span class="guess-dot" aria-hidden="true"></span><span><b>${esc(names[key])}</b><small>No call right now</small></span></li>`;
    const window = p.start && p.end ? `${esc(time(p.start))} – ${esc(time(p.end))}` : esc(time(p.target));
    return `<li class="guess-${key}"><span class="guess-dot" aria-hidden="true"></span><span><b>${esc(names[key])}</b><small>${esc(p.label)}${p.start && p.end ? ` · best guess ${esc(time(p.target))}` : ''}</small></span><strong>${window}</strong></li>`;
  }).join('');
  renderHTML(list, `<ul>${rows}</ul><p class="tiny muted">${morning ? 'She’s down for the night: these are the cats’ morning wake-up calls.' : 'Bands are each cat’s window; dots are their best guess. Shaded blocks are her sleeps so far today.'}</p>`);
}
function drawHome() {
  if ($('huckNapPlanHint')) $('huckNapPlanHint').textContent = napPlanHint();
  $('babyTitle').textContent = snapshot ? `${snapshot.name}’s little rhythm.` : 'Little rhythms, together.';
  $('babyBadge').textContent = demo ? 'Sample data' : error ? 'Needs attention' : connection.connected ? 'Connected' : 'Connect Huckleberry';
  $('babyError').textContent = error;
  $('babySettingsError').textContent = error;
  $('babyChecked').textContent = snapshot ? `${demo ? 'Sample preview · ' : ''}Checked ${when(snapshot.checkedAt)} · ${zone().replaceAll('_',' ')}. Checks every two minutes while Home or Settings is visible.` : 'Sleep, bottles, and diaper changes in one place.';
  const enabled = !!snapshot && !!connection.selected;
  document.querySelectorAll('[data-baby-log],#babySleep').forEach(button => { button.disabled = busy || !enabled; });
  $('babyNight').disabled = !snapshot;
  renderNight();
  $('babyRefresh').disabled = busy;
  $('babySleep').textContent = snapshot?.timer?.active ? '☀ Finish sleep' : '☾ Start sleep';
  if (!snapshot) {
    renderHTML($('babyPredictions'), `<div class="baby-intro"><span class="baby-orbit" aria-hidden="true">☾</span><div><h3>A softer landing for the next nap.</h3><p>${connection.connected ? 'Choose a child profile in Settings, then refresh here.' : 'Connect Huckleberry in Settings to log the little moments and compare three nap predictions.'}</p></div></div>`);
    renderHTML($('babyStats'),''); renderHTML($('babyScore'),''); if ($('babyStrip')) $('babyStrip').hidden = true; if ($('frankieGuessCard')) $('frankieGuessCard').hidden = true; frankie(); glance(); return;
  }
  const huck = huckleberryPrediction(snapshot), own = purrfectWindow({sleeps:snapshot.sleeps,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  const mia = miaForecast({sleeps:snapshot.sleeps,bottles:snapshot.bottles || [],birthdate:snapshot.birthdate,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  const nextBottle = bottleForecast(snapshot.bottles || [], {timezone:zone()});
  logPredictions(huck); glance(huck, own, mia, nextBottle);
  const score = scorePredictions(predictions, snapshot.sleeps, snapshot.timer, zone(), { bottles:snapshot.bottles || [], birthdate:snapshot.birthdate }), leader = score.summary.find(model => model.key === score.leader);
  const hmText = minutes => `${Math.floor(minutes / 60)}h ${minutes % 60}m`, signed = minutes => `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)}m`;
  // Asleep for the night: the three cats' morning wake-up calls.
  // Extras (morning calls, the day strip) must never stop the three cards from drawing.
  const problems = [], safely = (name, work, fallback = null) => { try { return work(); } catch (e) { console.error(`${name} failed`, e); problems.push(`${name}: ${e?.message || e}`); return fallback; } };
  const morning = safely('Morning calls', () => { const bedtime = currentBedtime(snapshot.sleeps, snapshot.timer, zone()); return bedtime ? morningPicks(snapshot.sleeps, zone(), bedtime, { birthdate:snapshot.birthdate }) : null; });
  const morningLine = morning && (morning.hubert || morning.mia || morning.mack) ? `<p class="morning-calls">☀ <strong>Morning wake-up calls:</strong> ${[['Hubert', morning.hubert], ['Mia', morning.mia], ['Mack', morning.mack]].filter(([, p]) => p).map(([cat, p]) => `${cat} ${esc(time(p.target))}`).join(' · ')}</p>` : '';
  const miaShown = mia.available ? mia : morning?.mia ? { available:true, kind:'morning', ...morning.mia, confidence:'Sunrise Forecast' } : mia;
  const miaWhy = !miaShown.available ? '' : miaShown.kind === 'morning' ? `blending how long her nights usually last with her usual wake-up time (${miaShown.clockShare}% on the clock)`
    : miaShown.kind === 'wake' ? `nap ${mia.napNumber} usually lasts ${hmText(mia.typicalMinutes)}; asleep since ${time(mia.sleepStart)}`
    : mia.kind === 'bedtime'
    ? [`bedtime usually comes ${hmText(mia.baseMinutes)} after the last nap, around ${time(mia.usualBedtime)}`, mia.clockShare >= 60 ? 'leaning on her steady bedtime routine' : mia.clockShare <= 40 ? 'leaning on her wake window' : '', mia.feedShare ? `${mia.feedShare}% from her bottle at ${time(mia.lastFeed)} (asleep about ${mia.feedTypical}m after)` : '', mia.trendMinutes ? `${signed(mia.trendMinutes)} as she grows` : '', mia.napMinutes ? `${signed(mia.napMinutes)} because the last nap was ${mia.previousNap}m (usually ${mia.typicalNap}m)` : ''].filter(Boolean).join(', ')
    : [`nap ${mia.napNumber} usually comes ${hmText(mia.baseMinutes)} after waking`, mia.trendMinutes ? `${signed(mia.trendMinutes)} as she grows${mia.ageDays != null ? ` (${ageLabel(mia.ageDays)})` : ''}` : '', mia.wakeMinutes ? `${signed(mia.wakeMinutes)} for an ${mia.wakeMinutes < 0 ? 'early' : 'late'} wake-up` : '', mia.bottleMinutes ? `${signed(mia.bottleMinutes)} for a ${mia.lastOz} oz bottle before` : '', mia.feedShare ? `leaning ${mia.feedShare}% on her bottle at ${time(mia.lastFeed)} (asleep about ${mia.feedTypical}m after a bottle)` : '', mia.napMinutes ? `${signed(mia.napMinutes)} because the last nap was ${mia.previousNap}m (usually ${mia.typicalNap}m)` : '', mia.nightMinutes ? `${signed(mia.nightMinutes)} because last night was ${hmText(mia.lastNight)} (usually ${hmText(mia.typicalNight)})` : ''].filter(Boolean).join(', ');
  const miaWhat = miaShown.kind === 'morning' ? 'morning wake-up' : miaShown.kind === 'wake' ? `waking from nap ${mia.napNumber}` : mia.kind === 'bedtime' ? `bedtime after ${mia.napsToday} nap${mia.napsToday === 1 ? '' : 's'}` : `nap ${mia.napNumber} of the day`;
  // Hubert: a nap, bedtime, or (asleep at night) the next wake-up.
  const purrWhat = !own.available ? '' : own.kind === 'wake' ? (own.phase === 'passed' ? 'next wake-up · past the window' : own.phase === 'within' ? 'next wake-up · in the window' : 'next wake-up')
    : `${own.kind === 'bedtime' ? 'bedtime · ' : ''}${own.phase === 'passed' ? 'window passed' : own.phase === 'within' ? 'in the window' : own.kind === 'bedtime' ? 'up next' : 'next daytime window'}`;
  const purrWhy = !own.available ? '' : own.kind === 'wake'
    ? `Asleep since ${time(own.sleepStart)}. Her night stretches starting ${own.matchedTime ? 'around this time' : 'overnight'} usually last ${hmText(own.typicalMinutes)} (${own.samples} stretches over ${own.days} nights). Best guess: ${time(own.target)}.`
    : own.kind === 'bedtime'
      ? `After waking around this time, she usually went down for the night about ${hmText(own.typicalMinutes)} later (${own.samples} evenings). Center: ${time(own.target)}.`
      : `Based on ${own.samples} logged wake windows across ${own.days} days${own.matchedTime ? ', around this time of day' : ''}. Center: ${time(own.target)}.`;
  const outdated = Date.now() - Date.parse(snapshot.checkedAt) > 10 * 60000;
  // Frankie's day strip: her sleeps today plus each cat's window, Hubert, Mia, Mack.
  const label = p => p.kind === 'bedtime' ? 'bedtime' : p.kind === 'wake' || p.kind === 'morning' ? 'wake-up' : 'nap';
  const stripPicks = morning ? [['hubert', 'Hubert', morning.hubert], ['mia', 'Mia', morning.mia], ['mack', 'Mack', morning.mack]].filter(([, , p]) => p).map(([key, cat, p]) => ({ key, cat, ...p, label:'wake-up' }))
    : [own.available ? { key:'hubert', cat:'Hubert', start:own.start, end:own.end, target:own.target, label:label(own) } : null, miaShown.available ? { key:'mia', cat:'Mia', start:miaShown.start, end:miaShown.end, target:miaShown.target, label:label(miaShown) } : null,
      huck.available && !huck.expired && !huck.sleeping ? { key:'mack', cat:'Mack', target:huck.time, label:'SweetSpot' } : null].filter(Boolean);
  // The same windows on the Frankie page, with a line per cat.
  // A failure here hides the Frankie page card; it isn't reported on Today's card.
  try { frankieGuesses(stripPicks, morning); } catch (e) { console.error('Frankie guesses failed', e); if ($('frankieGuessCard')) $('frankieGuessCard').hidden = true; }
  const strip = $('babyStrip');
  if (strip) {
    safely('Day strip', () => { renderHTML(strip, dayStripSVG({ sleeps:snapshot.sleeps, timer:snapshot.timer, picks:stripPicks, timezone:zone(), now:Date.now(), width:Math.max(320, Math.round(strip.clientWidth || 640)) })); });
    strip.hidden = problems.some(p => p.startsWith('Day strip'));
  }
  renderHTML($('babyPredictions'), `<article class="nap-card purr-nap"><div class="nap-label"><span>HUBERT’S PURRFECT WINDOW</span><span aria-hidden="true">🐾</span></div><h3>${own.available ? `${esc(time(own.start))} – ${esc(time(own.end))}` : 'Learning your rhythm'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : own.available ? `${esc(own.pattern)} · ${esc(purrWhat)}` : 'Your own sleep-history estimate'}</span><p>${own.available ? esc(purrWhy) : esc(own.reason)}</p></article>
    <article class="nap-card mia-nap"><div class="nap-label"><span>MIA’S CATNAP FORECAST</span><span aria-hidden="true">🌤</span></div><h3>${miaShown.available ? `${esc(time(miaShown.start))} – ${esc(time(miaShown.end))}` : 'Gathering clues'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : miaShown.available ? `${esc(miaShown.confidence)} · ${esc(miaWhat)}${miaShown.phase ? ` · ${miaShown.phase === 'passed' ? 'window passed' : miaShown.phase === 'within' ? 'in the window' : 'up next'}` : ''}` : 'Naps, bedtime and wake-ups'}</span><p>${miaShown.available ? `${esc(miaWhy.charAt(0).toUpperCase() + miaWhy.slice(1))}. Best guess: ${esc(time(miaShown.target))}.` : esc(mia.reason)}</p></article>
    <article class="nap-card huck-nap"><div class="nap-label"><span>MACK’S BORROWED SWEETSPOT</span><span>${demo ? 'Sample prediction' : `SweetSpot® · ${esc(napPlanLabel())}`}</span></div><h3>${huck.available ? esc(time(huck.time)) : 'Waiting for a prediction'}</h3><span class="nap-state">${huck.sleeping ? 'Sleep in progress' : huck.expired ? 'Previous prediction · passed' : huck.staleRead ? 'Saved prediction · stale' : huck.available ? 'Stored in Huckleberry' : 'From your Huckleberry account'}</span><p>${esc(huck.available ? huck.note : huck.reason)} <span class="mack-excuse">${esc(MACK_EXCUSE)}</span></p></article>${morningLine}${problems.length ? `<p class="forecast-problem" role="status">Part of the forecast couldn’t be drawn (${esc(problems.join('; ').slice(0, 200))}). The predictions above are fine; send this to Claude.</p>` : ''}`);
  renderHTML($('babyScore'), score.scoredNaps ? `<button type="button" class="baby-score" data-go="frankie"><span aria-hidden="true">🏆</span><span>${leader ? `<strong>${esc(leader.owner)}’s ${esc(leader.name)}</strong> is most accurate so far · ±${leader.mae} min across ${leader.n} naps` : `${score.scoredNaps} nap${score.scoredNaps === 1 ? '' : 's'} scored · a leader appears after three scored naps`}</span><span class="baby-score-link">Scoreboard →</span></button>` : '');
  const timer = snapshot.timer, elapsed = timer?.start ? Math.max(0,Math.floor(((timer.paused ? Date.parse(timer.end) : Date.now()) - Date.parse(timer.start)) / 60000)) : 0;
  const latest = snapshot.sleeps.at(-1), bottle = snapshot.lastBottle, diaper = snapshot.lastDiaper;
  renderHTML($('babyStats'), `<div><span>☾ Sleep</span><strong>${timer?.active ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m${timer.paused ? ' · paused' : ' · asleep'}` : latest ? `Awake since ${esc(time(latest.end))}` : 'No sleep logged'}</strong><small>${timer?.active ? `Started ${esc(when(timer.start))}` : latest ? esc(when(latest.end)) : 'Start a timer or log a finished sleep'}</small></div><div><span>◒ Last bottle</span><strong>${bottle ? `${esc(bottle.amount ?? '—')} ${esc(bottle.units)} · ${esc(bottle.type)}` : 'No bottle logged'}</strong><small>${esc(when(bottle?.time))}${nextBottle?.available ? ` · next ~${esc(time(nextBottle.target))}` : ''}</small></div><div><span>♡ Last diaper</span><strong>${diaper ? ({pee:'Wet',poo:'Dirty',both:'Wet + dirty',dry:'Dry'}[diaper.mode] || 'Diaper change') : 'No change logged'}</strong><small>${esc(when(diaper?.time))}</small></div>`);
  frankie();
}
function frankie() {
  // A chart problem must never break Huckleberry refreshes or look like a login error.
  try { renderFrankie({snapshot,timezone:zone(),predictions,demo,connected:connection.connected}); } catch (e) { console.error('Frankie page could not render', e); }
}
// Shares a small live summary with the Now & Next strip.
function glance(huck, own, mia, nextBottle = null) {
  window.dispatchEvent(new CustomEvent('hh:baby',{detail:snapshot ? {name:snapshot.name,timer:snapshot.timer,lastWake:snapshot.sleeps.at(-1)?.end,lastBottle:snapshot.bottles?.at(-1)?.start || snapshot.lastBottle?.time,huck,purr:own,mia,nextBottle} : null}));
}
// Save Huckleberry's latest SweetSpot for this wake-up while Frankie is awake.
// Hubert's and Mia's guesses are replayed from history, so they need no saving.
function logPredictions(huck) {
  if (!predictionStore || !snapshot || snapshot.historyComplete === false) return;
  const lastWake = snapshot.sleeps.at(-1)?.end; if (!lastWake) return;
  const entry = sweetspotEntry({lastWake,childId:snapshot.childId,sweetspot:huck,previousTarget:previousSweetspot(predictions,lastWake),timer:snapshot.timer,timezone:zone(),sleeps:snapshot.sleeps});
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
  if (entry.kind === 'pump') { (snapshot.pumps ||= []).push({start:entry.start,left:entry.left,right:entry.right,total:entry.left + entry.right,units:entry.units,...(entry.minutes ? {minutes:entry.minutes} : {})}); snapshot.pumps.sort((a,b) => Date.parse(a.start) - Date.parse(b.start)); }
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
  if (log.kind === 'pump') { if (log.left == null) return openLog('pump', log); logPump(log); return true; }
  return openLog(log.kind, log);
}
// Karena's pumps from quick add ("pumped left 2 right 2.5"): the preview was the confirmation.
// Both sides are needed; Huckleberry's single-total pump format isn't confirmed, so it isn't written.
const pumpRequests = new Map();
async function logPump(log) {
  if (log.left == null) { showNotice('Add how much came from each side, e.g. “karena pumped left 2 right 2.5”.'); return; }
  const key = `${+log.start}|${log.left}|${log.right}|${log.units}`;
  if (!pumpRequests.has(key)) pumpRequests.set(key, crypto.randomUUID()); // a retry of the same pump reuses its ID
  const entry = { kind:'pump', start:log.start.toISOString(), requestId:pumpRequests.get(key), left:log.left, right:log.right, units:log.units, ...(log.minutes ? { minutes:log.minutes } : {}) };
  try {
    await write(entry, snapshot.childId);
    showNotice(`Logged a pump: left ${log.left} ${log.units}, right ${log.right} ${log.units}. 🤱`);
    if (!demo) await refresh(true); else home();
  } catch (e) { showNotice(message(e)); }
}
// ---------- Night feed mode ----------
// A dim, full-screen panel for 3 AM: the clock, time since the last bottle, the
// bottle forecast, and three big buttons. Keeps the screen awake while open.
let nightLock = null, nightTimer = null;
const ago = value => { const m = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
function nightPanel() {
  let panel = $('nightMode'); if (panel) return panel;
  panel = document.createElement('div'); panel.id = 'nightMode'; panel.className = 'night-mode'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Night feed mode');
  document.body.append(panel);
  panel.addEventListener('click', e => {
    const action = e.target.closest('[data-night]')?.dataset.night;
    if (action === 'close') closeNight();
    else if (action === 'sleep') toggleSleep();
    else if (action === 'bottle' || action === 'diaper') openLog(action);
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('babyLogDialog').open) closeNight(); });
  return panel;
}
function renderNight() {
  const panel = $('nightMode'); if (!panel || panel.hidden || !snapshot) return;
  const timer = snapshot.timer, lastBottle = snapshot.bottles?.at(-1) || (snapshot.lastBottle?.time ? { start:snapshot.lastBottle.time, amount:snapshot.lastBottle.amount, units:snapshot.lastBottle.units, type:snapshot.lastBottle.type } : null);
  const next = bottleForecast(snapshot.bottles || [], { timezone:zone() }), wake = snapshot.sleeps.at(-1)?.end;
  const clock = new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:zone() });
  renderHTML(panel, `<button type="button" class="night-close" data-night="close">Done</button>
    <div class="night-clock" aria-live="off">${esc(clock)}</div>
    <div class="night-stats">
      <div><span>Last bottle</span><strong>${lastBottle ? `${esc(ago(lastBottle.start))} ago` : '—'}</strong><small>${lastBottle ? `${esc(lastBottle.amount ?? '')} ${esc(lastBottle.units || '')} ${esc((lastBottle.type || '').toLowerCase())} · ${esc(time(lastBottle.start))}` : 'No bottle logged'}</small></div>
      <div><span>Next bottle</span><strong>${next.available ? `~${esc(time(next.target))}` : '—'}</strong><small>${next.available ? `usually every ${Math.floor(next.typicalMinutes / 60)}h ${next.typicalMinutes % 60}m${next.phase === 'overdue' ? ' · any time now' : ''}` : esc(next.reason)}</small></div>
      <div><span>${timer?.active ? 'Asleep' : 'Awake'}</span><strong>${timer?.active ? esc(ago(timer.start)) : wake ? esc(ago(wake)) : '—'}</strong><small>${timer?.active ? `since ${esc(time(timer.start))}` : wake ? `since ${esc(time(wake))}` : ''}</small></div>
    </div>
    <div class="night-actions">
      <button type="button" data-night="sleep"${busy ? ' disabled' : ''}>${timer?.active ? '☀ Finish sleep' : '☾ Start sleep'}</button>
      <button type="button" data-night="bottle"${busy ? ' disabled' : ''}>🍼 Bottle</button>
      <button type="button" data-night="diaper"${busy ? ' disabled' : ''}>♡ Diaper</button>
    </div>
    <p class="night-tip">${demo ? 'Sample data · ' : ''}Screen stays awake while this is open.</p>`);
}
async function openNight() {
  if (!snapshot) return;
  const panel = nightPanel(); panel.hidden = false; document.documentElement.classList.add('night-open');
  renderNight(); panel.querySelector('[data-night="close"]')?.focus();
  nightTimer = setInterval(renderNight, 30000);
  try { nightLock = await navigator.wakeLock?.request('screen'); } catch { nightLock = null; }
}
function closeNight() {
  const panel = $('nightMode'); if (panel) panel.hidden = true;
  document.documentElement.classList.remove('night-open');
  clearInterval(nightTimer); nightLock?.release?.().catch(() => {}); nightLock = null;
  $('babyNight')?.focus();
}
// ---------- Recent logs: list, edit, delete ----------
const LOG_FORM = {sleep:'sleep-log', bottle:'bottle', diaper:'diaper'};
function renderLogs() {
  const root = $('frankieLogs'); if (!root) return;
  document.querySelectorAll('[data-log-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.logFilter === logs.filter)));
  $('frankieLogsError').textContent = logs.error;
  if (!logs.entries) { renderHTML(root, `<p class="tiny muted log-empty">${logs.loading ? 'Loading recent logs from Huckleberry…' : snapshot ? 'Open to load recent logs.' : 'Connect Huckleberry in Settings to see recent logs.'}</p>`); return; }
  renderHTML(root, logsHTML({entries:logs.entries, timezone:zone(), filter:logs.filter, showAll:logs.showAll}));
}
async function loadLogs() {
  if (!snapshot || logs.loading) { renderLogs(); return; }
  logs.loading = true; logs.error = ''; renderLogs();
  try { logs.entries = demo ? demoLogs() : (await call('recent')).entries || []; }
  catch (e) { logs.error = message(e); }
  finally { logs.loading = false; renderLogs(); }
}
async function changeLog(entry, childId = connection.selected, connectionVersion = connection.connectionVersion) {
  if (demo) demoChange(entry); else await call('change',{entry,childId,connectionVersion});
}
// Sample logs for the preview: the last three days of sample sleep and bottles, plus diapers.
function demoLogs() {
  if (sampleLogs) return sampleLogs.map(entry => ({...entry}));
  const since = Date.now() - 3 * 86400000, modes = ['pee','both','poo','pee'];
  const sleeps = snapshot.sleeps.filter(item => Date.parse(item.start) >= since).map((item, i) => ({kind:'sleep',id:`s${i}`,version:'1.000000000',start:item.start,end:item.end}));
  const bottles = snapshot.bottles.filter(item => Date.parse(item.start) >= since).map((item, i) => ({kind:'bottle',id:`b${i}`,version:'1.000000000',start:item.start,amount:item.amount,units:item.units,bottleType:item.type}));
  const diapers = bottles.map((item, i) => ({kind:'diaper',id:`d${i}`,version:'1.000000000',start:new Date(Date.parse(item.start) + 20 * 60000).toISOString(),mode:modes[i % modes.length]})).filter(item => Date.parse(item.start) < Date.now());
  sampleLogs = [...sleeps, ...bottles, ...diapers].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return sampleLogs.map(entry => ({...entry}));
}
function demoChange(entry) {
  demoLogs(); const index = sampleLogs.findIndex(item => item.kind === entry.kind && item.id === entry.id);
  if (index < 0) return;
  if (entry.change === 'delete') sampleLogs.splice(index, 1);
  else { const {change, ...fields} = entry; sampleLogs[index] = {...sampleLogs[index], ...fields}; sampleLogs.sort((a, b) => Date.parse(b.start) - Date.parse(a.start)); }
}
function editLog(entry) {
  const prefill = {start:entry.start, end:entry.end, amount:entry.amount, units:entry.units, bottleType:entry.bottleType, mode:entry.mode};
  openLog(LOG_FORM[entry.kind], prefill, entry);
}
async function deleteLog(entry, button) {
  if (busy) return;
  const {noun, what, when} = describeLog(entry, zone());
  if (!confirm(`Delete this ${noun} (${what}, ${when}) from ${demo ? 'the sample logs' : 'Huckleberry'}? This can’t be undone.`)) return;
  busy = true; button.disabled = true; logs.error = ''; home();
  try { await changeLog({change:'delete', kind:entry.kind, id:entry.id, version:entry.version}); showNotice(demo ? 'Sample log deleted.' : 'Deleted from Huckleberry.'); await refresh(true); }
  catch (e) { logs.error = message(e); }
  finally { busy = false; if (button.isConnected) button.disabled = false; home(); await loadLogs(); }
}
function initLogs() {
  const card = $('frankieLogsCard'); if (!card) return;
  $('frankieLogsDetails').addEventListener('toggle', e => { if (e.currentTarget.open) loadLogs(); });
  card.addEventListener('click', e => {
    const filter = e.target.closest('[data-log-filter]'), find = key => logs.entries?.find(entry => logKey(entry) === key);
    if (filter) { logs.filter = filter.dataset.logFilter; logs.showAll = false; renderLogs(); return; }
    if (e.target.closest('[data-log-more]')) { logs.showAll = true; renderLogs(); return; }
    if (e.target.closest('[data-log-refresh]')) { loadLogs(); return; }
    const edit = e.target.closest('[data-log-edit]'), remove = e.target.closest('[data-log-delete]');
    if (edit && find(edit.dataset.logEdit)) editLog(find(edit.dataset.logEdit));
    if (remove && find(remove.dataset.logDelete)) deleteLog(find(remove.dataset.logDelete), remove);
  });
  renderLogs();
}
const LOG_LOOK = { bottle:['🍼','Bottle','Save bottle'], diaper:['♡','Diaper change','Save diaper'], 'sleep-log':['☾','Finished sleep','Save sleep'], pump:['🤱','Pump','Save pump'] };
const lengthText = minutes => minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
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
// Drag bars: each one sets its real field, then the window refreshes from the fields.
const SLIDER_FIELD = { babyLogAmountSlider:'babyLogAmount', babyLogLeftSlider:'babyLogLeft', babyLogRightSlider:'babyLogRight' };
function applyLogSlider(target) {
  if (!target?.classList?.contains('log-slider')) return;
  const value = Number(target.value);
  if (target.id === 'babyLogStartAgo') $('babyLogStart').value = inputTime(Date.now() + value * 60000);
  else if (target.id === 'babyLogEndAgo') $('babyLogEnd').value = inputTime(Date.now() + value * 60000);
  else if (target.id === 'babyLogLength') $('babyLogStart').value = inputTime(new Date($('babyLogEnd').value) - value * 60000);
  else if (SLIDER_FIELD[target.id]) $(SLIDER_FIELD[target.id]).value = String(value);
}
function syncLogSliders() {
  const clamp = (input, value) => { input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), value))); };
  const ago = id => -Math.round((Date.now() - new Date($(id).value)) / 300000) * 5; // minutes, to the nearest 5
  clamp($('babyLogStartAgo'), ago('babyLogStart')); clamp($('babyLogEndAgo'), ago('babyLogEnd'));
  clamp($('babyLogLength'), Math.round((new Date($('babyLogEnd').value) - new Date($('babyLogStart').value)) / 60000));
  // Bottle and pump ranges follow the units.
  const ranges = { oz:{ bottle:[0.5, 10, 0.25], side:[0, 8, 0.25] }, ml:{ bottle:[15, 300, 5], side:[0, 240, 5] } };
  const set = (input, [min, max, step], value, label) => { input.min = min; input.max = max; input.step = step; clamp(input, value); const ends = input.nextElementSibling?.children; if (ends) { ends[0].textContent = label(min); ends[1].textContent = label(max); } };
  const bottleUnits = $('babyLogUnits').value === 'ml' ? 'ml' : 'oz', pumpUnits = $('babyLogPumpUnits').value === 'ml' ? 'ml' : 'oz';
  set($('babyLogAmountSlider'), ranges[bottleUnits].bottle, Number($('babyLogAmount').value) || 0, v => v === 0.5 ? '½' : `${v} ${bottleUnits}`);
  for (const side of ['Left', 'Right']) set($(`babyLog${side}Slider`), ranges[pumpUnits].side, Number($(`babyLog${side}`).value) || 0, v => `${v}`);
}
function syncLogForm() {
  syncLogSliders();
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
  // The exact time box stays tucked away unless "Other time…" is chosen or no chip matches.
  for (const group of document.querySelectorAll('[data-time-chips]')) {
    const block = group.parentElement, box = block.querySelector('.log-custom-time'), slider = block.querySelector('.log-slider');
    const ago = (Date.now() - new Date($(group.dataset.timeChips).value)) / 60000;
    // On the drag bar's 5-minute grid and within its range: no need for the exact box.
    const onSlider = slider && ago >= -1 && ago <= -Number(slider.min) + 1 && Math.abs(ago - Math.round(ago / 5) * 5) <= 1;
    if (box) box.hidden = onSlider && box.dataset.open !== 'true';
    group.querySelector('[data-other-time]')?.setAttribute('aria-pressed', String(!!box && !box.hidden));
  }
  const slept = Math.round((new Date(end) - new Date(start)) / 60000);
  document.querySelectorAll('#babyLogLengths [data-length]').forEach(chip => chip.setAttribute('aria-pressed', String(Math.abs(slept - Number(chip.dataset.length)) <= 1)));
  const left = Number($('babyLogLeft').value) || 0, right = Number($('babyLogRight').value) || 0, pumpUnits = $('babyLogPumpUnits').value;
  $('babyLogPumpTotal').textContent = `${Math.round((left + right) * 100) / 100} ${pumpUnits} in all`;
  // Say exactly what Save will do.
  if (!formEdit) {
    const diaper = { pee:'wet', poo:'dirty', both:'wet + dirty', dry:'dry' }[$('babyLogDiaper').value] || '';
    $('babyLogSave').textContent = kind === 'bottle' ? `Save ${fmtAmount(amount || 0, units)} bottle` : kind === 'diaper' ? `Save ${diaper} diaper` : kind === 'sleep-log' ? (slept > 0 ? `Save ${lengthText(slept)} sleep` : 'Save sleep') : kind === 'pump' ? `Save ${Math.round((left + right) * 100) / 100} ${pumpUnits} pump` : 'Save';
  }
}
// prefill: {start, end, amount, units, bottleType, mode} from quick add.
function openLog(kind, prefill = {}, editing = null) {
  if (busy || !snapshot) return false;
  formChild = connection.selected; formVersion = connection.connectionVersion; formId = crypto.randomUUID(); formEdit = editing;
  $('babyLogForm').reset(); $('babyLogKind').value = kind; $('babyLogError').textContent = ''; $('babyLogNotesWrap').open = false;
  const [icon, title, save] = LOG_LOOK[kind]; $('babyLogIcon').textContent = icon; $('babyLogFor').textContent = kind === 'pump' ? 'FOR KARENA' : 'FOR FRANKIE';
  document.querySelectorAll('.log-custom-time').forEach(box => { delete box.dataset.open; }); $('babyLogTitle').textContent = editing ? `Edit ${title.toLowerCase()}` : title; $('babyLogSave').textContent = editing ? 'Save changes' : save;
  $('babyLogNotesWrap').hidden = !!editing; // notes stay as they are in Huckleberry
  $('babyLogStartLabel').textContent = kind === 'sleep-log' ? 'Fell asleep' : kind === 'diaper' ? 'Changed' : 'When';
  $('babyLogStart').value = inputTime(prefill.start || Date.now() - (kind === 'sleep-log' ? 3600000 : 0)); $('babyLogEnd').value = inputTime(prefill.end || Date.now());
  // New bottles start from the last bottle logged (amount, units, milk).
  const last = lastBottle(), same = $('babyLogSame');
  $('babyLogAmount').value = String(prefill.amount ?? last?.amount ?? 4); $('babyLogUnits').value = prefill.units || last?.units || 'oz';
  $('babyLogMilk').value = prefill.bottleType || last?.type || 'Formula';
  same.hidden = !last || !!editing; if (last) { same.textContent = `Same as last · ${fmtAmount(last.amount, last.units)} ${last.type || ''}`.trim(); same.dataset.amount = last.amount; same.dataset.units = last.units; same.dataset.type = last.type || 'Formula'; }
  if (prefill.mode) $('babyLogDiaper').value = prefill.mode;
  // Pumps start from Karena's last session (or what was typed), in the same units.
  const lastPump = snapshot.pumps?.at(-1);
  const half = kind === 'pump' && prefill.left == null && prefill.amount ? Math.round(prefill.amount / 2 * 100) / 100 : null; // "pumped 5 oz" → 2.5 a side to start
  $('babyLogLeft').value = String(prefill.left ?? half ?? lastPump?.left ?? 2); $('babyLogRight').value = String(prefill.right ?? half ?? lastPump?.right ?? 2);
  $('babyLogPumpUnits').value = prefill.units && kind === 'pump' ? prefill.units : lastPump?.units || 'oz';
  // Only mention the time zone when this device isn't on the household's.
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('babyLogZone').textContent = deviceZone === zone() ? '' : `Times are in this device’s time zone (${deviceZone.replaceAll('_', ' ')}).`;
  document.querySelectorAll('[data-log-fields]').forEach(group => { const active = group.dataset.logFields === kind; group.hidden = !active; group.querySelectorAll('input,select').forEach(input => { input.disabled = !active; }); });
  syncLogForm(); $('babyLogDialog').showModal();
  return true;
}
function sampleSnapshot() {
  const now = Date.now(), {sleeps, bottles, pumps} = sampleHistory(now), last = bottles.at(-1), wake = Date.parse(sleeps.at(-1).end);
  return {childId:'sample-frankie',name:'Frankie',birthdate:new Date(now - 125 * 86400000).toISOString().slice(0, 10),timezone:zone(),checkedAt:new Date().toISOString(),historyComplete:true,feedsComplete:true,historyDays:45,sleeps,bottles,pumps,timer:{active:false},
    sweetspot:{time:new Date(Math.max(now + 20 * 60000, wake + 125 * 60000)).toISOString()},lastBottle:{time:last.start,amount:last.amount,units:last.units,type:last.type},lastDiaper:{time:new Date(now - 60 * 60000).toISOString(),mode:'pee'}};
}
function memoryPredictions(seed) {
  let entries = seed, notify;
  return { subscribe(cb) { notify = cb; cb(entries); }, async record(entry) { const saved = entries.find(item => item.id === entry.id), patch = sweetspotPatch(saved, entry); if (!patch) return; if (saved) Object.assign(saved, patch); else entries = [entry, ...entries]; notify?.(entries); } };
}
// ---------- Missed-nap recovery ----------
// The sleeps logged after a missed nap come out of Huckleberry for a moment (the server
// keeps exact copies), Huckleberry recalculates SweetSpot as of that nap, Mack's pick is
// saved, and the sleeps go back. Until they're back, this panel stays on the Frankie page.
let recovery = { active:false };
function drawRecovery() {
  const root = $('rewindPanel'); if (!root) return;
  if (!recovery.active) { root.hidden = true; root.innerHTML = ''; return; }
  const found = recovery.found, n = recovery.count;
  root.hidden = false;
  root.innerHTML = `<h3>Recovering the nap after ${esc(time(recovery.wake))}</h3>
    <p>${n} later sleep${n === 1 ? ' is' : 's are'} out of Huckleberry for the moment, saved here to put back. ${found ? `Huckleberry now says <strong>${esc(time(found))}</strong>${recovery.before ? ` (it said ${esc(time(recovery.before))} before)` : ''}. Save that as Mack’s pick?` : 'Open the Huckleberry app on your phone and wait until its SweetSpot changes, then tap <b>Check SweetSpot</b>.'}</p>
    ${recovery.note ? `<p class="form-error" role="alert">${esc(recovery.note)}</p>` : ''}
    <div class="connection-actions">${found ? '<button type="button" class="btn btn-primary" data-recover="save">Save it and put the sleeps back</button><button type="button" class="btn" data-recover="check">Check again</button>' : '<button type="button" class="btn btn-primary" data-recover="check">Check SweetSpot</button>'}<button type="button" class="btn" data-recover="restore">Put the sleeps back${found ? ' without saving' : ''}</button></div>`;
}
async function recover(step, wake) {
  if (busy) return; busy = true; recovery.note = '';
  $('rewindPanel')?.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    if (step === 'start') {
      const later = (snapshot?.sleeps || []).filter(sleep => Date.parse(sleep.start) >= Date.parse(wake)).length;
      if (!confirm(`Recover the nap after ${time(wake)}?\n\nHubert’s House will take the ${later} sleep${later === 1 ? '' : 's'} logged after it out of Huckleberry for a moment (exact copies are kept here), you’ll open the Huckleberry app so it recalculates SweetSpot, then everything goes back.\n\nAvoid logging sleeps in Huckleberry until it’s done.`)) return;
      const before = snapshot?.sweetspot?.time || null;
      const result = demo ? { count:later } : await call('rewind', { wake });
      recovery = { active:true, wake, count:result.count, before, found:null };
      if (!demo) refresh(true);
    } else if (step === 'check') {
      if (demo) recovery.found = new Date(Date.parse(recovery.wake) + 95 * 60000).toISOString();
      else {
        const next = await call('snapshot', { force:true }); snapshot = next;
        const target = next.sweetspot?.time;
        if (recoveredEntry({ lastWake:recovery.wake, childId:snapshot.childId, sweetspot:target, before:recovery.before })) recovery.found = target;
        else recovery.note = target ? `Huckleberry hasn’t recalculated yet (it still shows ${time(target)}). Open the app, give it a few seconds, and check again.` : 'Huckleberry hasn’t shown a SweetSpot yet. Open the app and check again.';
      }
    } else if (step === 'save' || step === 'restore') {
      if (step === 'save') {
        const entry = recoveredEntry({ lastWake:recovery.wake, childId:snapshot?.childId, sweetspot:recovery.found, before:recovery.before });
        if (entry) await predictionStore?.record(entry);
      }
      const result = demo ? { restored:recovery.count, alreadyThere:0 } : await call('restore');
      const saved = step === 'save';
      recovery = { active:false };
      showNotice(`${saved ? 'Mack’s pick is saved. ' : ''}All ${result.restored + result.alreadyThere} sleeps are back in Huckleberry.`);
      if (!demo) { lastAttempt = 0; refresh(true); }
    }
  } catch (e) { recovery.note = message(e); if (step === 'start') recovery = { active:false }; showNotice(message(e)); }
  finally { busy = false; drawRecovery(); home(); }
}
export async function initHuckleberry(app, options = {}) {
  demo = !!options.demo; service = app ? httpsCallable(getFunctions(app,config.functionsRegion),'huckleberry',{timeout:120000}) : null;
  if (demo) { connection = {connected:true,selected:'sample-frankie',children:[{id:'sample-frankie',name:'Frankie'}],timezone:zone()}; snapshot = sampleSnapshot(); }
  predictionStore = demo ? memoryPredictions(samplePredictions(snapshot.sleeps, zone())) : options.predictions || null;
  predictionStore?.subscribe(entries => { predictions = (entries || []).filter(entry => !snapshot || !entry.childId || entry.childId === snapshot.childId); home(); });
  initFrankie(frankie); initLogs();
  $('view-frankie')?.addEventListener('click', e => {
    const start = e.target.closest('[data-rewind-wake]'), step = e.target.closest('[data-recover]');
    if (start) recover('start', start.dataset.rewindWake); else if (step) recover(step.dataset.recover);
  });
  if (!demo && service) call('rewind-status').then(status => {
    if (!status?.active) return;
    recovery = { active:true, wake:status.wake, count:status.count, before:null, found:null }; drawRecovery();
    showNotice('A missed-nap recovery is still in progress: some of Frankie’s sleeps are out of Huckleberry.', { label:'Finish it', run:() => showView('frankie') });
  }).catch(() => {});
  $('babyScore').addEventListener('click', e => { if (e.target.closest('[data-go="frankie"]')) showView('frankie'); });
  $('babySettings').addEventListener('click', () => { showView('settings'); $('huckleberrySettings').scrollIntoView?.({behavior:'smooth',block:'start'}); });
  $('babyRefresh').addEventListener('click', async () => { if (busy) return; busy = true; home(); try { await refresh(true); } finally { busy = false; home(); } });
  document.querySelectorAll('[data-baby-log]').forEach(button => button.addEventListener('click', () => openLog(button.dataset.babyLog)));
  $('babySleep').addEventListener('click', () => toggleSleep());
  $('babyNight').addEventListener('click', openNight);
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && $('nightMode') && !$('nightMode').hidden && !nightLock) { try { nightLock = await navigator.wakeLock?.request('screen'); } catch {} } });
  $('babyLogCancel').addEventListener('click', () => { if (!busy) $('babyLogDialog').close(); });
  $('babyLogDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('babyLogForm').addEventListener('input', e => { applyLogSlider(e.target); formId = crypto.randomUUID(); syncLogForm(); });
  $('babyLogClose').addEventListener('click', () => { if (!busy) $('babyLogDialog').close(); });
  // Chips, stepper and pills set the real inputs, then count as an edit.
  const changed = () => { formId = crypto.randomUUID(); syncLogForm(); };
  $('babyLogForm').addEventListener('click', e => {
    const chip = e.target.closest('[data-ago]'), step = e.target.closest('[data-step]'), amount = e.target.closest('[data-amount]'), pill = e.target.closest('[data-pills] [data-value]'), same = e.target.closest('#babyLogSame');
    const other = e.target.closest('[data-other-time]'), length = e.target.closest('[data-length]'), pumpStep = e.target.closest('[data-pump-step]');
    if (other) { const box = other.closest('.log-block').querySelector('.log-custom-time'); box.dataset.open = 'true'; box.hidden = false; syncLogForm(); box.querySelector('input')?.focus(); return; }
    if (length) { $('babyLogStart').value = inputTime(new Date($('babyLogEnd').value) - Number(length.dataset.length) * 60000); changed(); return; }
    if (pumpStep) { const [id, dir] = pumpStep.dataset.pumpStep.split(':'), ml = $('babyLogPumpUnits').value === 'ml', input = $(id); input.value = String(Math.max(0, Math.round((Number(input.value || 0) + Number(dir) * (ml ? 10 : 0.25)) * 100) / 100)); changed(); return; }
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
    const entry = formEdit ? {change:'edit',kind:formEdit.kind,id:formEdit.id,version:formEdit.version,start:start.toISOString()} : {kind,start:start.toISOString(),requestId:formId,notes:$('babyLogNotes').value};
    if (kind === 'sleep-log') entry.end = end.toISOString();
    if (kind === 'bottle') Object.assign(entry,{amount:Number($('babyLogAmount').value),units:$('babyLogUnits').value,bottleType:$('babyLogMilk').value});
    if (kind === 'diaper') entry.mode = $('babyLogDiaper').value;
    if (kind === 'pump') { Object.assign(entry, { left:Number($('babyLogLeft').value) || 0, right:Number($('babyLogRight').value) || 0, units:$('babyLogPumpUnits').value }); if (!(entry.left + entry.right > 0)) { $('babyLogError').textContent = 'Add how much came from at least one side.'; return; } }
    const controls = [...e.currentTarget.querySelectorAll('input,textarea,select,button')].filter(control => !control.disabled);
    busy = true; controls.forEach(control => { control.disabled = true; }); $('babyLogError').textContent = ''; home();
    try {
      if (formEdit) { await changeLog(entry,formChild,formVersion); $('babyLogDialog').close(); showNotice(demo ? 'Sample log updated.' : 'Updated in Huckleberry.'); }
      else { await write(entry,formChild,formVersion); $('babyLogDialog').close(); showNotice(demo ? 'Sample log saved.' : 'Saved in Huckleberry.'); }
      await refresh(true); if ($('frankieLogsDetails')?.open) loadLogs();
    }
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
