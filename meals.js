// Life → Meals: this week's dinners, ideas (favorites first, then Publix-BOGO-friendly
// ideas), the weekly BOGO list (functions/publix.js) and saved favorites.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { showNotice, householdItems, addHouseholdItems } from './household.js';
import { renderHTML } from './dom.js';
import { dateKey, guessAisle } from './household-model.js';
import { suggestMeals, groceryItemsFor, validateMeal, parseIngredients, parseSteps, recipeFor, IDEAS } from './meal-ideas.js';
import { planHTML, ideasHTML, bogosHTML, storesHTML, favoritesHTML, recipeHTML } from './meals-view.js';
import { demoBogos } from './demo.js';

const $ = id => document.getElementById(id);
const STORE_KEY = 'hh_publix_store';
const failure = e => e?.code === 'functions/not-found' ? 'The Publix service is still deploying. Try again in a few minutes.' : e?.message || 'Publix’s weekly ad couldn’t be reached.';
const savedStore = () => { try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s && /^\d{1,5}$/.test(s.number) ? s : null; } catch { return null; } };

export function initMeals(app, { demo = false, store } = {}) {
  const panel = $('life-meals');
  if (!panel || !store) return;
  const call = demo || !app ? null : httpsCallable(getFunctions(app, config.functionsRegion), 'publix', { timeout:60000 });
  let meals = [], bogos = demo ? { items:demoBogos() } : { loading:true }, suggestions = [], shown = [], showAll = false, loadedAt = 0, busy = false;
  let publixStore = savedStore() || { number:'1588', name:'Carytown Exchange' }, stores = [];
  const groceries = () => householdItems().filter(item => item.kind === 'grocery');
  const today = () => dateKey();
  function draw() {
    const day = today();
    suggestions = suggestMeals({ meals, bogos:bogos.items || [], groceries:groceries(), today:day, exclude:shown });
    if (!suggestions.some(s => s.source === 'idea') && shown.length) { shown = []; suggestions = suggestMeals({ meals, bogos:bogos.items || [], groceries:groceries(), today:day }); }
    renderHTML($('mealPlan'), planHTML({ meals, suggestions, today:day }));
    renderHTML($('mealIdeas'), ideasHTML({ suggestions, meals, today:day, bogosLoaded:!!bogos.items }));
    renderHTML($('bogoPanel'), bogosHTML({ state:bogos, groceries:groceries(), suggestions, showAll, store:publixStore }));
    renderHTML($('mealFavorites'), favoritesHTML({ meals, today:day }));
    const bogoStore = $('bogoStore'); if (bogoStore) bogoStore.textContent = `PUBLIX ${publixStore.name}`.toUpperCase();
    const planned = meals.filter(m => m.plannedFor >= day).length, count = $('lifeMealCount'); if (count) count.textContent = planned ? String(planned) : '';
  }
  async function loadBogos(force = false) {
    if (!call || (!force && Date.now() - loadedAt < 30 * 60000)) return;
    loadedAt = Date.now();
    if (force || !bogos.items) { bogos = { ...bogos, loading:!bogos.items }; draw(); }
    try { bogos = (await call({ action:'deals', store:publixStore.number, force })).data; }
    catch (e) { bogos = bogos.items ? { ...bogos, loading:false, stale:true } : { error:failure(e) }; }
    draw();
  }
  let tidied = false;
  store.subscribe(next => {
    meals = (next || []).map(m => ({ ...m, ingredients:Array.isArray(m.ingredients) ? m.ingredients : [] })); draw();
    // Ideas are saved only while planned: tidy away ones from more than two weeks ago.
    if (tidied) return; tidied = true;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    const old = meals.filter(m => !m.favorite && (!m.plannedFor || m.plannedFor < dateKey(cutoff)));
    old.forEach(m => store.remove(m).catch(() => {}));
  }, () => {});
  window.addEventListener('hh:items', draw);
  window.addEventListener('hh:life-tab', e => { if (e.detail === 'meals') { loadBogos(); draw(); } });
  if (!panel.hidden) loadBogos();

  const run = async (work, done) => {
    if (busy) return; busy = true;
    try { await work(); if (done) showNotice(done); } catch (e) { showNotice(e?.message || 'Couldn’t save that. Try again.'); } finally { busy = false; }
  };
  const record = data => ({ ...validateMeal(data) });
  const byId = id => meals.find(m => m.id === id);
  // Planning an idea saves it (not as a favorite) so the plan survives reloads.
  async function plan(meal, day) {
    const existing = meal.id ? byId(meal.id) : meals.find(m => m.name.toLowerCase() === meal.name.toLowerCase());
    if (existing) await store.update(existing, { plannedFor:day });
    else await store.add(record({ name:meal.name, ingredients:meal.ingredients, steps:meal.steps || [], minutes:meal.minutes || 0, favorite:false, plannedFor:day, lastMade:'' }));
  }
  async function shop(meal) {
    const list = groceryItemsFor(meal, groceries());
    if (!list.length) { showNotice('Everything for it is already on the list.'); return; }
    await addHouseholdItems(list);
    showNotice(`Added ${list.length} item${list.length === 1 ? '' : 's'} for ${meal.name} to Groceries.`);
  }
  function edit(meal) {
    $('mealForm').reset(); $('mealError').textContent = '';
    $('mealId').value = meal?.id || ''; $('mealName').value = meal?.name || ''; $('mealIngredients').value = (meal?.ingredients || []).join('\n');
    const recipe = meal ? recipeFor(meal) : { steps:[], minutes:0 };
    $('mealSteps').value = recipe.steps.join('\n'); $('mealMinutes').value = recipe.minutes || '';
    $('mealFavorite').checked = meal ? !!meal.favorite : true; $('deleteMeal').hidden = !meal?.id;
    $('mealDialogTitle').textContent = meal?.id ? 'Edit dinner' : 'Save a favorite';
    $('mealDialog').showModal(); $('mealName').focus();
  }

  panel.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    const d = button.dataset, idea = i => suggestions[Number(i)];
    if (button.hasAttribute('data-meal-new')) return edit(null);
    if (button.hasAttribute('data-meal-shuffle')) { shown = [...shown, ...suggestions.filter(s => s.source === 'idea').map(s => s.name)]; if (shown.length >= IDEAS.length) shown = []; draw(); return; }
    if (button.hasAttribute('data-bogo-refresh')) { bogos = demo ? bogos : { loading:true }; draw(); loadBogos(true); return; }
    if (d.bogoAll !== undefined) { showAll = d.bogoAll === '1'; draw(); return; }
    if (d.bogoAdd) return run(() => addHouseholdItems([{ kind:'grocery', title:d.bogoAdd.slice(0, 180), owner:'both', due:'', cadence:'none', category:guessAisle(d.bogoAdd), quantity:'BOGO at Publix', list:'', completed:false }]), `${d.bogoAdd} is on the grocery list.`);
    if (d.bogoStore) { publixStore = { number:d.bogoStore, name:d.bogoStoreName || `#${d.bogoStore}` }; try { localStorage.setItem(STORE_KEY, JSON.stringify(publixStore)); } catch {} stores = []; bogos = { loading:true }; draw(); loadBogos(true); return; }
    if (d.ideaShop) return run(() => shop(idea(d.ideaShop)));
    if (d.ideaSave) { const s = idea(d.ideaSave); return run(async () => { const existing = meals.find(m => m.name.toLowerCase() === s.name.toLowerCase()); if (existing) await store.update(existing, { favorite:true }); else await store.add(record({ name:s.name, ingredients:s.ingredients, steps:s.steps || [], minutes:s.minutes || 0, favorite:true, plannedFor:'', lastMade:'' })); }, `${s.name} saved to your favorites. ♥`); }
    if (d.ideaRecipe) return showRecipe(idea(d.ideaRecipe));
    if (d.mealRecipe) return showRecipe(byId(d.mealRecipe));
    if (d.mealShop) return run(() => shop(byId(d.mealShop)));
    if (d.mealMade) { const m = byId(d.mealMade); return run(() => store.update(m, { lastMade:m.plannedFor && m.plannedFor < today() ? m.plannedFor : today() }), `${m.name}: made. Nice work, chef. 🍽`); }
    if (d.mealUnplan) { const m = byId(d.mealUnplan); return run(() => m.favorite ? store.update(m, { plannedFor:'' }) : store.remove(m)); }
    if (d.mealEdit) return edit(byId(d.mealEdit));
  });
  panel.addEventListener('change', event => {
    const select = event.target.closest('select'); if (!select || !select.value) return;
    const d = select.dataset, value = select.value;
    if (d.mealPick) { const meal = value.startsWith('fav:') ? byId(value.slice(4)) : suggestions[Number(value)]; if (meal) run(() => plan(meal, d.mealPick)); return; }
    if (d.ideaPlan !== undefined) { const meal = suggestions[Number(d.ideaPlan)]; if (meal) run(() => plan(meal, value), `${meal.name} is on the plan.`); return; }
    if (d.mealPlan) { const meal = byId(d.mealPlan); if (meal) run(() => plan(meal, value), `${meal.name} is on the plan.`); }
  });
  panel.addEventListener('submit', async event => {
    if (event.target.id !== 'bogoStoreForm') return; event.preventDefault();
    const zip = new FormData(event.target).get('zip');
    if (demo) { renderHTML($('bogoStores'), storesHTML([{ number:'1588', name:'Carytown Exchange', address:'3535 Ellwood Ave, Richmond', distance:0 }], publixStore.number)); return; }
    try { stores = (await call({ action:'stores', zip })).data.stores; renderHTML($('bogoStores'), storesHTML(stores, publixStore.number)); }
    catch (e) { showNotice(failure(e)); }
  });

  // The recipe card. The screen stays awake while it's open, for cooking.
  const recipeDialog = $('recipeDialog');
  let cooking = null, wake = null;
  const releaseWake = () => { wake?.release?.().catch?.(() => {}); wake = null; };
  function showRecipe(meal) {
    if (!meal || !recipeDialog) return;
    cooking = meal;
    const saved = !!(meal.id && byId(meal.id)), { minutes } = recipeFor(meal);
    $('recipeTitle').textContent = meal.name;
    $('recipeMeta').textContent = [meal.favorite ? '♥ FAVORITE' : saved ? 'ON THE PLAN' : 'IDEA', minutes ? `${minutes} MIN` : ''].filter(Boolean).join(' · ');
    renderHTML($('recipeBody'), recipeHTML(meal, { bogos:bogos.items || [], groceries:groceries(), saved }));
    if (!recipeDialog.open) recipeDialog.showModal();
    if (!wake && navigator.wakeLock?.request) navigator.wakeLock.request('screen').then(lock => { if (recipeDialog.open) wake = lock; else lock.release(); }, () => {});
  }
  recipeDialog?.addEventListener('close', () => { cooking = null; releaseWake(); });
  recipeDialog?.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || !cooking) return;
    const meal = cooking;
    if (button.hasAttribute('data-recipe-close')) return recipeDialog.close();
    if (button.hasAttribute('data-recipe-shop')) return run(() => shop(meal)).then(() => recipeDialog.open && showRecipe(meal));
    if (button.hasAttribute('data-recipe-edit')) { recipeDialog.close(); return edit(byId(meal.id)); }
    if (button.hasAttribute('data-recipe-save')) return run(async () => { await store.add(record({ name:meal.name, ingredients:meal.ingredients, steps:meal.steps || [], minutes:meal.minutes || 0, favorite:true, plannedFor:'', lastMade:'' })); recipeDialog.close(); }, `${meal.name} saved to your favorites. ♥`);
  });
  // Keep an open recipe current when the list or plan changes.
  window.addEventListener('hh:items', () => { if (recipeDialog?.open && cooking) showRecipe(cooking.id ? byId(cooking.id) || cooking : cooking); });

  const dialog = $('mealDialog');
  dialog?.querySelector('[data-meal-close]')?.addEventListener('click', () => dialog.close());
  $('mealForm')?.addEventListener('submit', async event => {
    event.preventDefault(); $('mealError').textContent = ''; $('saveMeal').disabled = true;
    try {
      const old = byId($('mealId').value);
      const data = record({ name:$('mealName').value, ingredients:parseIngredients($('mealIngredients').value), steps:parseSteps($('mealSteps').value), minutes:$('mealMinutes').value, favorite:$('mealFavorite').checked, plannedFor:old?.plannedFor || '', lastMade:old?.lastMade || '' });
      if (old) await store.update(old, data); else await store.add(data);
      dialog.close(); showNotice(data.favorite ? `${data.name} is in your favorites. ♥` : 'Saved.');
    } catch (e) { $('mealError').textContent = e?.message || 'Couldn’t save that dinner.'; } finally { $('saveMeal').disabled = false; }
  });
  $('deleteMeal')?.addEventListener('click', async () => {
    const meal = byId($('mealId').value); if (!meal) return; // deleted right away, with Undo
    try { await store.remove(meal); dialog.close(); showNotice(`Deleted “${meal.name}”.`, store.restore ? { label:'Undo', run:async () => { await store.restore(meal); showNotice(`${meal.name} is back.`); } } : undefined); }
    catch (e) { $('mealError').textContent = e?.message || 'Couldn’t delete it.'; }
  });
  draw();
}
