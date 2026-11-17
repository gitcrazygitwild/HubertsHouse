export const OWNERS = { both: 'Both', hanry: 'hanry', karena: 'Karena' };
export const CATEGORIES = ['Produce', 'Dairy & eggs', 'Bakery', 'Meat & fish', 'Pantry', 'Frozen', 'Household', 'Other'];
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Choose a valid date.');
  const d = new Date(`${day}T12:00:00`);
  if (isNaN(d) || dateKey(d) !== day) throw new Error('Choose a valid date.');
  return d;
}
export function nextDue(item, today = dateKey()) {
  const due = item.due || today;
  let d = parseDay(due);
  const anchor = item.anchorDay || d.getDate();
  let count = 0;
  do {
    if (item.cadence === 'daily') d.setDate(d.getDate() + 1);
    else if (item.cadence === 'weekly') d.setDate(d.getDate() + 7);
    else if (item.cadence === 'monthly') {
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
      d.setDate(Math.min(anchor, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    } else return due;
    if (++count > 50000) throw new Error('Please choose a more recent due date.');
  } while (dateKey(d) <= today);
  return dateKey(d);
}
export function completionPatch(item, now = new Date()) {
  if (item.kind === 'chore' && item.cadence !== 'none' && !item.completed) {
    return { due: nextDue(item, dateKey(now)), anchorDay: item.anchorDay || parseDay(item.due || dateKey(now)).getDate(), lastCompletedAt: now.toISOString(), completed: false };
  }
  return { completed: !item.completed, lastCompletedAt: item.completed ? null : now.toISOString() };
}
export function validateItem(data) {
  if (!['chore', 'task', 'grocery'].includes(data.kind)) throw new Error('Choose a list type.');
  const title = String(data.title || '').trim();
  if (!title || title.length > 180) throw new Error('Add a name under 180 characters.');
  if (data.due) parseDay(data.due);
  if (!Object.hasOwn(OWNERS, data.owner)) throw new Error('Choose a household member.');
  if (data.withFrankie !== undefined && typeof data.withFrankie !== 'boolean') throw new Error('Choose whether Frankie is coming along.');
  if (!['none', 'daily', 'weekly', 'monthly'].includes(data.cadence)) throw new Error('Choose a valid repeat schedule.');
  if (data.kind === 'chore' && data.cadence !== 'none' && !data.due) throw new Error('Choose a first due date for a repeating chore.');
  return { ...data, title };
}
export function dueLabel(item, today = dateKey()) {
  if (!item.due) return 'Anytime';
  if (item.due === today) return 'Today';
  if (item.due < today) return 'Overdue';
  const tomorrow = parseDay(today); tomorrow.setDate(tomorrow.getDate() + 1);
  return item.due === dateKey(tomorrow) ? 'Tomorrow' : parseDay(item.due).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function filterTaskItems(items, { timing = 'all', text = '', today = dateKey() } = {}) {
  const needle = text.trim().toLocaleLowerCase();
  return items.filter(item => {
    if (timing === 'today' && item.due !== today) return false;
    if (timing === 'overdue' && (item.completed || !item.due || item.due >= today)) return false;
    if (timing === 'anytime' && item.due) return false;
    return !needle || `${item.title} ${item.list || ''}`.toLocaleLowerCase().includes(needle);
  });
}

// Groceries added without an aisle get one guessed from the name ("oat milk" →
// Dairy & eggs). First match wins, so specific phrases come before single words.
const AISLES = [
  ['Frozen', /\b(frozen|ice cream|popsicles?|ice pops?|waffles? \(frozen\))\b/],
  ['Pantry', /\b(peanut butter|almond butter|coconut milk|cream of|baking (soda|powder)|bread ?crumbs|tomato (sauce|paste)|canned)\b/],
  ['Household', /\b(paper towels?|toilet paper|tissues?|detergent|dish ?soap|soap|sponges?|trash bags?|bin bags?|foil|plastic wrap|zip ?locs?|wipes|diapers?|shampoo|conditioner|toothpaste|toothbrush|deodorant|batteries|light ?bulbs?|litter|cat food|dog food|cat treats|bleach|cleaner|lotion|formula)\b/],
  ['Meat & fish', /\b(chicken|beef|pork|turkey|bacon|sausages?|salmon|tuna steaks?|fish|shrimp|prawns|steaks?|ham|lamb|ground meat|meatballs|hot dogs?|cod|tilapia)\b/],
  ['Dairy & eggs', /\b(milk|eggs?|cheese|cheddar|mozzarella|parmesan|yogh?urt|butter|cream|sour cream|half and half|creamer|kefir|cottage cheese)\b/],
  ['Bakery', /\b(bread|bagels?|buns?|rolls?|tortillas?|muffins?|croissants?|baguettes?|pitas?|naan|english muffins?|cake|cookies)\b/],
  ['Produce', /\b(apples?|bananas?|berries|strawberr(y|ies)|blueberr(y|ies)|raspberr(y|ies)|grapes?|oranges?|lemons?|limes?|peach(es)?|pears?|melons?|watermelon|pineapple|mango(es)?|avocados?|tomato(es)?|lettuce|spinach|kale|arugula|salad|cucumbers?|peppers?|onions?|garlic|potato(es)?|sweet potato(es)?|carrots?|celery|broccoli|cauliflower|zucchini|squash|mushrooms?|herbs?|cilantro|basil|parsley|mint|ginger|corn|green beans|asparagus|fruit|veg(gies|etables)?)\b/],
  ['Pantry', /\b(rice|pasta|noodles|spaghetti|cereal|oats?|oatmeal|granola|flour|sugar|coffee|tea|beans|lentils|chickpeas|sauce|salsa|oil|vinegar|spices?|salt|pepper|soup|broth|stock|peanuts?|nuts|almonds|snacks?|chips|crackers|pretzels|popcorn|honey|jam|jelly|syrup|ketchup|mustard|mayo|mayonnaise|dressing|chocolate|baby food|puffs|water|juice|soda|seltzer|wine|beer)\b/]
];
export function guessAisle(title = '') {
  const text = String(title).toLowerCase();
  return AISLES.find(([, pattern]) => pattern.test(text))?.[0] || 'Other';
}
