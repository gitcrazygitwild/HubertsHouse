// Mack's hat: when Huckleberry's SweetSpot has nothing to say (she's asleep, it's the
// night, or the last SweetSpot already passed), Mack pulls a guess out of a hat. It's
// somewhat sensible (the middle of Hubert's and Mia's calls) and somewhat random (up to
// 25 minutes either way, in steps of five, because Mack can only count in fives).
// The randomness is seeded by the moment, so a guess never changes on refresh and past
// pulls can be replayed honestly. Hat guesses are NEVER part of the competition; they're
// tracked separately for fun (scoreHat). Pure: no DOM, no network.
import { replayGuesses, predictionId, isDaytimeWake, actualSleepStart } from './prediction-log.js';
import { miaForecast } from './baby-model.js';
import { scoreMornings } from './cat-challenges.js';
import { nightLine, sleepKind } from './baby-history.js';

const MINUTE = 60000, DAY = 86400000;
const toStamp = value => typeof value === 'number' ? value : Date.parse(value);
// FNV-1a, then mulberry32: the same seed always gives the same numbers.
function hash(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function seeded(seed, n = 1) {
  let a = (hash(seed) + Math.imul(n, 0x9e3779b9)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const fmt = m => `${Math.abs(m)} minute${Math.abs(m) === 1 ? '' : 's'}`;
export const HAT_LINES = [
  o => `Mack averaged what Hubert and Mia said, then ${o >= 0 ? 'added' : 'took off'} ${fmt(o || 5)} “for style”.`,
  () => 'Pulled from the hat. The hat smelled faintly of tuna, which Mack considers a very good omen.',
  () => 'Mack batted three slips of paper under the couch and went with the one that came back out.',
  () => 'He sat on the TV remote and this is the time it showed. He’s standing by it.',
  () => 'The laundry basket was warmest at about this time last Tuesday. Mack calls this science.',
  () => 'Mack knocked the hat off the counter. This is the slip that landed face up.',
  () => 'He counted his whiskers twice, got two different numbers, and split the difference.',
  () => 'Mack stared at the wall until the answer came to him. It took four minutes and one nap.',
  o => `Huckleberry went quiet, so Mack asked his food bowl. The bowl said ${o === 0 ? 'right on the dot' : `${fmt(o)} ${o > 0 ? 'later' : 'earlier'} than the others`}.`,
  () => 'Mack is confident. Mack is always confident. That is not the same as being right.'
];
// One guess: { target, offset (minutes), line }, or null with nothing to go on.
// `bases`: Hubert's and Mia's targets; `fallback`: a plain guess when neither has one;
// `firedAt`: when the hat came out (a guess is never earlier than 10 minutes after it).
export function hatGuess({ bases = [], fallback = null, seed, firedAt = null } = {}) {
  const valid = bases.map(toStamp).filter(Number.isFinite);
  const base = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : toStamp(fallback);
  if (!Number.isFinite(base)) return null;
  const offset = Math.round((seeded(seed, 1) * 50 - 25) / 5) * 5 || 0;
  let target = base + offset * MINUTE, nudged = false;
  const fired = toStamp(firedAt);
  if (Number.isFinite(fired) && target < fired + 10 * MINUTE) { target = fired + (10 + Math.floor(seeded(seed, 3) * 5) * 5) * MINUTE; nudged = true; }
  // A nudged guess no longer sits next to the others, so skip the lines that say it does.
  const lines = nudged || !valid.length ? HAT_LINES.filter(line => line.length === 0) : HAT_LINES;
  const line = lines[Math.floor(seeded(seed, 2) * lines.length)](offset);
  return { target:new Date(Math.round(target / MINUTE) * MINUTE).toISOString(), offset:nudged ? null : offset, line, informed:valid.length };
}
export const hatSeed = (kind, stamp) => `${kind}:${toStamp(stamp)}`;

// ---------- The hat's track record (never part of the competition) ----------
// Replays every time the hat would have come out in the last `days` days:
// - next sleep: a daytime wake-up with no SweetSpot saved, or whose SweetSpot passed while she was still awake;
// - nap wake-up: every nap (SweetSpot never calls wake-ups);
// - morning: every night (SweetSpot is silent overnight).
// Each pull is compared with what happened, and with how Hubert and Mia did on the same call.
let memo = { key:null, value:null };
export function scoreHat(entries = [], sleeps = [], timer = null, timezone = 'America/New_York', now = Date.now(), { bottles = [], birthdate = null, days = 21 } = {}) {
  const key = JSON.stringify([timezone, birthdate, days, sleeps.length, sleeps.at(-1)?.end, sleeps[0]?.start, bottles.length, bottles.at(-1)?.start, timer?.active ? timer.start : null, entries.map(e => `${e.id}:${e.sweetspot?.target}`), Math.floor(+now / (15 * MINUTE))]);
  if (memo.key === key) return memo.value;
  const since = +now - days * DAY, saved = new Map(entries.map(e => [e.id, e])), rows = [];
  const line = nightLine(sleeps, timezone, now), err = (actual, target) => Math.round((actual - toStamp(target)) / MINUTE) || 0;
  const catsMiss = (actual, picks) => { const list = picks.filter(Boolean).map(p => Math.abs(err(actual, p.target))); return list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : null; };
  // Next sleep after a wake-up that SweetSpot didn't cover.
  for (const wake of [...new Set(sleeps.map(s => toStamp(s.end)))].filter(w => w >= since && w <= +now && isDaytimeWake(w, timezone, sleeps, line))) {
    const actual = actualSleepStart(wake, sleeps, timer); if (!actual) continue;
    const sweet = toStamp(saved.get(predictionId(wake))?.sweetspot?.target);
    const fired = !Number.isFinite(sweet) ? wake : sweet < actual - MINUTE ? sweet : null;
    if (fired == null) continue;
    const replay = replayGuesses(sleeps, wake, timezone, { bottles, birthdate });
    const hat = hatGuess({ bases:[replay.purrfect?.target, replay.mia?.target], seed:hatSeed('wake', wake), firedAt:fired });
    if (!hat) continue;
    rows.push({ kind:'sleep', at:new Date(fired).toISOString(), target:hat.target, actual:new Date(actual).toISOString(), error:err(actual, hat.target), cats:catsMiss(actual, [replay.purrfect, replay.mia]), line:hat.line });
  }
  // When she'd wake from each nap (Mia calls nap wake-ups; Hubert only nights).
  const parsed = sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) })).filter(s => Number.isFinite(s.start) && s.end > s.start).sort((a, b) => a.start - b.start);
  for (const nap of parsed.filter(s => s.start >= since && s.end <= +now && sleepKind(s, timezone, line) === 'nap')) {
    const known = sleeps.filter(s => toStamp(s.end) <= nap.start), at = new Date(nap.start + MINUTE);
    const mia = miaForecast({ sleeps:known, bottles:bottles.filter(b => toStamp(b.start) <= +at), birthdate, timezone, timer:{ active:true, start:new Date(nap.start).toISOString() } }, at);
    const hat = hatGuess({ bases:[mia.available && mia.kind === 'wake' ? mia.target : null], fallback:nap.start + 55 * MINUTE, seed:hatSeed('nap', nap.start), firedAt:nap.start });
    rows.push({ kind:'wake', at:new Date(nap.start).toISOString(), target:hat.target, actual:new Date(nap.end).toISOString(), error:err(nap.end, hat.target), cats:mia.available && mia.kind === 'wake' ? catsMiss(nap.end, [mia]) : null, line:hat.line });
  }
  // The morning wake-up, from each night's bedtime.
  for (const night of scoreMornings(sleeps, timezone, now, { birthdate, days }).results) {
    const bedtime = toStamp(night.bedtime), actual = toStamp(night.actual);
    const hat = hatGuess({ bases:[night.picks.hubert?.target, night.picks.mia?.target], seed:hatSeed('night', bedtime), firedAt:bedtime });
    if (!hat) continue;
    rows.push({ kind:'morning', at:night.bedtime, target:hat.target, actual:night.actual, error:err(actual, hat.target), cats:catsMiss(actual, [night.picks.hubert, night.picks.mia]), line:hat.line });
  }
  rows.sort((a, b) => toStamp(b.actual) - toStamp(a.actual));
  const n = rows.length, compared = rows.filter(r => r.cats != null);
  const avg = list => list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : null;
  const byAbs = [...rows].sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
  const value = { results:rows, n, mae:avg(rows.map(r => Math.abs(r.error))), hitRate:n ? Math.round(100 * rows.filter(r => Math.abs(r.error) <= 15).length / n) : null,
    hatOnSame:avg(compared.map(r => Math.abs(r.error))), catsOnSame:avg(compared.map(r => r.cats)),
    kinds:{ sleep:rows.filter(r => r.kind === 'sleep').length, wake:rows.filter(r => r.kind === 'wake').length, morning:rows.filter(r => r.kind === 'morning').length },
    best:byAbs[0] || null, worst:byAbs.at(-1) || null };
  memo = { key, value }; return value;
}
