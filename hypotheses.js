// "Got a hunch?" on the Frankie page: test a household hypothesis against Frankie's own
// logs. A hunch is { factor, outcome, direction }: "when <factor>, <outcome> is <more|less>".
// Free text is read with plain keyword rules (parseHypothesis); anything they can't place
// is saved for Claude to look at later (claudeDigest packs the text with a data summary).
// Pure: no DOM, no network.
import { nightLine, sleepKind, localDay, clockAt, dayStart, toOunces } from './baby-history.js';
import { nightsFrom } from './cat-challenges.js';

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const toStamp = value => typeof value === 'number' ? value : Date.parse(value);
const median = list => { const s = [...list].sort((a, b) => a - b), m = (s.length - 1) / 2; return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2; };

// What can be compared. `split` gives yes/no; `value` is split at its middle (above vs the rest).
export const FACTORS = {
  bath:{ level:'night', label:'it’s a bath night', split:r => r.bath, yes:'bath nights', no:'other nights' },
  eveningOz:{ level:'night', label:'she drinks more in the evening (4 PM to bedtime)', value:r => r.eveningOz, yes:'evenings with more ounces', no:'evenings with fewer' },
  dayOz:{ level:'night', label:'she drinks more that day', value:r => r.dayOz, yes:'days with more ounces', no:'days with fewer' },
  napTime:{ level:'night', label:'she naps longer that day', value:r => r.napMinutes, yes:'days with more nap time', no:'days with less' },
  napCount:{ level:'night', label:'she takes more naps that day', value:r => r.napCount, yes:'days with more naps', no:'days with fewer' },
  lateLastNap:{ level:'night', label:'her last nap ends late', value:r => r.lastNapEnd, yes:'days her last nap ended late', no:'days it ended earlier' },
  lateBedtime:{ level:'night', label:'bedtime is late', value:r => r.bedtime, yes:'nights with a later bedtime', no:'nights with an earlier one' },
  bottleBefore:{ level:'nap', label:'she has a bottle in the 45 minutes before a nap', split:r => r.bottleBefore, yes:'naps right after a bottle', no:'other naps' },
  bigBottle:{ level:'nap', label:'the bottle before a nap is bigger', value:r => r.lastOz, yes:'naps after a bigger bottle', no:'naps after a smaller one' },
  afternoon:{ level:'nap', label:'it’s an afternoon nap', split:r => r.afternoon, yes:'afternoon naps', no:'morning naps' },
  longWindow:{ level:'nap', label:'she’s been awake longer before the nap', value:r => r.window, yes:'naps after a longer wake window', no:'naps after a shorter one' }
};
export const OUTCOMES = {
  nightLength:{ level:'night', label:'her night sleep', more:'longer', less:'shorter', unit:'minutes', min:20, get:r => r.length },
  wakeups:{ level:'night', label:'her night wake-ups', more:'more', less:'fewer', unit:'count', min:0.5, get:r => r.wakeups },
  morningWake:{ level:'night', label:'her morning wake-up', more:'later', less:'earlier', unit:'clock', min:15, get:r => r.wake },
  bedtime:{ level:'night', label:'her bedtime', more:'later', less:'earlier', unit:'clock', min:15, get:r => r.bedtime, not:['lateBedtime'] },
  napLength:{ level:'nap', label:'the nap', more:'longer', less:'shorter', unit:'minutes', min:10, get:r => r.length }
};
export const fits = (factor, outcome) => !!FACTORS[factor] && !!OUTCOMES[outcome] && FACTORS[factor].level === OUTCOMES[outcome].level && !(OUTCOMES[outcome].not || []).includes(factor);
export function describeHypothesis({ factor, outcome, direction }) {
  if (!fits(factor, outcome)) return '';
  const o = OUTCOMES[outcome];
  return `When ${FACTORS[factor].label}, ${o.label} ${outcome === 'wakeups' ? 'are' : 'is'} ${direction === 'less' ? o.less : o.more}.`;
}

// ---------- Reading free text ----------
const FACTOR_WORDS = [
  ['bath', /\bbath/],
  ['bigBottle', /(big|bigger|larger|more|full)\b.*\b(bottle|oz|ounces?|feed)\b.*\bbefore\b.*\bnap|\bnap\b.*\bafter\b.*\b(big|bigger|full)\b.*\b(bottle|feed)/],
  ['bottleBefore', /(bottle|feed|eat|eats|ate|drinks?)\b.*\b(before|right before|then)\b.*\bnap|\bnap\b.*\b(after|following)\b.*\b(bottle|feed|eating)|(bottle|feed) (right |just )?before(?! bed)/],
  ['afternoon', /afternoon( nap)?/],
  ['longWindow', /(awake|up) (longer|for longer|a long time|long)|long(er)? wake ?window|more tired|overtired/],
  ['eveningOz', /(evening|before bed|bedtime|at night|dream ?feed|top.?off|last bottle)\b.*\b(bottle|oz|ounces?|feed|eat|eats|drinks?)|(bottle|oz|ounces?|feed|eat|eats|drinks?)\b.*\b(evening|before bed|at bedtime|at night)|dream ?feed|top.?off/],
  ['dayOz', /(more|bigger|extra|lots of)\b.*\b(oz|ounces?|bottles?|milk|formula)|(eats?|drinks?|ate|drank) (more|a lot|lots)/],
  ['lateLastNap', /(last|final) nap\b.*\b(late|later|after)|late (last |final |afternoon |evening )?(nap|catnap)|catnap/],
  ['napCount', /(more|extra|fourth|4th|third|3rd|three|four) naps?|(fewer|less) naps|drop(s|ped)? a nap/],
  ['napTime', /(more|longer|lots of|less|shorter|short) naps?\b|naps? (more|longer|less|shorter)|(more|less) (day ?sleep|daytime sleep)/],
  ['lateBedtime', /(late|later) bed ?time|(goes|go|put|puts) (her )?(down|to bed) late|stay(s|ed)? up late|bed ?time is late/]
];
const OUTCOME_WORDS = [
  ['wakeups', /wak(e|es|ing|ings)( up)? (less|fewer|more|a lot|less often|more often|up more|up less)|(fewer|less|more) (night )?wak(e|ing)s?|night wak(e|ing)s?|wakes? up (more|less) (at|during the) night|sleeps? through/],
  ['morningWake', /(wakes?|get(s)? up|up) (up )?(later|earlier) (in the morning|the next morning|next morning)|sleeps? in|(later|earlier) (morning|wake.?up|start)|early riser|up early/],
  ['bedtime', /(earlier|later) bed ?time|(goes|go|falls?) (down|to bed|asleep) (earlier|later|sooner)/],
  ['morningWake', /(wakes?|get(s)? up) (up )?(later|earlier)(?! at night)/],
  ['napLength', /(longer|shorter|better|worse|bad|good|short) naps?|naps? (are |is |get |seem |run )?(longer|shorter|better|worse)|naps? last (longer|shorter)/],
  ['nightLength', /(sleeps?|slept|sleeping) (longer|better|more|worse|less|shorter|well)|(longer|shorter|better|worse|good|bad) (night|nights|sleep)|night (is |sleep )?(longer|shorter|better|worse)/]
];
const UP = /\b(more|longer|later|better|well|good|sleeps? in|through|later)\b/, DOWN = /\b(less|fewer|shorter|earlier|worse|bad|early|sooner|short)\b/;
// { factor, outcome, direction } with null for any part not found.
export function parseHypothesis(text = '') {
  const t = String(text).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
  if (!t.trim()) return { factor:null, outcome:null, direction:'more' };
  let outcome = null, rest = t, said = '';
  for (const [key, re] of OUTCOME_WORDS) { const m = t.match(re); if (m) { outcome = key; said = m[0]; rest = t.replace(m[0], ' '); break; } }
  // The factor is looked for in what's left, so "sleeps longer" isn't read as "longer naps".
  let factor = null;
  for (const [key, re] of FACTOR_WORDS) if (re.test(rest) && (!outcome || fits(key, outcome))) { factor = key; break; }
  if (!factor) for (const [key, re] of FACTOR_WORDS) if (re.test(rest)) { factor = key; break; }
  if (factor && !outcome) outcome = FACTORS[factor].level === 'nap' ? 'napLength' : null;
  // Direction from the words around the outcome; "sleeps through" / "better" mean fewer wake-ups.
  let direction = DOWN.test(said) && !UP.test(said) ? 'less' : 'more';
  if (outcome === 'wakeups') direction = /through|fewer|less|better/.test(said) ? 'less' : 'more';
  if (outcome === 'morningWake' && /sleeps? in/.test(said)) direction = 'more';
  if (outcome === 'morningWake' && /early riser|up early/.test(said)) direction = 'less';
  if (factor && outcome && !fits(factor, outcome)) return { factor, outcome:null, direction };
  return { factor, outcome, direction };
}

// ---------- The data ----------
function feedsOf(bottles) { return bottles.map(b => ({ at:toStamp(b.start), oz:toOunces(Number(b.amount) || 0, b.units) })).filter(b => Number.isFinite(b.at) && b.oz > 0).sort((a, b) => a.at - b.at); }
export function hypothesisData({ sleeps = [], bottles = [], timezone = 'America/New_York', bathDays = [], now = Date.now(), days = 45 } = {}) {
  const list = sleeps.map(s => ({ start:toStamp(s.start), end:toStamp(s.end) })).filter(s => Number.isFinite(s.start) && s.end > s.start && s.end <= +now && s.start >= +now - days * DAY).sort((a, b) => a.start - b.start);
  const line = nightLine(list, timezone, now), feeds = feedsOf(bottles), naps = list.filter(s => sleepKind(s, timezone, line) === 'nap');
  const nights = nightsFrom(sleeps, timezone, now, days).filter(n => n.morning).map(n => {
    const from = dayStart(n.key, timezone), dayNaps = naps.filter(s => localDay(s.start, timezone) === n.key && s.end <= n.bedtime);
    const last = dayNaps.at(-1), weekday = new Date(`${n.key}T12:00:00Z`).getUTCDay();
    return { key:n.key, bedtime:n.bedClock, wake:n.wakeClock, length:Math.round((n.morning - n.bedtime) / MINUTE),
      wakeups:Math.max(0, list.filter(s => s.start >= n.bedtime && s.start < n.morning).length - 1),
      bath:bathDays.includes(weekday), dayOz:feeds.filter(f => localDay(f.at, timezone) === n.key).reduce((s, f) => s + f.oz, 0),
      eveningOz:feeds.filter(f => f.at >= from + 16 * HOUR && f.at < n.bedtime).reduce((s, f) => s + f.oz, 0),
      napMinutes:Math.round(dayNaps.reduce((s, x) => s + (x.end - x.start), 0) / MINUTE), napCount:dayNaps.length, lastNapEnd:last ? clockAt(last.end, timezone) : null };
  });
  const napRows = naps.map(nap => {
    const before = list.filter(s => s.end <= nap.start).at(-1), window = before ? Math.round((nap.start - before.end) / MINUTE) : null;
    const lastFeed = feeds.filter(f => f.at <= nap.start && f.at >= nap.start - 90 * MINUTE).at(-1);
    return { start:nap.start, length:Math.round((nap.end - nap.start) / MINUTE), window:window != null && window >= 20 && window <= 360 ? window : null,
      bottleBefore:!!feeds.find(f => f.at <= nap.start && f.at >= nap.start - 45 * MINUTE), lastOz:lastFeed ? lastFeed.oz : null, afternoon:clockAt(nap.start, timezone) >= 12 * 60 };
  });
  return { nights, naps:napRows };
}

// ---------- The test ----------
const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
const variance = list => { const m = mean(list); return list.length > 1 ? list.reduce((s, v) => s + (v - m) ** 2, 0) / (list.length - 1) : 0; };
const hm = minutes => { const m = Math.round(Math.abs(minutes)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const clockText = minutes => { const m = ((Math.round(minutes) % 1440) + 1440) % 1440, h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export function formatOutcome(outcome, value) { const unit = OUTCOMES[outcome].unit; return unit === 'clock' ? clockText(value) : unit === 'count' ? (Math.round(value * 10) / 10).toString() : hm(value); }
// { status: 'true' | 'maybe' | 'none' | 'opposite' | 'thin' | 'invalid', headline, detail, yes, no, diff }
export function testHypothesis({ factor, outcome, direction = 'more' }, data) {
  if (!fits(factor, outcome)) return { status:'invalid', headline:'That pairing can’t be tested', detail:'Pick a night thing with a night result, or a nap thing with a nap result.' };
  const f = FACTORS[factor], o = OUTCOMES[outcome], rows = (f.level === 'night' ? data.nights : data.naps).filter(r => Number.isFinite(o.get(r)));
  let yes, no;
  if (f.split) { yes = rows.filter(r => f.split(r)); no = rows.filter(r => !f.split(r)); }
  else {
    const valued = rows.filter(r => Number.isFinite(f.value(r)));
    if (valued.length < 8) return { status:'thin', headline:'Not enough logs yet', detail:`Only ${valued.length} ${f.level === 'night' ? 'nights' : 'naps'} have what this needs. Try again in a week or two.` };
    const mid = median(valued.map(f.value));
    yes = valued.filter(r => f.value(r) > mid); no = valued.filter(r => f.value(r) <= mid);
    // Many days tied at the middle (6 oz, 6 oz, 6 oz…): put the ties on the high side instead.
    if (yes.length < 4 || Math.abs(yes.length - no.length) > valued.length / 2) { const alt = valued.filter(r => f.value(r) >= mid); if (alt.length < valued.length && Math.abs(alt.length * 2 - valued.length) < Math.abs(yes.length * 2 - valued.length)) { yes = alt; no = valued.filter(r => f.value(r) < mid); } }
  }
  const unit = f.level === 'night' ? 'night' : 'nap';
  if (yes.length < 4 || no.length < 4) return { status:'thin', headline:'Not enough logs yet', detail:`${yes.length} ${f.yes} and ${no.length} ${f.no} so far; each side needs at least 4 ${unit}s.` };
  const a = yes.map(o.get), b = no.map(o.get), diff = mean(a) - mean(b), se = Math.sqrt(variance(a) / a.length + variance(b) / b.length) || 1e-9, t = diff / se;
  const wanted = direction === 'less' ? -1 : 1, agrees = Math.sign(diff) === wanted, sizeable = Math.abs(diff) >= o.min;
  const status = Math.abs(t) >= 2 && sizeable ? (agrees ? 'true' : 'opposite') : Math.abs(t) >= 1.2 && agrees && sizeable ? 'maybe' : 'none';
  const word = diff >= 0 ? o.more : o.less, amount = o.unit === 'count' ? `${Math.round(Math.abs(diff) * 10) / 10}` : hm(diff);
  const headline = { true:'Looks true', maybe:'Maybe: a hint, not proof yet', none:'No real difference so far', opposite:'Actually, the opposite' }[status];
  const same = o.unit === 'count' ? Math.abs(diff) < 0.05 : Math.abs(diff) < 1;
  const detail = `On ${f.yes}, ${o.label} averaged ${formatOutcome(outcome, mean(a))}, vs ${formatOutcome(outcome, mean(b))} on ${f.no}: ${same ? 'about the same' : `${amount} ${word}`} (${a.length} vs ${b.length} ${unit}s in the last 6 weeks).`;
  return { status, headline, detail, diff, yes:{ n:a.length, mean:mean(a) }, no:{ n:b.length, mean:mean(b) } };
}

// For a hunch Hubert's House can't test: the words plus her last month, ready to paste to Claude.
export function claudeDigest(text, data, { timezone = 'America/New_York', bathDays = [] } = {}) {
  const nights = data.nights.slice(-30).map(r => [r.key, clockText(r.bedtime), clockText(r.wake), r.length, r.wakeups, r.napCount, r.napMinutes, Math.round(r.dayOz * 10) / 10, Math.round(r.eveningOz * 10) / 10, r.bath ? 'y' : ''].join(','));
  const naps = data.naps.slice(-40).map(r => [new Date(r.start).toISOString().slice(0, 16), r.length, r.window ?? '', r.bottleBefore ? 'y' : '', r.lastOz != null ? Math.round(r.lastOz * 10) / 10 : ''].join(','));
  return `Hi Claude, here's a hunch about Frankie from Hubert's House. Can you check it against her logs?\n\nHunch: "${text}"\n\nTime zone: ${timezone}. Bath days (0 = Sunday): ${bathDays.join(', ') || 'none'}.\n\nNights (date of the evening, bedtime, morning wake, night minutes, wake-ups, naps that day, nap minutes, ounces that day, ounces 4 PM to bedtime, bath):\n${nights.join('\n')}\n\nRecent naps (start UTC, minutes, wake window before, bottle in the 45 min before, ounces of that bottle):\n${naps.join('\n')}\n`;
}
