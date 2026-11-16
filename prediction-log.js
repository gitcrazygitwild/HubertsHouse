// Nap prediction scoreboard. Each wake-up gets one record; each model's guess
// is locked in the first time it is seen after that wake-up and never changed,
// so later refreshes cannot improve a score with hindsight.
export const MODELS = [
  { key:'sweetspot', name:'SweetSpot', owner:'Huckleberry', hitMinutes:15 },
  { key:'purrfect', name:'Purrfect Window', owner:'Hubert' },
  { key:'mia', name:'Catnap Forecast', owner:'Mia' }
];
const MINUTE = 60000, MAX_WAIT = 8 * 3600000;
const ms = value => Date.parse(value);
export const predictionId = lastWake => `w${ms(lastWake)}`;

// Builds the record for the current wake-up from whatever models are available.
// Only daytime wake-ups (5am–8pm in the baby's time zone) are nap predictions;
// a 3am feed wake followed by more night sleep is not a nap to score.
export function isDaytimeWake(lastWake, timezone = 'America/New_York') {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone:timezone, hour:'numeric', hourCycle:'h23' }).format(new Date(lastWake)));
  return hour >= 5 && hour < 20;
}
export function predictionEntry({ lastWake, childId, sweetspot, purrfect, mia, timezone, now = new Date() }) {
  const wake = ms(lastWake);
  if (!Number.isFinite(wake) || +now - wake > MAX_WAIT || !isDaytimeWake(wake, timezone)) return null;
  const entry = { id:predictionId(lastWake), lastWake:new Date(wake).toISOString(), childId:String(childId || '') };
  const window = model => model?.available && ms(model.target) > wake ? { start:model.start, end:model.end, target:model.target, loggedAt:new Date(+now).toISOString() } : null;
  if (sweetspot?.available && !sweetspot.sleeping && ms(sweetspot.time) > wake) entry.sweetspot = { target:sweetspot.time, loggedAt:new Date(+now).toISOString() };
  const purr = window(purrfect), forecast = window(mia);
  if (purr) entry.purrfect = purr;
  if (forecast) entry.mia = forecast;
  return MODELS.some(model => entry[model.key]) ? entry : null;
}

// Only fields a record does not have yet; existing guesses are never replaced.
export function missingFields(existing, incoming) {
  if (!incoming) return null;
  if (!existing) return incoming;
  const patch = {};
  for (const { key } of MODELS) if (incoming[key] && !existing[key]) patch[key] = incoming[key];
  return Object.keys(patch).length ? patch : null;
}

// The first sleep that began after this wake-up (a running timer counts).
export function actualSleepStart(lastWake, sleeps = [], timer = null) {
  const wake = ms(lastWake);
  const starts = sleeps.map(sleep => ms(sleep.start)).filter(start => Number.isFinite(start) && start > wake);
  if (timer?.active && ms(timer.start) > wake) starts.push(ms(timer.start));
  const first = starts.length ? Math.min(...starts) : null;
  return first && first - wake <= MAX_WAIT ? first : null;
}

export function scorePredictions(entries = [], sleeps = [], timer = null) {
  const results = [];
  for (const entry of entries) {
    const actual = actualSleepStart(entry.lastWake, sleeps, timer);
    if (!actual) continue;
    const row = { id:entry.id, lastWake:entry.lastWake, actual:new Date(actual).toISOString(), models:{} };
    for (const model of MODELS) {
      const guess = entry[model.key]; if (!guess?.target) continue;
      const error = (actual - ms(guess.target)) / MINUTE;
      const hit = model.hitMinutes ? Math.abs(error) <= model.hitMinutes : actual >= ms(guess.start) && actual <= ms(guess.end);
      row.models[model.key] = { error:Math.round(error), hit };
    }
    const scored = Object.entries(row.models);
    if (scored.length >= 2) {
      const best = Math.min(...scored.map(([, value]) => Math.abs(value.error)));
      row.winners = scored.filter(([, value]) => Math.abs(value.error) === best).map(([key]) => key);
    } else row.winners = [];
    results.push(row);
  }
  results.sort((a,b) => ms(b.actual) - ms(a.actual));
  const summary = MODELS.map(model => {
    const scored = results.filter(row => row.models[model.key]).map(row => row.models[model.key]);
    const n = scored.length;
    return { ...model, n, mae:n ? Math.round(scored.reduce((sum, value) => sum + Math.abs(value.error), 0) / n) : null,
      bias:n ? Math.round(scored.reduce((sum, value) => sum + value.error, 0) / n) : null,
      hitRate:n ? Math.round(100 * scored.filter(value => value.hit).length / n) : null,
      wins:results.filter(row => row.winners.includes(model.key) && row.winners.length === 1).length };
  });
  const ranked = summary.filter(model => model.n >= 3).sort((a,b) => a.mae - b.mae || b.hitRate - a.hitRate);
  return { results, summary, leader:ranked[0]?.key || null, scoredNaps:results.length };
}
