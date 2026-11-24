// "Ask the house": plain questions answered from what Hubert's House already knows (the
// calendar, Frankie's logs and the cats' calls, bins, baths, birthdays, the forecast). All
// local: nothing is sent anywhere. Pure: answerQuestion(text, data) → { answer, view } or null.
import { catsConsensus } from './baby-model.js';
import { babySummary, dailySleep, toOunces } from './baby-history.js';
import { nextUp, untilText } from './smart-home.js';
import { nextPickup, pickupOn } from './trash-days.js';
import { isBathDay, nextBathDay } from './bath-days.js';
import { birthdaysInRange } from './birthdays-model.js';
import { lastNight } from './night-insights.js';

const DAY = 86400000, WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const clock = value => new Date(value).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
const dayName = value => new Date(value).toLocaleDateString('en-US', { weekday:'long' });
const dateLabel = value => new Date(value).toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
const ago = (stamp, now) => { const m = Math.max(0, Math.round((+now - Date.parse(stamp)) / 60000)); return m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`; };
const hours = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const oz = n => `${Math.round(n * 10) / 10} oz`;
const startOfDay = date => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const keyOf = date => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export const isQuestion = text => { const t = String(text || '').trim().toLowerCase(); return t.length > 3 && (/\?$/.test(t) || /^(what|what's|whats|when|when's|how|is|are|will|whose|who|where|did|does|do|has|have|any|should|tell me|show me)\b/.test(t)); };

// Which days a question is about: "today", "tomorrow", "friday", "this weekend". Null if none.
export function daysAsked(text, now = new Date()) {
  const t = text.toLowerCase(), today = startOfDay(now), plus = n => new Date(+today + n * DAY + 3600000 * 2);
  if (/\b(this )?weekend\b/.test(t)) { const sat = (6 - today.getDay() + 7) % 7; return { label:'this weekend', days:today.getDay() === 0 ? [plus(0)] : [plus(sat), plus(sat + 1)] }; }
  if (/\btomorrow\b/.test(t)) return { label:'tomorrow', days:[plus(1)] };
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) return { label:/tonight|evening/.test(t) ? 'tonight' : 'today', days:[plus(0)], evening:/tonight|evening/.test(t) };
  const wd = WEEKDAYS.findIndex(d => new RegExp(`\\b${d}s?\\b|\\b${d.slice(0, 3)}\\b`).test(t));
  if (wd >= 0) { const n = (wd - today.getDay() + 7) % 7; return { label:n === 0 ? 'today' : `on ${WEEKDAYS[wd][0].toUpperCase()}${WEEKDAYS[wd].slice(1)}`, days:[plus(n)] }; }
  return null;
}
const onDay = (events, day) => {
  const from = startOfDay(day), to = new Date(+from + DAY);
  return events.filter(e => { const s = new Date(e.start), end = e.end ? new Date(e.end) : new Date(+s + (e.allDay ? DAY : 3600000)); return s < to && end > from && !e.extendedProps?.holiday; })
    .sort((a, b) => (b.allDay - a.allDay) || (new Date(a.start) - new Date(b.start)));
};
const describeEvent = e => e.allDay ? e.title : `${e.title} at ${clock(e.start)}`;

export function answerQuestion(text, { now = new Date(), events = [], baby = null, frankie = null, forecast = null } = {}) {
  const t = String(text || '').toLowerCase().replace(/[’']/g, "'").trim();
  if (!t) return null;
  const name = baby?.name || frankie?.snapshot?.name || 'Frankie';
  const aboutBaby = /\b(frankie|baby|she|her)\b/.test(t);
  // ---- Frankie ----
  if (/\b(bottle|eat|ate|eaten|fed|feed|feeding|drink|drank|ounces|oz)\b/.test(t) && (aboutBaby || /\bbottle|feed|fed\b/.test(t))) {
    if (/how much|how many|ounces|oz|today|so far/.test(t) && frankie?.snapshot) {
      const s = babySummary(frankie.snapshot, frankie.timezone, +now), today = s.today.bottles;
      return { answer:`${name} has had ${oz(today?.ounces || 0)} today over ${today?.count || 0} bottle${today?.count === 1 ? '' : 's'}${s.avgOunces ? `; her usual day is about ${oz(s.avgOunces)}` : ''}.`, view:'frankie' };
    }
    if (!baby?.lastBottle && !frankie?.snapshot?.bottles?.length) return { answer:`I don’t have any bottles logged for ${name} yet.`, view:'frankie' };
    const last = frankie?.snapshot?.bottles?.at(-1), at = baby?.lastBottle || last?.start, amount = last && Date.parse(last.start) === Date.parse(at) ? ` (${oz(toOunces(Number(last.amount) || 0, last.units))})` : '';
    const next = baby?.nextBottle?.available ? ` The next one is due around ${clock(baby.nextBottle.target)}${baby.nextBottle.waitingForWake ? ', once she wakes' : ''}.` : '';
    return { answer:`${name}’s last bottle${amount} was at ${clock(at)}, ${ago(at, now)} ago.${next}`, view:'frankie' };
  }
  if (/\b(next|when).*(nap|sleep|bed ?time)\b|\bnap (time|soon)\b|\bbedtime\b/.test(t) && !/how (much|long)/.test(t)) {
    if (baby?.timer?.active) return { answer:`${name} is asleep right now (for ${ago(baby.timer.start, now)}).`, view:'frankie' };
    const call = baby ? catsConsensus(baby) : null;
    if (!call) return { answer:`The cats don’t have a call for ${name}’s next sleep right now.`, view:'frankie' };
    return { answer:`The cats think ${name}’s next ${call.kind === 'bedtime' ? 'sleep is bedtime,' : 'nap is'} around ${clock(call.target)} (${untilText(Math.max(0, Math.round((Date.parse(call.target) - +now) / 60000)))}).${call.picks.length > 1 ? ` That’s the average of ${list(call.picks.map(p => `${p.cat} ${clock(p.at)}`))}.` : ''}`, view:'frankie' };
  }
  if (/last night/.test(t) && /sleep|slept|night|go|do/.test(t) && frankie?.snapshot) {
    const n = lastNight({ ...frankie.snapshot, timezone:frankie.timezone, now:+now });
    if (n.available) return { answer:`Last night ${name} slept ${hours(n.slept / 60)}, from ${clock(n.bedtime)} to ${n.morning ? clock(n.morning) : 'now (still asleep)'}: ${n.wakeups} wake-up${n.wakeups === 1 ? '' : 's'}, ${n.feeds ? `${n.feeds} feed${n.feeds === 1 ? '' : 's'}` : 'no feeds'}, longest stretch ${hours(n.longest / 60)}.${n.vsAverage != null && Math.abs(n.vsAverage) >= 15 ? ` That’s ${hours(Math.abs(n.vsAverage) / 60)} ${n.vsAverage > 0 ? 'more' : 'less'} than her usual.` : ''}`, view:'frankie' };
  }
  if (/how much.*sleep|sleep (yesterday|today|last night)|slept/.test(t) && frankie?.snapshot) {
    const rows = dailySleep(frankie.snapshot.sleeps || [], frankie.timezone, 2, +now), row = /yesterday|last night/.test(t) ? rows[0] : rows[1];
    const label = /yesterday|last night/.test(t) ? 'yesterday' : 'so far today';
    return { answer:`${name} slept ${hours(row?.total || 0)} ${label}: ${hours(row?.night || 0)} at night and ${hours(row?.nap || 0)} in ${row?.naps || 0} nap${row?.naps === 1 ? '' : 's'}.`, view:'frankie' };
  }
  if ((aboutBaby && /\b(awake|asleep|sleeping|up|napping)\b/.test(t)) || /how long.*(awake|asleep|up)/.test(t)) {
    if (!baby) return { answer:`I can’t see ${name}’s sleep right now. Is Huckleberry connected?`, view:'settings' };
    if (baby.timer?.active) return { answer:`${name} has been asleep for ${ago(baby.timer.start, now)}, since ${clock(baby.timer.start)}.`, view:'frankie' };
    if (!baby.lastWake) return { answer:`No sleeps are logged for ${name} yet.`, view:'frankie' };
    return { answer:`${name} has been awake for ${ago(baby.lastWake, now)}, since ${clock(baby.lastWake)}.`, view:'frankie' };
  }
  // ---- Around the house ----
  if (/\b(trash|garbage|recycling|recycle|bins?)\b/.test(t)) {
    const want = /recycl/.test(t) ? 'recycling' : /trash|garbage/.test(t) ? 'trash' : null;
    let next = null; for (let i = 0, d = startOfDay(now); i < 22 && !next; i++, d = new Date(+d + DAY)) { const p = pickupOn(new Date(+d + 12 * 3600000)); if (p && (!want || p.kinds.includes(want))) next = p; }
    next ||= nextPickup(now);
    if (!next) return { answer:'There’s no pickup in the next three weeks.', view:'settings' };
    const day = new Date(`${next.date}T12:00:00`), n = Math.round((startOfDay(day) - startOfDay(now)) / DAY);
    const when = n === 0 ? 'today' : n === 1 ? 'tomorrow, so the bins go out tonight' : dateLabel(day);
    return { answer:`${next.kinds.length > 1 ? 'Trash and recycling' : next.kinds[0] === 'recycling' ? 'Recycling' : 'Trash'} pickup is ${when}${next.moved ? ` (moved for ${next.moved.holiday})` : ''}.`, view:'settings' };
  }
  if (/\bbath\b/.test(t)) {
    const when = next => { if (!next) return null; const n = Math.round((startOfDay(new Date(`${next.date}T12:00:00`)) - startOfDay(now)) / DAY); return n === 0 ? 'tonight' : n === 1 ? 'tomorrow' : `on ${dayName(`${next.date}T12:00:00`)}`; };
    if (/tonight|today/.test(t) || /^is (it|tonight)/.test(t)) return { answer:isBathDay(now) ? 'Yes, tonight is bath night. 🛁' : `No bath tonight. The next one is ${when(nextBathDay(new Date(+now + DAY))) || 'not scheduled'}.`, view:'settings' };
    const next = when(nextBathDay(now)); return { answer:next ? `The next bath night is ${next}.` : 'No bath nights are set.', view:'settings' };
  }
  if (/birthday/.test(t)) {
    const soon = birthdaysInRange(startOfDay(now), new Date(+now + 366 * DAY));
    if (!soon.length) return { answer:'No birthdays are saved yet.', view:'settings' };
    const first = soon[0], same = soon.filter(b => b.date === first.date), day = new Date(`${first.date}T12:00:00`), n = Math.round((startOfDay(day) - startOfDay(now)) / DAY);
    return { answer:`Next up: ${list(same.map(b => b.age ? `${b.name} turns ${b.age}` : `${b.name}’s birthday`))} ${n === 0 ? 'today 🎂' : n === 1 ? 'tomorrow' : `on ${dateLabel(day)}`}.`, view:'calendar' };
  }
  // ---- Weather ----
  if (/\b(rain|raining|weather|umbrella|snow|storm|cold|hot|warm|temperature|forecast)\b/.test(t)) {
    const days = forecast?.days || []; if (!days.length) return { answer:'I don’t have a forecast right now.', view:'today' };
    const asked = daysAsked(t, now), wanted = (asked?.days || [now]).map(d => ({ when:d, day:days.find(x => x.date === keyOf(d)) }));
    if (!wanted.some(w => w.day)) return { answer:'That’s beyond the forecast I have (about a week).', view:'today' };
    const wet = d => d.rain >= 50 || d.kind === 'rain' || d.kind === 'storm', maybe = d => d.rain >= 25;
    const found = wanted.filter(w => w.day).map(w => w.day);
    const yesNo = /rain|umbrella/.test(t) ? (found.some(wet) ? 'Probably, yes. ' : found.some(maybe) ? 'Maybe. ' : 'Probably not. ') : '';
    const line = d => `${d.label ? `${d.label.toLowerCase()}, ` : ''}high ${Math.round(d.high)}°, low ${Math.round(d.low)}°${d.rain == null ? '' : `, ${d.rain}% chance of rain`}`;
    if (wanted.length > 1) return { answer:`${yesNo}${wanted.filter(w => w.day).map(w => `${dayName(w.when)}: ${line(w.day)}`).join('. ')}.`, view:'today' };
    const label = asked?.label || 'today';
    return { answer:`${yesNo}${label[0].toUpperCase()}${label.slice(1)} in Richmond: ${line(found[0])}.`, view:'today' };
  }
  // ---- Calendar ----
  if (/what('s| is)? next|next (plan|thing|event)|coming up/.test(t)) {
    const { current, next } = nextUp(events, now);
    if (current && !next) return { answer:`Right now: ${current.event.title}, ${current.minutesLeft} minutes left. Nothing else is planned this week.`, view:'today' };
    if (!next) return { answer:'Nothing is planned for the next week.', view:'calendar' };
    return { answer:`${current ? `Now: ${current.event.title}. ` : ''}Next: ${next.event.title}, ${next.minutesUntil < 1440 ? `at ${clock(next.from)}` : `${dayName(next.from)} at ${clock(next.from)}`} (${untilText(next.minutesUntil)}).`, view:'today' };
  }
  const asked = daysAsked(t, now);
  if (asked && /(what|anything|plans?|planned|schedule|busy|free|happening|going on|on)\b/.test(t)) {
    const found = asked.days.flatMap(day => onDay(events, day).filter(e => !asked.evening || e.allDay || new Date(e.start).getHours() >= 16 || new Date(e.end || e.start) > new Date(new Date(day).setHours(17, 0, 0, 0))).map(e => ({ e, day })));
    if (/\bfree\b/.test(t)) return { answer:found.length ? `Not completely. ${asked.label[0].toUpperCase()}${asked.label.slice(1)}: ${list(found.map(f => describeEvent(f.e)))}.` : `Yes, nothing is planned ${asked.label}.`, view:'calendar' };
    if (!found.length) return { answer:`Nothing is planned ${asked.label}.`, view:'calendar' };
    const byDay = asked.days.length > 1;
    return { answer:`${asked.label[0].toUpperCase()}${asked.label.slice(1)}: ${list(found.map(f => `${describeEvent(f.e)}${byDay ? ` (${dayName(f.day)})` : ''}`))}.`, view:'calendar' };
  }
  const when = t.match(/^(?:when(?:'s| is| are| was)?|what day is|what time is)\s+(?:the |our |my |a )?(.+?)\??$/);
  if (when) {
    const q = when[1].replace(/\b(next|again|happening|scheduled|planned)\b/g, '').trim(); if (q.length < 3) return null;
    const match = events.filter(e => new Date(e.end || e.start) >= now && e.title?.toLowerCase().includes(q)).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
    if (!match) return { answer:`I couldn’t find “${q}” on the calendar.`, view:'calendar' };
    return { answer:`${match.title} is ${keyOf(match.start) === keyOf(now) ? 'today' : `on ${dateLabel(match.start)}`}${match.allDay ? '' : ` at ${clock(match.start)}`}.`, view:'calendar', event:match };
  }
  return null;
}

export const SAMPLE_QUESTIONS = ['When did Frankie last eat?', 'When is her next nap?', 'What’s on tomorrow?', 'When is recycling?', 'Will it rain this weekend?', 'Whose birthday is next?'];
