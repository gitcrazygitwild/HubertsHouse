// Natural-language quick add: "Pediatrician Tue 3pm with Frankie" becomes an
// event draft. The draft always opens in the editor, so nothing saves unseen.
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const dayAlias = { sun:0, mon:1, tue:2, tues:2, wed:3, weds:3, thu:4, thur:4, thurs:4, fri:5, sat:6 };
const monthAlias = Object.fromEntries(MONTHS.map((m, i) => [m.slice(0, 3), i]).concat([['sept', 8]]));
const PARTS = { morning:9, afternoon:14, evening:18, tonight:19, noon:12, midnight:0, lunch:12, dinner:18, breakfast:8 };

function to24(hour, minute, meridiem, context) {
  let h = Number(hour) % 24; const m = Number(minute || 0);
  if (meridiem) { const pm = meridiem.startsWith('p'); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  else if (context === 'evening' && h < 12) h += 12;
  else if (!meridiem && h >= 1 && h <= 6) h += 12; // "at 3" means 3pm for household plans
  return { h, m };
}

export function parseQuickAdd(text, now = new Date()) {
  let rest = ` ${String(text || '').trim()} `;
  // Cut the match out at its own position (not the first look-alike substring).
  const take = pattern => { const match = rest.match(pattern); if (match) rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`; return match; };
  const result = { owner:'both', withFrankie:false, allDay:false, recognized:[] };

  // People
  if (take(/\b(?:with |\+ ?|and )?frankie\b/i)) { result.withFrankie = true; result.recognized.push('Frankie'); }
  const karena = /\b(?:for |with )?karena\b/i.test(rest), hanry = /\b(?:for |with )?h(?:a|e)nry\b/i.test(rest);
  if (karena && !hanry) { result.owner = 'karena'; take(/\b(?:for )?karena\b/i); result.recognized.push('Karena'); }
  else if (hanry && !karena) { result.owner = 'hanry'; take(/\b(?:for )?h(?:a|e)nry\b/i); result.recognized.push('hanry'); }
  else if (take(/\b(?:together|both of us|both)\b/i) || (karena && hanry)) { take(/\b(?:and )?karena\b/i); take(/\b(?:and )?h(?:a|e)nry\b/i); result.recognized.push('Together'); }

  // Date
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  let date = null, context = null, match;
  if ((match = take(/\b(today|tonight|this (?:morning|afternoon|evening))\b/i))) { date = new Date(day); const word = match[1].toLowerCase(); context = word === 'tonight' ? 'tonight' : word.split(' ')[1] || null; }
  else if ((match = take(/\b(tomorrow|tmrw|tmr)(?: (morning|afternoon|evening|night))?\b/i))) { date = new Date(day); date.setDate(date.getDate() + 1); context = match[2]?.toLowerCase() === 'night' ? 'tonight' : match[2]?.toLowerCase() || null; }
  else if ((match = take(/\b(?:on )?(next |this )?(sun|mon|tues?|wed(?:s|nes)?|thu(?:rs?)?|thurs|fri|sat)(?:day|sday|nesday|urday|rsday)?\b(?: (morning|afternoon|evening|night))?/i))) {
    const key = match[2].toLowerCase().slice(0, match[2].toLowerCase().startsWith('thu') ? 4 : 3), target = dayAlias[key] ?? dayAlias[match[2].toLowerCase()];
    date = new Date(day); let diff = (target - date.getDay() + 7) % 7; if (match[1]?.trim().toLowerCase() === 'next' && diff < 7) diff += diff === 0 ? 7 : 7;
    date.setDate(date.getDate() + diff); context = match[3]?.toLowerCase() === 'night' ? 'tonight' : match[3]?.toLowerCase() || null;
  }
  else if ((match = take(/\b(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    date = new Date(day); date.setMonth(Number(match[1]) - 1, Number(match[2]));
    if (match[3]) date.setFullYear(Number(match[3].length === 2 ? `20${match[3]}` : match[3])); else if (date < day) date.setFullYear(date.getFullYear() + 1);
  }
  else if ((match = take(/\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/i))) {
    date = new Date(day); date.setMonth(monthAlias[match[1].toLowerCase()], Number(match[2])); if (date < day) date.setFullYear(date.getFullYear() + 1);
  }
  else if ((match = take(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/i))) { date = new Date(day); date.setDate(Number(match[1])); if (date < day) date.setMonth(date.getMonth() + 1); }
  else if ((match = take(/\bin (\d{1,2}) (day|week)s?\b/i))) { date = new Date(day); date.setDate(date.getDate() + Number(match[1]) * (match[2].toLowerCase() === 'week' ? 7 : 1)); }

  // Time and duration
  let start = null, end = null;
  const range = take(/\b(?:from |at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)? ?(?:-|–|to|until|til) ?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)\b/i);
  if (range) {
    const endTime = to24(range[4], range[5], range[6], context), startTime = to24(range[1], range[2], range[3] || (Number(range[1]) <= Number(range[4]) || Number(range[1]) === 12 ? range[6] : null), context);
    start = startTime; end = endTime;
  } else if ((match = take(/\b(?:at |@ ?)?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.|a|p)\b/i)) || (match = take(/\b(?:at |@ ?)(\d{1,2})(?::(\d{2}))?\b/i)) || (match = take(/\b(\d{1,2}):(\d{2})\b/))) {
    start = to24(match[1], match[2], match[3]?.replaceAll('.', '').toLowerCase(), context);
  } else if ((match = take(/\b(?:at )?(noon|midnight)\b/i))) start = { h:PARTS[match[1].toLowerCase()], m:0 };
  else if ((match = rest.match(/\b(breakfast|lunch|dinner)\b/i)) && date) start = { h:PARTS[match[1].toLowerCase()], m:0 };
  else if (context) start = { h:PARTS[context], m:0 };
  let minutes = 60;
  if ((match = take(/\bfor (\d+(?:\.\d+)?|an?|half an) ?(hours?|hrs?|h|minutes?|mins?|m)\b/i))) {
    const amount = /^an?$/i.test(match[1]) ? 1 : /half/i.test(match[1]) ? .5 : Number(match[1]);
    minutes = /^h/i.test(match[2]) ? amount * 60 : amount;
  }
  if (!date && !start) return null;
  if (!date) { date = new Date(day); if (start && (start.h * 60 + start.m) <= now.getHours() * 60 + now.getMinutes()) date.setDate(date.getDate() + 1); }
  if (start) {
    result.start = new Date(date); result.start.setHours(start.h, start.m, 0, 0);
    if (end) { result.end = new Date(date); result.end.setHours(end.h, end.m, 0, 0); if (result.end <= result.start) result.end.setDate(result.end.getDate() + 1); }
    else result.end = new Date(+result.start + minutes * 60000);
  } else { result.allDay = true; result.start = new Date(date); result.end = new Date(date); }
  const title = rest.replace(/\s+/g, ' ').replace(/^\s*(?:at|on|with|for|from|and|-|,)\s+/i, '').replace(/\s+(?:at|on|with|for|from|and|-|,)\s*$/i, '').trim();
  result.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : 'New plan';
  const lower = result.title.toLowerCase();
  result.type = /doctor|dentist|pediatric|appointment|appt|checkup|vet\b|vaccin/.test(lower) ? 'appointment' : /trip|vacation|flight|getaway/.test(lower) ? 'trip' : /party|birthday|wedding|shower/.test(lower) ? 'party' : 'general';
  return result;
}

export function describeDraft(draft, locale) {
  if (!draft) return '';
  const date = draft.start.toLocaleDateString(locale, { weekday:'short', month:'short', day:'numeric' });
  const time = draft.allDay ? 'All day' : `${draft.start.toLocaleTimeString(locale, { hour:'numeric', minute:'2-digit' })} – ${draft.end.toLocaleTimeString(locale, { hour:'numeric', minute:'2-digit' })}`;
  const who = { both:'Together', hanry:'hanry', karena:'Karena' }[draft.owner];
  return `${draft.title} · ${date} · ${time} · ${who}${draft.withFrankie ? ' + Frankie' : ''}`;
}

// ---------- Frankie logs in plain words ----------
// "frankie bottle 10:30am 4oz", "frankie diaper wet", "frankie nap 1-2:15pm",
// "frankie fell asleep 9:40", "frankie woke up". Only text that names Frankie
// (or "baby") AND a log word is treated as a log, so "Frankie swim class Tue
// 3pm" stays a calendar event.
const WHO = /\b(frankie|frankies|frankie's|baby)\b|🍼/i;
const LOG_WORDS = { bottle:/\b(bottles?|fed|feeds?|feeding|ounces?|oz|ml)\b|\d\s?(oz|ml)\b|🍼/i, diaper:/\b(diapers?|nappy|changed?|poo+p?y?|pee|wet|dirty|dry|blowout)\b/i, sleep:/\b(nap|napped|naps|slept|sleep|sleeping|asleep|woke|wakes?|awake|down for)\b/i };
const MILK = [[/\bformula\b/i, 'Formula'], [/\b(breast ?milk|breast|bm|pumped|expressed)\b/i, 'Breast Milk'], [/\bcow'?s?( milk)?\b/i, 'Cow Milk'], [/\bsoy\b/i, 'Soy Milk']];
// Logs are about the past: pick the most recent matching moment at or before
// now (+5 min of slack). Without am/pm, both 3:15am and 3:15pm are candidates.
function clockToDate(hour, minute, meridiem, now) {
  let h = Number(hour) % 24; const m = Number(minute || 0);
  if (meridiem) { const pm = /^p/i.test(meridiem); h = h % 12 + (pm ? 12 : 0); }
  const hours = !meridiem && h >= 1 && h < 12 ? [h, h + 12] : [h];
  const limit = +now + 5 * 60000, candidates = [];
  for (const dayOffset of [0, -1]) for (const value of hours) { const date = new Date(now); date.setDate(date.getDate() + dayOffset); date.setHours(value, m, 0, 0); if (+date <= limit) candidates.push(date); }
  return candidates.sort((x, y) => y - x)[0];
}
export function parseBabyLog(text, now = new Date()) {
  const raw = String(text || '');
  if (!WHO.test(raw)) return null;
  const kind = LOG_WORDS.diaper.test(raw) && !LOG_WORDS.bottle.test(raw) ? 'diaper' : LOG_WORDS.bottle.test(raw) ? 'bottle' : LOG_WORDS.diaper.test(raw) ? 'diaper' : LOG_WORDS.sleep.test(raw) ? 'sleep' : null;
  if (!kind) return null;
  let rest = ` ${raw} `;
  const take = pattern => { const match = rest.match(pattern); if (match) rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`; return match; };
  const result = { kind, start:new Date(now), recognized:[] };
  // Amount first, so "4oz" is never read as a time.
  const amount = take(/(\d+(?:\.\d+)?)\s?(oz|ounces?|ml)\b/i);
  if (amount) { result.amount = Number(amount[1]); result.units = /^ml$/i.test(amount[2]) ? 'ml' : 'oz'; }
  const duration = take(/\bfor (\d+(?:\.\d+)?|an?|half an) ?(hours?|hrs?|h|minutes?|mins?|m)\b/i) || (kind === 'sleep' ? take(/\b(\d+(?:\.\d+)?) ?(hours?|hrs?|h|minutes?|mins?|m)\b(?! ago)/i) : null);
  const minutes = duration ? (/^h/i.test(duration[2]) ? (/^an?$/i.test(duration[1]) ? 1 : /half/i.test(duration[1]) ? .5 : Number(duration[1])) * 60 : Number(duration[1])) : null;
  let start = null, end = null, match;
  if ((match = take(/\b(?:from )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)? ?(?:-|–|to|until|til) ?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)?\b/i))) {
    end = clockToDate(match[4], match[5], match[6], now);
    start = clockToDate(match[1], match[2], match[3] || (!match[3] && match[6] && Number(match[1]) <= Number(match[4]) ? match[6] : null), now);
    if (start >= end) start.setDate(start.getDate() - 1);
  } else if ((match = take(/\b(\d+|an?|half an) ?(hours?|hrs?|h|minutes?|mins?|m) ago\b/i))) {
    const amountAgo = /^an?$/i.test(match[1]) ? 1 : /half/i.test(match[1]) ? .5 : Number(match[1]);
    start = new Date(+now - amountAgo * (/^h/i.test(match[2]) ? 3600000 : 60000));
  } else if ((match = take(/\b(?:at |@ ?)?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.|a|p)\b/i)) || (match = take(/\b(?:at |@ ?)(\d{1,2})(?::(\d{2}))?\b/i)) || (match = take(/\b(\d{1,2}):(\d{2})\b/))) {
    start = clockToDate(match[1], match[2], match[3]?.replaceAll('.', ''), now);
  } else if (take(/\bjust now\b|\bnow\b/i)) start = new Date(now);
  if (start) result.start = start;
  if (kind === 'bottle') {
    const milk = MILK.find(([pattern]) => pattern.test(raw)); if (milk) result.bottleType = milk[1];
    if (!amount && (match = rest.match(/\bbottle (?:of )?(\d+(?:\.\d+)?)\b/i)) && Number(match[1]) <= 12) { result.amount = Number(match[1]); result.units = 'oz'; }
  }
  if (kind === 'diaper') {
    const dirty = /\b(poo+p?y?|dirty|blowout|bm)\b/i.test(raw), wet = /\b(pee|wet)\b/i.test(raw);
    result.mode = /\bboth\b/i.test(raw) || (dirty && wet) ? 'both' : dirty ? 'poo' : /\bdry\b/i.test(raw) ? 'dry' : wet ? 'pee' : null;
  }
  if (kind === 'sleep') {
    if (end) { result.kind = 'sleep-log'; result.end = end; }
    else if (minutes) { result.kind = 'sleep-log'; if (start) result.end = new Date(+result.start + minutes * 60000); else { result.end = new Date(now); result.start = new Date(+now - minutes * 60000); } }
    else if (/\b(woke|wakes?|awake|up from)\b/i.test(raw)) result.kind = 'sleep-stop';
    else if (/\b(asleep|down for|went down|sleeping|nap(?:ping)? now|fell)\b/i.test(raw) || !start) result.kind = 'sleep-start';
    else result.kind = 'sleep-start';
  }
  return result;
}
export function describeBabyLog(log, locale) {
  if (!log) return '';
  const at = date => date.toLocaleTimeString(locale, { hour:'numeric', minute:'2-digit' });
  const label = { bottle:'🍼 Bottle', diaper:'♡ Diaper', 'sleep-log':'☾ Finished sleep', 'sleep-start':'☾ Fell asleep', 'sleep-stop':'☀ Woke up' }[log.kind];
  const detail = log.kind === 'bottle' ? (log.amount ? `${log.amount} ${log.units}${log.bottleType ? ` ${log.bottleType}` : ''}` : `same as last bottle${log.bottleType ? ` · ${log.bottleType}` : ''}`)
    : log.kind === 'diaper' ? ({ pee:'Wet', poo:'Dirty', both:'Wet + dirty', dry:'Dry' }[log.mode] || 'choose wet or dirty')
    : log.kind === 'sleep-log' ? `${at(log.start)} – ${at(log.end)} · ${Math.round((log.end - log.start) / 60000)} min` : '';
  return `${label} for Frankie · ${log.kind === 'sleep-log' ? '' : `${at(log.start)}${detail ? ' · ' : ''}`}${detail}`.replace(/ · $/, '');
}
