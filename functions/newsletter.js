// The morning newsletter: a home-page digest emailed to each household member.
// buildDigest() turns raw household data into a summary; composeEmail() renders
// it as an email. Both are pure so they can be tested without sending anything.
// The shared/ modules are copied from the app by scripts/share.mjs at build and
// deploy time, so the email uses exactly the same logic as the home page.
import { dailyContent } from './shared/daily-content.js';
import { babySummary, dailySleep, dailyBottles, dayStory, localDay } from './shared/baby-history.js';
import { marketValue, marketChange, marketDate, marketLine } from './shared/briefing-format.js';
import { purrfectWindow, miaForecast, huckleberryPrediction } from './shared/baby-model.js';
import { scorePredictions } from './shared/prediction-log.js';
import { weatherFlags } from './shared/smart-home.js';
import { frankieAwards } from './shared/awards.js';
import { freeEvenings } from './shared/free-nights.js';

export const HOUSE_TZ = 'America/New_York';
export const APP_URL = 'https://huberts-house.web.app';
const DAY = 86400000;
export class NewsletterError extends Error { constructor(code, message) { super(message); this.code = code; } }

// "2026-11-16" is a local calendar date, not UTC midnight.
export const parseWhen = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(...value.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n))) : new Date(value);
function advance(date, repeat) {
  const d = new Date(date);
  if (repeat === 'daily') d.setDate(d.getDate() + 1); else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1); else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1); else d.setDate(d.getDate() + 1);
  return d;
}
// Household events (with repeats, same rules as the app) plus iCloud events, within [from, to).
export function eventsInRange(household = [], icloud = [], from, to) {
  const out = [];
  for (const doc of household) {
    if (!doc.title || !doc.start) continue;
    const start = parseWhen(doc.start), end = doc.end ? parseWhen(doc.end) : null, length = end ? end - start : 0;
    if (isNaN(start)) continue;
    const repeat = doc.repeat || 'none', until = doc.repeatUntil ? new Date(`${doc.repeatUntil}T23:59:59`) : to;
    let cursor = new Date(start), guard = 0;
    while (cursor < to && cursor <= until && guard++ < 800) {
      const occEnd = end ? new Date(+cursor + length) : new Date(+cursor + (doc.allDay ? DAY : 3600000));
      if (occEnd > from) out.push({ title:doc.title, start:new Date(cursor), end:occEnd, allDay:!!doc.allDay, owner:doc.owner || 'both', withFrankie:!!doc.withFrankie });
      if (repeat === 'none') break;
      cursor = advance(cursor, repeat);
    }
  }
  for (const event of icloud) {
    const start = parseWhen(event.start), end = event.end ? parseWhen(event.end) : new Date(+start + (event.allDay ? DAY : 3600000));
    if (start < to && end > from) out.push({ title:event.title, start, end, allDay:!!event.allDay, owner:event.owner || 'both', withFrankie:!!event.withFrankie });
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
const startOfDay = date => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const onDay = (events, day) => { const from = startOfDay(day), to = new Date(+from + DAY); return events.filter(e => e.start < to && e.end > from); };

export function buildDigest({ name = '', now = new Date(), household = [], icloud = [], items = [], forecast = null, snapshot = null, predictions = [], recent = null, briefing = null, prefs = {} }) {
  const today = startOfDay(now), horizon = new Date(+today + 15 * DAY);
  const events = eventsInRange(household, icloud, today, horizon), tomorrow = new Date(+today + DAY);
  const week = Array.from({ length:7 }, (_, i) => { const day = new Date(+today + i * DAY); return { day, count:onDay(events, day).length }; });
  const busiest = [...week].sort((a, b) => b.count - a.count)[0];
  const todayKey = dateKey(today);
  const chores = items.filter(item => ['chore', 'task'].includes(item.kind) && !item.completed && /^\d{4}-\d{2}-\d{2}$/.test(item.due || '') && item.due <= todayKey)
    .map(item => ({ title:item.title, overdue:item.due < todayKey, owner:item.owner || 'both' }));
  const groceries = items.filter(item => item.kind === 'grocery' && !item.completed).length;
  const fc = forecast?.days || [];
  const digest = {
    name:String(name || '').trim(), now, content:dailyContent(now), afterDark:prefs.afterDark === true,
    weather:fc[0] ? { ...fc[0], tomorrow:fc[1] || null } : null,
    rain:weatherFlags(events.map(e => ({ ...e, start:e.start.toISOString(), end:e.end.toISOString() })), fc, now),
    today:onDay(events, today), tomorrow:onDay(events, tomorrow), week:{ plans:week.reduce((sum, d) => sum + d.count, 0), busiest:busiest?.count ? busiest : null },
    freeNights:freeEvenings(events, now, 14, 3).map(n => n.date), chores, groceries, baby:null,
    world:briefing && (briefing.headlines?.length || briefing.markets?.length) ? { headlines:(briefing.headlines || []).slice(0, 6), goodNews:briefing.goodNews || null, markets:briefing.markets || [] } : null
  };
  if (snapshot?.sleeps) {
    const tz = snapshot.timezone || HOUSE_TZ, summary = babySummary(snapshot, tz, +now);
    // Yesterday: the last full local day.
    const yesterday = { sleep:dailySleep(snapshot.sleeps, tz, 2, +now)[0], bottles:dailyBottles(snapshot.bottles || [], tz, 2, +now)[0] };
    yesterday.story = dayStory(snapshot, recent?.filter(entry => entry.kind === 'diaper') ?? null, tz, localDay(+now - DAY, tz), +now);
    const huck = huckleberryPrediction(snapshot, now), purr = purrfectWindow({ sleeps:snapshot.sleeps, timer:snapshot.timer, timezone:tz }, now), mia = miaForecast({ sleeps:snapshot.sleeps, timer:snapshot.timer, timezone:tz }, now);
    const score = scorePredictions(predictions, snapshot.sleeps, snapshot.timer, tz);
    digest.baby = { name:snapshot.name || 'Frankie', tz, timer:snapshot.timer, lastWake:snapshot.sleeps.at(-1)?.end || null, lastBottle:snapshot.bottles?.at(-1) || null, summary, yesterday,
      predictions:{ huck, purr, mia }, leader:score.leader ? score.summary.find(m => m.key === score.leader) : null, scored:score.scoredNaps,
      awards:now.getDay() === 1 ? frankieAwards(snapshot, tz, +now).awards.slice(0, 4) : [] };
  }
  return digest;
}
// ---------- Email rendering ----------
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clock = (date, tz = HOUSE_TZ) => new Date(date).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone:tz });
const longDate = date => date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
const shortDate = date => date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
const hm = hours => { if (hours == null) return '—'; const m = Math.round(hours * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const ago = (stamp, now) => { const m = Math.max(0, Math.round((now - Date.parse(stamp)) / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const WHO = { hanry:'hanry', karena:'Karena', both:'Together', custom:'' };
const C = { bg:'#f6f5f0', card:'#fffefa', ink:'#293c34', muted:'#687568', line:'#e3e6dc', accent:'#365e4b', soft:'#e8eedf', pink:'#98657a' };

function section(eyebrow, title, body) {
  return `<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.card};border:1px solid ${C.line};border-radius:16px"><tr><td style="padding:18px 22px">
    <div style="font:700 10px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.muted}">${esc(eyebrow)}</div>
    <div style="font:400 21px/1.3 Georgia,'Times New Roman',serif;color:${C.ink};margin:4px 0 10px">${title}</div>${body}</td></tr></table></td></tr>`;
}
const p = (text, style = '') => `<p style="margin:0 0 8px;font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.ink};${style}">${text}</p>`;
const small = text => `<span style="color:${C.muted};font-size:12px">${text}</span>`;
const minutes = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
// A few plain sentences about Frankie's yesterday.
export function storyText(b) {
  const s = b.yesterday.story, name = b.name, tz = b.tz;
  if (!s) return '';
  const day = [];
  if (s.wake) day.push(`was up for the day at ${clock(s.wake, tz)}`);
  if (s.naps.count) day.push(`took ${plural(s.naps.count, 'nap')} (${minutes(s.naps.minutes)} in all${s.naps.count > 1 && s.naps.longest ? `; the longest, ${minutes(s.naps.longest.minutes)}, started at ${clock(s.naps.longest.start, tz)}` : ''})`);
  else day.push('had no naps logged');
  if (s.bedtime) day.push(`went down for the night at ${clock(s.bedtime, tz)}`);
  const sentences = [`Yesterday ${name} ${day.length > 1 ? `${day.slice(0, -1).join(', ')} and ${day.at(-1)}` : day[0]}.`];
  const feeds = [s.bottles.count ? `${plural(s.bottles.count, 'bottle')}, ${s.bottles.ounces} oz in all` : 'no bottles logged'];
  if (s.diapers) feeds.push(s.diapers.count ? `${plural(s.diapers.count, 'diaper change')} (${s.diapers.wet} wet, ${s.diapers.dirty} dirty)` : 'no diaper changes logged');
  sentences.push(`She had ${feeds.join(' and ')}.`);
  if (s.overnight && !b.timer?.active) sentences.push(`Overnight she slept ${minutes(s.overnight.minutes)} and woke at ${clock(s.overnight.woke, tz)}.`);
  else if (s.bedtime && b.timer?.active) sentences.push(`She’s still asleep${s.overnight ? ` after ${minutes(s.overnight.minutes)} of logged night sleep` : ''}.`);
  const total = b.yesterday.sleep?.total, avg = b.summary.avgSleep;
  if (total && avg && Math.abs(total - avg) >= 0.25) sentences.push(`That’s ${minutes(Math.round(Math.abs(total - avg) * 60))} ${total > avg ? 'more' : 'less'} sleep than her 7-day average.`);
  return sentences.join(' ');
}
function worldSection(world) {
  const tiles = world.markets.map(m => { const change = marketChange(m), color = change.tone === 'up' ? '#2f7d4f' : change.tone === 'down' ? '#b4232a' : C.muted;
    return `<td style="width:33%;padding:8px 8px 8px 0;vertical-align:top"><div style="font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">${esc(m.name)}</div><div style="font:600 16px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.ink}">${esc(marketValue(m))}</div><div style="font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${color}">${esc(change.text)} <span style="color:${C.muted}">${esc(marketDate(m.date))}</span></div></td>`; });
  const rows = []; for (let i = 0; i < tiles.length; i += 3) rows.push(`<tr>${tiles.slice(i, i + 3).join('')}</tr>`);
  const news = world.headlines.map(h => `<li style="margin:0 0 6px"><a href="${esc(h.link)}" style="color:${C.ink};text-decoration:none;font-weight:600">${esc(h.title)}</a> <span style="color:${C.muted};font-size:12px">${esc(h.source)}</span></li>`).join('');
  const good = world.goodNews ? `<div style="margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#fbf3df">${p(`<span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a6a1f">☀ Good news</span><br><a href="${esc(world.goodNews.link)}" style="color:${C.ink};font-weight:600;text-decoration:none">${esc(world.goodNews.title)}</a> ${small(esc(world.goodNews.source))}`, 'margin:0;font-size:14px')}</div>` : '';
  return section('The world, briefly', 'Top headlines & markets', good + (news ? `<ol style="margin:0 0 10px;padding-left:20px;font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.ink}">${news}</ol>` : '')
    + (rows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table>` : '')
    + p(small('Headlines: NPR and BBC World. Good news: Good News Network. Markets and rates: FRED (St. Louis Fed), last close shown.'), 'margin:8px 0 0'));
}
function planRows(events) {
  return events.map(e => `<tr><td style="padding:7px 12px 7px 0;width:92px;vertical-align:top;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.accent};white-space:nowrap">${e.allDay ? 'All day' : esc(clock(e.start))}</td><td style="padding:7px 0;border-bottom:1px solid ${C.line};font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.ink}">${esc(e.title)} ${small(esc([WHO[e.owner] ?? '', e.withFrankie ? '+ Frankie' : ''].filter(Boolean).join(' ')))}</td></tr>`).join('');
}

export function composeEmail(d) {
  const greeting = `${d.now.getHours() < 12 ? 'Good morning' : d.now.getHours() < 17 ? 'Good afternoon' : 'Good evening'}${d.name ? `, ${esc(d.name)}` : ''}`;
  const w = d.weather, sections = [];
  const subjectBits = [w ? `${Math.round(w.high)}°` : null, `${d.today.length} plan${d.today.length === 1 ? '' : 's'}`];
  if (d.baby) subjectBits.push(d.baby.timer?.active ? `${d.baby.name} asleep` : `${d.baby.name}’s day`);
  const subject = `☀ ${d.now.toLocaleDateString('en-US', { weekday:'long' })} at Hubert’s House · ${subjectBits.filter(Boolean).join(' · ')}`;

  // Today
  const weatherLine = w ? p(`<strong>${Math.round(w.high)}° / ${Math.round(w.low)}°</strong> · ${esc(w.label || '')}${w.rain != null ? ` · ${Math.round(w.rain)}% rain` : ''}${w.tomorrow ? ` ${small(`· Tomorrow ${Math.round(w.tomorrow.high)}° ${esc(w.tomorrow.label || '')}`)}` : ''}`) : '';
  const rain = d.rain.length ? p(`☔ Rain may affect <strong>${esc(d.rain[0].title)}</strong> (${esc(shortDate(new Date(d.rain[0].start)))}${d.rain[0].rain != null ? `, ${d.rain[0].rain}%` : ''})${d.rain.length > 1 ? ` and ${d.rain.length - 1} more` : ''}.`, 'font-size:13px') : '';
  sections.push(section('Today in Richmond', `${d.today.length ? `${d.today.length} plan${d.today.length === 1 ? '' : 's'} today` : 'A wide-open day'}`,
    weatherLine + rain + (d.today.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${planRows(d.today)}</table>` : p('Nothing on the calendar. Make it your own.', `color:${C.muted}`))
    + (d.tomorrow.length ? p(`<strong>Tomorrow:</strong> ${d.tomorrow.slice(0, 4).map(e => `${esc(e.title)}${e.allDay ? '' : ` ${small(esc(clock(e.start)))}`}`).join(' · ')}${d.tomorrow.length > 4 ? ` +${d.tomorrow.length - 4}` : ''}`, 'margin-top:12px;font-size:13px') : '')));

  // Frankie
  if (d.baby) {
    const b = d.baby, now = d.now, y = b.yesterday;
    const status = b.timer?.active ? `asleep for ${ago(b.timer.start, now)}` : b.lastWake ? `awake for ${ago(b.lastWake, now)}` : 'no sleep logged yet';
    const nap = [b.predictions.huck?.available && !b.predictions.huck.expired ? `SweetSpot ${clock(b.predictions.huck.time, b.tz)}` : '', b.predictions.purr?.available ? `Hubert${b.predictions.purr.kind === 'bedtime' ? ' (bedtime)' : b.predictions.purr.kind === 'wake' ? ' (next wake-up)' : ''} ${clock(b.predictions.purr.start, b.tz)}–${clock(b.predictions.purr.end, b.tz)}` : '', b.predictions.mia?.available ? `Mia${b.predictions.mia.kind === 'bedtime' ? ' (bedtime)' : ''} ${clock(b.predictions.mia.start, b.tz)}–${clock(b.predictions.mia.end, b.tz)}` : ''].filter(Boolean);
    const stats = [['Slept yesterday', hm(y.sleep?.total), y.sleep ? `${hm(y.sleep.night)} night · ${y.sleep.naps} nap${y.sleep.naps === 1 ? '' : 's'}` : ''], ['Bottles yesterday', y.bottles?.count ? `${y.bottles.ounces} oz` : '—', y.bottles?.count ? `${y.bottles.count} bottles` : ''], ['7-day average', b.summary.avgOunces ? `${Math.round(b.summary.avgOunces * 10) / 10} oz` : '—', b.summary.avgSleep ? `${hm(b.summary.avgSleep)} sleep/day` : '']];
    const tiles = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${stats.map(([label, value, note]) => `<td style="width:33%;padding:10px 8px 10px 0;vertical-align:top"><div style="font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">${esc(label)}</div><div style="font:400 20px/1.3 Georgia,serif;color:${C.ink}">${esc(value)}</div><div style="font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">${esc(note)}</div></td>`).join('')}</tr></table>`;
    const awards = b.awards.length ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#fbf3df">${p(`<strong>🏆 Last week’s awards:</strong> ${b.awards.map(a => `${a.icon} ${esc(a.title)} <strong>${esc(a.value)}</strong>`).join(' · ')}`, 'margin:0;font-size:13px')}</div>` : '';
    sections.push(section('Little moments, big love', `${esc(b.name)} is ${esc(status)}`,
      (b.yesterday.story ? p(esc(storyText(b)), 'margin-bottom:10px') : '') + tiles + (nap.length ? p(`<strong>Next nap:</strong> ${esc(nap.join(' · '))}`, 'font-size:13px;margin-top:6px') : '')
      + (b.lastBottle ? p(small(`Last bottle ${esc(ago(b.lastBottle.start, now))} ago · ${esc(b.lastBottle.amount)} ${esc(b.lastBottle.units)}`)) : '')
      + (b.leader ? p(`🏆 <strong>${esc(b.leader.owner)}’s ${esc(b.leader.name)}</strong> leads the nap challenge · ±${b.leader.mae} min over ${b.leader.n} naps`, 'font-size:13px') : '') + awards));
  }

  if (d.world) sections.push(worldSection(d.world));

  // Around the house
  const house = [];
  if (d.chores.length) house.push(p(`<strong>To take care of:</strong> ${d.chores.slice(0, 6).map(c => `${esc(c.title)}${c.overdue ? ` ${small('(overdue)')}` : ''}`).join(' · ')}${d.chores.length > 6 ? ` +${d.chores.length - 6}` : ''}`, 'font-size:13px'));
  if (d.groceries) house.push(p(`🛒 <strong>${d.groceries}</strong> thing${d.groceries === 1 ? '' : 's'} on the grocery list.`, 'font-size:13px'));
  house.push(p(`📅 <strong>${d.week.plans}</strong> plan${d.week.plans === 1 ? '' : 's'} this week${d.week.busiest ? ` · busiest: ${esc(d.week.busiest.day.toLocaleDateString('en-US', { weekday:'long' }))}` : ''}.`, 'font-size:13px'));
  if (d.freeNights.length) house.push(p(`♡ <strong>Free nights for a date:</strong> ${d.freeNights.map(n => esc(shortDate(n))).join(' · ')}`, 'font-size:13px'));
  sections.push(section('Around the house', 'The week at a glance', house.join('')));

  // A little something
  const c = d.content;
  const extras = p(`<em style="font-family:Georgia,serif;font-size:16px">“${esc(c.quote)}”</em>`) + p(`✦ ${esc(c.fact)}`, 'font-size:13px') + p(`<strong>${esc(c.word.word)}</strong> ${small(esc(c.word.part))} — ${esc(c.word.definition)}`, 'font-size:13px')
    + `<div style="margin-top:12px;padding:12px 14px;border-radius:12px;background:#eeeaf6">${p(`<strong>Dad joke:</strong> ${esc(c.joke.setup)}`, 'margin:0 0 4px;font-size:13px')}${p(small(`↓ Punchline: <span style="color:${C.ink}">${esc(c.joke.punchline)}</span>`), 'margin:0')}</div>`
    + (d.afterDark ? `<div style="margin-top:8px;padding:12px 14px;border-radius:12px;background:#f3e6ea">${p(`<strong>🔞 After dark:</strong> ${esc(c.afterDark.setup)}`, 'margin:0 0 4px;font-size:13px')}${p(small(`↓ ${esc(c.afterDark.punchline)}`), 'margin:0')}</div>` : '');
  sections.push(section('A little something for today', 'Quote, fact, word & a laugh', extras));

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
<tr><td style="padding:4px 4px 18px"><div style="font:700 10px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.pink}">Hubert’s House · ${esc(longDate(d.now))}</div><div style="font:400 30px/1.2 Georgia,'Times New Roman',serif;color:${C.ink};margin-top:6px">${greeting}.</div></td></tr>
${sections.join('\n')}
<tr><td style="padding:8px 4px 0;text-align:center;font:12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}"><a href="${APP_URL}" style="color:${C.accent};font-weight:600">Open Hubert’s House</a> · <a href="${APP_URL}/#settings" style="color:${C.muted}">Newsletter settings</a><br>Made for hanry, Karena, Frankie, Hubert, Mack & Mia.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${greeting.replace(/&#39;|&amp;/g, m => m === '&amp;' ? '&' : "'")}. ${longDate(d.now)}`, w ? `Weather: ${Math.round(w.high)}°/${Math.round(w.low)}° ${w.label || ''}` : '',
    `Today: ${d.today.length ? d.today.map(e => `${e.allDay ? 'All day' : clock(e.start)} ${e.title}`).join('; ') : 'nothing planned'}`,
    d.baby ? (storyText(d.baby) || `${d.baby.name}: yesterday ${hm(d.baby.yesterday.sleep?.total)} sleep, ${d.baby.yesterday.bottles?.ounces ?? 0} oz`) : '',
    d.world?.headlines.length ? `Top headlines:\n${d.world.headlines.map(h => `• ${h.title} (${h.source}) ${h.link}`).join('\n')}` : '',
    d.world?.goodNews ? `Good news: ${d.world.goodNews.title} ${d.world.goodNews.link}` : '',
    d.world?.markets.length ? `Markets: ${d.world.markets.map(marketLine).join(' · ')}` : '',
    `Dad joke: ${c.joke.setup} — ${c.joke.punchline}`, APP_URL].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

export function validatePrefs(input = {}) {
  const name = String(input.name ?? '').trim();
  if (name.length > 40) throw new NewsletterError('invalid-argument', 'Keep the name under 40 characters.');
  return { enabled:input.enabled !== false, afterDark:input.afterDark === true, name };
}
export function validateSender(input = {}) {
  const email = String(input.email || '').trim(), password = String(input.password || '').replace(/\s+/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new NewsletterError('invalid-argument', 'Enter the Gmail address that will send the newsletter.');
  if (password.length < 8 || password.length > 64) throw new NewsletterError('invalid-argument', 'Enter the 16-character Google app password.');
  return { email, password };
}
