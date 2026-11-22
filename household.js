import { dateKey, dueLabel, completionPatch, validateItem, escapeHTML as esc, OWNERS, CATEGORIES, filterTaskItems, guessAisle } from './household-model.js';
import { eventsOnDay, localDate, eventEnd } from './calendar-model.js';
import { renderHTML } from './dom.js';
import { eventChecklistGroups, eventChecklistKey } from './checklists.js';
const $ = id => document.getElementById(id);
let store, items = [], events = [], currentKind = 'chore', taskFocus = 'all', openEvent, newEvent, viewChanged, onData;
let noticeTimer, wakeLock, displayMode = false, activeView = 'today', monitorFullscreen = false;
let getEventRecords=()=>[],saveEventChecklist,editEventChecklist,taskSource='all';
const pendingChecklists=new Set();
const titles = { today: 'Today at home', calendar: 'Your calendar, all together.', life: 'Life, handled.', settings: 'Your house, your way', frankie: 'Frankie', devices: 'Smart home' };
// Chores and groceries live together on the Life page; the old names open its tabs.
const LIFE_TABS = { tasks: 'todos', todos: 'todos', groceries: 'groceries', meals: 'meals' };
let lifeTab = 'todos';
export const householdItems = () => items;
export const addHouseholdItems = list => list.length === 1 ? store.add(list[0]) : store.addMany(list);
function showLifeTab(tab) {
  lifeTab = Object.values(LIFE_TABS).includes(tab) ? tab : 'todos';
  document.querySelectorAll('[data-life-tab]').forEach(button => { const on = button.dataset.lifeTab === lifeTab; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('.life-panel').forEach(panel => { panel.hidden = panel.id !== `life-${lifeTab}`; });
  window.dispatchEvent(new CustomEvent('hh:life-tab', { detail:lifeTab }));
}
export function showNotice(message, action) {
  const el = $('notice'); el.textContent = message; el.classList.remove('hidden');
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { el.classList.add('hidden'); Promise.resolve(action.run()).catch(e => showNotice(e.message)); }; el.append(b); }
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el.classList.add('hidden'), action ? 14000 : 6500);
}
export function showView(view) {
  if (Object.hasOwn(LIFE_TABS, view)) { showLifeTab(LIFE_TABS[view]); view = 'life'; }
  if (!Object.hasOwn(titles, view)) view = 'today';
  activeView = view;
  document.body.dataset.view = view; // phones hide repeated header pieces outside Today (mobile.css)
  document.querySelectorAll('.house-view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('viewTitle').textContent = titles[view];
  history.replaceState(null, '', `${location.pathname}${location.search}#${view === 'life' && lifeTab !== 'todos' ? lifeTab : view}`);
  if (['calendar','today','life'].includes(view)) requestAnimationFrame(() => viewChanged?.(view));
}
async function setDisplayMode(on) {
  displayMode = on; document.body.classList.toggle('display-mode', on);
  document.body.classList.toggle('monitor-mode', on);
  localStorage.setItem('hh_display', on ? '1' : '0');
  $('displayBtn').setAttribute('aria-pressed', String(on));
  { const button = $('displayBtn'), label = button.querySelector('.btn-label'), text = on ? 'Exit monitor' : 'Monitor mode'; if (label) { label.textContent = text; button.title = text; } else button.textContent = text; }
  $('settingsDisplayBtn').textContent = on ? 'Exit monitor mode' : 'Open monitor mode';
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
async function toggleMonitor() {
  if (displayMode) {
    monitorFullscreen = false;
    setDisplayMode(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  // Request fullscreen directly from the click so browser user activation is retained.
  const request = document.documentElement.requestFullscreen?.();
  setDisplayMode(true);
  try {
    if (!request) throw new Error('unsupported');
    await request; monitorFullscreen = !!document.fullscreenElement;
  } catch { showNotice('Monitor layout is on. This browser does not support full screen; use its full-screen controls if available.'); }
}
function tick() {
  const now = new Date();
  $('houseDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  $('houseClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  render();
}
export function initHousehold(options) {
  onData = options.onData;
  getEventRecords=options.getEventRecords || (()=>[]);saveEventChecklist=options.saveEventChecklist;editEventChecklist=options.editEventChecklist;
  store = options.store; openEvent = options.openEvent; newEvent = options.newEvent; viewChanged = options.viewChanged;
  store.subscribe(next => { items = next; render(); window.dispatchEvent(new Event('hh:items')); }, (message, error = false) => { $('houseDataStatus').textContent = message; if (error) showNotice(message); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showView(b.dataset.go)));
  document.querySelectorAll('[data-life-tab]').forEach(b => b.addEventListener('click', () => showView(b.dataset.lifeTab)));
  document.querySelector('.life-tabs')?.addEventListener('keydown', e => {
    const tabs = [...document.querySelectorAll('[data-life-tab]')], at = tabs.findIndex(t => t.dataset.lifeTab === lifeTab);
    const next = e.key === 'ArrowRight' ? tabs[(at + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(at + tabs.length - 1) % tabs.length] : null;
    if (next) { e.preventDefault(); showView(next.dataset.lifeTab); next.focus(); }
  });
  document.querySelectorAll('[data-add-kind]').forEach(b => b.addEventListener('click', () => editItem(null, b.dataset.addKind)));
  document.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    currentKind = b.dataset.kind;
    document.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('active', x === b));
    const add = document.querySelector('#life-todos [data-add-kind]'); add.dataset.addKind = currentKind; add.textContent = currentKind === 'chore' ? '＋ Add a chore' : '＋ Add a checklist item'; render();
  }));
  document.querySelectorAll('[data-task-focus]').forEach(button => button.addEventListener('click', () => {
    taskFocus = button.dataset.taskFocus; render();
  }));
  $('taskSearch').addEventListener('input', render);
  $('taskSource').addEventListener('change',()=>{taskSource=$('taskSource').value;render();});
  $('newChecklist').addEventListener('click',()=>{$('standaloneChecklistForm').reset();$('standaloneChecklistError').textContent='';$('standaloneChecklistDialog').showModal();$('standaloneChecklistName').focus();});
  $('cancelStandaloneChecklist').addEventListener('click',()=>$('standaloneChecklistDialog').close());
  $('standaloneChecklistForm').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('saveStandaloneChecklist');button.disabled=true;$('standaloneChecklistError').textContent='';
    try {
      const list=$('standaloneChecklistName').value.trim(),lines=$('standaloneChecklistItems').value.split('\n').map(line=>line.trim()).filter(Boolean);
      if(!list || !lines.length || lines.length>100)throw new Error('Name your checklist and add between 1 and 100 items, one per line.');
      const records=lines.map(title=>validateItem({kind:'task',title,list,owner:$('standaloneChecklistOwner').value,due:$('standaloneChecklistDue').value,cadence:'none',quantity:'',category:'Other',completed:false}));
      await store.addMany(records);taskSource='all';$('taskSource').value='all';$('standaloneChecklistDialog').close();render();showNotice('Checklist created for the household.');
    } catch(error){$('standaloneChecklistError').textContent=friendlyError(error);} finally{button.disabled=false;}
  });
  $('resetTaskFilters').addEventListener('click', () => { taskFocus = 'all'; $('taskSearch').value = ''; render(); });
  $('houseOwner').addEventListener('change', render); $('showCompleted').addEventListener('change', render);
  $('quickEvent').addEventListener('click', () => newEvent());
  $('displayBtn').addEventListener('click', toggleMonitor);
  $('settingsDisplayBtn').addEventListener('click', toggleMonitor);
  document.addEventListener('fullscreenchange', () => {
    if (monitorFullscreen && !document.fullscreenElement) { monitorFullscreen = false; setDisplayMode(false); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && displayMode && !document.fullscreenElement) setDisplayMode(false); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); if (displayMode) setDisplayMode(true); } });
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
    try { await store.add(validateItem({ kind: 'grocery', title, owner: 'both', due: '', cadence: 'none', category: guessAisle(title), quantity: '', list: '', completed: false })); if (input.value.trim() === title) input.value = ''; showNotice('Added to the grocery list.'); }
    catch (error) { showNotice(friendlyError(error)); } finally { button.disabled = false; }
  });
  initGrocerySwipe($('groceryGroups'));
  $('clearBought').addEventListener('click', async () => {
    const bought = items.filter(x => x.kind === 'grocery' && x.completed); if (!bought.length) return;
    if (!confirm(`Clear ${bought.length} bought item${bought.length === 1 ? '' : 's'}?`)) return;
    $('clearBought').disabled = true;
    try { await store.removeMany(bought); showNotice('Bought items cleared.'); } catch (e) { showNotice(friendlyError(e)); } finally { $('clearBought').disabled = false; }
  });
  document.querySelector('.house-main').addEventListener('click', e => {
    const checklist=e.target.closest('[data-edit-event-checklist]');if(checklist)editEventChecklist?.(checklist.dataset.editEventChecklist);
    const remove = e.target.closest('[data-delete-item]'); if (remove) { removeGrocery(remove.dataset.deleteItem); return; }
    const edit = e.target.closest('[data-edit-item]'); if (edit) editItem(items.find(x => x.id === edit.dataset.editItem));
    const event = e.target.closest('[data-open-event]'); if (event) openEvent(event.dataset.openEvent, event.dataset.occ);
  });
  document.querySelector('.house-main').addEventListener('change', async e => {
    const eventCheck=e.target.closest('[data-event-check]');
    if(eventCheck) {
      const record=getEventRecords().find(item=>item.id===eventCheck.dataset.eventCheck);if(!record)return;
      const key=eventChecklistKey(record);if(pendingChecklists.has(key))return;
      const original=structuredClone(record),checklist=structuredClone(record.checklist);checklist[Number(eventCheck.dataset.checkIndex)].done=eventCheck.checked;
      pendingChecklists.add(key);eventCheck.closest('.event-checklist-group').querySelectorAll('input,button').forEach(el=>{el.disabled=true;});
      try {await saveEventChecklist(original,checklist);showNotice(eventCheck.checked?'Checked off. Event updated too.':'Back on the event checklist.');}
      catch(error){showNotice(friendlyError(error));}
      finally{pendingChecklists.delete(key);render();}return;
    }
    const checkbox = e.target.closest('[data-complete]'); if (!checkbox) return;
    const item = items.find(x => x.id === checkbox.dataset.complete); if (!item) return;
    checkbox.disabled = true;
    try {
      const before = { completed: !!item.completed, due: item.due || '', lastCompletedAt: item.lastCompletedAt || null, anchorDay: item.anchorDay || null };
      const patch = completionPatch(item); const updated = await store.update(item, patch);
      const recurring = item.kind === 'chore' && item.cadence !== 'none';
      showNotice(recurring ? `Done. Next up: ${dueLabel({ due: patch.due })}.` : patch.completed ? 'Checked off. Nicely done.' : 'Back on the list.', { label: 'Undo', run: () => store.update(updated, before) });
    } catch (error) { checkbox.checked = !!item.completed; checkbox.disabled = false; showNotice(friendlyError(error)); render(); }
  });
  showView(location.hash.slice(1)); tick(); setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 30000);
  if (localStorage.getItem('hh_display') === '1') setDisplayMode(true);
}
export function updateHouseholdEvents(next) { events = next; render(); }
// One tap (or a swipe left) removes a grocery item, with Undo instead of a confirm.
const removing = new Set();
async function removeGrocery(id) {
  const item = items.find(x => x.id === id && x.kind === 'grocery'); if (!item || removing.has(id)) return;
  removing.add(id);
  try {
    await store.remove(item);
    const { id:_id, version, createdAt, updatedAt, ...copy } = item;
    showNotice(`Removed ${item.title}.`, { label:'Undo', run:() => store.add(validateItem(copy)) });
  } catch (error) { showNotice(friendlyError(error)); render(); }
  finally { removing.delete(id); }
}
// Swipe a grocery row left to remove it. Short swipes spring back; vertical scrolling is left alone.
function initGrocerySwipe(root) {
  if (!root) return;
  let row = null, startX = 0, startY = 0, dx = 0, sideways = null;
  const reset = () => { if (row) { row.style.transform = ''; row.classList.remove('swiping'); row.style.removeProperty('--swipe'); } row = null; sideways = null; dx = 0; };
  root.addEventListener('touchstart', e => {
    const target = e.target.closest('[data-swipe-item]');
    if (!target || e.touches.length !== 1 || e.target.closest('input, button.item-delete')) return;
    row = target; startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; sideways = null;
  }, { passive:true });
  root.addEventListener('touchmove', e => {
    if (!row) return;
    const x = e.touches[0].clientX - startX, y = e.touches[0].clientY - startY;
    if (sideways === null && (Math.abs(x) > 10 || Math.abs(y) > 10)) sideways = Math.abs(x) > Math.abs(y) * 1.3;
    if (!sideways) { if (sideways === false) reset(); return; }
    dx = Math.min(0, x); row.classList.add('swiping'); row.style.transform = `translateX(${dx}px)`;
    row.style.setProperty('--swipe', String(Math.min(1, -dx / 110)));
  }, { passive:true });
  const end = () => {
    if (!row) return;
    const id = row.dataset.swipeItem, gone = dx < -110 || (dx < -70 && -dx > row.offsetWidth * 0.35);
    if (gone) { row.style.transform = 'translateX(-110%)'; row.classList.add('swiped'); setTimeout(() => removeGrocery(id), 160); row = null; sideways = null; dx = 0; }
    else reset();
  };
  root.addEventListener('touchend', end, { passive:true });
  root.addEventListener('touchcancel', reset, { passive:true });
}
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
  $('itemWithFrankie').checked = !!item?.withFrankie;
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
    const data = validateItem({ kind, withFrankie:kind !== 'grocery' && $('itemWithFrankie').checked, title: $('itemTitle').value, owner: kind === 'grocery' ? 'both' : $('itemOwner').value,
      due: kind === 'grocery' ? '' : $('itemDue').value, cadence: kind === 'chore' ? $('itemCadence').value : 'none',
      list: kind === 'task' ? $('itemList').value.trim().slice(0, 80) : '', quantity: kind === 'grocery' ? $('itemQuantity').value.trim().slice(0, 60) : '',
      category: kind === 'grocery' ? ($('itemCategory').value === 'Other' ? guessAisle($('itemTitle').value) : $('itemCategory').value) : 'Other', completed: old?.completed || false });
    if (old && old.due !== data.due) data.anchorDay = data.due ? Number(data.due.slice(-2)) : null;
    if (old) await store.update(old, data); else await store.add(data);
    $('itemDialog').close(); showNotice('Saved for the household.');
  } catch (error) { $('itemError').textContent = friendlyError(error); } finally { $('saveItem').disabled = false; }
}
function itemHTML(item) {
  const due = dueLabel(item); const sub = item.kind === 'grocery' ? esc(item.quantity || 'Tap to edit details') : `${item.due < dateKey() && item.due ? '<span class="overdue">' : '<span>'}${esc(due)}</span>${item.cadence !== 'none' ? `<span>↻ ${esc(item.cadence)}</span>` : ''}`;
  return `<div class="item-row ${item.withFrankie ? 'with-frankie ' : ''}${item.completed ? 'done' : ''}"${item.kind === 'grocery' ? ` data-swipe-item="${esc(item.id)}"` : ''}><input type="checkbox" class="item-check" data-complete="${esc(item.id)}" aria-label="${esc(item.completed ? 'Uncheck' : 'Complete')} ${esc(item.title)}" ${item.completed ? 'checked' : ''} /><div class="item-copy"><button type="button" class="item-edit" data-edit-item="${esc(item.id)}">${esc(item.title)}</button><div class="item-meta">${sub}</div></div>${item.kind !== 'grocery' ? `<span class="owner-tag ${esc(item.owner)}">${esc(OWNERS[item.owner] || 'Both')}${item.withFrankie ? ' + Frankie' : ''}</span>` : `<button type="button" class="item-delete" data-delete-item="${esc(item.id)}" aria-label="Remove ${esc(item.title)}" title="Remove">×</button>`}</div>`;
}
function empty(title, detail) { return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(detail)}</div>`; }
function groupsHTML(list, key, sortKeys) {
  const groups = new Map(); for (const item of list) { const name = key(item); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(item); }
  const keys = [...groups.keys()]; if (sortKeys) keys.sort((a,b) => sortKeys.indexOf(a) - sortKeys.indexOf(b));
  return keys.map(name => `<section class="list-group"><h3>${esc(name)}<span>${groups.get(name).length} item${groups.get(name).length === 1 ? '' : 's'}</span></h3>${groups.get(name).map(itemHTML).join('')}</section>`).join('');
}
function eventGroupHTML(group,visible) {
  const record=group.record,done=record.checklist.filter(item=>item.done).length,disabled=pendingChecklists.has(group.key)?'disabled':'';
  return `<section class="list-group event-checklist-group"><header><div><span class="eyebrow">${record.icloud?'APPLE EVENT':'HOUSEHOLD EVENT'}${record.recurring || (record.repeat && record.repeat!=='none')?' · SHARED SERIES LIST':''}</span><h3>${esc(group.title)}<span>${done}/${record.checklist.length} done</span></h3><p>${esc(localDate(group.due).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}))} · ${esc(record.owner==='custom' ? record.ownerCustom || 'Other' : OWNERS[record.owner] || 'Both')}${record.withFrankie?' + Frankie':''}${record.checklistOnly?' · Saved event date':''}</p></div><button type="button" class="text-link" data-edit-event-checklist="${esc(record.id)}" ${disabled}>Edit checklist →</button></header><div class="list-progress" aria-hidden="true"><i style="width:${Math.round(done/record.checklist.length*100)}%"></i></div>${visible.map(item=>`<label class="item-row ${item.done?'done':''}"><input type="checkbox" class="item-check" data-event-check="${esc(record.id)}" data-check-index="${item.index}" ${item.done?'checked':''} ${disabled}/><span class="item-copy">${esc(item.text)}</span></label>`).join('')}</section>`;
}
function render() {
  if (!$('homeAgenda')) return;
  onData?.(events, items);
  const today = dateKey(), now = new Date();
  const pending = items.filter(x => !x.completed && x.kind !== 'grocery');
  const due = pending.filter(x => !x.due || x.due <= today);
  const groceries = items.filter(x => x.kind === 'grocery');
  const todayEvents = eventsOnDay(events, now);
  $('statEvents').textContent = todayEvents.length; $('statTasks').textContent = due.length; $('statGroceries').textContent = groceries.filter(x => !x.completed).length;
  $('daySummary').textContent = todayEvents.length ? `${todayEvents.length} plan${todayEvents.length === 1 ? '' : 's'} today. ${due.length ? `${due.length} little thing${due.length === 1 ? '' : 's'} to take care of.` : 'A little room to breathe.'}` : 'A little room to breathe. Make today your own.';
  const upcoming = events.filter(e => eventEnd(e) > (e.allDay ? new Date(`${today}T00:00:00`) : now)).sort((a,b) => localDate(a.start) - localDate(b.start)).slice(0, 5);
  renderHTML($('homeAgenda'), upcoming.length ? upcoming.map(e => {
    const d = localDate(e.start), owner = e.extendedProps?.owner || 'both';
    const time = e.allDay ? 'All day' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `<button type="button" class="agenda-row${e.extendedProps?.withFrankie ? ' with-frankie' : ''}" data-open-event="${esc(e.extendedProps?.sourceId || e.id)}" data-occ="${esc(d.toISOString())}"><span class="agenda-date">${esc(d.toLocaleDateString([], { weekday: 'short' }).toUpperCase())}<strong>${d.getDate()}</strong>${esc(d.toLocaleDateString([], { month: 'short' }))}</span><span class="agenda-copy ${esc(owner)}"><strong>${esc(e.title)}</strong><small>${esc(time)}${e.extendedProps?.icloud ? ' · iCloud' : ''}</small></span><span class="agenda-owner">${esc(OWNERS[owner] || 'Both')}${e.extendedProps?.withFrankie ? ' + Frankie' : ''}</span></button>`;
  }).join('') : empty('Nothing coming up yet.', 'Add your first plan, or connect an iCloud calendar in Settings.'));
  const sorted = [...pending].sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999'));
  renderHTML($('homeChores'), sorted.length ? sorted.slice(0, 5).map(itemHTML).join('') : empty('A fresh start for your home.', 'Add a chore or a checklist item to get everyone on the same page.'));
  const owner = $('houseOwner').value, completed = $('showCompleted').checked;
  const allTasks = items.filter(x => x.kind === currentKind && (owner === 'all' || x.owner === owner));
  const tasks = filterTaskItems(allTasks.filter(x => completed || !x.completed), { timing: taskFocus, text: $('taskSearch').value, today }).sort((a,b) => Number(a.completed) - Number(b.completed) || (a.due || '9999').localeCompare(b.due || '9999'));
  document.querySelectorAll('[data-task-focus]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.taskFocus === taskFocus)));
  $('resetTaskFilters').hidden = taskFocus === 'all' && !$('taskSearch').value;
  const doneToday = allTasks.filter(x => x.lastCompletedAt && dateKey(new Date(x.lastCompletedAt)) === today).length;
  $('tasksProgress').textContent = `${doneToday} taken care of today · ${tasks.length} shown · ${allTasks.filter(x => !x.completed).length} still to do`;
  const isChecklist=currentKind==='task';
  $('newChecklist').hidden=!isChecklist;$('taskSourceWrap').hidden=!isChecklist;
  $('taskGroups').hidden=isChecklist && taskSource==='events';
  renderHTML($('taskGroups'), tasks.length ? groupsHTML(tasks, x => x.completed ? 'Completed' : isChecklist ? x.list || 'Everyday checklist' : x.due && x.due < today ? 'Needs a little love' : x.due === today ? 'For today' : x.due ? 'Coming up' : 'Anytime') : isChecklist ? empty('Your own little lists.', 'Create a checklist for cleaning the shower, packing, or anything else. No event needed.') : taskFocus !== 'all' || $('taskSearch').value.trim() ? empty('No matches here.', 'Try a different timing filter or clear your search.') : empty('All clear here.', 'Add a chore to share the load.'));
  $('eventChecklistSection').hidden=!isChecklist || taskSource==='standalone';
  if(isChecklist) {
    const groups=eventChecklistGroups(getEventRecords()).filter(group=>owner==='all' || group.owner===owner || (['hanry','karena'].includes(owner) && group.owner==='both'));
    let shown=0;
    const markup=groups.map(group=>{const visible=filterTaskItems(group.items.filter(item=>completed || !item.done),{timing:taskFocus,text:$('taskSearch').value,today});shown+=visible.length;return visible.length?eventGroupHTML(group,visible):'';}).join('');
    renderHTML($('eventChecklistGroups'),markup || empty('No event checklist items here yet.', 'Add items inside a household or Apple event. They’ll appear here automatically.'));
    $('tasksProgress').textContent=`${taskSource==='events'?0:tasks.length} standalone items · ${taskSource==='standalone'?0:shown} event items shown`;
  }
  const count = (id, n) => { const el = $(id); if (el) el.textContent = n ? String(n) : ''; };
  count('lifeTodoCount', due.length); count('lifeGroceryCount', groceries.filter(x => !x.completed).length);
  $('groceryCount').textContent = `${groceries.filter(x => !x.completed).length} to pick up · ${groceries.filter(x => x.completed).length} in the basket`;
  $('clearBought').disabled = !groceries.some(x => x.completed);
  renderHTML($('groceryGroups'), groceries.length ? groupsHTML([...groceries].sort((a,b) => Number(a.completed) - Number(b.completed) || a.title.localeCompare(b.title)), x => x.completed ? 'In the basket' : x.category && x.category !== 'Other' ? x.category : guessAisle(x.title), [...CATEGORIES, 'In the basket']) : empty('The list is ready when you are.', 'Add the first thing you need. It’ll be here on your next store run.'));
}
