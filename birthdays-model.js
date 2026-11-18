// Birthdays from Apple Contacts: where they land on the calendar, Today and the
// morning email. No imports, so the newsletter can share it (scripts/share.mjs).
// A birthday is { name, month (1–12), day, year | null }.
const pad = n => String(n).padStart(2, '0');
const key = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
let list = [];
export const birthdayList = () => list;
export function setBirthdayList(value) { list = Array.isArray(value) ? value.filter(b => b && b.name && b.month >= 1 && b.month <= 12 && b.day >= 1 && b.day <= 31) : []; return list; }
export function birthdaysShown() { try { return globalThis.localStorage?.getItem('hh_birthdays') !== '0'; } catch { return true; } }
// Feb 29 birthdays fall on Feb 28 in other years.
const dayIn = (year, b) => new Date(year, b.month - 1, b.month === 2 && b.day === 29 && new Date(year, 1, 29).getMonth() !== 1 ? 28 : b.day);
export const birthdayTitle = (b, year) => `🎂 ${b.name}${b.year && year - b.year > 0 && year - b.year < 130 ? ` turns ${year - b.year}` : '’s birthday'}`;
// Every birthday on a day in [start, end), oldest year first.
export function birthdaysInRange(start, end, birthdays = list) {
  const from = new Date(start), to = new Date(end), out = [];
  from.setHours(0, 0, 0, 0);
  for (let year = from.getFullYear(); year <= to.getFullYear(); year++) for (const b of birthdays) {
    const date = dayIn(year, b);
    if (date >= from && date < to) out.push({ ...b, date:key(date), age:b.year ? year - b.year : null, title:birthdayTitle(b, year) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
export function birthdayEvents(start, end) {
  if (!birthdaysShown()) return [];
  return birthdaysInRange(start, end).map(b => {
    const next = new Date(`${b.date}T12:00:00`); next.setDate(next.getDate() + 1);
    return { id:`birthday:${b.date}:${b.name}`, title:b.title, start:b.date, end:key(next), allDay:true, editable:false, startEditable:false, durationEditable:false, extendedProps:{ holiday:true, birthday:true, name:b.name, age:b.age } }; // drawn like a holiday: not editable, not filtered by owner
  });
}
// For the email: today's birthdays and the rest of the coming week.
export function upcomingBirthdays(now = new Date(), days = 7, birthdays = list) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + days);
  const all = birthdaysInRange(today, end, birthdays), todayKey = key(today);
  return { today:all.filter(b => b.date === todayKey), soon:all.filter(b => b.date !== todayKey) };
}
