// Meal planning for Life → Meals: the household's saved favorites first, then dinner
// ideas built around this week's Publix BOGOs and what's already on the grocery list.
// Pure: no DOM, no network.
import { dateKey, guessAisle } from './household-model.js';

// A starter library of weeknight dinners. Ingredient names double as grocery items.
export const IDEAS = [
  { name:'Chicken parmesan', ingredients:['chicken breasts', 'pasta sauce', 'shredded mozzarella', 'parmesan', 'breadcrumbs', 'pasta'] },
  { name:'Baked ziti', ingredients:['pasta', 'pasta sauce', 'ricotta', 'shredded mozzarella', 'parmesan', 'ground beef'] },
  { name:'Spaghetti & meatballs', ingredients:['pasta', 'pasta sauce', 'meatballs', 'parmesan', 'garlic bread'] },
  { name:'Meatball subs', ingredients:['meatballs', 'pasta sauce', 'sub rolls', 'shredded mozzarella', 'salad kit'] },
  { name:'Sheet-pan sausage & veggies', ingredients:['smoked sausage', 'potatoes', 'bell peppers', 'onions', 'olive oil'] },
  { name:'Chicken tacos', ingredients:['chicken thighs', 'tortillas', 'salsa', 'shredded cheese', 'sour cream', 'lettuce', 'limes'] },
  { name:'Beef tacos', ingredients:['ground beef', 'taco seasoning', 'tortillas', 'shredded cheese', 'sour cream', 'lettuce', 'tomatoes'] },
  { name:'Chicken quesadillas', ingredients:['rotisserie chicken', 'tortillas', 'shredded cheese', 'salsa', 'sour cream'] },
  { name:'Breakfast for dinner', ingredients:['eggs', 'bacon', 'pancake mix', 'butter', 'berries'] },
  { name:'Chicken pot pie', ingredients:['rotisserie chicken', 'frozen vegetables', 'cream of chicken soup', 'pie crust', 'chicken broth'] },
  { name:'Cheesy chicken, broccoli & rice', ingredients:['chicken breasts', 'rice', 'frozen broccoli', 'cheddar', 'chicken broth'] },
  { name:'Honey garlic salmon', ingredients:['salmon', 'honey', 'garlic', 'rice', 'green beans'] },
  { name:'Shrimp scampi', ingredients:['shrimp', 'pasta', 'butter', 'garlic', 'lemon juice', 'parmesan'] },
  { name:'Naan pizzas', ingredients:['naan', 'pasta sauce', 'shredded mozzarella', 'pepperoni', 'salad kit'] },
  { name:'Homemade pizza night', ingredients:['pizza dough', 'pasta sauce', 'shredded mozzarella', 'pepperoni'] },
  { name:'Ham & cheese crescent bake', ingredients:['crescent rolls', 'ham steak', 'shredded cheese', 'eggs', 'frozen broccoli'] },
  { name:'Burgers & oven fries', ingredients:['ground beef', 'buns', 'cheese singles', 'frozen fries', 'pickles', 'lettuce'] },
  { name:'Turkey chili', ingredients:['ground turkey', 'beans', 'diced tomatoes', 'onions', 'chili seasoning', 'shredded cheese', 'sour cream'] },
  { name:'Chicken noodle soup', ingredients:['chicken breasts', 'egg noodles', 'carrots', 'celery', 'chicken broth', 'dinner rolls'] },
  { name:'Pork chops & mashed potatoes', ingredients:['pork chops', 'potatoes', 'butter', 'green beans', 'gravy mix'] },
  { name:'Teriyaki chicken bowls', ingredients:['chicken thighs', 'teriyaki sauce', 'rice', 'frozen vegetables'] },
  { name:'Mediterranean chicken plates', ingredients:['chicken thighs', 'hummus', 'pita bread', 'cucumbers', 'tomatoes', 'feta'] },
  { name:'BLTs & soup', ingredients:['bacon', 'bread', 'lettuce', 'tomatoes', 'mayonnaise', 'tomato soup'] },
  { name:'Grown-up ramen', ingredients:['ramen', 'eggs', 'frozen vegetables', 'green onions', 'chicken broth'] },
  { name:'Chicken Caesar wraps', ingredients:['rotisserie chicken', 'tortillas', 'romaine', 'caesar dressing', 'parmesan'] },
  { name:'Stuffed peppers', ingredients:['bell peppers', 'ground beef', 'rice', 'pasta sauce', 'shredded cheese'] },
  { name:'Sloppy joes', ingredients:['ground beef', 'buns', 'sloppy joe sauce', 'coleslaw mix'] },
  { name:'Lemon roast chicken & potatoes', ingredients:['whole chicken', 'potatoes', 'carrots', 'lemons', 'butter'] },
  { name:'Pesto pasta with chicken', ingredients:['pasta', 'pesto', 'chicken breasts', 'cherry tomatoes', 'parmesan'] },
  { name:'Ham fried rice', ingredients:['rice', 'eggs', 'frozen vegetables', 'ham steak', 'soy sauce'] },
  { name:'Nuggets & mac night', ingredients:['chicken nuggets', 'mac and cheese', 'frozen vegetables'] },
  { name:'Baked potato bar', ingredients:['potatoes', 'bacon', 'shredded cheese', 'sour cream', 'butter', 'frozen broccoli'] },
  { name:'Grilled cheese & tomato soup', ingredients:['bread', 'cheddar', 'butter', 'tomato soup'] },
  { name:'Cheese board dinner', ingredients:['brie', 'crackers', 'salami', 'grapes', 'hummus'] }
];
// Things most kitchens already have: shown, but not added to the list automatically.
export const STAPLES = new Set(['olive oil', 'garlic', 'honey', 'soy sauce', 'salt', 'pepper', 'butter']);

// How an ingredient shows up in Publix deal names. Anything not listed matches by its own name.
const TERMS = {
  'pasta sauce':/\b(pasta sauce|marinara|bertolli sauce|rao s|prego|ragu|botticelli)\b/,
  pasta:/^(?!.*\bsauce\b).*\b(pasta|spaghetti|penne|rigatoni|linguine|fettuccine|ziti)\b/,
  'chicken broth':/\b(broth|cooking stock|chicken stock)\b/,
  'shredded mozzarella':/\b(shredded|mozzarella)\b/, 'shredded cheese':/\bshredded\b/, cheddar:/\bcheddar\b/,
  parmesan:/\b(parmesan|parmigiano|pecorino|romano)\b/, 'cheese singles':/\b(singles|american cheese)\b/,
  'frozen vegetables':/\b(birds eye|frozen vegetables|steamfresh)\b/, 'frozen broccoli':/\b(broccoli|birds eye)\b/,
  'green beans':/\b(green beans|del monte vegetables)\b/,
  tortillas:/\b(tortillas?|wraps|flatbread)\b/, 'pita bread':/^(?!.*\bchips\b).*\bpitas?\b/,
  'chicken breasts':/^(?!.*\b(breaded|nuggets|tenders|strips)\b).*\bchicken breasts?\b/, 'chicken nuggets':/\b(nuggets|chicken tenders)\b/,
  'chicken thighs':/\bchicken thighs?\b/, 'rotisserie chicken':/\b(rotisserie|restaurant style chicken)\b/,
  'ham steak':/\bham\b/, 'smoked sausage':/\b(smoked sausage|kielbasa)\b/,
  potatoes:/^(?!.*\b(chips|crisps|rolls)\b).*\bpotato(es)?\b/, rice:/^(?!.*\b(snacks?|cakes?|crisp|krispies|treats)\b).*\brice\b/,
  tomatoes:/^(?!.*\b(cocktail|juice|soup|sauce|paste|ketchup|clamato)\b).*\btomato(es)?\b/, 'cherry tomatoes':/\b(cherry|grape) tomato(es)?\b/,
  garlic:/^(?!.*\b(dip|spread|bread|sauce)\b).*\bgarlic\b/, honey:/^(?!.*\b(comb|nut|ham|mustard)\b).*\bhoney\b/, lemons:/^(?!.*\bjuice\b).*\blemons?\b/,
  bread:/^(?!.*\bcrumbs?\b).*\bbread\b/, 'dinner rolls':/\b(dinner rolls|brioche rolls|potato rolls)\b/, 'sub rolls':/\b(sub rolls|hoagie)\b/,
  buns:/\b(buns|brioche)\b/, 'crescent rolls':/\bcrescents?\b/, 'pie crust':/\bpie crusts?\b/, 'pizza dough':/\b(pizza dough|ready dough)\b/,
  'cream of chicken soup':/\bcream (of|soup)\b/, 'salad kit':/\bsalads?\b/, butter:/^(?!.*\b(peanut|almond|cookie)\b).*\bbutter\b/,
  'lemon juice':/\b(lemon juice|realemon)\b/, mayonnaise:/\b(mayonnaise|mayo)\b/, 'pancake mix':/\b(pancake|bisquick)\b/,
  'gravy mix':/\bgravy\b/, 'caesar dressing':/\b(caesar|dressings?)\b/, crackers:/\bcrackers?\b/, salami:/\b(salami|pepperoni)\b/,
  berries:/\b(berries|raspberries|strawberries|blueberries|blackberries)\b/
};
export const norm = text => String(text || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const singular = word => word.replace(/(ies)$/, 'y').replace(/(oes|ches|shes)$/, m => m.slice(0, -2)).replace(/([^s])s$/, '$1');
const words = text => norm(text).split(' ').filter(Boolean).map(singular).join(' ');
const pattern = ingredient => TERMS[ingredient] || new RegExp(`\\b${words(ingredient).replace(/ /g, '\\s+')}\\b`);

// The first BOGO that covers this ingredient, if any.
export function dealFor(ingredient, bogos = []) {
  const re = pattern(ingredient), alias = !TERMS[ingredient];
  return bogos.find(deal => re.test(alias ? words(deal.title) : norm(deal.title))) || null;
}
// Is this ingredient already on the grocery list (not yet bought)?
export function onList(ingredient, groceries = []) {
  const want = words(ingredient);
  return groceries.some(item => { if (item.completed) return false; const have = words(item.title); return have === want || ` ${have} `.includes(` ${want} `) || (want.length > 4 && ` ${want} `.includes(` ${have} `) && have.length > 3); });
}
export function annotate(meal, { bogos = [], groceries = [] } = {}) {
  const ingredients = (meal.ingredients || []).map(i => String(i).trim()).filter(Boolean);
  const deals = [], have = [], toBuy = [], staples = [];
  for (const ingredient of ingredients) {
    const deal = dealFor(ingredient, bogos); if (deal) deals.push({ ingredient, title:deal.title, save:deal.save || null });
    if (onList(ingredient, groceries)) have.push(ingredient);
    else if (STAPLES.has(ingredient.toLowerCase())) staples.push(ingredient);
    else toBuy.push(ingredient);
  }
  return { ...meal, ingredients, deals, onList:have, toBuy, staples };
}
// A stable shuffle that changes each week, so ties don't always pick the same dinners.
function weekSeed(name, today) {
  const d = new Date(`${today}T12:00:00`), week = Math.floor((+d - 345600000) / 604800000);
  let h = week * 2654435761 >>> 0; for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h / 4294967296;
}
const daysSince = (day, today) => day ? Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86400000) : Infinity;
// `exclude`: idea names already shown ("More ideas" steps through the library).
export function suggestMeals({ meals = [], bogos = [], groceries = [], today = dateKey(), count = 6, favoriteSlots = 3, exclude = [] } = {}) {
  const planned = new Set(meals.filter(m => m.plannedFor && m.plannedFor >= today).map(m => norm(m.name)));
  const favorites = meals.filter(m => m.favorite && !planned.has(norm(m.name)))
    .map(m => annotate(m, { bogos, groceries }))
    // Not made lately first; then the ones the BOGOs help most.
    .sort((a, b) => (Math.min(daysSince(b.lastMade, today), 60) - Math.min(daysSince(a.lastMade, today), 60)) || (b.deals.length - a.deals.length) || a.name.localeCompare(b.name))
    .slice(0, favoriteSlots).map(m => ({ ...m, source:'favorite' }));
  const taken = new Set([...meals.map(m => norm(m.name)), ...exclude.map(norm)]);
  const ideas = IDEAS.filter(idea => !taken.has(norm(idea.name))).map(idea => annotate(idea, { bogos, groceries }))
    .map(idea => ({ ...idea, source:'idea', score:idea.deals.length * 3 + idea.onList.length * 1.5 + weekSeed(idea.name, today) }))
    .sort((a, b) => b.score - a.score).slice(0, Math.max(0, count - favorites.length)).map(({ score, ...idea }) => idea);
  return [...favorites, ...ideas];
}
// The next seven dinners, today first, with whatever is planned for each day.
export function weekPlan(meals = [], today = dateKey()) {
  const start = new Date(`${today}T12:00:00`);
  return Array.from({ length:7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); const day = dateKey(d); return { day, label:i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday:'long' }), meal:meals.find(m => m.plannedFor === day) || null }; });
}
// Grocery items for the ingredients still to buy (staples and items already on the list are skipped).
export function groceryItemsFor(meal, groceries = []) {
  const { toBuy } = annotate(meal, { groceries });
  return toBuy.map(title => ({ kind:'grocery', title, owner:'both', due:'', cadence:'none', category:guessAisle(title), quantity:`for ${meal.name}`.slice(0, 60), list:'', completed:false }));
}
// "Chicken, rice; broccoli" or one per line → a clean ingredient list.
export function parseIngredients(text) {
  const seen = new Set();
  return String(text || '').split(/[\n,;]+/).map(s => s.trim().replace(/\s+/g, ' ').slice(0, 80)).filter(s => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase())).slice(0, 25);
}
export function validateMeal(data) {
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw new Error('Name the dinner (under 80 characters).');
  const ingredients = Array.isArray(data.ingredients) ? parseIngredients(data.ingredients.join('\n')) : parseIngredients(data.ingredients);
  const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
  return { name, ingredients, favorite:!!data.favorite, plannedFor:day(data.plannedFor), lastMade:day(data.lastMade) };
}
// BOGOs worth a look for dinner: food only, the ones our meal ideas use first.
export function dinnerBogos(bogos = [], suggestions = []) {
  const used = new Set(suggestions.flatMap(s => s.deals.map(d => d.title)));
  const food = new Set(['Meat', 'Seafood', 'Produce', 'Dairy', 'Deli', 'Frozen', 'Pantry', 'Bakery']);
  return bogos.filter(b => food.has(b.category)).sort((a, b) => Number(!used.has(a.title)) - Number(!used.has(b.title)));
}
