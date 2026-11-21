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
    async addMany(items) { data.push(...items.map(item=>({...item,id:crypto.randomUUID(),version:0})));emit(); },
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
// Sample favorites and one planned dinner for the Meals tab preview.
export function demoMealStore() {
  let notify;
  const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return dateKey(d); };
  let data = [
    { id:'m1', name:'Karena’s turkey chili', ingredients:['ground turkey', 'beans', 'diced tomatoes', 'onions', 'shredded cheese', 'sour cream'], steps:['Soften the onion in a little oil, 5 minutes.', 'Brown the turkey with a big spoon of chili powder and cumin.', 'Add the tomatoes and beans; simmer 30 minutes (longer is better).', 'Top with cheese and sour cream.'], minutes:45, favorite:true, plannedFor:day(0), lastMade:day(-16) },
    { id:'m2', name:'Sheet-pan salmon & broccoli', ingredients:['salmon', 'frozen broccoli', 'lemons', 'olive oil', 'rice'], favorite:true, plannedFor:'', lastMade:day(-5) },
    { id:'m3', name:'Taco Tuesday', ingredients:['ground beef', 'taco seasoning', 'tortillas', 'shredded cheese', 'salsa', 'sour cream'], favorite:true, plannedFor:'', lastMade:day(-12) },
    { id:'m4', name:'hanry’s famous pancakes', ingredients:['pancake mix', 'eggs', 'bacon', 'berries'], favorite:true, plannedFor:'', lastMade:'' }
  ].map(x => ({ version:0, ...x }));
  const emit = () => notify?.(structuredClone(data));
  const check = item => { const current = data.find(x => x.id === item.id); if (!current || current.version !== item.version) throw new Error('This dinner changed. Try again.'); return current; };
  return {
    subscribe(cb, status) { notify = cb; emit(); status?.(''); },
    async add(item) { const result = { ...item, id:crypto.randomUUID(), version:0 }; data.push(result); emit(); return result; },
    async update(item, patch) { const current = check(item); Object.assign(current, patch, { version:current.version + 1 }); emit(); return structuredClone(current); },
    async remove(item) { check(item); data = data.filter(x => x.id !== item.id); emit(); }
  };
}
// A slice of a real Publix weekly ad (BOGOs only), for the preview.
export const demoBogos = () => {
  const ends = new Date(Date.now() + 4 * 86400000).toISOString();
  return [['Smithfield Bacon', 'Meat', '$7.49'], ['Tyson Restaurant Style Chicken', 'Meat', '$9.99'], ['Hatfield Ham Steak', 'Meat', '$5.29'], ['Armour Meatballs', 'Meat', '$6.99'],
    ['Bertolli Sauce', 'Pantry', '$4.79'], ['Swanson Broth or Cooking Stock', 'Pantry', '$3.99'], ['Barilla Protein+ Pasta', 'Pantry', '$2.89'], ['Sargento Shredded Cheese', 'Dairy', '$4.99'],
    ['Daisy Sour Cream', 'Dairy', '$2.99'], ['Land O Lakes Butter', 'Dairy', '$6.49'], ['Birds Eye Vegetables', 'Frozen', '$7.79'], ['Toufayan Flatbread & Wraps', 'Deli', '$4.99'],
    ['Stonefire Naan Rounds', 'Deli', '$4.49'], ['Sabra Hummus', 'Deli', '$4.29'], ['Red Raspberries', 'Produce', '$5.99'], ['Fresh Attitude Salads', 'Produce', '$4.99'], ['Cheez-It Family Size Baked Snack Crackers', 'Snacks', '$6.29']]
    .map(([title, category, save]) => ({ title, category, save, detail:'', ends, image:null }));
};
