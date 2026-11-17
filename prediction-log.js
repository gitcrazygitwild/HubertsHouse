// Nap prediction scoreboard.
// - Hubert's Purrfect Window and Mia's Catnap Forecast are deterministic, so
//   their guess for any wake-up is recomputed "as of" that wake-up from sleeps
//   that had ended by then. Backfilled naps therefore get honest guesses too,
//   and nothing about them needs storing.
// - Huckleberry's SweetSpot cannot be replayed. Its latest prediction is saved
//   per wake-up while the baby is awake (Huckleberry recalculates after a nap is
//   entered) and is no longer updated once the next sleep starts.
// - A nap is scored only when all three models have a guess for it.
// - Fairness: every model is judged on ONE predicted time (SweetSpot's time,
//   each window's center). A hit is falling asleep within ±15 min of it for
//   all three, so a wide window earns no easier hits. Window widths are shown
//   separately so a cautious, wide window is visible.
import { purrfectWindow, miaForecast } from './baby-model.js';
import { nightLine, sleepKind } from './baby-history.js';

export const MODELS = [
  { key:'sweetspot', name:'SweetSpot', owner:'Huckleberry' },
  { key:'purrfect', name:'Purrfect Window', owner:'Hubert' },
  { key:'mia', name:'Catnap Forecast', owner:'Mia' }
];
const MINUTE = 60000, MAX_WAIT = 8 * 3600000;
export const HIT_MINUTES = 15;
const ms = value => Date.parse(value);
export const predictionId = lastWake => `w${ms(lastWake)}`;

// Only wake-ups before a nap are scored: the end of a nap, or the end of the night
// in the morning. A 3am feed wake followed by more night sleep is not a nap to score.
// With the sleep log, nap vs night follows Frankie's learned evening line (so a late
// catnap before a 10 PM bedtime counts); without it, the old 5am–8pm rule applies.
const hourFormats = new Map();
export function isDaytimeWake(lastWake, timezone = 'America/New_York', sleeps = null, line = null) {
  if (!hourFormats.has(timezone)) hourFormats.set(timezone, new Intl.DateTimeFormat('en-US', { timeZone:timezone, hour:'numeric', hourCycle:'h23' }));
  const wake = typeof lastWake === 'number' ? lastWake : ms(lastWake), hour = Number(hourFormats.get(timezone).format(new Date(wake)));
  const ended = sleeps?.find(sleep => ms(sleep.end) === wake);
  if (!ended) return hour >= 5 && hour < 20;
  if (sleepKind(ended, timezone, line ?? nightLine(sleeps, timezone, wake)) === 'nap') return true;
  return hour >= 5 && hour < 12;
}

// The SweetSpot record for the current wake-up, or null when there is nothing
// new and valid to save. `previousTarget` is the SweetSpot saved for the wake-up
// before this one: seeing it again means Huckleberry has not recalculated yet.
export function sweetspotEntry({ lastWake, childId, sweetspot, previousTarget = null, timer = null, timezone, sleeps = null, now = new Date() }) {
  const wake = ms(lastWake);
  if (!Number.isFinite(wake) || +now - wake > MAX_WAIT || !isDaytimeWake(wake, timezone, sleeps) || timer?.active) return null;
  if (!sweetspot?.available || sweetspot.sleeping || !(ms(sweetspot.time) > wake) || sweetspot.time === previousTarget) return null;
  return { id:predictionId(lastWake), lastWake:new Date(wake).toISOString(), childId:String(childId || ''), sweetspot:{ target:sweetspot.time, loggedAt:new Date(+now).toISOString() } };
}
// What to write for an existing record: the latest SweetSpot wins while awake.
export function sweetspotPatch(existing, incoming) {
  if (!incoming) return null;
  if (!existing) return incoming;
  return existing.sweetspot?.target === incoming.sweetspot.target ? null : { sweetspot:incoming.sweetspot };
}
export function previousSweetspot(entries = [], lastWake) {
  const wake = ms(lastWake);
  return entries.filter(entry => ms(entry.lastWake) < wake && entry.sweetspot?.target).sort((a, b) => ms(b.lastWake) - ms(a.lastWake))[0]?.sweetspot.target || null;
}

// The first sleep that began after this wake-up (a running timer counts).
export function actualSleepStart(lastWake, sleeps = [], timer = null) {
  const wake = ms(lastWake);
  const starts = sleeps.map(sleep => ms(sleep.start)).filter(start => Number.isFinite(start) && start > wake);
  if (timer?.active && ms(timer.start) > wake) starts.push(ms(timer.start));
  const first = starts.length ? Math.min(...starts) : null;
  return first && first - wake <= MAX_WAIT ? first : null;
}

// Hubert's and Mia's guesses as of one wake-up, from sleeps that had ended by then.
export function replayGuesses(sleeps, lastWake, timezone) {
  const wake = ms(lastWake), known = sleeps.filter(sleep => ms(sleep.end) <= wake), at = new Date(wake + MINUTE);
  const pick = model => model.available ? { start:model.start, end:model.end, target:model.target } : null;
  return { purrfect:pick(purrfectWindow({ sleeps:known, timezone }, at)), mia:pick(miaForecast({ sleeps:known, timezone }, at)) };
}

// Scores are recomputed only when the logs, saved SweetSpots or timer change.
let memo = { key:null, value:null };
export function scorePredictions(entries = [], sleeps = [], timer = null, timezone = 'America/New_York') {
  const key = JSON.stringify([timezone, timer?.active ? timer.start : null, sleeps.length, sleeps.at(-1)?.start, sleeps.at(-1)?.end, sleeps[0]?.start, entries.map(entry => `${entry.id}:${entry.sweetspot?.target}`)]);
  if (memo.key === key) return memo.value;
  const value = computeScores(entries, sleeps, timer, timezone); memo = { key, value }; return value;
}
function computeScores(entries, sleeps, timer, timezone) {
  const saved = new Map(entries.map(entry => [entry.id, entry]));
  // Naps before the first saved SweetSpot predate the scoreboard; ignore them.
  const since = Math.min(...entries.map(entry => ms(entry.lastWake)).filter(Number.isFinite));
  const latest = Math.max(0, ...sleeps.map(sleep => ms(sleep.end)).filter(Number.isFinite)), line = nightLine(sleeps, timezone, latest, 60);
  const wakes = [...new Set(sleeps.map(sleep => sleep.end))].filter(end => ms(end) >= since && isDaytimeWake(end, timezone, sleeps, line));
  const results = []; let skipped = 0;
  for (const lastWake of wakes) {
    const actual = actualSleepStart(lastWake, sleeps, timer);
    if (!actual) continue;
    // Without a saved SweetSpot a nap can never be scored, so skip the replay.
    const sweetspot = saved.get(predictionId(lastWake))?.sweetspot;
    if (!sweetspot) { skipped++; continue; }
    const replay = replayGuesses(sleeps, lastWake, timezone);
    const guesses = { sweetspot:sweetspot ? { target:sweetspot.target } : null, purrfect:replay.purrfect, mia:replay.mia };
    if (!MODELS.every(model => guesses[model.key])) { skipped++; continue; }
    const row = { id:predictionId(lastWake), lastWake, actual:new Date(actual).toISOString(), models:{} };
    for (const model of MODELS) {
      const guess = guesses[model.key], error = (actual - ms(guess.target)) / MINUTE;
      const width = guess.start && guess.end ? Math.round((ms(guess.end) - ms(guess.start)) / MINUTE) : null;
      row.models[model.key] = { error:Math.round(error) || 0, hit:Math.abs(error) <= HIT_MINUTES, width, inWindow:width != null ? actual >= ms(guess.start) && actual <= ms(guess.end) : null };
    }
    const best = Math.min(...MODELS.map(model => Math.abs(row.models[model.key].error)));
    row.winners = MODELS.filter(model => Math.abs(row.models[model.key].error) === best).map(model => model.key);
    results.push(row);
  }
  results.sort((a, b) => ms(b.actual) - ms(a.actual));
  const n = results.length;
  const summary = MODELS.map(model => {
    const scored = results.map(row => row.models[model.key]);
    return { ...model, n, mae:n ? Math.round(scored.reduce((sum, value) => sum + Math.abs(value.error), 0) / n) : null,
      bias:n ? Math.round(scored.reduce((sum, value) => sum + value.error, 0) / n) || 0 : null,
      hitRate:n ? Math.round(100 * scored.filter(value => value.hit).length / n) : null,
      wins:results.filter(row => row.winners.length === 1 && row.winners[0] === model.key).length,
      avgWidth:n && scored.every(value => value.width != null) ? Math.round(scored.reduce((sum, value) => sum + value.width, 0) / n) : null };
  });
  const leader = n >= 3 ? [...summary].sort((a, b) => a.mae - b.mae || b.hitRate - a.hitRate)[0].key : null;
  return { results, summary, leader, scoredNaps:n, skipped };
}
