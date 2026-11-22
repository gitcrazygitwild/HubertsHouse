// The morning newsletter: a home-page digest emailed to each household member.
// buildDigest() turns raw household data into a summary; composeEmail() renders
// it as an email. Both are pure so they can be tested without sending anything.
// The shared/ modules are copied from the app by scripts/share.mjs at build and
// deploy time, so the email uses exactly the same logic as the home page.
import { dailyContent } from './shared/daily-content.js';
import { babySummary, dailySleep, dailyBottles, dayStory, dayStoryText, localDay } from './shared/baby-history.js';
import { marketValue, marketChange, marketDate, marketLine } from './shared/briefing-format.js';
import { purrfectWindow, miaForecast, huckleberryPrediction } from './shared/baby-model.js';
import { scorePredictions } from './shared/prediction-log.js';
import { weatherFlags } from './shared/smart-home.js';
import { frankieAwards } from './shared/awards.js';
import { isBathDay, cleanBathDays, DEFAULT_BATH_DAYS, BATH_TITLE } from './shared/bath-days.js';
import { pickupOn } from './shared/trash-days.js';
import { freeEvenings } from './shared/free-nights.js';
import { upcomingBirthdays } from './shared/birthdays-model.js';
import { scoreMornings, scoreBottles, bottlePicks, CHALLENGES } from './shared/cat-challenges.js';

export const HOUSE_TZ = 'America/New_York';
export const APP_URL = 'https://huberts-house.web.app';
const DAY = 86400000;
export class NewsletterError extends Error { constructor(code, message) { super(message); this.code = code; } }
// Each outside service gets a time budget. A slow one is left out of the email (and
// named in it) instead of stalling the whole send past the function's deadline.
export const BUDGET = { snapshot:75000, recent:25000, icloud:40000, forecast:12000, briefing:25000, mail:60000 };
export async function withinTime(work, ms, fallback = null) {
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve({ value:fallback, late:true }), ms); });
  try { return await Promise.race([Promise.resolve(work).then(value => ({ value, late:false }), error => ({ value:fallback, late:false, failed:true, error })), late]); }
  finally { clearTimeout(timer); }
}
export const SKIPPED_LABELS = { baby:'the newest Huckleberry logs (Frankie’s section uses the last saved copy)', diapers:'diaper changes', icloud:'Apple Calendar plans', forecast:'the weather', briefing:'headlines and markets' };

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

function bathItem(day, saved) {
  const list = saved == null ? DEFAULT_BATH_DAYS : cleanBathDays(saved) ?? DEFAULT_BATH_DAYS;
  return isBathDay(day, list) ? [{ title:BATH_TITLE, start:new Date(day), end:new Date(+day + DAY), allDay:true, owner:'both', withFrankie:true }] : [];
}
// Bin day as an all-day item; on the day before, a reminder to put the bins out.
function trashItem(day, saved, { eve = false } = {}) {
  const pickup = pickupOn(day, saved ?? undefined);
  if (!pickup) return [];
  const title = `${pickup.title}${eve ? ' (bins out tonight)' : ''}${pickup.moved ? ` · moved for ${pickup.moved.holiday}` : ''}`;
  return [{ title, start:new Date(day), end:new Date(+day + DAY), allDay:true, owner:'both', marker:true }]; // a reminder, not a plan
}
export function buildDigest({ name = '', now = new Date(), household = [], icloud = [], items = [], forecast = null, snapshot = null, predictions = [], recent = null, briefing = null, birthdays = [], prefs = {}, skipped = [], bathDays = null, trash = null }) {
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
    weather:fc[0] ? { ...fc[0], tomorrow:fc[1] || null } : null, outlook:fc.slice(0, 7),
    rain:weatherFlags(events.map(e => ({ ...e, start:e.start.toISOString(), end:e.end.toISOString() })), fc, now),
    // Bath nights ride along as all-day items at the top of today's and tomorrow's plans.
    today:[...trashItem(today, trash), ...bathItem(today, bathDays), ...onDay(events, today)], tomorrow:[...trashItem(tomorrow, trash, { eve:true }), ...bathItem(tomorrow, bathDays), ...onDay(events, tomorrow)], week:{ plans:week.reduce((sum, d) => sum + d.count, 0), busiest:busiest?.count ? busiest : null },
    freeNights:freeEvenings(events, now, 14, 3).map(n => n.date), birthdays:upcomingBirthdays(now, 7, birthdays), chores, groceries, baby:null, skipped:[...new Set(skipped)].filter(key => SKIPPED_LABELS[key]),
    world:briefing && (briefing.headlines?.length || briefing.markets?.length) ? { headlines:(briefing.headlines || []).slice(0, 6), goodNews:briefing.goodNews || null, markets:briefing.markets || [] } : null
  };
  if (snapshot?.sleeps) {
    const tz = snapshot.timezone || HOUSE_TZ, summary = babySummary(snapshot, tz, +now);
    // Yesterday: the last full local day.
    const yesterday = { sleep:dailySleep(snapshot.sleeps, tz, 2, +now)[0], bottles:dailyBottles(snapshot.bottles || [], tz, 2, +now)[0] };
    yesterday.story = dayStory(snapshot, recent?.filter(entry => entry.kind === 'diaper') ?? null, tz, localDay(+now - DAY, tz), +now);
    const huck = huckleberryPrediction(snapshot, now), purr = purrfectWindow({ sleeps:snapshot.sleeps, timer:snapshot.timer, timezone:tz }, now), mia = miaForecast({ sleeps:snapshot.sleeps, bottles:snapshot.bottles || [], birthdate:snapshot.birthdate, timer:snapshot.timer, timezone:tz }, now);
    const score = scorePredictions(predictions, snapshot.sleeps, snapshot.timer, tz, { bottles:snapshot.bottles || [], birthdate:snapshot.birthdate });
    digest.baby = { name:snapshot.name || 'Frankie', tz, timer:snapshot.timer, lastWake:snapshot.sleeps.at(-1)?.end || null, lastBottle:snapshot.bottles?.at(-1) || null, summary, yesterday,
      predictions:{ huck, purr, mia }, leader:score.leader ? score.summary.find(m => m.key === score.leader) : null, scored:score.scoredNaps,
      awards:now.getDay() === 1 ? frankieAwards(snapshot, tz, +now).awards.slice(0, 4) : [] };
    // The cats' other challenges: who leads, and today's Bottle Bet guesses.
    const owner = (kind, key) => CHALLENGES[kind].find(m => m.key === key)?.owner;
    const mornings = scoreMornings(snapshot.sleeps, tz, +now, { birthdate:snapshot.birthdate }), bottles = scoreBottles(snapshot.bottles || [], tz, +now, { birthdate:snapshot.birthdate });
    digest.baby.challenges = { morning:owner('morning', mornings.leader) || null, bottle:owner('bottle', bottles.leader) || null, bet:bottlePicks(snapshot.bottles || [], tz, localDay(+now, tz), { birthdate:snapshot.birthdate }) };
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
  return dayStoryText(b.yesterday.story, { name:b.name, timezone:b.tz, asleep:!!b.timer?.active, totalHours:b.yesterday.sleep?.total, averageHours:b.summary.avgSleep });
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
const SKY = { sun:'☀️', partly:'⛅', cloud:'☁️', rain:'🌧️', storm:'⛈️', snow:'❄️', fog:'🌫️' };
export const WEATHER_URL = 'https://gitcrazygitwild.github.io/Miateorology/';
// The week's forecast in one row; each day links to Miateorology.
function outlookRow(days) {
  const cells = days.map((day, i) => `<td style="width:${Math.floor(100 / days.length)}%;padding:6px 2px;text-align:center;vertical-align:top"><a href="${WEATHER_URL}" style="text-decoration:none;color:${C.ink}" title="${esc(day.label || '')}"><div style="font:600 11px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">${i === 0 ? 'Today' : esc(new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { weekday:'short' }))}</div><div style="font-size:18px;line-height:1.5">${SKY[day.kind] || '•'}</div><div style="font:600 13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif">${day.high == null ? '—' : Math.round(day.high)}°<span style="font-weight:400;color:${C.muted}"> ${day.low == null ? '' : `${Math.round(day.low)}°`}</span></div>${day.rain != null && day.rain >= 30 ? `<div style="font:11px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#3b6fa8">${Math.round(day.rain)}%</div>` : ''}</a></td>`).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 12px;border-top:1px solid ${C.line};border-bottom:1px solid ${C.line}"><tr>${cells}</tr></table>`;
}
function planRows(events) {
  return events.map(e => `<tr><td style="padding:7px 12px 7px 0;width:92px;vertical-align:top;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.accent};white-space:nowrap">${e.allDay ? 'All day' : esc(clock(e.start))}</td><td style="padding:7px 0;border-bottom:1px solid ${C.line};font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.ink}">${esc(e.title)} ${small(esc([WHO[e.owner] ?? '', e.withFrankie ? '+ Frankie' : ''].filter(Boolean).join(' ')))}</td></tr>`).join('');
}

export function composeEmail(d) {
  const greeting = `${d.now.getHours() < 12 ? 'Good morning' : d.now.getHours() < 17 ? 'Good afternoon' : 'Good evening'}${d.name ? `, ${esc(d.name)}` : ''}`;
  const w = d.weather, sections = [];
  const planCount = d.today.filter(e => !e.marker).length; // bin day rides along but isn't a plan
  const subjectBits = [w ? `${Math.round(w.high)}°` : null, `${planCount} plan${planCount === 1 ? '' : 's'}`];
  if (d.birthdays?.today.length) subjectBits.push(`🎂 ${d.birthdays.today.map(b => b.name).join(' & ')}`);
  if (d.baby) subjectBits.push(d.baby.timer?.active ? `${d.baby.name} asleep` : `${d.baby.name}’s day`);
  const subject = `☀ ${d.now.toLocaleDateString('en-US', { weekday:'long' })} at Hubert’s House · ${subjectBits.filter(Boolean).join(' · ')}`;

  // Today
  const weatherLine = w ? p(`<strong>${Math.round(w.high)}° / ${Math.round(w.low)}°</strong> · ${esc(w.label || '')}${w.rain != null ? ` · ${Math.round(w.rain)}% rain` : ''}${w.tomorrow ? ` ${small(`· Tomorrow ${Math.round(w.tomorrow.high)}° ${esc(w.tomorrow.label || '')}`)}` : ''}`) : '';
  const rain = d.rain.length ? p(`☔ Rain may affect <strong>${esc(d.rain[0].title)}</strong> (${esc(shortDate(new Date(d.rain[0].start)))}${d.rain[0].rain != null ? `, ${d.rain[0].rain}%` : ''})${d.rain.length > 1 ? ` and ${d.rain.length - 1} more` : ''}.`, 'font-size:13px') : '';
  sections.push(section('Today in Richmond', `${planCount ? `${planCount} plan${planCount === 1 ? '' : 's'} today` : 'A wide-open day'}`,
    (d.birthdays?.today.length ? `<div style="margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#fbeef0">${p(d.birthdays.today.map(b => `<strong>${esc(b.title)}</strong>`).join(' · ') + ' today!', 'margin:0;font-size:14px')}</div>` : '') + weatherLine + (d.outlook?.length > 1 ? outlookRow(d.outlook) : '') + rain + (d.today.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${planRows(d.today)}</table>` : p('Nothing on the calendar. Make it your own.', `color:${C.muted}`))
    + (d.tomorrow.length ? p(`<strong>Tomorrow:</strong> ${d.tomorrow.slice(0, 4).map(e => `${esc(e.title)}${e.allDay ? '' : ` ${small(esc(clock(e.start)))}`}`).join(' · ')}${d.tomorrow.length > 4 ? ` +${d.tomorrow.length - 4}` : ''}`, 'margin-top:12px;font-size:13px') : '')));

  // Frankie
  if (d.baby) {
    const b = d.baby, now = d.now, y = b.yesterday;
    const status = b.timer?.active ? `asleep for ${ago(b.timer.start, now)}` : b.lastWake ? `awake for ${ago(b.lastWake, now)}` : 'no sleep logged yet';
    const nap = [b.predictions.purr?.available ? `Hubert${b.predictions.purr.kind === 'bedtime' ? ' (bedtime)' : b.predictions.purr.kind === 'wake' ? ' (next wake-up)' : ''} ${clock(b.predictions.purr.start, b.tz)}–${clock(b.predictions.purr.end, b.tz)}` : '', b.predictions.mia?.available ? `Mia${b.predictions.mia.kind === 'bedtime' ? ' (bedtime)' : b.predictions.mia.kind === 'wake' ? ' (wake-up)' : ''} ${clock(b.predictions.mia.start, b.tz)}–${clock(b.predictions.mia.end, b.tz)}` : '', b.predictions.huck?.available && !b.predictions.huck.expired ? `Mack (SweetSpot) ${clock(b.predictions.huck.time, b.tz)}` : ''].filter(Boolean);
    const stats = [['Slept yesterday', hm(y.sleep?.total), y.sleep ? `${hm(y.sleep.night)} night · ${y.sleep.naps} nap${y.sleep.naps === 1 ? '' : 's'}` : ''], ['Bottles yesterday', y.bottles?.count ? `${y.bottles.ounces} oz` : '—', y.bottles?.count ? `${y.bottles.count} bottles` : ''], ['7-day average', b.summary.avgOunces ? `${Math.round(b.summary.avgOunces * 10) / 10} oz` : '—', b.summary.avgSleep ? `${hm(b.summary.avgSleep)} sleep/day` : '']];
    const tiles = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${stats.map(([label, value, note]) => `<td style="width:33%;padding:10px 8px 10px 0;vertical-align:top"><div style="font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">${esc(label)}</div><div style="font:400 20px/1.3 Georgia,serif;color:${C.ink}">${esc(value)}</div><div style="font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">${esc(note)}</div></td>`).join('')}</tr></table>`;
    const awards = b.awards.length ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#fbf3df">${p(`<strong>🏆 Last week’s awards:</strong> ${b.awards.map(a => `${a.icon} ${esc(a.title)} <strong>${esc(a.value)}</strong>`).join(' · ')}`, 'margin:0;font-size:13px')}</div>` : '';
    sections.push(section('Little moments, big love', `${esc(b.name)} is ${esc(status)}`,
      (b.yesterday.story ? p(esc(storyText(b)), 'margin-bottom:10px') : '') + tiles + (nap.length ? p(`<strong>Next nap:</strong> ${esc(nap.join(' · '))}`, 'font-size:13px;margin-top:6px') : '')
      + (b.lastBottle ? p(small(`Last bottle ${esc(ago(b.lastBottle.start, now))} ago · ${esc(b.lastBottle.amount)} ${esc(b.lastBottle.units)}`)) : '')
      + (b.leader ? p(`🏆 <strong>${esc(b.leader.owner)}’s ${esc(b.leader.name)}</strong> leads the nap challenge · ±${b.leader.mae} min over ${b.leader.n} naps`, 'font-size:13px') : '')
      + (b.challenges?.morning || b.challenges?.bottle ? p(`🐾 ${[b.challenges.morning ? `<strong>${esc(b.challenges.morning)}</strong> leads the morning wake-up challenge` : '', b.challenges.bottle ? `<strong>${esc(b.challenges.bottle)}</strong> leads the Bottle Bet` : ''].filter(Boolean).join(' · ')}`, 'font-size:13px') : '')
      + (b.challenges?.bet?.hubert != null ? p(`🍼 <strong>Today’s Bottle Bet:</strong> Hubert ${b.challenges.bet.hubert} · Mia ${b.challenges.bet.mia} · Mack ${b.challenges.bet.mack} oz`, 'font-size:13px') : '') + awards));
  }

  if (d.world) sections.push(worldSection(d.world));

  // Around the house
  const house = [];
  if (d.chores.length) house.push(p(`<strong>To take care of:</strong> ${d.chores.slice(0, 6).map(c => `${esc(c.title)}${c.overdue ? ` ${small('(overdue)')}` : ''}`).join(' · ')}${d.chores.length > 6 ? ` +${d.chores.length - 6}` : ''}`, 'font-size:13px'));
  if (d.groceries) house.push(p(`🛒 <strong>${d.groceries}</strong> thing${d.groceries === 1 ? '' : 's'} on the grocery list.`, 'font-size:13px'));
  house.push(p(`📅 <strong>${d.week.plans}</strong> plan${d.week.plans === 1 ? '' : 's'} this week${d.week.busiest ? ` · busiest: ${esc(d.week.busiest.day.toLocaleDateString('en-US', { weekday:'long' }))}` : ''}.`, 'font-size:13px'));
  if (d.birthdays?.soon.length) house.push(p(`🎂 <strong>Birthdays this week:</strong> ${d.birthdays.soon.slice(0, 6).map(b => `${esc(b.name)}${b.age ? ` (${b.age})` : ''} ${small(esc(shortDate(new Date(`${b.date}T12:00:00`))))}`).join(' · ')}${d.birthdays.soon.length > 6 ? ` +${d.birthdays.soon.length - 6}` : ''}`, 'font-size:13px'));
  if (d.freeNights.length) house.push(p(`♡ <strong>Free nights for a date:</strong> ${d.freeNights.map(n => esc(shortDate(n))).join(' · ')}`, 'font-size:13px'));
  sections.push(section('Around the house', 'The week at a glance', house.join('')));

  // A little something
  const c = d.content;
  const extras = p(`<em style="font-family:Georgia,serif;font-size:16px">“${esc(c.quote)}”</em>`) + p(`✦ ${esc(c.fact)}`, 'font-size:13px') + p(`<strong>${esc(c.word.word)}</strong>${c.word.say ? ` ${small(`/${esc(c.word.say)}/`)}` : ''} ${small(esc(c.word.part))} — ${esc(c.word.definition)}`, 'font-size:13px')
    + `<div style="margin-top:12px;padding:12px 14px;border-radius:12px;background:#eeeaf6">${p(`<strong>Dad joke:</strong> ${esc(c.joke.setup)}`, 'margin:0 0 4px;font-size:13px')}${p(small(`↓ Punchline: <span style="color:${C.ink}">${esc(c.joke.punchline)}</span>`), 'margin:0')}</div>`
    + (d.afterDark ? `<div style="margin-top:8px;padding:12px 14px;border-radius:12px;background:#f3e6ea">${p(`<strong>🔞 After dark:</strong> ${esc(c.afterDark.setup)}`, 'margin:0 0 4px;font-size:13px')}${p(small(`↓ ${esc(c.afterDark.punchline)}`), 'margin:0')}</div>` : '');
  sections.push(section('A little something for today', 'Quote, fact, word & a laugh', extras));

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
<tr><td style="padding:4px 4px 18px"><div style="font:700 10px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.pink}">Hubert’s House · ${esc(longDate(d.now))}</div><div style="font:400 30px/1.2 Georgia,'Times New Roman',serif;color:${C.ink};margin-top:6px">${greeting}.</div></td></tr>
${sections.join('\n')}
${d.skipped?.length ? `<tr><td style="padding:0 4px 10px;text-align:center;font:12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}">Left out or older this time because a service was slow to answer: ${esc(d.skipped.map(key => SKIPPED_LABELS[key]).join(', '))}.</td></tr>` : ''}
<tr><td style="padding:8px 4px 0;text-align:center;font:12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${C.muted}"><a href="${APP_URL}" style="color:${C.accent};font-weight:600">Open Hubert’s House</a> · <a href="${APP_URL}/#settings" style="color:${C.muted}">Newsletter settings</a><br>Made for hanry, Karena, Frankie, Hubert, Mack & Mia.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${greeting.replace(/&#39;|&amp;/g, m => m === '&amp;' ? '&' : "'")}. ${longDate(d.now)}`, w ? `Weather: ${Math.round(w.high)}°/${Math.round(w.low)}° ${w.label || ''}${d.outlook?.length > 1 ? `\nThis week: ${d.outlook.slice(1).map(day => `${new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { weekday:'short' })} ${day.high == null ? '—' : Math.round(day.high)}°/${day.low == null ? '—' : Math.round(day.low)}°${day.rain != null && day.rain >= 30 ? ` ${Math.round(day.rain)}%` : ''}`).join(' · ')} (${WEATHER_URL})` : ''}` : '',
    d.birthdays?.today.length ? `${d.birthdays.today.map(b => b.title).join(' · ')} today!` : '',
    `Today: ${d.today.length ? d.today.map(e => `${e.allDay ? 'All day' : clock(e.start)} ${e.title}`).join('; ') : 'nothing planned'}`,
    d.baby ? (storyText(d.baby) || `${d.baby.name}: yesterday ${hm(d.baby.yesterday.sleep?.total)} sleep, ${d.baby.yesterday.bottles?.ounces ?? 0} oz`) : '',
    d.world?.headlines.length ? `Top headlines:\n${d.world.headlines.map(h => `• ${h.title} (${h.source}) ${h.link}`).join('\n')}` : '',
    d.world?.goodNews ? `Good news: ${d.world.goodNews.title} ${d.world.goodNews.link}` : '',
    d.world?.markets.length ? `Markets: ${d.world.markets.map(marketLine).join(' · ')}` : '',
    d.birthdays?.soon.length ? `Birthdays this week: ${d.birthdays.soon.map(b => `${b.name}${b.age ? ` (${b.age})` : ''} ${shortDate(new Date(`${b.date}T12:00:00`))}`).join(' · ')}` : '',
    `Dad joke: ${c.joke.setup} — ${c.joke.punchline}`, d.skipped?.length ? `Left out or older this time (slow to answer): ${d.skipped.map(key => SKIPPED_LABELS[key]).join(', ')}.` : '', APP_URL].filter(Boolean).join('\n\n');
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
