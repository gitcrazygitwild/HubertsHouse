import { dateKey } from './household-model.js';
export function demoStore() {
  let notify;
  const today = dateKey();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  let data = [
    { id: 'd1', kind: 'chore', title: 'Fresh sheets, fresh start', owner: 'both', cadence: 'weekly', due: today },
    { id: 'd2', kind: 'chore', title: 'Water the plants', owner: 'karena', cadence: 'weekly', due: today },
    { id: 'd3', kind: 'chore', title: 'Take out the recycling', owner: 'hanry', cadence: 'weekly', due: dateKey(tomorrow) },
    { id: 'd4', kind: 'task', title: 'Pick a place for date night', owner: 'both', cadence: 'none', due: '', list: 'Little plans' },
    { id: 'd5', kind: 'grocery', title: 'Oat milk', category: 'Dairy & eggs', quantity: '2 cartons' },
    { id: 'd6', kind: 'grocery', title: 'Avocados', category: 'Produce', quantity: '3 ripe ones' },
    { id: 'd7', kind: 'grocery', title: 'Sourdough', category: 'Bakery', quantity: '1 loaf' },
    { id: 'd8', kind: 'grocery', title: 'Coffee beans', category: 'Pantry', quantity: '1 bag' },
    { id: 'd9', kind: 'grocery', title: 'Something for Hubert', category: 'Household', quantity: '' }
  ].map(x => ({ completed: false, version: 0, owner: 'both', due: '', cadence: 'none', list: '', category: 'Other', quantity: '', ...x }));
  const emit = () => notify?.(structuredClone(data));
  const check = item => { const current = data.find(x => x.id === item.id); if (!current || current.version !== item.version) throw new Error('This item changed. Try again.'); return current; };
  return {
    subscribe(cb, status) { notify = cb; emit(); status('Sample data · changes last for this preview only'); },
    async add(item) { const result = { ...item, id: crypto.randomUUID(), version: 0 }; data.push(result); emit(); return result; },
    async update(item, patch) { const current = check(item); Object.assign(current, patch, { version: current.version + 1 }); emit(); return structuredClone(current); },
    async remove(item) { check(item); data = data.filter(x => x.id !== item.id); emit(); },
    async removeMany(list) { list.forEach(check); data = data.filter(x => !list.some(i => i.id === x.id)); emit(); }
  };
}
export function demoEvents() {
  function date(offset, hour) { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour,0,0,0); return d.toISOString(); }
  return [
    { id: 'sample1', title: 'A slow morning & the farmers’ market', start: date(0,10), end: date(0,12), owner: 'both', type: 'general' },
    { id: 'sample2', title: 'Dinner at our favorite place', start: date(0,19), end: date(0,21), owner: 'both', type: 'general' },
    { id: 'sample3', title: 'Coffee with a friend', start: date(1,11), end: date(1,12), owner: 'karena', type: 'general' },
    { id: 'sample4', title: 'A little time outside', start: date(2,16), end: date(2,17), owner: 'hanry', type: 'general' },
    { id: 'sample5', title: 'Yoga & a reset', start: date(2,8), end: date(2,9), owner: 'karena', type: 'general' },
    { id: 'sample6', title: 'Dinner together', start: date(1,18), end: date(1,20), owner: 'both', type: 'general' },
    { id: 'sample7', title: 'Dentist', start: date(3,9), end: date(3,10), owner: 'hanry', type: 'appointment' },
    { id: 'sample8', title: 'Movie night at home', start: date(4,19), end: date(4,21), owner: 'both', type: 'general' },
    { id: 'sample9', title: 'A weekend away', start: date(5,0), end: date(6,0), owner: 'both', type: 'trip', allDay: true },
    { id: 'sample10', title: 'Lunch with friends', start: date(7,12), end: date(7,14), owner: 'karena', type: 'party' },
    { id: 'sample11', title: 'Fresh air & a long walk', start: date(8,10), end: date(8,12), owner: 'hanry', type: 'general' },
    { id: 'sample12', title: 'Dinner with the family', start: date(11,17), end: date(11,20), owner: 'both', type: 'party' },
    { id: 'sample13', title: 'Date night', start: date(13,18), end: date(13,21), owner: 'both', type: 'general' }
  ].map(x => ({ allDay: false, checklist: [], notes: 'Sample event — preview only.', repeat: 'none', ...x }));
}
