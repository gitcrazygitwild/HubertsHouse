// Trash and recycling pickups: a household setting (householdSettings/home → trash), shown
// like bath nights on the calendar, on Today and in the morning email. Each stream has a
// weekday, how often (every week, every other week, or not at all) and, for every other
// week, a date it's known to come. A pickup that lands on a big holiday moves to the next
// workday. No imports, so the newsletter can share it. Dates are local calendar days.
export const DEFAULT_TRASH = { trash:{ day:1, every:1, anchor:'2026-11-23' }, recycling:{ day:1, every:2, anchor:'2026-11-23' }, bump:true };
export const PICKUP_LOOK = { trash:{ icon:'🗑️', name:'Trash' }, recycling:{ icon:'♻️', name:'Recycling' } };
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
export const keyOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const noon = key => new Date(`${key}T12:00:00`);
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

// ---------- Big holidays (observed: a Saturday holiday moves to Friday, a Sunday one to Monday) ----------
const nthWeekday = (year, month, weekday, n) => { const d = new Date(year, month, 1, 12); d.setDate(1 + ((weekday - d.getDay() + 7) % 7) + (n - 1) * 7); return d; };
const lastWeekday = (year, month, weekday) => { const d = new Date(year, month + 1, 0, 12); d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7)); return d; };
const observed = date => { const d = new Date(date); if (d.getDay() === 6) d.setDate(d.getDate() - 1); else if (d.getDay() === 0) d.setDate(d.getDate() + 1); return d; };
const memo = new Map();
export function bigHolidays(year) {
  if (!memo.has(year)) memo.set(year, new Map([
    [observed(new Date(year, 0, 1, 12)), 'New Year’s Day'], [lastWeekday(year, 4, 1), 'Memorial Day'], [observed(new Date(year, 6, 4, 12)), 'Independence Day'],
    [nthWeekday(year, 8, 1, 1), 'Labor Day'], [nthWeekday(year, 10, 4, 4), 'Thanksgiving'], [observed(new Date(year, 11, 25, 12)), 'Christmas']
  ].map(([d, name]) => [keyOf(d), name])));
  return memo.get(year);
}
export const holidayOn = date => { const d = new Date(date); return bigHolidays(d.getFullYear()).get(keyOf(d)) || bigHolidays(d.getFullYear() + 1).get(keyOf(d)) || null; };

// ---------- The setting ----------
const isKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00`));
function cleanStream(value, fallback) {
  if (!value || typeof value !== 'object') return { ...fallback };
  const day = Number.isInteger(value.day) && value.day >= 0 && value.day <= 6 ? value.day : fallback.day;
  const every = [0, 1, 2].includes(value.every) ? value.every : fallback.every;
  let anchor = isKey(value.anchor) ? value.anchor : fallback.anchor;
  // The known date must fall on the chosen weekday: move it forward to the next one.
  const a = noon(anchor); a.setDate(a.getDate() + ((day - a.getDay() + 7) % 7)); anchor = keyOf(a);
  return { day, every, anchor };
}
export function cleanTrash(value) {
  if (!value || typeof value !== 'object') return null;
  return { trash:cleanStream(value.trash, DEFAULT_TRASH.trash), recycling:cleanStream(value.recycling, DEFAULT_TRASH.recycling), bump:value.bump !== false };
}
let settings = cleanTrash(DEFAULT_TRASH);
export const trashSettings = () => settings;
export function setTrash(value) { settings = value == null ? cleanTrash(DEFAULT_TRASH) : cleanTrash(value) ?? cleanTrash(DEFAULT_TRASH); return settings; }

// ---------- Pickups ----------
const scheduled = (date, stream) => {
  if (!stream.every || date.getDay() !== stream.day) return false;
  if (stream.every === 1) return true;
  const weeks = Math.round((noon(keyOf(date)) - noon(stream.anchor)) / (7 * DAY));
  return ((weeks % stream.every) + stream.every) % stream.every === 0;
};
// Next workday on or after `date` that isn't a big holiday.
const workday = date => { let d = new Date(date); for (let i = 0; i < 7 && (d.getDay() === 0 || d.getDay() === 6 || holidayOn(d)); i++) d = addDays(d, 1); return d; };
// Every pickup day in [start, end): { date, kinds:['trash','recycling'], title, moved:{ from, holiday } | null }.
export function pickupsInRange(start, end, value = settings) {
  const s = cleanTrash(value) ?? cleanTrash(DEFAULT_TRASH), from = noon(keyOf(new Date(start))), to = new Date(end), byDay = new Map();
  for (let d = addDays(from, -7), guard = 0; d < to && guard < 900; d = addDays(d, 1), guard++) {
    for (const kind of ['trash', 'recycling']) {
      if (!scheduled(d, s[kind])) continue;
      const holiday = s.bump ? holidayOn(d) : null, when = holiday ? workday(addDays(d, 1)) : d, key = keyOf(when);
      const entry = byDay.get(key) || { date:key, kinds:[], moved:null };
      if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
      if (holiday) entry.moved = { from:keyOf(d), holiday };
      byDay.set(key, entry);
    }
  }
  const startKey = keyOf(new Date(start));
  return [...byDay.values()].filter(e => e.date >= startKey && noon(e.date) < to).sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ ...e, title:pickupTitle(e.kinds) }));
}
export function pickupTitle(kinds) {
  const list = ['trash', 'recycling'].filter(k => kinds.includes(k));
  return list.length === 2 ? '🗑️ Trash & ♻️ recycling' : list.length ? `${PICKUP_LOOK[list[0]].icon} ${PICKUP_LOOK[list[0]].name}` : '';
}
// All-day calendar markers, drawn like holidays: not editable, not filtered by owner.
export function trashEvents(start, end, value = settings) {
  return pickupsInRange(start, end, value).map(p => ({ id:`trash:${p.date}`, title:p.title, start:p.date, end:keyOf(addDays(noon(p.date), 1)), allDay:true, editable:false, startEditable:false, durationEditable:false, extendedProps:{ holiday:true, trash:true, moved:p.moved } }));
}
// The pickup on `date`, or null.
export const pickupOn = (date = new Date(), value = settings) => pickupsInRange(new Date(date), addDays(noon(keyOf(new Date(date))), 1), value)[0] || null;
// The next pickup from `now` (today counts): { ...pickup, label:'Today' | 'Tomorrow' | 'Monday' }.
export function nextPickup(now = new Date(), value = settings) {
  const today = noon(keyOf(new Date(now))), next = pickupsInRange(today, addDays(today, 22), value)[0];
  if (!next) return null;
  const days = Math.round((noon(next.date) - today) / DAY);
  return { ...next, label:days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : noon(next.date).toLocaleDateString('en-US', { weekday:'long' }) };
}
export function describeTrash(value = settings) {
  const s = cleanTrash(value) ?? cleanTrash(DEFAULT_TRASH), names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const one = (kind) => { const x = s[kind]; return x.every ? `${PICKUP_LOOK[kind].name} ${x.every === 1 ? 'every' : 'every other'} ${names[x.day]}` : `No ${PICKUP_LOOK[kind].name.toLowerCase()} pickup`; };
  return `${one('trash')} · ${one('recycling')}${s.bump ? ' · moves to the next workday after a big holiday' : ''}`;
}
