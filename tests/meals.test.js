import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBogos, fetchWeeklyBogos, findStores, createPublix, plain, DEFAULT_STORE } from '../functions/publix.js';
import { dealFor, onList, annotate, suggestMeals, weekPlan, groceryItemsFor, parseIngredients, validateMeal, IDEAS, recipeFor, parseSteps } from '../meal-ideas.js';
import { RECIPES } from '../meal-recipes.js';

// A trimmed copy of a real Publix weekly ad (store 1588, week of Nov 18, 2026).
const ad = JSON.parse(await readFile(new URL('./fixtures-publix-weekly-ad.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-21T17:00:00Z');
const bogos = parseBogos(ad, now);
const respond = (body, ok = true) => async (url, init) => { respond.calls.push({ url, init }); return { ok, status:ok ? 200 : 503, json:async () => body }; };
respond.calls = [];

test('the weekly ad becomes a clean list of running BOGOs', () => {
  assert.equal(ad.Savings.length, 25); // 21 BOGO rows (Clamato listed twice) and 4 other deals
  assert.equal(bogos.length, 20, 'only "Buy 1 Get 1", one per product');
  const bacon = bogos.find(b => b.title === 'Smithfield Bacon');
  assert.equal(bacon.category, 'Meat'); assert.match(bacon.save, /^\$\d+\.\d\d$/); assert.match(bacon.image, /^https:\/\/akimages\.shoplocal\.com\//);
  assert.ok(bogos.some(b => b.title === 'Stacy’s Pita Chips' || b.title === "Stacy's Pita Chips"), 'HTML entities are decoded');
  assert.ok(bogos.every(b => !/&[a-z#0-9]+;/i.test(b.title + b.detail)));
  assert.ok(!bogos.some(b => /^free item/i.test(b.detail)), 'the boilerplate is trimmed');
  assert.equal(bogos.find(b => b.title === 'Clamato Tomato Cocktail').category, 'Drinks', 'the most specific category wins');
  assert.equal(plain('Pr&eacute;sident Brie Triple Cr&egrave;me'), 'Président Brie Triple Crème');
  // Deals that already ended are dropped.
  assert.equal(parseBogos(ad, new Date('2026-12-30T00:00:00Z')).length, 0);
  assert.deepEqual(parseBogos({ Savings:'nope' }), []); assert.deepEqual(parseBogos(null), []);
});

test('fetching asks for one store, with the header Publix needs', async () => {
  respond.calls = [];
  const week = await fetchWeeklyBogos('01588', { fetch:respond(ad), now });
  assert.equal(week.store, '1588'); assert.equal(week.items.length, 20);
  const { url, init } = respond.calls[0];
  assert.match(url, /^https:\/\/services\.publix\.com\/api\/v4\/savings\?.*getSavingType=WeeklyAd&storeNumber=1588$/);
  assert.equal(init.headers.PublixStore, '1588');
  await assert.rejects(fetchWeeklyBogos('15; drop', { fetch:respond(ad) }), /Choose a Publix store/);
  await assert.rejects(fetchWeeklyBogos('1588', { fetch:respond({ Savings:[] }), now }), /without any BOGOs/);
  await assert.rejects(fetchWeeklyBogos('1588', { fetch:respond({}, false), now }), /didn’t answer/);
  assert.equal(DEFAULT_STORE.number, '1588');
});

test('stores near a ZIP', async () => {
  const stores = await findStores('23221', { fetch:respond({ Stores:[{ KEY:'01588', NAME:'Carytown Exchange', ADDR:'3535 Ellwood Ave', CITY:'Richmond', DISTANCE:'0' }, { KEY:'bad', NAME:'x' }] }) });
  assert.deepEqual(stores, [{ number:'1588', name:'Carytown Exchange', address:'3535 Ellwood Ave, Richmond', distance:0 }]);
  await assert.rejects(findStores('2322'), /5-digit ZIP/);
});

test('deals are cached per store, and a failed refresh keeps the last copy', async () => {
  const docs = new Map(), db = { doc:path => ({ get:async () => ({ data:() => docs.get(path) }), set:async data => { docs.set(path, structuredClone(data)); } }) };
  let calls = 0, fail = false, clock = +now;
  const fetch = async () => { calls++; if (fail) throw new Error('offline'); return { ok:true, json:async () => ad }; };
  const publix = createPublix({ db, fetch, now:() => new Date(clock) });
  const first = await publix.deals({ store:'1588' }); assert.equal(first.items.length, 20); assert.equal(calls, 1);
  await publix.deals({ store:'1588' }); assert.equal(calls, 1, 'served from the cache');
  clock += 7 * 3600000; fail = true;
  const stale = await publix.deals({ store:'1588' }); assert.equal(stale.stale, true); assert.equal(stale.items.length, 20); assert.equal(calls, 2);
  await assert.rejects(publix.deals({ store:'99' }), /didn’t answer/);
});

test('ingredients match the right deals, and not look-alikes', () => {
  const deal = name => dealFor(name, bogos)?.title || null;
  assert.equal(deal('pasta sauce'), 'Bertolli Sauce');
  assert.equal(deal('chicken broth'), 'Swanson Broth or Cooking Stock');
  assert.equal(deal('bacon'), 'Smithfield Bacon');
  assert.equal(deal('rotisserie chicken'), 'Tyson Restaurant Style Chicken');
  assert.equal(deal('ham steak'), 'Hatfield Ham Steak');
  assert.equal(deal('tomatoes'), null, 'Clamato is not tomatoes');
  assert.equal(deal('chicken breasts'), null, 'breaded nuggets are not chicken breasts');
  assert.equal(deal('chicken nuggets'), 'Perdue Breaded Chicken Breast Nuggets');
  assert.equal(deal('pita bread'), null, 'pita chips are not pita bread');
  assert.equal(dealFor('rice', [{ title:"Kellogg's Rice Krispies Treats" }]), null);
  assert.equal(dealFor('butter', [{ title:'Jif Peanut Butter' }]), null);
  assert.equal(dealFor('potatoes', [{ title:"Lay's Potato Chips" }]), null);
  assert.ok(onList('shredded cheese', [{ title:'Shredded cheese', completed:false }]));
  assert.ok(onList('avocados', [{ title:'Avocado' }]));
  assert.ok(!onList('cheese', [{ title:'Cheese', completed:true }]), 'bought items don’t count');
});

test('favorites come first (longest since made), then BOGO-friendly ideas', () => {
  const meals = [
    { id:'a', name:'Taco Tuesday', ingredients:['ground beef', 'tortillas'], favorite:true, lastMade:'2026-11-18', plannedFor:'' },
    { id:'b', name:'Chili', ingredients:['ground turkey', 'beans'], favorite:true, lastMade:'2026-10-01', plannedFor:'' },
    { id:'c', name:'Pancakes', ingredients:['pancake mix'], favorite:true, lastMade:'', plannedFor:'2026-11-22' }, // already planned
    { id:'d', name:'Baked ziti', ingredients:['pasta'], favorite:false, lastMade:'', plannedFor:'2026-11-23' }
  ];
  const list = suggestMeals({ meals, bogos, groceries:[{ title:'Shredded cheese' }], today:'2026-11-21' });
  assert.deepEqual(list.slice(0, 2).map(m => m.name), ['Chili', 'Taco Tuesday']);
  assert.equal(list.length, 6); assert.ok(list.slice(2).every(m => m.source === 'idea'));
  assert.ok(!list.some(m => m.name === 'Pancakes' || m.name === 'Baked ziti'), 'planned and saved dinners aren’t suggested again');
  assert.ok(list[2].deals.length >= 3, `the top idea uses several BOGOs (${list[2].name})`);
  // "More ideas" skips what was shown.
  const more = suggestMeals({ meals, bogos, today:'2026-11-21', exclude:list.map(m => m.name) });
  assert.ok(more.filter(m => m.source === 'idea').every(m => !list.some(l => l.name === m.name)));
  assert.ok(IDEAS.length >= 30);
});

test('one tap adds only what’s missing, and the week starts tonight', () => {
  const meal = { name:'Chicken tacos', ingredients:['chicken thighs', 'tortillas', 'salsa', 'olive oil', 'garlic'] };
  const items = groceryItemsFor(meal, [{ title:'Salsa', completed:false }]);
  assert.deepEqual(items.map(i => i.title), ['chicken thighs', 'tortillas'], 'staples and items already on the list are skipped');
  assert.ok(items.every(i => i.kind === 'grocery' && i.quantity === 'for Chicken tacos' && i.owner === 'both'));
  assert.equal(items[0].category, 'Meat & fish');
  const plan = weekPlan([{ name:'Chili', plannedFor:'2026-11-22' }], '2026-11-21');
  assert.equal(plan.length, 7); assert.equal(plan[0].label, 'Tonight'); assert.equal(plan[1].label, 'Tomorrow'); assert.equal(plan[1].meal.name, 'Chili');
  const a = annotate(meal, { bogos, groceries:[] }); assert.deepEqual(a.staples, ['olive oil', 'garlic']);
});

test('saved dinners are tidy and safe', () => {
  assert.deepEqual(parseIngredients('ground turkey, Beans\nbeans;  shredded   cheese\n\n'), ['ground turkey', 'Beans', 'shredded cheese']);
  assert.deepEqual(validateMeal({ name:'  Chili  ', ingredients:'a, b', favorite:1, plannedFor:'2026-11-22', lastMade:'yesterday' }), { name:'Chili', ingredients:['a', 'b'], favorite:true, plannedFor:'2026-11-22', lastMade:'', steps:[], minutes:0 });
  assert.throws(() => validateMeal({ name:'' }), /Name the dinner/);
  assert.equal(parseIngredients(Array.from({ length:40 }, (_, i) => `item ${i}`).join(',')).length, 25);
});

test('every idea comes with cooking steps, and saved dinners can have their own', () => {
  assert.deepEqual(Object.keys(RECIPES).sort(), IDEAS.map(i => i.name).sort(), 'one recipe per idea, names matching');
  for (const idea of IDEAS) { assert.ok(idea.steps.length >= 3 && idea.steps.length <= 8, idea.name); assert.ok(idea.minutes >= 10 && idea.minutes <= 120, idea.name); assert.ok(idea.steps.every(s => s.length <= 300 && /[.!]$/.test(s)), idea.name); }
  // Poultry recipes say how to tell it's done.
  for (const name of ['Chicken parmesan', 'Chicken tacos', 'Lemon roast chicken & potatoes']) assert.match(RECIPES[name].steps.join(' '), /165°F|175°F/, name);
  // A saved favorite with its own steps uses them; a saved idea without steps falls back to the library.
  assert.deepEqual(recipeFor({ name:'Chicken tacos', steps:['Our way.'], minutes:20 }), { minutes:20, steps:['Our way.'] });
  assert.equal(recipeFor({ name:'chicken tacos' }).steps.length, RECIPES['Chicken tacos'].steps.length);
  assert.deepEqual(recipeFor({ name:'Grandma’s stew' }), { minutes:0, steps:[] });
  assert.deepEqual(parseSteps('1. Boil water\n2) Add pasta\n\n- Drain   it\n• Serve'), ['Boil water', 'Add pasta', 'Drain it', 'Serve']);
  assert.equal(parseSteps(Array.from({ length:30 }, (_, i) => `step ${i}`).join('\n')).length, 20);
  assert.deepEqual([validateMeal({ name:'x', minutes:'45' }).minutes, validateMeal({ name:'x', minutes:'9000' }).minutes, validateMeal({ name:'x', minutes:'soon' }).minutes], [45, 0, 0]);
});
