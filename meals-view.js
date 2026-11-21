// Markup for Life → Meals. Pure: takes state, returns HTML strings.
import { escapeHTML as esc } from './household-model.js';
import { weekPlan, onList, recipeFor, annotate } from './meal-ideas.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortDay = day => new Date(`${day}T12:00:00`).toLocaleDateString([], { month:'short', day:'numeric' });
const ago = (day, today) => { if (!day) return 'Not made yet'; const n = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86400000); return n <= 0 ? 'Made today' : n === 1 ? 'Made yesterday' : n < 14 ? `Made ${n} days ago` : `Made ${Math.round(n / 7)} weeks ago`; };
const empty = (title, detail) => `<div class="empty-state"><strong>${esc(title)}</strong>${esc(detail)}</div>`;

// A "Plan for…" picker of the open days this week.
function dayPicker(attr, value, plan) {
  const open = plan.filter(d => !d.meal);
  if (!open.length) return '';
  return `<label class="meal-plan-pick"><span class="sr-only">Plan for a day</span><select ${attr}="${esc(value)}"><option value="">Plan for…</option>${open.map(d => `<option value="${esc(d.day)}">${esc(d.label)}</option>`).join('')}</select></label>`;
}
export function planHTML({ meals = [], suggestions = [], today }) {
  const plan = weekPlan(meals, today), choices = suggestions.filter(s => s.source === 'favorite' || s.source === 'idea');
  return `<ol class="meal-week">${plan.map(d => d.meal
    ? `<li class="meal-day planned${d.meal.lastMade === d.day ? ' made' : ''}"><span class="meal-when"><b>${esc(d.label)}</b><small>${esc(shortDay(d.day))}</small></span><span class="meal-what"><button type="button" class="meal-name" data-meal-recipe="${esc(d.meal.id)}" title="How to make it">${d.meal.favorite ? '<i class="meal-heart" aria-label="Favorite">♥</i> ' : ''}${esc(d.meal.name)}${recipeFor(d.meal).steps.length ? ' <span class="meal-recipe-hint" aria-hidden="true">📖</span>' : ''}</button></span><span class="meal-actions"><button type="button" class="btn btn-small" data-meal-shop="${esc(d.meal.id)}" title="Add what’s missing to Groceries">🛒</button>${d.meal.lastMade === d.day ? '<span class="meal-done">Made ✓</span>' : `<button type="button" class="btn btn-small" data-meal-made="${esc(d.meal.id)}">Made it</button>`}<button type="button" class="text-link" data-meal-unplan="${esc(d.meal.id)}" aria-label="Clear ${esc(d.label)}">Clear</button></span></li>`
    : `<li class="meal-day open"><span class="meal-when"><b>${esc(d.label)}</b><small>${esc(shortDay(d.day))}</small></span><label class="meal-what"><span class="sr-only">Dinner for ${esc(d.label)}</span><select data-meal-pick="${esc(d.day)}"><option value="">Pick a dinner…</option>${choices.length ? `<optgroup label="Ideas this week">${choices.map((s, i) => `<option value="${i}">${s.source === 'favorite' ? '♥ ' : ''}${esc(s.name)}</option>`).join('')}</optgroup>` : ''}${meals.some(m => m.favorite) ? `<optgroup label="All favorites">${meals.filter(m => m.favorite).map(m => `<option value="fav:${esc(m.id)}">♥ ${esc(m.name)}</option>`).join('')}</optgroup>` : ''}</select></label><span class="meal-actions"></span></li>`).join('')}</ol>`;
}
export function ideasHTML({ suggestions = [], meals = [], today, bogosLoaded = false }) {
  if (!suggestions.length) return empty('No ideas left this round.', 'Tap ↻ to start over.');
  const plan = weekPlan(meals, today);
  return `<div class="meal-ideas">${suggestions.map((s, i) => {
    const deals = s.deals.length ? `<p class="meal-deals">${s.deals.map(d => `<span class="bogo-chip" title="${esc(d.title)}">BOGO · ${esc(d.ingredient)}</span>`).join('')}</p>` : '';
    const have = s.onList.length ? `<p class="tiny muted">Already on the list: ${esc(s.onList.join(', '))}</p>` : '';
    const add = s.toBuy.length ? `<button type="button" class="btn btn-small" data-idea-shop="${i}">🛒 Add ${plural(s.toBuy.length, 'item')}</button>` : '<span class="meal-done">All on the list ✓</span>';
    const why = s.source === 'favorite' ? `${ago(s.lastMade, today)}${s.deals.length ? ` · ${plural(s.deals.length, 'BOGO')}` : ''}` : s.deals.length ? `Uses ${plural(s.deals.length, 'BOGO')}${s.onList.length ? ` and ${s.onList.length} thing${s.onList.length === 1 ? '' : 's'} you’re already buying` : ''}` : s.onList.length ? `Uses ${s.onList.length} thing${s.onList.length === 1 ? '' : 's'} already on the list` : bogosLoaded ? 'Something different' : 'A weeknight classic';
    return `<article class="meal-idea ${esc(s.source)}"><header><h3>${s.source === 'favorite' ? '<i class="meal-heart" aria-label="Favorite">♥</i> ' : ''}${esc(s.name)}</h3><small>${esc(why)}${recipeFor(s).minutes ? ` · ${esc(recipeFor(s).minutes)} min` : ''}</small></header>${deals}<p class="meal-ingredients">${s.ingredients.map(x => `<span class="${s.onList.includes(x) ? 'have' : s.deals.some(d => d.ingredient === x) ? 'deal' : ''}">${esc(x)}</span>`).join('')}</p>${have}<footer>${add}${recipeFor(s).steps.length ? `<button type="button" class="btn btn-small" data-idea-recipe="${i}">📖 How to make it</button>` : ''}${dayPicker('data-idea-plan', i, plan)}${s.source === 'idea' ? `<button type="button" class="text-link" data-idea-save="${i}">♥ Save</button>` : ''}</footer></article>`;
  }).join('')}</div>`;
}
export function bogosHTML({ state = {}, groceries = [], suggestions = [], showAll = false, store = null }) {
  if (state.loading) return '<p class="muted">Checking this week’s Publix ad…</p>';
  if (state.error && !state.items) return `<p class="muted">${esc(state.error)}</p><button type="button" class="btn btn-small" data-bogo-refresh>Try again</button>`;
  const items = state.items || [];
  if (!items.length) return empty('No BOGOs to show.', 'Publix’s weekly ad didn’t list any this week.');
  const used = new Set(suggestions.flatMap(s => s.deals.map(d => d.title)));
  const food = new Set(['Meat', 'Seafood', 'Produce', 'Dairy', 'Deli', 'Frozen', 'Pantry', 'Bakery']);
  const list = (showAll ? items : items.filter(b => food.has(b.category))).slice().sort((a, b) => Number(!used.has(a.title)) - Number(!used.has(b.title)) || a.category.localeCompare(b.category));
  const ends = items.map(b => b.ends).filter(Boolean).sort()[0];
  const shown = showAll ? list : list.slice(0, 24);
  return `<div class="bogo-head"><p class="tiny muted">${esc(store?.name ? `Publix ${store.name}` : 'Publix')}${ends ? ` · through ${esc(new Date(ends).toLocaleDateString([], { weekday:'short', month:'numeric', day:'numeric' }))}` : ''} · ${plural(items.length, 'BOGO')}${state.stale ? ' · showing the last copy' : ''}</p><div class="segmented" role="group" aria-label="Which BOGOs"><button type="button" data-bogo-all="0" class="${showAll ? '' : 'active'}">For dinner</button><button type="button" data-bogo-all="1" class="${showAll ? 'active' : ''}">All ${items.length}</button></div></div>
  <ul class="bogo-list">${shown.map(b => { const have = onList(b.title, groceries); return `<li class="bogo-item${used.has(b.title) ? ' used' : ''}">${b.image ? `<img src="${esc(b.image)}" alt="" loading="lazy" width="48" height="48" />` : '<span class="bogo-thumb" aria-hidden="true">🏷️</span>'}<span class="bogo-copy"><b>${esc(b.title)}</b><small>${esc(b.category)}${b.save ? ` · save up to ${esc(b.save)}` : ''}${used.has(b.title) ? ' · in your ideas' : ''}</small></span>${have ? '<span class="meal-done">On the list ✓</span>' : `<button type="button" class="btn btn-small" data-bogo-add="${esc(b.title)}" aria-label="Add ${esc(b.title)} to Groceries">＋ List</button>`}</li>`; }).join('')}</ul>
  ${!showAll && list.length > shown.length ? `<button type="button" class="text-link" data-bogo-all="1">Show all ${items.length} BOGOs →</button>` : ''}
  <details class="bogo-store"><summary>Change store</summary><form id="bogoStoreForm" class="bogo-store-form"><label class="field"><span>ZIP code</span><input name="zip" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="23221" required /></label><button type="submit" class="btn btn-small">Find stores</button></form><div id="bogoStores"></div></details>`;
}
export function storesHTML(stores = [], current) {
  if (!stores.length) return '<p class="tiny muted">No Publix stores found near that ZIP.</p>';
  return `<ul class="bogo-stores">${stores.map(s => `<li><span><b>${esc(s.name)}</b><small>${esc(s.address)}${s.distance ? ` · ${esc(s.distance.toFixed(1))} mi` : ''}</small></span>${s.number === current ? '<span class="meal-done">Current ✓</span>' : `<button type="button" class="btn btn-small" data-bogo-store="${esc(s.number)}" data-bogo-store-name="${esc(s.name)}">Use this store</button>`}</li>`).join('')}</ul>`;
}
export function favoritesHTML({ meals = [], today }) {
  const favorites = meals.filter(m => m.favorite).sort((a, b) => a.name.localeCompare(b.name));
  if (!favorites.length) return empty('Save the dinners you love.', 'They’ll come up first each week, starting with the ones you haven’t made in a while.');
  const plan = weekPlan(meals, today);
  return `<ul class="meal-favorites">${favorites.map(m => `<li><span class="meal-fav-copy"><button type="button" class="item-edit" data-meal-edit="${esc(m.id)}">${esc(m.name)}</button><small>${esc(ago(m.lastMade, today))}${m.plannedFor && m.plannedFor >= today ? ` · planned for ${esc(plan.find(d => d.day === m.plannedFor)?.label || shortDay(m.plannedFor))}` : ''} · ${plural(m.ingredients?.length || 0, 'ingredient')}${recipeFor(m).minutes ? ` · ${esc(recipeFor(m).minutes)} min` : ''}</small></span><button type="button" class="btn btn-small" data-meal-recipe="${esc(m.id)}">📖 Recipe</button>${m.plannedFor && m.plannedFor >= today ? '' : dayPicker('data-meal-plan', m.id, plan)}</li>`).join('')}</ul>`;
}
// The recipe card: ingredients (with what's on the list or on BOGO) and numbered steps.
export function recipeHTML(meal, { bogos = [], groceries = [], saved = false } = {}) {
  const { steps, minutes } = recipeFor(meal), a = annotate(meal, { bogos, groceries });
  const tag = x => a.onList.includes(x) ? '<small class="have">on the list</small>' : a.deals.some(d => d.ingredient === x) ? '<small class="deal">BOGO</small>' : a.staples.includes(x) ? '<small>pantry</small>' : '';
  return `<p class="tiny muted">${minutes ? `About ${esc(minutes)} minutes · ` : ''}${plural(a.ingredients.length, 'ingredient')}</p>
  ${a.ingredients.length ? `<h3 class="recipe-h">Ingredients</h3><ul class="recipe-ingredients">${a.ingredients.map(x => `<li>${esc(x)} ${tag(x)}</li>`).join('')}</ul>` : ''}
  <h3 class="recipe-h">How to make it</h3>
  ${steps.length ? `<ol class="recipe-steps">${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : `<p class="muted">No steps saved yet.${saved ? ' Tap Edit to add how you make it.' : ''}</p>`}
  <div class="modal-actions">${a.toBuy.length ? `<button type="button" class="btn" data-recipe-shop>🛒 Add ${plural(a.toBuy.length, 'item')}</button>` : '<span class="meal-done">All on the list ✓</span>'}<div class="spacer"></div>${saved ? '<button type="button" class="btn" data-recipe-edit>Edit</button>' : '<button type="button" class="btn" data-recipe-save>♥ Save</button>'}</div>`;
}
