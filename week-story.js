// "Frankie's week": the last seven full days as a few story cards (big number, one line,
// a little chart), plus the Weekly Awards, plus a plain-text version to share with family.
// Pure: weekStory(snapshot, timezone, now) → { from, to, slides }.
import { dailySleep, dailyBottles, dayStart } from './baby-history.js';
import { frankieAwards } from './awards.js';
import { ageLabel, ageInDays } from './baby-model.js';

const hm = hours => { const m = Math.round(hours * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const round1 = n => Math.round(n * 10) / 10;
const weekday = (key, timezone, style = 'short') => new Date(dayStart(key, timezone) + 12 * 3600000).toLocaleDateString('en-US', { weekday:style, timeZone:timezone });
const dateOf = (key, timezone) => new Date(dayStart(key, timezone) + 12 * 3600000).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:timezone });
const change = (now, before, unit, fmt = n => `${round1(n)} ${unit}`) => {
  if (before == null || !Number.isFinite(before)) return '';
  const d = now - before; if (Math.abs(d) < (unit === 'h' ? 1 / 6 : 0.25)) return 'about the same as the week before';
  return `${unit === 'h' ? hm(Math.abs(d)) : fmt(Math.abs(d))} ${d > 0 ? 'more' : 'less'} a day than the week before`;
};

export function weekStory(snapshot = {}, timezone = 'America/New_York', now = Date.now()) {
  const name = snapshot.name || 'Frankie', sleeps = snapshot.sleeps || [], bottles = snapshot.bottles || [];
  const sleepRows = dailySleep(sleeps, timezone, 15, now).slice(0, 14), bottleRows = dailyBottles(bottles, timezone, 15, now).slice(0, 14);
  const week = sleepRows.slice(7), before = sleepRows.slice(0, 7).filter(r => r.total > 0);
  const bottleWeek = bottleRows.slice(7), bottleBefore = bottleRows.slice(0, 7).filter(r => r.count);
  const logged = week.filter(r => r.total > 0), fed = bottleWeek.filter(r => r.count);
  if (logged.length < 3 && fed.length < 3) return { available:false, reason:`${name}’s week appears after a few days of logs.` };
  const from = week[0].key, to = week.at(-1).key, slides = [];
  const age = snapshot.birthdate ? ageLabel(ageInDays(snapshot.birthdate, new Date(now))) : '';
  slides.push({ kind:'intro', tone:'dawn', eyebrow:`${name.toUpperCase()}’S WEEK`, big:`${dateOf(from, timezone)} – ${dateOf(to, timezone)}`, line:'Seven days of naps, bottles and very big yawns.', sub:age ? `${name} is ${age}.` : '' });
  if (logged.length >= 3) {
    const total = logged.reduce((s, r) => s + r.total, 0), perDay = total / logged.length, prior = before.length >= 3 ? before.reduce((s, r) => s + r.total, 0) / before.length : null;
    const best = [...logged].sort((a, b) => b.total - a.total)[0];
    slides.push({ kind:'sleep', tone:'night', eyebrow:'SHE SLEPT', big:`${Math.round(total)}`, unit:'hours', line:`That’s ${hm(perDay)} a day.`, sub:change(perDay, prior, 'h'),
      bars:week.map(r => ({ label:weekday(r.key, timezone).slice(0, 2), value:round1(r.total), highlight:r.key === best.key })), barUnit:'h', note:`Sleepiest day: ${weekday(best.key, timezone, 'long')}, ${hm(best.total)}.` });
    const nightAvg = logged.reduce((s, r) => s + r.night, 0) / logged.length, naps = logged.reduce((s, r) => s + r.naps, 0), napHours = logged.reduce((s, r) => s + r.nap, 0);
    const bestNight = [...logged].sort((a, b) => b.night - a.night)[0];
    slides.push({ kind:'nights', tone:'dusk', eyebrow:'A TYPICAL NIGHT', big:hm(nightAvg), line:`Her best night was ${weekday(bestNight.key, timezone, 'long')}: ${hm(bestNight.night)}.`, sub:naps ? `Plus ${naps} nap${naps === 1 ? '' : 's'} this week, ${hm(napHours / naps)} each on average.` : '' });
  }
  if (fed.length >= 3) {
    const oz = fed.reduce((s, r) => s + r.ounces, 0), count = fed.reduce((s, r) => s + r.count, 0), perDay = oz / fed.length;
    const prior = bottleBefore.length >= 3 ? bottleBefore.reduce((s, r) => s + r.ounces, 0) / bottleBefore.length : null, top = [...fed].sort((a, b) => b.ounces - a.ounces)[0];
    slides.push({ kind:'bottles', tone:'milk', eyebrow:'SHE DRANK', big:`${Math.round(oz)}`, unit:'ounces', line:`${round1(perDay)} oz a day, over ${count} bottles.`, sub:change(perDay, prior, 'oz'),
      bars:bottleWeek.map(r => ({ label:weekday(r.key, timezone).slice(0, 2), value:r.ounces, highlight:r.key === top.key })), barUnit:'oz', note:`About ${round1(oz / 33.8)} liters, or ${Math.round(oz / 12)} soda cans.` });
  }
  const tones = ['gold', 'night', 'milk', 'dusk'];
  for (const [i, award] of frankieAwards(snapshot, timezone, now).awards.filter(a => a.title !== 'Milk Mileage').entries()) slides.push({ kind:'award', tone:tones[i % tones.length], eyebrow:award.title.toUpperCase(), icon:award.icon, big:award.value, line:award.detail });
  slides.push({ kind:'outro', tone:'dawn', eyebrow:'THAT’S A WRAP', icon:'🐾', big:`Go, ${name}!`, line:'Send her week to the family?' });
  return { available:true, name, from, to, slides };
}

// The same week, as a text message.
export function weekStoryText(story) {
  if (!story?.available) return '';
  const lines = [`${story.name}’s week 🐾 (${story.slides[0].big})`];
  for (const s of story.slides) {
    if (s.kind === 'sleep') lines.push(`😴 Slept ${s.big} hours (${s.line.replace('That’s ', '').replace('.', '')})`);
    if (s.kind === 'nights') lines.push(`🌙 A typical night: ${s.big}. ${s.line}`);
    if (s.kind === 'bottles') lines.push(`🍼 Drank ${s.big} oz: ${s.line}`);
    if (s.kind === 'award') lines.push(`${s.icon} ${s.eyebrow[0]}${s.eyebrow.slice(1).toLowerCase()}: ${s.big} (${s.line})`);
  }
  lines.push('— from Hubert’s House');
  return lines.join('\n');
}
