// Preview-only sample history: a believable ~4-month-old rhythm with gently
// lengthening wake windows. Deterministic so screenshots and tests are stable.
import { purrfectWindow, miaForecast } from './baby-model.js';
import { predictionEntry } from './prediction-log.js';

const MIN = 60000, H = 3600000;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function sampleHistory(now = Date.now(), days = 45) {
  const random = rng(20261116), jitter = spread => (random() - .5) * 2 * spread;
  const sleeps = [], bottles = [];
  for (let d = days; d >= 0; d--) {
    const day = new Date(now); day.setDate(day.getDate() - d); day.setHours(0, 0, 0, 0);
    const age = days - d, base = +day;
    // Overnight: bedtime the previous evening, one feed wake around 2-3am.
    const bed = base - (4.5 + jitter(.3)) * H, wake1 = base + (2.3 + jitter(.4)) * H, morning = base + (6.75 + jitter(.35)) * H;
    sleeps.push({ start:bed, end:wake1 }, { start:wake1 + (25 + jitter(8)) * MIN, end:morning });
    bottles.push({ start:wake1 + 5 * MIN, amount:3 + Math.round(random() * 2) / 2 });
    let cursor = morning;
    const windows = [92, 112, 128, 140].map((w, i) => w + age * .45 + jitter(i ? 14 : 10));
    for (let n = 0; n < (age > 30 && random() > .5 ? 3 : 4); n++) {
      const napStart = cursor + windows[n] * MIN;
      if (napStart > base + 18 * H) break;
      const length = (n === 1 ? 85 : n === 3 ? 35 : 55) + jitter(22);
      sleeps.push({ start:napStart, end:napStart + length * MIN });
      cursor = napStart + length * MIN;
    }
    for (const hour of [7, 10.3, 13.6, 16.8, 19.2]) bottles.push({ start:base + (hour + jitter(.4)) * H, amount:Math.round((4 + age * .03 + jitter(.6)) * 2) / 2 });
  }
  const live = sleeps.filter(s => s.start < now - 25 * MIN).map(s => ({ start:s.start, end:Math.min(s.end, now - 25 * MIN) })).filter(s => s.end > s.start);
  return {
    sleeps:live.map(s => ({ start:new Date(s.start).toISOString(), end:new Date(s.end).toISOString() })),
    bottles:bottles.filter(b => b.start <= now).map(b => ({ start:new Date(b.start).toISOString(), amount:b.amount, units:'oz', type:'Formula' }))
  };
}

// What each model would have said right after each recent wake-up.
export function samplePredictions(sleeps, timezone, now = Date.now(), days = 12) {
  const random = rng(7), entries = [];
  const wakes = sleeps.map(s => Date.parse(s.end)).filter(end => end > now - days * 86400000 && end < now - 3 * H);
  for (const wake of wakes) {
    const at = new Date(wake + 2 * MIN), known = sleeps.filter(s => Date.parse(s.end) <= wake);
    const next = sleeps.find(s => Date.parse(s.start) > wake);
    const purrfect = purrfectWindow({ sleeps:known, timezone }, at), mia = miaForecast({ sleeps:known, timezone }, at);
    const sweetspot = next ? { available:true, time:new Date(Date.parse(next.start) + (random() - .45) * 50 * MIN).toISOString() } : null;
    const entry = predictionEntry({ lastWake:new Date(wake).toISOString(), childId:'sample-frankie', sweetspot, purrfect, mia, timezone, now:at });
    if (entry) entries.push(entry);
  }
  return entries;
}
