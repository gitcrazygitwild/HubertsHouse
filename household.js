import { dateKey, dueLabel, completionPatch, validateItem, escapeHTML as esc, OWNERS, CATEGORIES } from './household-model.js';
const $ = id => document.getElementById(id);
let store, items = [], events = [], currentKind = 'chore', openEvent, newEvent, viewChanged;
let noticeTimer, wakeLock, displayMode = false, activeView = 'today';
const titles = { today: 'Today at home', calendar: 'The household calendar', tasks: 'Chores & checklists', groceries: 'The grocery list', settings: 'Your house, your way' };
export function showNotice(message, action) {
  const el = $('notice'); el.textContent = message; el.classList.remove('hidden');
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { el.classList.add('hidden'); Promise.resolve(action.run()).catch(e => showNotice(e.message)); }; el.append(b); }
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el.classList.add('hidden'), action ? 14000 : 6500);
}
export function showView(view) {
  if (!Object.hasOwn(titles, view)) view = 'today';
  activeView = view;
  document.querySelectorAll('.house-view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('viewTitle').textContent = titles[view];
  history.replaceState(null, '', `${location.pathname}${location.search}#${view}`);
  if (view === 'calendar') requestAnimationFrame(() => viewChanged?.(view));
}
async function setDisplayMode(on) {
  displayMode = on; document.body.classList.toggle('display-mode', on);
  localStorage.setItem('hh_display', on ? '1' : '0');
  $('displayBtn').setAttribute('aria-pressed', String(on));
  $('displayBtn').textContent = on ? 'Exit display' : 'Display mode';
  $('settingsDisplayBtn').textContent = on ? 'Turn off display mode' : 'Turn on display mode';
  if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = null; }
  if (on && document.visibilityState === 'visible') {
    try {
      if (!navigator.wakeLock) throw new Error('unsupported');
      wakeLock = await navigator.wakeLock.request('screen');
      $('wakeStatus').textContent = 'Keeping this screen awake while the page is visible.';
      wakeLock.addEventListener('release', () => { $('wakeStatus').textContent = 'Screen wake lock released by this device.'; });
    } catch { $('wakeStatus').textContent = 'Screen wake lock is unavailable. Adjust your device’s auto-lock setting for a shared display.'; }
  } else if (!on) $('wakeStatus').textContent = '';
  requestAnimationFrame(() => viewChanged?.(activeView));
}
function tick() {
  const now = new Date();
  $('houseDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  $('houseClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  render();
}
export function initHousehold(options) {
  store = options.store; openEvent = options.openEvent; newEvent = options.newEvent; viewChanged = options.viewChanged;
  store.subscribe(next => { items = next; render(); }, (message, error = false) => { $('houseDataStatus').textContent = message; if (error) showNotice(message); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showView(b.dataset.go)));
  document.querySelectorAll('[data-add-kind]').forEach(b => b.addEventListener('click', () => editItem(null, b.dataset.addKind)));
  document.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    currentKind = b.dataset.kind;
    document.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('active', x === b));
    const add = document.querySelector('#view-tasks [data-add-kind]'); add.dataset.addKind = currentKind; add.textContent = currentKind === 'chore' ? '＋ Add a chore' : '＋ Add a checklist item'; render();
  }));
  $('houseOwner').addEventListener('change', render); $('showCompleted').addEventListener('change', render);
  $('quickEvent').addEventListener('click', () => newEvent());
  $('displayBtn').addEventListener('click', () => setDisplayMode(!displayMode));
  $('settingsDisplayBtn').addEventListener('click', () => setDisplayMode(!displayMode));
  document.addEventListener('visibilitychange', () => { if (displayMode && document.visibilityState === 'visible') setDisplayMode(true); });
  $('closeItemDialog').addEventListener('click', () => $('itemDialog').close());
  $('itemDialog').addEventListener('click', e => { if (e.target === $('itemDialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  $('itemForm').addEventListener('submit', saveItem);
  $('deleteItem').addEventListener('click', async () => {
    const item = items.find(x => x.id === $('itemId').value); if (!item || !confirm(`Delete “${item.title}”?`)) return;
    $('deleteItem').disabled = true;
    try { await store.remove(item); $('itemDialog').close(); showNotice('Item deleted.'); } catch (e) { $('itemError').textContent = friendlyError(e); } finally { $('deleteItem').disabled = false; }
  });
  $('quickGroceryForm').addEventListener('submit', async e => {
    e.preventDefault(); const input = $('quickGrocery'); const title = input.value.trim(); if (!title) return;
    const button = e.currentTarget.querySelector('button'); button.disabled = true;
    try { await store.add(validateItem({ kind: 'grocery', title, owner: 'both', due: '', cadence: 'none', category: 'Other', quantity: '', list: '', completed: false })); if (input.value.trim() === title) input.value = ''; showNotice('Added to the grocery list.'); }
    catch (error) { showNotice(friendlyError(error)); } finally { button.disabled = false; }
  });
  $('clearBought').addEventListener('click', async () => {
    const bought = items.filter(x => x.kind === 'grocery' && x.completed); if (!bought.length) return;
    if (!confirm(`Clear ${bought.length} bought item${bought.length === 1 ? '' : 's'}?`)) return;
    $('clearBought').disabled = true;
    try { await store.removeMany(bought); showNotice('Bought items cleared.'); } catch (e) { showNotice(friendlyError(e)); } finally { $('clearBought').disabled = false; }
  });
  document.querySelector('.house-main').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit-item]'); if (edit) editItem(items.find(x => x.id === edit.dataset.editItem));
    const event = e.target.closest('[data-open-event]'); if (event) openEvent(event.dataset.openEvent, event.dataset.occ);
  });
  document.querySelector('.house-main').addEventListener('change', async e => {
    const checkbox = e.target.closest('[data-complete]'); if (!checkbox) return;
    const item = items.find(x => x.id === checkbox.dataset.complete); if (!item) return;
    checkbox.disabled = true;
    try {
      const before = { completed: !!item.completed, due: item.due || '', lastCompletedAt: item.lastCompletedAt || null, anchorDay: item.anchorDay || null };
      const patch = completionPatch(item); const updated = await store.update(item, patch);
      const recurring = item.kind === 'chore' && item.cadence !== 'none';
      showNotice(recurring ? `Done. Next up: ${dueLabel({ due: patch.due })}.` : patch.completed ? 'Checked off. Nicely done.' : 'Back on the list.', { label: 'Undo', run: () => store.update(updated, before) });
    } catch (error) { showNotice(friendlyError(error)); render(); }
  });
  showView(location.hash.slice(1)); tick(); setInterval(tick, 30000);
  if (localStorage.getItem('hh_display') === '1') setDisplayMode(true);
}
export function updateHouseholdEvents(next) { events = next; render(); }
function friendlyError(error) {
  if (/permission-denied/.test(error.code || '')) return 'This account does not have household access. Check your household membership.';
  return error.message || 'Couldn’t save that change. Please try again.';
}
function editItem(item, kind = 'chore') {
  if (item) kind = item.kind;
  $('itemForm').reset(); $('itemError').textContent = '';
  $('itemId').value = item?.id || ''; $('itemKind').value = kind; $('itemTitle').value = item?.title || '';
  $('itemDialogTitle').textContent = `${item ? 'Edit' : 'Add'} ${kind === 'grocery' ? 'groceries' : kind === 'task' ? 'a checklist item' : 'a chore'}`;
  $('itemTitle').previousElementSibling.textContent = kind === 'grocery' ? 'What do we need?' : 'What needs doing?';
  $('itemOwner').value = item?.owner || 'both'; $('itemDue').value = item?.due || (kind === 'chore' ? dateKey() : '');
  $('itemCadence').value = item?.cadence || 'none'; $('itemList').value = item?.list || '';
  $('itemQuantity').value = item?.quantity || ''; $('itemCategory').value = item?.category || 'Other';
  $('taskItemFields').classList.toggle('hidden', kind === 'grocery'); $('groceryItemFields').classList.toggle('hidden', kind !== 'grocery');
  $('cadenceField').classList.toggle('hidden', kind !== 'chore'); $('listNameField').classList.toggle('hidden', kind !== 'task');
  $('deleteItem').classList.toggle('hidden', !item); $('itemDialog').showModal(); $('itemTitle').focus();
}
async function saveItem(e) {
  e.preventDefault(); $('itemError').textContent = ''; $('saveItem').disabled = true;
  try {
    const kind = $('itemKind').value; const old = items.find(x => x.id === $('itemId').value);
    const data = validateItem({ kind, title: $('itemTitle').value, owner: kind === 'grocery' ? 'both' : $('itemOwner').value,
      due: kind === 'grocery' ? '' : $('itemDue').value, cadence: kind === 'chore' ? $('itemCadence').value : 'none',
      list: kind === 'task' ? $('itemList').value.trim().slice(0, 80) : '', quantity: kind === 'grocery' ? $('itemQuantity').value.trim().slice(0, 60) : '',
      category: kind === 'grocery' ? $('itemCategory').value : 'Other', completed: old?.completed || false });
    if (old && old.due !== data.due) data.anchorDay = data.due ? Number(data.due.slice(-2)) : null;
    if (old) await store.update(old, data); else await store.add(data);
    $('itemDialog').close(); showNotice('Saved for the household.');
  } catch (error) { $('itemError').textContent = friendlyError(error); } finally { $('saveItem').disabled = false; }
}
function itemHTML(item) {
  const due = dueLabel(item); const sub = item.kind === 'grocery' ? esc(item.quantity || 'Tap to edit details') : `${item.due < dateKey() && item.due ? '<span class="overdue">' : '<span>'}${esc(due)}</span>${item.cadence !== 'none' ? `<span>↻ ${esc(item.cadence)}</span>` : ''}`;
  return `<div class="item-row ${item.completed ? 'done' : ''}"><input type="checkbox" class="item-check" data-complete="${esc(item.id)}" aria-label="${esc(item.completed ? 'Uncheck' : 'Complete')} ${esc(item.title)}" ${item.completed ? 'checked' : ''} /><div class="item-copy"><button type="button" class="item-edit" data-edit-item="${esc(item.id)}">${esc(item.title)}</button><div class="item-meta">${sub}</div></div>${item.kind !== 'grocery' ? `<span class="owner-tag ${esc(item.owner)}">${esc(OWNERS[item.owner] || 'Both')}</span>` : ''}</div>`;
}
function empty(title, detail) { return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(detail)}</div>`; }
function groupsHTML(list, key, sortKeys) {
  const groups = new Map(); for (const item of list) { const name = key(item); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(item); }
  const keys = [...groups.keys()]; if (sortKeys) keys.sort((a,b) => sortKeys.indexOf(a) - sortKeys.indexOf(b));
  return keys.map(name => `<section class="list-group"><h3>${esc(name)}<span>${groups.get(name).length} item${groups.get(name).length === 1 ? '' : 's'}</span></h3>${groups.get(name).map(itemHTML).join('')}</section>`).join('');
}
function render() {
  if (!$('homeAgenda')) return;
  const today = dateKey(), now = new Date();
  const pending = items.filter(x => !x.completed && x.kind !== 'grocery');
  const due = pending.filter(x => !x.due || x.due <= today);
  const groceries = items.filter(x => x.kind === 'grocery');
  const todayEvents = events.filter(e => { const start = new Date(e.start); const end = e.end ? new Date(e.end) : start; return dateKey(start) <= today && (dateKey(start) === today || end > new Date(`${today}T00:00:00`)); });
  $('statEvents').textContent = todayEvents.length; $('statTasks').textContent = due.length; $('statGroceries').textContent = groceries.filter(x => !x.completed).length;
  $('daySummary').textContent = todayEvents.length ? `${todayEvents.length} plan${todayEvents.length === 1 ? '' : 's'} today. ${due.length ? `${due.length} little thing${due.length === 1 ? '' : 's'} to take care of.` : 'A little room to breathe.'}` : 'A little room to breathe. Make today your own.';
  const upcoming = events.filter(e => (e.end ? new Date(e.end) : new Date(e.start)) >= (e.allDay ? new Date(`${today}T00:00:00`) : now)).sort((a,b) => new Date(a.start) - new Date(b.start)).slice(0, 5);
  $('homeAgenda').innerHTML = upcoming.length ? upcoming.map(e => {
    const d = new Date(e.start), owner = e.extendedProps?.owner || 'both';
    const time = e.allDay ? 'All day' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `<button type="button" class="agenda-row" data-open-event="${esc(e.extendedProps?.sourceId || e.id)}" data-occ="${esc(d.toISOString())}"><span class="agenda-date">${esc(d.toLocaleDateString([], { weekday: 'short' }).toUpperCase())}<strong>${d.getDate()}</strong>${esc(d.toLocaleDateString([], { month: 'short' }))}</span><span class="agenda-copy ${esc(owner)}"><strong>${esc(e.title)}</strong><small>${esc(time)}${e.extendedProps?.icloud ? ' · iCloud' : ''}</small></span><span class="agenda-owner">${esc(OWNERS[owner] || 'Both')}</span></button>`;
  }).join('') : empty('Nothing coming up yet.', 'Add your first plan, or connect an iCloud calendar in Settings.');
  const sorted = [...pending].sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999'));
  $('homeChores').innerHTML = sorted.length ? sorted.slice(0, 5).map(itemHTML).join('') : empty('A fresh start for your home.', 'Add a chore or a checklist item to get everyone on the same page.');
  const owner = $('houseOwner').value, completed = $('showCompleted').checked;
  const allTasks = items.filter(x => x.kind === currentKind && (owner === 'all' || x.owner === owner));
  const tasks = allTasks.filter(x => completed || !x.completed).sort((a,b) => Number(a.completed) - Number(b.completed) || (a.due || '9999').localeCompare(b.due || '9999'));
  const doneToday = allTasks.filter(x => x.lastCompletedAt && dateKey(new Date(x.lastCompletedAt)) === today).length;
  $('tasksProgress').textContent = `${doneToday} taken care of today · ${allTasks.filter(x => !x.completed).length} on the list`;
  $('taskGroups').innerHTML = tasks.length ? groupsHTML(tasks, x => x.completed ? 'Completed' : currentKind === 'task' ? x.list || 'Everyday checklist' : x.due && x.due < today ? 'Needs a little love' : x.due === today ? 'For today' : x.due ? 'Coming up' : 'Anytime') : empty('All clear here.', `Add ${currentKind === 'chore' ? 'a chore' : 'a checklist item'} to share the load.`);
  $('groceryCount').textContent = `${groceries.filter(x => !x.completed).length} to pick up · ${groceries.filter(x => x.completed).length} in the basket`;
  $('clearBought').disabled = !groceries.some(x => x.completed);
  $('groceryGroups').innerHTML = groceries.length ? groupsHTML([...groceries].sort((a,b) => Number(a.completed) - Number(b.completed) || a.title.localeCompare(b.title)), x => x.completed ? 'In the basket' : x.category || 'Other', [...CATEGORIES, 'In the basket']) : empty('The list is ready when you are.', 'Add the first thing you need. It’ll be here on your next store run.');
}
