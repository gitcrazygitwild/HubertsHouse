// What the Frankie page shows from night-insights.js: the "Last night" tile and the
// "Days of the week" rows in What Mia has noticed. Returns HTML strings.
import { escapeHTML as esc } from './household-model.js';
import { WEEKDAYS } from './night-insights.js';

const hm = minutes => { const m = Math.round(Math.abs(minutes)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const clock = (value, timezone) => new Date(value).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:timezone });
const clockOfMinutes = minutes => { const m = ((Math.round(minutes) % 1440) + 1440) % 1440, h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function lastNightTile(night, timezone) {
  if (!night?.available) return `<div class="frankie-tile is-night"><span>☾ Last night</span><strong>—</strong><small>${esc(night?.reason || 'No night logged yet')}</small></div>`;
  const when = `${clock(night.bedtime, timezone)} → ${night.morning ? clock(night.morning, timezone) : 'still asleep'}`;
  const vs = night.inProgress || night.vsAverage == null ? '' : Math.abs(night.vsAverage) < 15 ? ' · about her usual' : ` · ${hm(night.vsAverage)} ${night.vsAverage > 0 ? 'more' : 'less'} than usual`;
  const extra = [plural(night.wakeups, 'wake-up'), night.feeds ? `${plural(night.feeds, 'feed')}${night.ounces ? ` (${night.ounces} oz)` : ''}` : 'no feeds', `longest ${hm(night.longest)}`].join(' · ');
  return `<div class="frankie-tile is-night"><span>☾ ${night.inProgress ? 'Tonight so far' : 'Last night'}</span><strong>${hm(night.slept)}</strong><small>${esc(when)}${esc(vs)}</small><small>${esc(extra)}</small></div>`;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const WORDS = { night:['longer', 'shorter'], naps:['longer', 'shorter'], bedtime:['later', 'earlier'], wake:['later', 'earlier'], ounces:['more', 'less'] };
const amount = (key, diff) => key === 'ounces' ? `${Math.round(Math.abs(diff) * 10) / 10} oz` : hm(diff);
const level = (m, value) => m.unit === 'clock' ? clockOfMinutes(value) : m.unit === 'oz' ? `${Math.round(value * 10) / 10} oz` : hm(value);
function sentence(key, m) {
  if (m.verdict === 'not-enough') return `Needs a few weeks of logs (at least two of every weekday). ${m.n} ${m.of} so far.`;
  const [more, less] = WORDS[key], hi = `${m.high.name}s ${amount(key, m.high.diff)} ${more}`, lo = `${m.low.name}s ${amount(key, m.low.diff)} ${less}`;
  if (m.verdict === 'none') return `No weekday pattern: ${m.small ? `no day is more than ${amount(key, Math.max(Math.abs(m.high.diff), Math.abs(m.low.diff)))} off her average` : 'the days differ about as much as chance would make them'}, across ${m.n} ${m.of}. Usual ${m.unit === 'clock' ? 'time' : 'amount'}: ${level(m, m.overall)}.`;
  return `${m.verdict === 'clear' ? '' : 'Maybe: '}${hi} than her average, ${lo}${m.verdict === 'clear' ? '.' : '. Could still be chance; it firms up with more weeks.'}`;
}
export function weekdayHTML(links) {
  const name = { 'not-enough':'Not enough logs yet', none:'No pattern', slight:'Maybe', clear:'A real pattern' };
  const rows = Object.entries(links).map(([key, m]) => {
    // A fixed floor for the scale, so a 5-minute wobble looks small (an hour fills the bar for sleep).
    const floor = { night:60, naps:60, bedtime:45, wake:45, ounces:4 }[key];
    const max = m.byDay ? Math.max(floor, ...m.byDay.map(d => Math.abs(d.diff))) : 1;
    const bars = m.byDay ? `<div class="wd-bars" role="img" aria-label="${esc(ORDER.map(d => { const day = m.byDay[d]; return `${WEEKDAYS[d]} ${day.diff >= 0 ? '+' : '−'}${amount(key, day.diff)}`; }).join(', '))}">${ORDER.map(d => {
      const day = m.byDay[d], h = Math.round(Math.abs(day.diff) / max * 100), mark = m.verdict !== 'none' && (d === m.high.day || d === m.low.day) ? ' is-mark' : '';
      return `<span class="${day.diff >= 0 ? 'up' : 'down'}${mark}" title="${esc(`${WEEKDAYS[d]}: ${level(m, day.mean)} (${day.n})`)}"><i style="height:${Math.max(4, h / 2)}%"></i><small>${WEEKDAYS[d].slice(0, 2)}</small></span>`;
    }).join('')}</div>` : '';
    return `<div class="link-row wd-row link-${m.verdict === 'not-enough' ? 'not-enough' : m.verdict}"><div><strong>${esc(m.label)} by weekday</strong><small>${esc(sentence(key, m))}</small>${bars}</div><span class="link-badge">${esc(name[m.verdict])}</span></div>`;
  }).join('');
  return `<h3 class="wd-title">Days of the week</h3><div class="link-rows">${rows}</div><p class="tiny muted">Each day is compared with her own average after taking out how she’s changing week to week. “A real pattern” means a shuffle test rarely gives differences this big by chance (under 1 in 20); “Maybe” means under 1 in 5.</p>`;
}
