// Frankie's page: live status, the nap prediction scoreboard, a 24-hour sleep
// timeline, daily sleep totals and daily bottle ounces. Charts are inline SVG
// with a shared tooltip; every chart also has a table view.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { dailySleep, dailyBottles, dailyPumps, toOunces, timelineRows, babySummary, dayStory, dayStoryText, localDay } from './baby-history.js';
import { MODELS, scorePredictions, MIA_V2_SINCE, isDaytimeWake } from './prediction-log.js';
import { bottleSleepLinks, ageInDays, ageLabel } from './baby-model.js';
import { bottlePace } from './bottle-pace.js';
import { CHALLENGES, MACK_EXCUSE, scoreMornings, scoreBottles, scorePumps, morningPicks, bottlePicks, pumpPicks, currentBedtime, nightsFrom, scoreNapNight, napNightPicks } from './cat-challenges.js';
import { frankieAwards } from './awards.js';
import { scoreHat } from './mack-hat.js';
import { dayRing, dayRingHTML } from './day-ring.js';
import { hm, oz, clock, dayLabel, sleepChart, bottleChart, pumpChart, timeline, legend, table } from './frankie-charts.js';
import { catsConsensus } from './baby-model.js';
import { weekStory } from './week-story.js';
import { openStory } from './story-view.js';

const $ = id => document.getElementById(id);
let range = 30, shared = null, ringArgs = null, nextCall = null; // ringArgs: what the 24-hour clock last drew from // the latest snapshot, for "Share her day"
try { range = Number(localStorage.getItem('hh_frankie_range')) || 30; } catch { /* storage may be blocked */ }
const ago = (stamp, now) => { const minutes = Math.max(0, Math.round((now - Date.parse(stamp)) / 60000)); return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };
const signed = minutes => minutes === 0 ? 'on time' : `${Math.abs(minutes)}m ${minutes > 0 ? 'late' : 'early'}`;
// Bottle pace: her usual day as the target, with recent bottles counted gradually.
export function paceHTML(pace, timezone) {
  if (!pace.available) return `<p class="muted">${esc(pace.reason)}</p>`;
  const pct = v => `${Math.max(0, Math.min(100, v / Math.max(pace.target, pace.drank, 1) * 100)).toFixed(1)}%`;
  const hm = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
  const word = { 'on-track':'On track', ahead:'Ahead of pace', behind:'Behind pace' }[pace.status];
  const detail = pace.status === 'on-track' ? `about where she usually is by ${clock(Date.now(), timezone)}` : `${oz(Math.abs(pace.diff))} ${pace.status === 'ahead' ? 'more' : 'less'} than usual by ${clock(Date.now(), timezone)}`;
  // Each bottle counts gradually across the time around it, so feeding times don't swing the verdict.
  const notes = [
    pace.lastBottle?.settling > 0.05 ? `Her ${oz(pace.lastBottle.oz)} bottle at ${clock(Date.parse(pace.lastBottle.at), timezone)} is still being counted in, so she doesn’t look ahead just because she ate.` : '',
    pace.coming ? `Her next bottle (about ${oz(pace.coming.oz)}${pace.nextDue ? ` around ${clock(Date.parse(pace.nextDue), timezone)}` : ''}) is close, so part of it already counts: she isn’t behind just because it hasn’t happened yet.` : '',
    pace.waitingForWake ? 'She’s asleep, so the next bottle is expected when she wakes (the cats’ average wake-up call).' : ''
  ].filter(Boolean);
  const settling = notes.length ? `${notes.join(' ')} Each bottle counts a little at a time over the ${hm(pace.gapMinutes)} around it, and her usual days are scored the same way.` : '';
  const due = pace.nextDue ? Date.parse(pace.nextDue) : null;
  return `<div class="pace pace-${pace.status}"><div class="pace-head"><strong class="pace-word">${word}</strong><span>${esc(detail)}</span></div>
    <div class="pace-bar" role="img" aria-label="${esc(`${oz(pace.drank)} of a ${oz(pace.target)} day; usually ${oz(pace.expected)} by now`)}"><i class="pace-counted" style="width:${pct(pace.counted)}"></i><i class="pace-settling" style="width:${pct(Math.max(0, pace.drank - pace.counted))}"></i><b class="pace-mark" style="left:${pct(pace.expected)}" title="Where she usually is by now"></b></div>
    <div class="pace-legend"><span><b>${oz(pace.drank)}</b> so far · ${pace.count} bottle${pace.count === 1 ? '' : 's'}</span><span>usually <b>${oz(pace.expected)}</b> by now</span><span>target <b>${oz(pace.target)}</b></span></div>
    <div class="frankie-status pace-tiles"><div class="frankie-tile"><span>Still to go</span><strong>${oz(pace.remaining)}</strong><small>to reach her ${pace.days}-day average</small></div><div class="frankie-tile"><span>On course for</span><strong>${oz(pace.projected)}</strong><small>if the day keeps this pace</small></div><div class="frankie-tile"><span>Next bottle</span><strong>${due ? esc(due < Date.now() ? 'Any time' : clock(due, timezone)) : '—'}</strong><small>${pace.waitingForWake ? 'when she wakes' : `every ~${esc(hm(pace.gapMinutes))} lately`}</small></div></div>
    ${settling ? `<p class="tiny muted">${esc(settling)}</p>` : ''}</div>`;
}
// Today at a glance: total, the left/right split, and today's sessions.
export function pumpsHTML(pumps = [], timezone, now = Date.now()) {
  if (!pumps.length) return '<p class="muted">No pumps logged yet. Log them in Huckleberry (Pump, with left and right amounts) and they’ll show up here with a daily chart and a cat challenge.</p>';
  const rows = dailyPumps(pumps, timezone, 8, now), today = rows.at(-1), week = rows.slice(0, -1).filter(r => r.count);
  const avg = week.length ? week.reduce((s, r) => s + r.ounces, 0) / week.length : null;
  const sided = today.left + today.right, share = v => today.ounces ? Math.round(v / today.ounces * 1000) / 10 : 0;
  const last = pumps.at(-1), todays = pumps.filter(p => localDay(Date.parse(p.start), timezone) === today.key).reverse();
  const side = p => p.left == null && p.right == null ? `${oz(toOunces(p.total, p.units))} total` : `L ${oz(toOunces(p.left || 0, p.units))} · R ${oz(toOunces(p.right || 0, p.units))}`;
  const lead = today.left && today.right ? (Math.abs(today.left - today.right) < 0.25 ? 'Even on both sides today.' : `${today.left > today.right ? 'Left' : 'Right'} side is ahead by ${oz(Math.abs(today.left - today.right))}.`) : '';
  return `<div class="frankie-status pump-tiles"><div class="frankie-tile"><span>Pumped today</span><strong>${oz(today.ounces)}</strong><small>${today.count} session${today.count === 1 ? '' : 's'}${last ? ` · last ${esc(ago(last.start, now))} ago` : ''}</small></div>
    <div class="frankie-tile"><span>Left</span><strong class="pump-l">${oz(today.left)}</strong><small>today</small></div>
    <div class="frankie-tile"><span>Right</span><strong class="pump-r">${oz(today.right)}</strong><small>today</small></div>
    <div class="frankie-tile"><span>Daily average</span><strong>${oz(avg)}</strong><small>${week.length ? `last ${week.length} pumping day${week.length === 1 ? '' : 's'}` : 'building'}</small></div></div>
    ${today.ounces ? `<div class="pump-split" role="img" aria-label="${esc(`Today: left ${oz(today.left)}, right ${oz(today.right)}${today.unsplit ? `, total only ${oz(today.unsplit)}` : ''}`)}"><i class="left" style="width:${share(today.left)}%"></i><i class="right" style="width:${share(today.right)}%"></i>${today.unsplit ? `<i class="unsplit" style="width:${share(today.unsplit)}%"></i>` : ''}</div>
    <div class="pump-split-labels"><span class="l">Left <b>${oz(today.left)}</b>${sided ? ` · ${Math.round(today.left / sided * 100)}%` : ''}</span>${today.unsplit ? `<span>Total only <b>${oz(today.unsplit)}</b></span>` : ''}<span class="r">Right <b>${oz(today.right)}</b>${sided ? ` · ${Math.round(today.right / sided * 100)}%` : ''}</span></div>${lead ? `<p class="tiny muted">${esc(lead)}</p>` : ''}` : ''}
    ${todays.length ? `<ul class="pump-sessions">${todays.slice(0, 8).map(p => `<li><span>${esc(clock(Date.parse(p.start), timezone))}${p.minutes ? ` <small>· ${p.minutes} min</small>` : ''}</span><span>${esc(side(p))} <small>· ${esc(oz(toOunces(p.total, p.units)))}</small></span></li>`).join('')}</ul>` : '<p class="tiny muted">No pumps yet today.</p>'}`;
}
function scoreboard(score, timezone) {
  const crown = key => score.leader === key ? '<span class="leader-badge">🏆 Leading</span>' : '';
  const cards = score.summary.map(model => `<article class="score-card score-${model.key}${score.leader === model.key ? ' is-leader' : ''}"><div class="score-head"><span>${esc(model.owner.toUpperCase())}</span>${crown(model.key)}</div><h3>${esc(model.name)}</h3>
    <div class="score-stats"><div><strong>${model.mae == null ? '—' : `±${model.mae}m`}</strong><small>avg miss</small></div><div><strong>${model.hitRate == null ? '—' : `${model.hitRate}%`}</strong><small>within 15m</small></div><div><strong>${model.wins}</strong><small>closest</small></div></div>
    <p class="score-width">${model.avgWidth == null ? 'Picks a single time' : `Avg window ${model.avgWidth} min wide`}</p><p>${model.n ? `${model.n} nap${model.n === 1 ? '' : 's'} scored${model.bias ? ` · usually ${signed(-model.bias).replace('late', 'too late').replace('early', 'too early')}` : ' · no early/late lean'}` : 'No naps scored yet'}</p></article>`).join('');
  const recent = score.results.slice(0, 8).map(row => `<tr><td>${esc(new Date(row.actual).toLocaleDateString([], { weekday:'short', timeZone:timezone }))} ${esc(clock(row.actual, timezone))}</td>${MODELS.map(model => { const r = row.models[model.key]; return `<td class="${r ? r.hit ? 'is-hit' : 'is-miss' : ''}${row.winners.length === 1 && row.winners[0] === model.key ? ' is-best' : ''}">${r ? `${r.hit ? '✓' : '·'} ${esc(signed(r.error))}` : '—'}</td>`; }).join('')}</tr>`).join('');
  // Naps without a saved SweetSpot (the app wasn't open while she was awake): offer recovery.
  const missed = score.missed?.length ? `<details class="missed-naps"><summary>${score.missed.length} recent nap${score.missed.length === 1 ? '' : 's'} missing from the scoreboard</summary><p class="tiny">No SweetSpot was saved for these, so Mack had no pick. Recovering one briefly takes the sleeps logged after it out of Huckleberry (saved here first and put back exactly), so Huckleberry recalculates SweetSpot as of that nap.</p><div class="missed-list">${score.missed.map(m => `<button type="button" class="btn" data-rewind-wake="${esc(m.lastWake)}">Woke ${esc(new Date(m.lastWake).toLocaleDateString([], { weekday:'short', timeZone:timezone }))} ${esc(clock(m.lastWake, timezone))} · napped ${esc(clock(m.actual, timezone))}</button>`).join('')}</div></details>` : '';
  return `${cards ? `<div class="score-grid">${cards}</div>` : ''}${missed}${recent ? `<div class="score-table-wrap"><table class="score-table"><thead><tr><th>Fell asleep</th>${MODELS.map(m => `<th>${esc(m.name)}</th>`).join('')}</tr></thead><tbody>${recent}</tbody></table></div>` : ''}
    <p class="tiny muted">Hubert’s and Mia’s guesses are recalculated for every wake-up using only what was logged before it, so backfilled naps get guesses too. Each nap is judged by the model version that was live then: Mia’s naps before ${esc(new Date(MIA_V2_SINCE).toLocaleDateString([], { month:'short', day:'numeric', timeZone:timezone }))} keep the forecasts her first version made. Mack’s pick is Huckleberry’s SweetSpot (${esc(MACK_EXCUSE.replace(/^Mack /, 'he ').replace(/\.$/, ''))}), captured while Frankie was awake; it stops updating once she falls asleep. A nap counts only when all three have a guess${score.skipped ? ` (${score.skipped} nap${score.skipped === 1 ? '' : 's'} skipped for a missing SweetSpot)` : ''}. Every model is judged on one time: SweetSpot’s time, or the middle of each window. Avg miss, hits (asleep within 15 minutes of that time) and “closest” all use it, so a wide window doesn’t earn easier hits; window widths are shown so a cautious guess is visible. “Late” means Frankie fell asleep after the guess.${score.scoredNaps < 3 ? ' A leader appears after three scored naps.' : ''}</p>`;
}

// "Bottles & sleep": what Frankie's own logs say, in plain words.
export function bottleLinksHTML(links, ageDays = null) {
  const name = { 'not-enough':'Not enough logs yet', none:'No clear link', slight:'A slight link', clear:'A clear link' };
  const row = (title, link, explain) => `<div class="link-row link-${link.verdict}"><div><strong>${esc(title)}</strong><small>${esc(explain(link))}</small></div><span class="link-badge">${esc(name[link.verdict])}</span></div>`;
  const per = (link, more, less, unit = 'minutes') => link.verdict === 'not-enough' ? `${link.n} of 8 days needed` : link.verdict === 'none' ? `Across ${link.n} times, ounces didn’t change it much` : `About ${Math.round(Math.abs(link.slope))} ${unit} ${link.slope >= 0 ? more : less} per extra ounce (${link.n} times)`;
  const f = links.feedToSleep;
  return `<div class="link-rows">
    ${row('Bigger bottle before a nap → longer nap?', links.napLength, link => per(link, 'longer', 'shorter'))}
    ${row('Bigger bottle → longer awake after?', links.window, link => per(link, 'longer awake', 'shorter awake'))}
    ${row('More ounces in the evening → longer night?', links.night, link => per(link, 'more night sleep', 'less night sleep'))}
    <div class="link-row"><div><strong>Bottle, then asleep</strong><small>${f.of ? `${f.share}% of her naps and bedtimes came within an hour of a bottle${f.typical != null ? `, usually ${f.typical} min after` : ''}` : 'No naps logged yet'}</small></div><span class="link-badge">${!f.of ? 'Watching' : f.share >= 60 ? 'Usually' : f.share >= 30 ? 'Sometimes' : 'Rarely'}</span></div>
  </div><p class="tiny muted">${ageDays != null ? `Frankie is ${esc(ageLabel(ageDays))}; Mia uses her age to follow how her wake windows grow and how long her history stays relevant. ` : 'Mia uses Frankie’s age when Huckleberry shares her birthdate. '}A link is used in Mia’s forecast only when Frankie’s last four weeks show it clearly; “bottle, then asleep” counts once it’s her usual pattern and steadier than her wake windows. These are correlations in her own logs, not feeding advice.</p>`;
}
// The morning wake-up and Bottle Bet challenges: one card per cat, then recent rounds.
export function challengeHTML(kind, score, timezone, upcoming = null) {
  const morning = kind === 'morning', pump = kind === 'pump', unit = morning ? 'm' : ' oz', models = CHALLENGES[kind];
  const value = (v, row) => v == null ? '—' : morning ? clock(v, timezone) : `${v} oz`;
  const cards = score.summary.map(model => `<article class="score-card score-${model.key}${score.leader === model.key ? ' is-leader' : ''}"><div class="score-head"><span>${esc(model.owner.toUpperCase())}</span>${score.leader === model.key ? '<span class="leader-badge">🏆 Leading</span>' : ''}</div><h3>${esc(model.name)}</h3>
    <div class="score-stats"><div><strong>${model.mae == null ? '—' : `±${model.mae}${unit}`}</strong><small>avg miss</small></div><div><strong>${model.hitRate == null ? '—' : `${model.hitRate}%`}</strong><small>within ${morning ? '15m' : '2 oz'}</small></div><div><strong>${model.wins}</strong><small>closest</small></div></div>
    <p class="score-width">${esc(model.how)}</p><p>${model.n ? `${model.n} ${morning ? 'morning' : 'day'}${model.n === 1 ? '' : 's'} scored` : `No ${morning ? 'mornings' : 'days'} scored yet`}</p></article>`).join('');
  const calls = upcoming && Object.values(upcoming).some(Boolean) ? `<p class="challenge-calls"><strong>${morning ? 'Tonight’s calls' : 'Today’s guesses'}:</strong> ${models.filter(m => upcoming[m.key] != null).map(m => `${esc(m.owner)} ${esc(morning ? clock(upcoming[m.key].target, timezone) : `${upcoming[m.key]} oz`)}`).join(' · ')}</p>` : '';
  const rows = score.results.slice(0, 6).map(row => `<tr><td>${esc(morning ? new Date(row.actual).toLocaleDateString([], { weekday:'short', timeZone:timezone }) : new Date(`${row.key}T12:00:00`).toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' }))} · ${esc(morning ? clock(row.actual, timezone) : `${row.actual} oz`)}</td>${models.map(m => `<td class="${Math.abs(row.errors[m.key]) <= (morning ? 15 : 2) ? 'is-hit' : 'is-miss'}${row.winners.length === 1 && row.winners[0] === m.key ? ' is-best' : ''}">${esc(morning ? clock(row.picks[m.key].target, timezone) : `${row.picks[m.key]} oz`)}</td>`).join('')}</tr>`).join('');
  return `${calls}<div class="score-grid">${cards}</div>${rows ? `<div class="score-table-wrap"><table class="score-table"><thead><tr><th>${morning ? 'Woke up' : pump ? 'Pumped' : 'Drank'}</th>${models.map(m => `<th>${esc(m.owner)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <p class="tiny muted">${morning ? 'Each cat makes its call at bedtime, from nights logged before it. The morning wake-up is when the night’s last stretch ended (4 AM to noon).' : pump ? 'Each cat guesses at midnight from earlier days. Days with no pumps logged aren’t scored.' : 'Each cat guesses at midnight from earlier days. Days with fewer than three bottles logged aren’t scored.'} Recalculated from ${pump ? 'Huckleberry’s' : 'Frankie’s'} logs, so backfilled ${morning ? 'nights' : 'days'} count too.</p>`;
}
// Mack's hat: how his pulled-from-a-hat guesses would have done (never in the competition).
const HAT_KIND = { sleep:'next sleep', wake:'nap wake-up', morning:'morning' };
export function hatHTML(score, timezone) {
  if (!score.n) return '<p class="tiny muted">No hat pulls to score yet. Mack pulls one whenever SweetSpot goes quiet: while she sleeps, overnight, or when its last call has passed.</p>';
  const miss = m => m === 0 ? 'spot on' : `${Math.abs(m)}m ${m > 0 ? 'early' : 'late'}`;
  const day = stamp => `${new Date(stamp).toLocaleDateString([], { weekday:'short', timeZone:timezone })} ${clock(stamp, timezone)}`;
  const versus = score.catsOnSame == null ? '' : score.hatOnSame <= score.catsOnSame ? 'Somehow, the hat is keeping up with Hubert and Mia.' : score.hatOnSame - score.catsOnSame <= 10 ? 'Not far behind Hubert and Mia, which worries them.' : 'Hubert and Mia are relieved.';
  const rows = score.results.slice(0, 6).map(r => `<tr><td>${esc(day(r.actual))}<small>${esc(HAT_KIND[r.kind])}</small></td><td>🎩 ${esc(clock(r.target, timezone))}</td><td class="${Math.abs(r.error) <= 15 ? 'is-hit' : 'is-miss'}">${esc(miss(r.error))}</td></tr>`).join('');
  return `<div class="hat-stats">
      <div><strong>±${score.mae}m</strong><small>hat’s avg miss</small></div>
      <div><strong>${score.catsOnSame == null ? '—' : `±${score.catsOnSame}m`}</strong><small>Hubert &amp; Mia on the same calls</small></div>
      <div><strong>${score.hitRate}%</strong><small>within 15 min</small></div>
      <div><strong>${score.n}</strong><small>pulls · ${score.kinds.sleep} sleeps, ${score.kinds.wake} nap wake-ups, ${score.kinds.morning} mornings</small></div>
    </div>
    <p class="hat-verdict">${esc(versus)}${score.best ? ` Best pull: ${esc(HAT_KIND[score.best.kind])} on ${esc(day(score.best.actual))} (${esc(miss(score.best.error))}).` : ''}${score.worst && score.worst !== score.best ? ` Worst: ${esc(miss(score.worst.error))} on ${esc(day(score.worst.actual))}.` : ''}</p>
    <div class="score-table-wrap"><table class="score-table fit-table"><thead><tr><th>What happened</th><th>Hat said</th><th>Miss</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="tiny muted">Whenever SweetSpot goes quiet (she’s asleep, it’s the night, or its last call passed while she was still up), Mack pulls a guess: the middle of Hubert’s and Mia’s calls, give or take up to 25 minutes, in steps of five. The same moment always pulls the same slip, so these are replayed from the last three weeks of logs. None of it counts in the challenges.</p>`;
}
// Nap or night? One card per cat, the calls for the sleep coming up, then recent wake-ups.
const NN = { night:'🌙 Night', nap:'😴 Nap' };
export function napNightHTML(score, timezone, upcoming = null, plan = 4) {
  const models = CHALLENGES.napnight;
  const cards = score.summary.map(model => `<article class="score-card score-${model.key}${score.leader === model.key ? ' is-leader' : ''}"><div class="score-head"><span>${esc(model.owner.toUpperCase())}</span>${score.leader === model.key ? '<span class="leader-badge">🏆 Leading</span>' : ''}</div><h3>${esc(model.name)}</h3>
    <div class="score-stats"><div><strong>${model.hitRate == null ? '—' : `${model.hitRate}%`}</strong><small>called right</small></div><div><strong>${model.nights ? `${model.nightsRight}/${model.nights}` : '—'}</strong><small>bedtimes</small></div><div><strong>${model.naps ? `${model.napsRight}/${model.naps}` : '—'}</strong><small>naps</small></div></div>
    <p class="score-width">${esc(model.how)}</p><p>${model.n ? `${model.n} wake-up${model.n === 1 ? '' : 's'} scored` : 'No wake-ups scored yet'}</p></article>`).join('');
  const calls = upcoming && models.some(m => upcoming[m.key]) ? `<p class="challenge-calls"><strong>Her next sleep:</strong> ${models.map(m => `${esc(m.owner)} ${upcoming[m.key] ? esc(NN[upcoming[m.key]]) : '<span class="muted">no call yet</span>'}`).join(' · ')}${upcoming.napsToday != null ? ` <span class="muted">(${upcoming.napsToday} nap${upcoming.napsToday === 1 ? '' : 's'} so far today)</span>` : ''}</p>` : '';
  const rows = score.results.slice(0, 6).map(row => `<tr><td>${esc(new Date(row.asleep).toLocaleDateString([], { weekday:'short', timeZone:timezone }))} ${esc(clock(row.asleep, timezone))}<small>${esc(NN[row.actual])}</small></td>${models.map(m => `<td class="${row.right[m.key] ? 'is-hit' : 'is-miss'}">${row.right[m.key] ? '✓' : '✗'} ${esc(row.picks[m.key] === 'night' ? 'Night' : 'Nap')}</td>`).join('')}</tr>`).join('');
  return `${calls}<div class="score-grid">${cards}</div>${rows ? `<div class="score-table-wrap"><table class="score-table fit-table"><thead><tr><th>Fell asleep</th>${models.map(m => `<th>${esc(m.owner)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <p class="tiny muted">Each cat calls it when she wakes up, from what was logged by then, so backfilled sleeps count too. Night means the sleep started after her usual evening line or lasted four hours or more. Mack follows the ${esc(String(plan))}-nap SweetSpot plan chosen in Settings: after that many naps, Huckleberry’s next SweetSpot is bedtime. A wake-up counts once all three have a call.</p>`;
}
// "The cats' calls" carousel: one slide per challenge with what each cat is calling now.
const CAT_KEYS = ['hubert', 'mia', 'mack'];
function callRows(kind, value, score, note = '') {
  const models = CHALLENGES[kind];
  return `<ul>${models.map(m => { const v = value(m.key);
    return `<li class="guess-${m.key}${v == null ? ' is-quiet' : ''}"><span class="guess-dot" aria-hidden="true"></span><span><b>${esc(m.owner)} · ${esc(m.name)}</b><small>${score?.leader === m.key ? '🏆 leading · ' : ''}${esc(m.how)}</small></span><strong>${v == null ? '<span class="muted">no call yet</span>' : esc(v)}</strong></li>`; }).join('')}</ul>${note ? `<p class="tiny muted">${note}</p>` : ''}`;
}
const seeAll = id => `<button type="button" class="text-link calls-more" data-calls-jump="${id}">Full scoreboard ↓</button>`;
export function callsSlides({ sleeps, bottles, pumps, timer, timezone, now, birthdate, plan, napNight, mornings, bottleScore, pumpScore, todayOz, todayPump }) {
  const last = sleeps.at(-1), up = !timer?.active && last ? Date.parse(last.end) : null, awake = up && isDaytimeWake(up, timezone, sleeps) ? up : null;
  // Nap or night: called at each wake-up.
  const nn = awake ? napNightPicks(sleeps, timezone, awake, { bottles, birthdate, plan }) : null, lastNN = napNight.results[0];
  const napNightHTML = callRows('napnight', key => nn?.[key] ? (nn[key] === 'night' ? '🌙 Night' : '😴 Nap') : null, napNight,
    nn ? `Called when she woke at ${esc(clock(awake, timezone))}${nn.napsToday != null ? ` · ${nn.napsToday} nap${nn.napsToday === 1 ? '' : 's'} so far today` : ''}.` : `${up ? 'She’s up for a night feed; the calls come after her morning wake-up.' : 'She’s asleep; the calls come when she wakes up.'}${lastNN ? ` Last time it was ${lastNN.actual === 'night' ? 'the night' : 'a nap'}: ${CAT_KEYS.map(k => `${CHALLENGES.napnight.find(m => m.key === k).owner} ${lastNN.right[k] ? '✓' : '✗'}`).join(' · ')}.` : ''}`) + seeAll('frankieNapNight');
  // Morning wake-up: called at bedtime.
  const bedtime = currentBedtime(sleeps, timer, timezone, now), mp = bedtime ? morningPicks(sleeps, timezone, bedtime, { birthdate }) : null, lastMorning = mornings.results[0];
  const morningHTML = callRows('morning', key => mp?.[key] ? clock(mp[key].target, timezone) : null, mornings,
    mp ? `Called at bedtime (${esc(clock(bedtime, timezone))}).` : `The cats call the morning at bedtime.${lastMorning ? ` Last wake-up: ${esc(clock(lastMorning.actual, timezone))} (${CAT_KEYS.map(k => `${CHALLENGES.morning.find(m => m.key === k).owner} ${esc(clock(lastMorning.picks[k].target, timezone))}`).join(', ')}).` : ''}`) + seeAll('frankieMorning');
  // Bottle bet and pump pool: called at midnight.
  const bp = bottlePicks(bottles, timezone, localDay(now, timezone), { birthdate });
  const bottleHTML = callRows('bottle', key => bp[key] != null ? `${bp[key]} oz` : null, bottleScore, `So far today: <strong>${esc(oz(todayOz))}</strong>.`) + seeAll('frankieBottleBet');
  const pp = pumps.length ? pumpPicks(pumps, timezone, localDay(now, timezone), { bottles }) : {};
  const pumpHTML = pumps.length ? callRows('pump', key => pp[key] != null ? `${pp[key]} oz` : null, pumpScore, `Pumped so far today: <strong>${esc(oz(todayPump))}</strong>.`) + seeAll('frankiePumpPool') : '<p class="tiny muted">Log Karena’s pumps (＋ Pump on Today, or tell Siri) and the cats start guessing her daily ounces.</p>';
  return { napNightHTML, morningHTML, bottleHTML, pumpHTML };
}
// The 24-hour clock (day-ring.js), redrawn when the cats' next call changes.
function drawRing() {
  const el = $('frankieRing'); if (!el || !ringArgs) return;
  const now = Date.now(), { sleeps, timer, timezone } = ringArgs, last = sleeps.at(-1);
  const ring = dayRing({ ...ringArgs, now, next:nextCall && !timer?.active ? { at:nextCall.target, label:nextCall.kind === 'bedtime' ? 'bedtime' : 'next nap' } : null });
  const status = timer?.active ? ago(timer.start, now) : last ? ago(last.end, now) : '—';
  const since = timer?.active ? `since ${clock(timer.start, timezone)}` : last ? `since ${clock(last.end, timezone)}` : '';
  renderHTML(el, dayRingHTML(ring, { timezone, now, status, since }));
  if ($('frankieRingCard')) $('frankieRingCard').hidden = false;
}
export function renderFrankie({ snapshot, timezone, predictions = [], demo = false, connected = false, wakeAt = null }) {
  shared = snapshot ? { snapshot, timezone, demo } : null;
  const share = $('frankieShare'); if (share) share.disabled = !snapshot;
  document.querySelectorAll('[data-week-story]').forEach(button => { button.disabled = !snapshot; });
  const root = $('frankieContent'); if (!root) return;
  // The placeholder lives beside the page content and is only shown/hidden, so
  // the chart containers always exist when data arrives.
  const empty = $('frankieEmpty'), ready = !!snapshot;
  root.hidden = !ready; if (empty) empty.hidden = ready;
  if (!ready) { if (empty) renderHTML(empty, `<span class="baby-orbit" aria-hidden="true">☾</span><div><h3>Frankie’s trends will live here.</h3><p>${connected ? 'Loading her history from Huckleberry… If this stays, choose a child profile in Settings and press Refresh on Home.' : 'Connect Huckleberry in Settings to see sleep history, daily ounces and the nap prediction scoreboard.'}</p></div>`); return; }
  if (!['frankieStatus', 'frankieScore', 'frankieTimeline', 'frankieSleep', 'frankieBottles', 'frankieNote'].every(id => $(id))) return;
  const now = Date.now(), sleeps = snapshot.sleeps || [], bottles = snapshot.bottles || [];
  const summary = babySummary({ sleeps, bottles }, timezone, now), last = sleeps.at(-1), timer = snapshot.timer;
  const status = timer?.active ? `Asleep for ${ago(timer.start, now)}` : last ? `Awake for ${ago(last.end, now)}` : 'No sleep logged';
  const change = summary.avgOunces && summary.priorOunces ? Math.round((summary.avgOunces - summary.priorOunces) * 2) / 2 : null;
  const lastBottle = bottles.at(-1);
  renderHTML($('frankieStatus'), `<div class="frankie-tile is-live"><span>${timer?.active ? '☾ Sleeping' : '☀ Awake'}</span><strong>${esc(status)}</strong><small>${timer?.active ? `since ${esc(clock(timer.start, timezone))}` : last ? `since ${esc(clock(last.end, timezone))}` : ''}</small></div>
    <div class="frankie-tile"><span>Sleep today</span><strong>${hm(summary.today.sleep?.total)}</strong><small>${summary.avgSleep ? `7-day avg ${hm(summary.avgSleep)} per day` : 'Building a weekly average'}</small></div>
    <div class="frankie-tile"><span>Bottles today</span><strong>${oz(summary.today.bottles?.ounces)}</strong><small>${summary.today.bottles?.count || 0} bottle${summary.today.bottles?.count === 1 ? '' : 's'}${lastBottle ? ` · last ${esc(ago(lastBottle.start, now))} ago` : ''}</small></div>
    <div class="frankie-tile"><span>Daily average</span><strong>${oz(summary.avgOunces)}</strong><small>${change == null ? 'last 7 full days' : change === 0 ? 'same as the week before' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)} oz vs the week before`}</small></div>`);
  ringArgs = { sleeps, bottles, timer, timezone }; drawRing();
  const week = frankieAwards({ sleeps, bottles }, timezone, now);
  if ($('frankieAwards')) {
    renderHTML($('frankieAwards'), week.awards.length ? week.awards.map(award => `<article class="award"><span class="award-icon" aria-hidden="true">${award.icon}</span><div><small>${esc(award.title)}</small><strong>${esc(award.value)}</strong><span>${esc(award.detail)}</span></div></article>`).join('') : '<p class="tiny muted">Awards appear after a few days of logs.</p>');
    $('frankieAwardsRange').textContent = week.awards.length ? `${dayLabel(week.from, timezone)} – ${dayLabel(week.to, timezone)}` : '';
  }
  const score = scorePredictions(predictions, sleeps, timer, timezone, { bottles, birthdate:snapshot.birthdate });
  if ($('frankieLinks')) renderHTML($('frankieLinks'), bottleLinksHTML(bottleSleepLinks({ sleeps, bottles, timezone }, now), ageInDays(snapshot.birthdate, now)));
  renderHTML($('frankieScore'), scoreboard(score, timezone));
  if ($('frankieMorning')) {
    const bedtime = currentBedtime(sleeps, timer, timezone, now);
    renderHTML($('frankieMorning'), challengeHTML('morning', scoreMornings(sleeps, timezone, now, { birthdate:snapshot.birthdate }), timezone, bedtime ? morningPicks(sleeps, timezone, bedtime, { birthdate:snapshot.birthdate }) : null));
  }
  if ($('frankieHat')) { const hat = scoreHat(predictions, sleeps, timer, timezone, now, { bottles, birthdate:snapshot.birthdate }); $('mackHatCard').hidden = false; renderHTML($('frankieHat'), hatHTML(hat, timezone)); }
  if ($('frankieNapNight')) {
    const plan = Number(snapshot.sweetspot?.selectedNapDay) || Number(snapshot.napPlan) || 4, extra = { bottles, birthdate:snapshot.birthdate, plan };
    const up = !timer?.active && last ? Date.parse(last.end) : null, awake = up && isDaytimeWake(up, timezone, sleeps) ? up : null; // no call after a night feed
    renderHTML($('frankieNapNight'), napNightHTML(scoreNapNight(sleeps, timezone, now, { ...extra, timer }), timezone, awake ? napNightPicks(sleeps, timezone, awake, extra) : null, plan));
  }
  if ($('frankieBottleBet')) renderHTML($('frankieBottleBet'), challengeHTML('bottle', scoreBottles(bottles, timezone, now, { birthdate:snapshot.birthdate }), timezone, bottlePicks(bottles, timezone, localDay(now, timezone), { birthdate:snapshot.birthdate })));
  const width = id => Math.max(280, Math.round($(id).clientWidth || 720));
  // Bottle pace for today.
  if ($('frankiePace')) { $('frankiePaceCard').hidden = false; renderHTML($('frankiePace'), paceHTML(bottlePace(bottles, timezone, now, { wakeAt }), timezone)); }
  // Karena's pumps: the card always shows (with a how-to when empty); the challenge and chart once there's data.
  const pumps = snapshot.pumps || [];
  if ($('frankiePumps')) renderHTML($('frankiePumps'), pumpsHTML(pumps, timezone, now));
  if ($('pumpPoolCard')) $('pumpPoolCard').hidden = !pumps.length;
  if ($('pumpChartCard')) $('pumpChartCard').hidden = !pumps.length;
  if (pumps.length && $('frankiePumpPool')) renderHTML($('frankiePumpPool'), challengeHTML('pump', scorePumps(pumps, timezone, now, { bottles }), timezone, pumpPicks(pumps, timezone, localDay(now, timezone), { bottles })));
  renderHTML($('frankieTimeline'), timeline(timelineRows(sleeps, timezone, 14, now), timezone, width('frankieTimeline')) + legend([['night', 'Night sleep'], ['nap', 'Nap']]));
  const sleepRows = dailySleep(sleeps, timezone, range, now), bottleRows = dailyBottles(bottles, timezone, range, now);
  const shown = Math.min(range, snapshot.historyDays || range);
  renderHTML($('frankieSleep'), sleepChart(sleepRows.slice(-shown), timezone, width('frankieSleep')) + legend([['night', 'Night'], ['nap', 'Naps']])
    + table('Daily sleep', ['Day', 'Night', 'Naps', 'Total', 'Nap count'], [...sleepRows.slice(-shown)].reverse().map(r => [esc(dayLabel(r.key, timezone)), hm(r.night), hm(r.nap), hm(r.total), r.naps])));
  renderHTML($('frankieBottles'), bottleChart(bottleRows.slice(-shown), timezone, summary.avgOunces, width('frankieBottles'))
    + table('Bottle ounces per day', ['Day', 'Ounces', 'Bottles'], [...bottleRows.slice(-shown)].reverse().map(r => [esc(dayLabel(r.key, timezone)), oz(r.ounces), r.count])));
  if (pumps.length && $('frankiePumpChart') && !$('pumpChartCard')?.hidden) {
    const pumpRows = dailyPumps(pumps, timezone, range, now).slice(-shown), past = pumpRows.slice(-8, -1).filter(r => r.count);
    const avg = past.length ? past.reduce((s, r) => s + r.ounces, 0) / past.length : null;
    renderHTML($('frankiePumpChart'), pumpChart(pumpRows, timezone, avg, width('frankiePumpChart')) + legend([['left', 'Left'], ['right', 'Right'], ...(pumpRows.some(r => r.unsplit) ? [['unsplit', 'Total only']] : [])])
      + table('Ounces pumped per day', ['Day', 'Total', 'Left', 'Right', 'Pumps'], [...pumpRows].reverse().map(r => [esc(dayLabel(r.key, timezone)), oz(r.ounces), oz(r.left), oz(r.right), r.count])));
  }
  document.querySelectorAll('[data-frankie-range]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.frankieRange) === range)));
  // The cats' calls carousel (the first slide, the next nap, is drawn by baby.js).
  if ($('callsNapNight')) {
    try {
      const plan = Number(snapshot.sweetspot?.selectedNapDay) || Number(snapshot.napPlan) || 4;
      const slides = callsSlides({ sleeps, bottles, pumps, timer, timezone, now, birthdate:snapshot.birthdate, plan,
        napNight:scoreNapNight(sleeps, timezone, now, { bottles, birthdate:snapshot.birthdate, plan, timer }), mornings:scoreMornings(sleeps, timezone, now, { birthdate:snapshot.birthdate }),
        bottleScore:scoreBottles(bottles, timezone, now, { birthdate:snapshot.birthdate }), pumpScore:pumps.length ? scorePumps(pumps, timezone, now, { bottles }) : null,
        todayOz:summary.today.bottles?.ounces || 0, todayPump:pumps.length ? dailyPumps(pumps, timezone, 1, now).at(-1)?.ounces || 0 : 0 });
      renderHTML($('callsNapNight'), slides.napNightHTML); renderHTML($('callsMorning'), slides.morningHTML); renderHTML($('callsBottle'), slides.bottleHTML); renderHTML($('callsPump'), slides.pumpHTML);
      fitCalls();
    } catch (e) { console.error('Cats’ calls slides failed', e); }
  }
  // The hunch box (hypotheses-view.js) tests against the same logs.
  try { window.dispatchEvent(new CustomEvent('hh:frankie', { detail:{ snapshot, timezone } })); } catch {}
  $('frankieNote').textContent = `${demo ? 'Sample data · ' : ''}${snapshot.historyComplete === false || snapshot.feedsComplete === false ? 'Some older history was too long to load in full. ' : ''}Up to ${snapshot.historyDays || 14} days from Huckleberry · ${timezone.replaceAll('_', ' ')}.`;
}

// "Share her day": yesterday and today so far, in plain sentences for a text to family.
export function frankieDayText(snapshot, timezone, now = Date.now()) {
  const name = snapshot.name || 'Frankie', summary = babySummary(snapshot, timezone, now), asleep = !!snapshot.timer?.active;
  const yesterdayKey = localDay(now - 86400000, timezone), yesterdayRow = dailySleep(snapshot.sleeps || [], timezone, 2, now)[0];
  const yesterday = dayStoryText(dayStory(snapshot, null, timezone, yesterdayKey, now), { name, timezone, label:'Yesterday', asleep:false, totalHours:yesterdayRow?.total, averageHours:summary.avgSleep });
  const today = dayStoryText(dayStory(snapshot, null, timezone, localDay(now, timezone), now), { name, timezone, label:'So far today', asleep });
  return [`${name}’s day 🐾`, yesterday, today, asleep ? `${name} is asleep right now.` : '', '— from Hubert’s House'].filter(Boolean).join('\n\n');
}
async function shareDay(button) {
  if (!shared) return;
  const text = frankieDayText(shared.snapshot, shared.timezone), note = $('frankieShareNote');
  try {
    if (navigator.share) { await navigator.share({ title:`${shared.snapshot.name || 'Frankie'}’s day`, text }); return; }
    await navigator.clipboard.writeText(text); if (note) note.textContent = 'Copied. Paste it into a message.';
  } catch (error) {
    if (error?.name === 'AbortError') return; // closed the share sheet
    if (note) { note.textContent = text; note.classList.add('is-fallback'); }
  }
  button.blur();
}
// The carousel's height follows the slide in view, and the tabs follow the swipe.
function callsIndex() { const track = $('callsTrack'); return track && track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0; }
function fitCalls() {
  const track = $('callsTrack'); if (!track) return;
  const i = callsIndex(), slide = track.querySelector(`[data-calls-slide="${i}"]`);
  document.querySelectorAll('[data-calls-tab]').forEach(tab => tab.setAttribute('aria-selected', String(Number(tab.dataset.callsTab) === i)));
  if (slide && slide.offsetHeight) track.style.height = `${slide.offsetHeight}px`;
}
function initCalls() {
  const track = $('callsTrack'); if (!track) return;
  let settle;
  track.addEventListener('scroll', () => { clearTimeout(settle); settle = setTimeout(fitCalls, 90); document.querySelectorAll('[data-calls-tab]').forEach(tab => tab.setAttribute('aria-selected', String(Number(tab.dataset.callsTab) === callsIndex()))); }, { passive:true });
  document.querySelector('.calls-tabs')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-calls-tab]'); if (!tab) return;
    const i = Number(tab.dataset.callsTab);
    document.querySelectorAll('[data-calls-tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    if (track.scrollTo) track.scrollTo({ left:i * track.clientWidth, behavior:'smooth' }); else track.scrollLeft = i * track.clientWidth;
    setTimeout(fitCalls, 400);
  });
  $('frankieGuessCard')?.addEventListener('click', event => { const jump = event.target.closest('[data-calls-jump]'); if (jump) $(jump.dataset.callsJump)?.closest('section')?.scrollIntoView({ behavior:'smooth', block:'start' }); });
  if ('ResizeObserver' in window) new ResizeObserver(() => fitCalls()).observe(track.querySelector('[data-calls-slide="0"]'));
}
export function initFrankie(rerender) {
  initCalls();
  window.addEventListener('hh:baby', event => { const call = event.detail ? catsConsensus(event.detail) : null; if ((call?.target || null) !== (nextCall?.target || null)) { nextCall = call; drawRing(); } });
  $('frankieShare')?.addEventListener('click', event => shareDay(event.currentTarget));
  // Frankie's week as story cards (week-story.js, story-view.js).
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-week-story]') || !shared) return;
    const story = weekStory(shared.snapshot, shared.timezone);
    if (story.available) openStory(story); else { const note = $('frankieShareNote'); if (note) note.textContent = story.reason; }
  });
  document.querySelectorAll('[data-frankie-range]').forEach(button => button.addEventListener('click', () => {
    range = Number(button.dataset.frankieRange); try { localStorage.setItem('hh_frankie_range', String(range)); } catch { /* optional */ }
    rerender();
  }));
  // One tooltip for every chart: hover on desktop, tap on touch screens.
  const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.setAttribute('role', 'status'); tip.hidden = true; document.body.append(tip);
  const show = (target, x, y) => {
    const [title, ...lines] = target.dataset.tip.split('|');
    tip.innerHTML = `<strong>${esc(title)}</strong>${lines.map(line => `<span>${esc(line)}</span>`).join('')}`; tip.hidden = false;
    const box = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - box.width - 8, Math.max(8, x - box.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - box.height - 14)}px`;
    document.querySelectorAll('.is-hovered').forEach(el => el.classList.remove('is-hovered')); target.classList.add('is-hovered');
  };
  const hide = () => { tip.hidden = true; document.querySelectorAll('.is-hovered').forEach(el => el.classList.remove('is-hovered')); };
  const root = $('view-frankie');
  root?.addEventListener('pointermove', e => { const target = e.target.closest?.('[data-tip]'); if (target) show(target, e.clientX, e.clientY); else hide(); });
  root?.addEventListener('pointerleave', hide);
  root?.addEventListener('click', e => { const target = e.target.closest?.('[data-tip]'); if (target) show(target, e.clientX, e.clientY); });
  document.addEventListener('scroll', hide, { passive:true, capture:true }); // the page or its scrolling area (phones)
  document.addEventListener('pointerdown', event => { if (!event.target.closest?.('[data-tip]')) hide(); });
  window.addEventListener('hashchange', hide);
  // Charts are drawn at their real pixel width so text stays the same size.
  let lastWidth = 0, pending;
  if ('ResizeObserver' in window) new ResizeObserver(entries => { const next = Math.round(entries[0].contentRect.width); if (!next || Math.abs(next - lastWidth) < 8) return; lastWidth = next; clearTimeout(pending); pending = setTimeout(rerender, 120); }).observe(root);
}
