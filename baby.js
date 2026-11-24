import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice, showView } from './household.js';
import { purrfectWindow, huckleberryPrediction, miaForecast, bottleForecast, ageLabel, averageCalls, sleepAwareBottle } from './baby-model.js';
import { currentBedtime, morningPicks, MACK_EXCUSE } from './cat-challenges.js';
import { sweetspotEntry, sweetspotPatch, previousSweetspot, scorePredictions, guessRounds } from './prediction-log.js';
import { sampleHistory, samplePredictions } from './baby-sample.js';
import { renderFrankie, initFrankie } from './frankie.js';
import { renderHTML } from './dom.js';
import { dayStripSVG, STRIP_LANES, CATS } from './day-strip.js';
import { hatGuess, hatSeed } from './mack-hat.js';
import { initNightMode } from './night-mode.js';
import { initRecentLogs } from './recent-logs.js';
import { initLogSheet } from './log-sheet.js';
import { initNapRecovery } from './nap-recovery.js';

const $ = id => document.getElementById(id);
let service, demo = false, connection = {connected:false}, snapshot = null, error = '', busy = false, inFlight, lastAttempt = 0, pendingTimer;
let formChild, formVersion, formId, formEdit = null, predictionStore = null, predictions = [], lastLogged = '', wakeCall = null;
const zone = () => connection.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:zone()}) : '—';
const when = value => value ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone()}) : 'No entry yet';
const inputTime = value => { const date = new Date(value); return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
const ago = value => { const m = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
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
  // The whole day, wider than the screen: swipe sideways for every sleep's guesses.
  const now = Date.now(), rounds = guessRounds(predictions, snapshot.sleeps, snapshot.timer, zone(), now, { bottles:snapshot.bottles || [], birthdate:snapshot.birthdate });
  const old = strip.querySelector('.strip-scroll'), kept = old && strip.dataset.touched && now - Number(strip.dataset.touched) < 5 * 60000 ? old.scrollLeft : null;
  const svg = dayStripSVG({ sleeps:snapshot.sleeps, timer:snapshot.timer, picks, rounds, timezone:zone(), now, width:Math.max(300, Math.round((strip.clientWidth || card.clientWidth || 640))), scroll:true });
  const nameTags = CATS.map(([key, cat], i) => `<span class="strip-name ${key}" style="top:${STRIP_LANES.top + i * (STRIP_LANES.height + STRIP_LANES.gap) - 2}px">${esc(cat)}</span>`).join('');
  renderHTML(strip, `<div class="strip-legend"><span><i class="night"></i>Night</span><span><i></i>Nap</span><span><i class="actual"></i>fell asleep</span></div><div class="strip-frame"><div class="strip-names" aria-hidden="true">${nameTags}</div><div class="strip-scroll" tabindex="0" aria-label="Frankie’s day; scroll sideways to see every guess">${svg}</div></div>`);
  const scroller = strip.querySelector('.strip-scroll'), nowX = Number(strip.querySelector('[data-now-x]')?.dataset.nowX) || 0;
  strip.dataset.nowX = String(nowX);
  const toNow = () => { const el = strip.querySelector('.strip-scroll'); if (el?.clientWidth) el.scrollLeft = Math.max(0, Number(strip.dataset.nowX) - el.clientWidth * 0.6); };
  if (kept != null) scroller.scrollLeft = kept; else toNow();
  if (!strip.dataset.bound) {
    strip.dataset.bound = '1';
    for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown']) strip.addEventListener(type, () => { strip.dataset.touched = String(Date.now()); }, { passive:true });
    // Drawn while the Frankie page was hidden? Scroll to now once it has a size.
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (!strip.dataset.touched) toNow(); }).observe(strip);
  }
  const names = { hubert:'Hubert’s Purrfect Window', mia:'Mia’s Catnap Forecast', mack:'Mack’s borrowed SweetSpot' };
  const rows = ['hubert', 'mia', 'mack'].map(key => {
    const p = picks.find(pick => pick.key === key);
    if (!p) return `<li class="guess-${key} is-quiet"><span class="guess-dot" aria-hidden="true"></span><span><b>${esc(names[key])}</b><small>No call right now</small></span></li>`;
    if (p.hat) return `<li class="guess-${key} is-hat"><span class="guess-dot" aria-hidden="true"></span><span><b>Mack’s hat guess</b><small>${esc(p.label.replace('🎩 hat · ', ''))} · not in the competition · ${esc(p.why || '')}</small></span><strong>🎩 ${esc(time(p.target))}</strong></li>`;
    const window = p.start && p.end ? `${esc(time(p.start))} – ${esc(time(p.end))}` : esc(time(p.target));
    return `<li class="guess-${key}"><span class="guess-dot" aria-hidden="true"></span><span><b>${esc(names[key])}</b><small>${esc(p.label)}${p.start && p.end ? ` · best guess ${esc(time(p.target))}` : ''}</small></span><strong>${window}</strong></li>`;
  }).join('');
  // Earlier today: each sleep and how close each cat came (or that it had no call).
  const miss = (p, actual) => { if (!p) return '<td class="is-quiet">no call</td>'; const m = Math.round((Date.parse(actual) - Date.parse(p.target)) / 60000); return `<td class="${Math.abs(m) <= 15 ? 'is-hit' : 'is-miss'}">${esc(time(p.target))} <small>${m === 0 ? 'spot on' : `${Math.abs(m)}m ${m > 0 ? 'early' : 'late'}`}</small></td>`; };
  const earlier = rounds.length ? `<div class="score-table-wrap"><table class="score-table guess-table fit-table"><caption class="tiny muted">Earlier today</caption><thead><tr><th>Fell asleep</th>${CATS.map(([, cat]) => `<th>${esc(cat)}</th>`).join('')}</tr></thead><tbody>${[...rounds].reverse().map(r => `<tr><td>${esc(time(r.actual))}</td>${CATS.map(([key]) => miss(r[key], r.actual)).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  const quiet = rounds.some(r => CATS.some(([key]) => !r[key]));
  renderHTML(list, `<ul>${rows}</ul>${earlier}<p class="tiny muted">${morning ? 'She’s down for the night: the dots after now are the cats’ morning wake-up calls. ' : ''}Swipe the strip sideways to see the whole day. Bands are each cat’s window and dots their best guess; faded ones are guesses for earlier sleeps, and the dashed line is when she actually fell asleep.${quiet ? ' “No call” means that cat didn’t have a guess then: Hubert and Mia need a few days of naps, and Mack’s SweetSpot is only saved while the app is open and she’s awake.' : ''}</p>`);
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
  night?.render();
  $('babyRefresh').disabled = busy;
  $('babySleep').textContent = snapshot?.timer?.active ? '☀ Finish sleep' : '☾ Start sleep';
  if (!snapshot) {
    renderHTML($('babyPredictions'), `<div class="baby-intro"><span class="baby-orbit" aria-hidden="true">☾</span><div><h3>A softer landing for the next nap.</h3><p>${connection.connected ? 'Choose a child profile in Settings, then refresh here.' : 'Connect Huckleberry in Settings to log the little moments and compare three nap predictions.'}</p></div></div>`);
    renderHTML($('babyStats'),''); renderHTML($('babyScore'),''); if ($('babyStrip')) $('babyStrip').hidden = true; if ($('frankieGuessCard')) $('frankieGuessCard').hidden = true; frankie(); glance(); return;
  }
  const huck = huckleberryPrediction(snapshot), own = purrfectWindow({sleeps:snapshot.sleeps,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  const mia = miaForecast({sleeps:snapshot.sleeps,bottles:snapshot.bottles || [],birthdate:snapshot.birthdate,timer:snapshot.timer,timezone:zone(),complete:snapshot.historyComplete});
  logPredictions(huck);
  const score = scorePredictions(predictions, snapshot.sleeps, snapshot.timer, zone(), { bottles:snapshot.bottles || [], birthdate:snapshot.birthdate }), leader = score.summary.find(model => model.key === score.leader);
  const hmText = minutes => `${Math.floor(minutes / 60)}h ${minutes % 60}m`, signed = minutes => `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)}m`;
  // Asleep for the night: the three cats' morning wake-up calls.
  // Extras (morning calls, the day strip) must never stop the three cards from drawing.
  const problems = [], safely = (name, work, fallback = null) => { try { return work(); } catch (e) { console.error(`${name} failed`, e); problems.push(`${name}: ${e?.message || e}`); return fallback; } };
  const morning = safely('Morning calls', () => { const bedtime = currentBedtime(snapshot.sleeps, snapshot.timer, zone()); return bedtime ? morningPicks(snapshot.sleeps, zone(), bedtime, { birthdate:snapshot.birthdate }) : null; });
  // Asleep for the night: each cat's morning wake-up call (Challenge 3) goes in its own card.
  const morningCall = (p, extra = '') => p ? `<p class="morning-call">☀ Morning call: <strong>${esc(time(p.target))}</strong>${extra}</p>` : '';
  const miaShown = mia.available ? mia : morning?.mia ? { available:true, kind:'morning', ...morning.mia, confidence:'Sunrise Forecast' } : mia;
  // Asleep: the next bottle waits for her to wake, at the cats' averaged wake-up call
  // (Hubert's next wake-up, Mia's and Mack's morning calls overnight; Mia's nap wake-up).
  wakeCall = snapshot.timer?.active ? safely('Wake-up call', () => averageCalls([
    own.available && own.kind === 'wake' ? { cat:'Hubert', at:own.target } : morning?.hubert ? { cat:'Hubert', at:morning.hubert.target } : null,
    miaShown.available && ['wake', 'morning'].includes(miaShown.kind) ? { cat:'Mia', at:miaShown.target } : null,
    morning?.mack ? { cat:'Mack', at:morning.mack.target } : null])) : null;
  const nextBottle = sleepAwareBottle(bottleForecast(snapshot.bottles || [], {timezone:zone()}), wakeCall);
  glance(huck, own, mia, nextBottle);
  const miaWhy = !miaShown.available ? '' : miaShown.kind === 'morning' ? `blending how long her nights usually last with her usual wake-up time (${miaShown.clockShare}% on the clock)`
    : miaShown.kind === 'wake' ? `nap ${mia.napNumber} usually lasts ${hmText(mia.typicalMinutes)}; asleep since ${time(mia.sleepStart)}`
    : mia.kind === 'bedtime'
    ? [`bedtime usually comes ${hmText(mia.baseMinutes)} after the last nap, around ${time(mia.usualBedtime)}`, mia.clockShare >= 60 ? 'leaning on her steady bedtime routine' : mia.clockShare <= 40 ? 'leaning on her wake window' : '', mia.feedShare ? `${mia.feedShare}% from her bottle at ${time(mia.lastFeed)} (asleep about ${mia.feedTypical}m after)` : '', mia.trendMinutes ? `${signed(mia.trendMinutes)} as she grows` : '', mia.napMinutes ? `${signed(mia.napMinutes)} because the last nap was ${mia.previousNap}m (usually ${mia.typicalNap}m)` : ''].filter(Boolean).join(', ')
    : [`nap ${mia.napNumber} usually comes ${hmText(mia.baseMinutes)} after waking`, mia.trendMinutes ? `${signed(mia.trendMinutes)} as she grows${mia.ageDays != null ? ` (${ageLabel(mia.ageDays)})` : ''}` : '', mia.wakeMinutes ? `${signed(mia.wakeMinutes)} for an ${mia.wakeMinutes < 0 ? 'early' : 'late'} wake-up` : '', mia.bottleMinutes ? `${signed(mia.bottleMinutes)} for a ${mia.lastOz} oz bottle before` : '', mia.feedShare ? `leaning ${mia.feedShare}% on her bottle at ${time(mia.lastFeed)} (asleep about ${mia.feedTypical}m after a bottle)` : '', mia.napMinutes ? `${signed(mia.napMinutes)} because the last nap was ${mia.previousNap}m (usually ${mia.typicalNap}m)` : '', mia.nightMinutes ? `${signed(mia.nightMinutes)} because last night was ${hmText(mia.lastNight)} (usually ${hmText(mia.typicalNight)})` : ''].filter(Boolean).join(', ');
  const miaWhat = miaShown.kind === 'morning' ? 'morning wake-up' : miaShown.kind === 'wake' ? `waking from nap ${mia.napNumber}` : mia.kind === 'bedtime' ? `bedtime after ${mia.napsToday} nap${mia.napsToday === 1 ? '' : 's'}` : `nap ${mia.napNumber} of the day`;
  // Hubert: a nap, bedtime, or (asleep, nap or night) the next wake-up.
  const purrWhat = !own.available ? '' : own.kind === 'wake' ? (own.phase === 'passed' ? 'next wake-up · past the window' : own.phase === 'within' ? 'next wake-up · in the window' : 'next wake-up')
    : `${own.kind === 'bedtime' ? 'bedtime · ' : ''}${own.phase === 'passed' ? 'window passed' : own.phase === 'within' ? 'in the window' : own.kind === 'bedtime' ? 'up next' : 'next daytime window'}`;
  const purrWhy = !own.available ? '' : own.kind === 'wake' && own.nap
    ? `Napping since ${time(own.sleepStart)}. Her naps starting ${own.matchedTime ? 'around this time of day' : 'during the day'} usually last ${hmText(own.typicalMinutes)} (${own.samples} naps over ${own.days} days). Best guess: ${time(own.target)}.`
    : own.kind === 'wake'
    ? `Asleep since ${time(own.sleepStart)}. Her night stretches starting ${own.matchedTime ? 'around this time' : 'overnight'} usually last ${hmText(own.typicalMinutes)} (${own.samples} stretches over ${own.days} nights). Best guess: ${time(own.target)}.`
    : own.kind === 'bedtime'
      ? `After waking around this time, she usually went down for the night about ${hmText(own.typicalMinutes)} later (${own.samples} evenings). Center: ${time(own.target)}.`
      : `Based on ${own.samples} logged wake windows across ${own.days} days${own.matchedTime ? ', around this time of day' : ''}. Center: ${time(own.target)}.`;
  const outdated = Date.now() - Date.parse(snapshot.checkedAt) > 10 * 60000;
  // Mack's hat: when SweetSpot has nothing to say, Mack pulls a guess (never in the competition).
  const hat = safely('Mack’s hat', () => {
    if (huck.available && !huck.expired && !huck.sleeping) return null;
    const timer = snapshot.timer, began = timer?.active ? Date.parse(timer.start) : null, lastWake = Date.parse(snapshot.sleeps.at(-1)?.end);
    if (morning) { const bedtime = currentBedtime(snapshot.sleeps, timer, zone()); return { what:'morning wake-up', ...hatGuess({ bases:[morning.hubert?.target, morning.mia?.target], fallback:bedtime + 10.5 * 3600000, seed:hatSeed('night', bedtime), firedAt:bedtime }) }; }
    if (Number.isFinite(began)) return { what:'wake-up', ...hatGuess({ bases:[miaShown.available && miaShown.kind === 'wake' ? miaShown.target : null, own.available && own.kind === 'wake' ? own.target : null], fallback:began + 55 * 60000, seed:hatSeed('nap', began), firedAt:began }) };
    if (!Number.isFinite(lastWake)) return null;
    const fired = huck.available && Date.parse(huck.time) > lastWake ? Date.parse(huck.time) : lastWake;
    return { what:'next sleep', ...hatGuess({ bases:[own.available ? own.target : null, mia.available ? mia.target : null], fallback:lastWake + 2 * 3600000, seed:hatSeed('wake', lastWake), firedAt:fired }) };
  });
  // Frankie's day strip: her sleeps today plus each cat's window, Hubert, Mia, Mack.
  const label = p => p.kind === 'bedtime' ? 'bedtime' : p.kind === 'wake' || p.kind === 'morning' ? 'wake-up' : 'nap';
  const stripPicks = morning ? [['hubert', 'Hubert', morning.hubert], ['mia', 'Mia', morning.mia], ['mack', 'Mack', morning.mack]].filter(([, , p]) => p).map(([key, cat, p]) => ({ key, cat, ...p, label:'wake-up' }))
    : [own.available ? { key:'hubert', cat:'Hubert', start:own.start, end:own.end, target:own.target, label:label(own) } : null, miaShown.available ? { key:'mia', cat:'Mia', start:miaShown.start, end:miaShown.end, target:miaShown.target, label:label(miaShown) } : null,
      huck.available && !huck.expired && !huck.sleeping ? { key:'mack', cat:'Mack', target:huck.time, label:'SweetSpot' } : hat?.target ? { key:'mack', cat:'Mack', target:hat.target, label:`🎩 hat · ${hat.what}`, hat:true, why:hat.line } : null].filter(Boolean);
  // The same windows on the Frankie page, with a line per cat.
  // A failure here hides the Frankie page card; it isn't reported on Today's card.
  try { frankieGuesses(stripPicks, morning); } catch (e) { console.error('Frankie guesses failed', e); if ($('frankieGuessCard')) $('frankieGuessCard').hidden = true; }
  const strip = $('babyStrip');
  if (strip) {
    safely('Day strip', () => { renderHTML(strip, dayStripSVG({ sleeps:snapshot.sleeps, timer:snapshot.timer, picks:stripPicks, timezone:zone(), now:Date.now(), width:Math.max(320, Math.round(strip.clientWidth || 640)) })); });
    strip.hidden = problems.some(p => p.startsWith('Day strip'));
  }
  renderHTML($('babyPredictions'), `<article class="nap-card purr-nap"><div class="nap-label"><span>HUBERT’S PURRFECT WINDOW</span><span aria-hidden="true">🐾</span></div><h3>${own.available ? `${esc(time(own.start))} – ${esc(time(own.end))}` : 'Learning your rhythm'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : own.available ? `${esc(own.pattern)} · ${esc(purrWhat)}` : 'Your own sleep-history estimate'}</span><p>${own.available ? esc(purrWhy) : esc(own.reason)}</p>${morningCall(morning?.hubert)}</article>
    <article class="nap-card mia-nap"><div class="nap-label"><span>MIA’S CATNAP FORECAST</span><span aria-hidden="true">🌤</span></div><h3>${miaShown.available ? `${esc(time(miaShown.start))} – ${esc(time(miaShown.end))}` : 'Gathering clues'}</h3><span class="nap-state">${outdated ? 'Saved history · refresh needed' : miaShown.available ? `${esc(miaShown.confidence)} · ${esc(miaWhat)}${miaShown.phase ? ` · ${miaShown.phase === 'passed' ? 'window passed' : miaShown.phase === 'within' ? 'in the window' : 'up next'}` : ''}` : 'Naps, bedtime and wake-ups'}</span><p>${miaShown.available ? `${esc(miaWhy.charAt(0).toUpperCase() + miaWhy.slice(1))}. Best guess: ${esc(time(miaShown.target))}.` : esc(mia.reason)}</p>${miaShown.kind === 'morning' ? '' : morningCall(morning?.mia)}</article>
    <article class="nap-card huck-nap"><div class="nap-label"><span>MACK’S BORROWED SWEETSPOT</span><span>${demo ? 'Sample prediction' : `SweetSpot® · ${esc(napPlanLabel())}`}</span></div>${hat?.target ? `<h3>🎩 ${esc(time(hat.target))}</h3><span class="nap-state">Out of the hat · ${esc(hat.what)} · just for fun, not in the competition</span><p>${esc(hat.line)} <span class="mack-excuse">${huck.sleeping ? 'SweetSpot doesn’t guess while she sleeps' : huck.available ? `SweetSpot’s last call (${esc(time(huck.time))}) already passed` : 'Huckleberry has no SweetSpot right now'}, so this one’s all Mack.</span></p>` : `<h3>${huck.available ? esc(time(huck.time)) : 'Waiting for a prediction'}</h3><span class="nap-state">${huck.sleeping ? 'Sleep in progress' : huck.expired ? 'Previous prediction · passed' : huck.staleRead ? 'Saved prediction · stale' : huck.available ? 'Stored in Huckleberry' : 'From your Huckleberry account'}</span><p>${esc(huck.available ? huck.note : huck.reason)} <span class="mack-excuse">${esc(MACK_EXCUSE)}</span></p>`}${morningCall(morning?.mack, hat?.target ? ' <small>(his Groundhog Day call for the morning challenge; the hat is just for fun)</small>' : '')}</article>${problems.length ? `<p class="forecast-problem" role="status">Part of the forecast couldn’t be drawn (${esc(problems.join('; ').slice(0, 200))}). The predictions above are fine; send this to Claude.</p>` : ''}`);
  renderHTML($('babyScore'), score.scoredNaps ? `<button type="button" class="baby-score" data-go="frankie"><span aria-hidden="true">🏆</span><span>${leader ? `<strong>${esc(leader.owner)}’s ${esc(leader.name)}</strong> is most accurate so far · ±${leader.mae} min across ${leader.n} naps` : `${score.scoredNaps} nap${score.scoredNaps === 1 ? '' : 's'} scored · a leader appears after three scored naps`}</span><span class="baby-score-link">Scoreboard →</span></button>` : '');
  const timer = snapshot.timer, elapsed = timer?.start ? Math.max(0,Math.floor(((timer.paused ? Date.parse(timer.end) : Date.now()) - Date.parse(timer.start)) / 60000)) : 0;
  const latest = snapshot.sleeps.at(-1), bottle = snapshot.lastBottle, diaper = snapshot.lastDiaper;
  renderHTML($('babyStats'), `<div><span>☾ Sleep</span><strong>${timer?.active ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m${timer.paused ? ' · paused' : ' · asleep'}` : latest ? `Awake since ${esc(time(latest.end))}` : 'No sleep logged'}</strong><small>${timer?.active ? `Started ${esc(when(timer.start))}` : latest ? esc(when(latest.end)) : 'Start a timer or log a finished sleep'}</small></div><div><span>◒ Last bottle</span><strong>${bottle ? `${esc(bottle.amount ?? '—')} ${esc(bottle.units)} · ${esc(bottle.type)}` : 'No bottle logged'}</strong><small>${esc(when(bottle?.time))}${nextBottle?.available ? ` · next ~${esc(time(nextBottle.target))}` : ''}</small></div><div><span>♡ Last diaper</span><strong>${diaper ? ({pee:'Wet',poo:'Dirty',both:'Wet + dirty',dry:'Dry'}[diaper.mode] || 'Diaper change') : 'No change logged'}</strong><small>${esc(when(diaper?.time))}</small></div>`);
  frankie();
}
function frankie() {
  // A chart problem must never break Huckleberry refreshes or look like a login error.
  try { renderFrankie({snapshot,timezone:zone(),predictions,demo,connected:connection.connected,wakeAt:snapshot?.timer?.active ? wakeCall?.target : null}); } catch (e) { console.error('Frankie page could not render', e); }
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
  if (log.kind === 'pump') { if (log.left == null) return sheet.open('pump', log); logPump(log); return true; }
  return sheet.open(log.kind, log);
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
function sampleSnapshot() {
  const now = Date.now(), {sleeps, bottles, pumps} = sampleHistory(now), last = bottles.at(-1), wake = Date.parse(sleeps.at(-1).end);
  return {childId:'sample-frankie',name:'Frankie',birthdate:new Date(now - 125 * 86400000).toISOString().slice(0, 10),timezone:zone(),checkedAt:new Date().toISOString(),historyComplete:true,feedsComplete:true,historyDays:45,sleeps,bottles,pumps,timer:{active:false},
    sweetspot:{time:new Date(Math.max(now + 20 * 60000, wake + 125 * 60000)).toISOString()},lastBottle:{time:last.start,amount:last.amount,units:last.units,type:last.type},lastDiaper:{time:new Date(now - 60 * 60000).toISOString(),mode:'pee'}};
}
function memoryPredictions(seed) {
  let entries = seed, notify;
  return { subscribe(cb) { notify = cb; cb(entries); }, async record(entry) { const saved = entries.find(item => item.id === entry.id), patch = sweetspotPatch(saved, entry); if (!patch) return; if (saved) Object.assign(saved, patch); else entries = [entry, ...entries]; notify?.(entries); } };
}
// What the split-out parts (night-mode.js, recent-logs.js, log-sheet.js, nap-recovery.js) share with this file.
let night, recent, sheet, nap;
const ctx = {
  get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; },
  get demo() { return demo; }, get connection() { return connection; }, get wakeCall() { return wakeCall; }, get predictionStore() { return predictionStore; },
  get busy() { return busy; }, set busy(value) { busy = value; },
  resetAttempts() { lastAttempt = 0; },
  zone, time, ago, inputTime, message, showNotice, showView, call, home, refresh, write, toggleSleep,
  openLog:(...args) => sheet.open(...args), changeLog:(...args) => recent.change(...args), loadLogs:() => recent.load()
};
export async function initHuckleberry(app, options = {}) {
  night = initNightMode(ctx); sheet = initLogSheet(ctx); nap = initNapRecovery(ctx);
  demo = !!options.demo; service = app ? httpsCallable(getFunctions(app,config.functionsRegion),'huckleberry',{timeout:120000}) : null;
  if (demo) { connection = {connected:true,selected:'sample-frankie',children:[{id:'sample-frankie',name:'Frankie'}],timezone:zone()}; snapshot = sampleSnapshot(); }
  predictionStore = demo ? memoryPredictions(samplePredictions(snapshot.sleeps, zone())) : options.predictions || null;
  predictionStore?.subscribe(entries => { predictions = (entries || []).filter(entry => !snapshot || !entry.childId || entry.childId === snapshot.childId); home(); });
  initFrankie(frankie); recent = initRecentLogs(ctx);
  $('view-frankie')?.addEventListener('click', e => {
    const start = e.target.closest('[data-rewind-wake]'), step = e.target.closest('[data-recover]');
    if (start) nap.recover('start', start.dataset.rewindWake); else if (step) nap.recover(step.dataset.recover);
  });
  if (!demo && service) call('rewind-status').then(status => {
    if (!status?.active) return;
    nap.resume(status);
    showNotice('A missed-nap recovery is still in progress: some of Frankie’s sleeps are out of Huckleberry.', { label:'Finish it', run:() => showView('frankie') });
  }).catch(() => {});
  $('babyScore').addEventListener('click', e => { if (e.target.closest('[data-go="frankie"]')) showView('frankie'); });
  $('babySettings').addEventListener('click', () => { showView('settings'); $('huckleberrySettings').scrollIntoView?.({behavior:'smooth',block:'start'}); });
  $('babyRefresh').addEventListener('click', async () => { if (busy) return; busy = true; home(); try { await refresh(true); } finally { busy = false; home(); } });
  document.querySelectorAll('[data-baby-log]').forEach(button => button.addEventListener('click', () => sheet.open(button.dataset.babyLog)));
  $('babySleep').addEventListener('click', () => toggleSleep());
  $('babyNight').addEventListener('click', night.open);
  sheet.init();
  settings();
  if (!demo && config.huckleberryServiceEnabled) {
    await refresh();
  }
  const tick = () => { if (document.visibilityState !== 'visible' || busy) return; home(); if (['today','settings','frankie'].some(view => !$(`view-${view}`).classList.contains('hidden'))) refresh(); };
  setInterval(tick,60000); document.addEventListener('visibilitychange',tick);
}
