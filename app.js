import { initCatCrew } from './cat-crew.js';
import { logBabyFromText } from './baby.js';
import { initUpgrades } from './upgrades.js';
import { createPlaceWeather, usePlaceWeather, sampleWeatherFetch } from './place-weather.js';
import { OWNER_STYLE, normalizeDocs, expandRepeats, roundToNextHour } from './event-data.js';
import { ensureCatLinkMarkup, setCatMode, LS_CATMODE } from './cat-mode.js';
import { firestoreStore } from './stores.js';
import { connectCalendarPage, wireCalendarPage, getCalendar, getVisibleEvents, initCalendarUI, openFromPanel, renderCalendarFromCache, renderPanels, searchInput, setSearchUIState } from './calendar-page.js';
import { connectEventWindow, initDateEditor, wireEventWindow, openEventModal, openTaskModal, updateEventOverlap, backdrop, defaultCalendar, drawDetailsWhere, whereBox } from './event-window.js';
import { startFeatures, showStartupProblems } from './features.js';
import { holidaysEnabled } from './holidays.js';
import { birthdaysShown } from './birthdays-model.js';
import { checklistKey, eventChecklistKey } from './checklists.js';
// app.js — Hubert’s House
// Household dashboard, authenticated Firebase sync and iCloud calendar integration.
// Upcoming + Outstanding checklist panels + checklist-focused modal
// Month title tap = jump-to-month + swipe left/right to change months/weeks/days

import { config } from './config.js';
import { initHousehold, updateHouseholdEvents, showNotice, showView } from './household.js';
import { initCloudCalendar, setCloudRange, refreshCloud, saveCloudAssignment, deleteCloudEvent } from './cloud-calendar.js';
import { demoStore, demoEvents } from './demo.js';
import { initDashboard } from './dashboard.js';
import { initHomeCalendar } from './home-calendar.js';
import { eventTemplate } from './event-templates.js';
import { initWeather } from './weather.js';
import { renderWeekBrief } from './week-brief.js';
import { initCalendarExperience } from './calendar-view.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
const demo = new URLSearchParams(location.search).get('demo') === '1';
// Weather where events are (outside Richmond): Open-Meteo, or made-up numbers in the preview.
usePlaceWeather(createPlaceWeather({ fetch:demo ? sampleWeatherFetch() : undefined, onUpdate:() => { homeCalendar?.render(); drawDetailsWhere(); whereBox?.refresh(); } }));
const gate = document.getElementById('gate');
const gateForm = document.getElementById('gateForm');
const gateInput = document.getElementById('gateInput');
const rememberDevice = document.getElementById('rememberDevice');
let auth, memberVerified = false, dataStarted = false;
function isUnlocked() { return demo || memberVerified; }
async function lock() {
  if (demo) { location.href = location.pathname; return; }
  await signOut(auth);
  location.reload();
}
gateForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const button = document.getElementById('signInBtn'), errorBox = document.getElementById('gateError'); button.disabled = true;
  errorBox.textContent = '';
  // Already signed in but the app didn't finish starting: a fresh start is what's needed
  // (signing in again as the same person wouldn't trigger anything).
  if (auth?.currentUser) { errorBox.textContent = 'Starting Hubert’s House…'; location.reload(); return; }
  // Never sit silently: say so if sign-in takes too long.
  const slow = setTimeout(() => { errorBox.textContent = 'Sign-in is taking a long time. Check your connection, or close the app and open it again.'; }, 20000);
  try {
    await setPersistence(auth, rememberDevice.checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, document.getElementById('gateEmail').value.trim(), gateInput.value);
  } catch (error) {
    errorBox.textContent = (error.code === 'auth/operation-not-allowed' || error.code === 'auth/configuration-not-found'
      ? 'Household sign-in needs to be activated. Use the sample preview while setup is completed.'
      : error.code === 'auth/network-request-failed' ? 'Could not reach sign-in. Check your connection and try again.'
      : error.code === 'auth/too-many-requests' ? 'Too many tries for now. Wait a few minutes, then try again.'
      : 'Could not sign in. Check your household email and password.') + (error.code ? ` (${error.code})` : '');
  } finally { clearTimeout(slow); gateInput.value = ''; button.disabled = false; }
});


// Show/hide gate immediately
if (isUnlocked()) gate?.classList.add("hidden");
else gate?.classList.remove("hidden");

// ---------- Topbar / controls ----------
const logoutBtn = document.getElementById("logoutBtn");

const fab = document.getElementById("fab");

logoutBtn?.addEventListener("click", lock);

// ---------- iOS modal scroll fix ----------
function scrollToTopSafely(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    try { el.scrollTop = 0; } catch {}
  });
}


// ---------- Firebase ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, setDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = config.firebase;

let db, eventsCol;
let calendarExperience, homeCalendar;

// In-memory cache from Firestore
let rawDocs = [];
let cloudChecklistDocs = [];
let localDocs = [], cloudDocs = [];
let expandedEvents = [];


// What the Calendar page (calendar-page.js) shares with this file.
connectCalendarPage({
  get demo() { return demo; }, get rawDocs() { return rawDocs; }, get expandedEvents() { return expandedEvents; }, get calendarExperience() { return calendarExperience; },
  addEventOnDay, scrollToTopSafely
});
// What the event windows (event-window.js) share with this file.
connectEventWindow({
  get auth() { return auth; }, get demo() { return demo; },
  get rawDocs() { return rawDocs; }, get localDocs() { return localDocs; }, get cloudDocs() { return cloudDocs; }, get expandedEvents() { return expandedEvents; },
  deleteEventWithUndo, saveEventChecklist, saveLocalEvent, scrollToTopSafely
});

// ---------- Init ----------
initCatCrew();
initDashboard({ onAppearanceChange: () => getCalendar()?.updateSize() });
ensureCatLinkMarkup();
setCatMode((localStorage.getItem(LS_CATMODE) || "0") === "1");
setSearchUIState();

async function initApp() {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app); eventsCol = collection(db, 'events'); auth = getAuth(app);
  initCalendarUI(); initUIHooks(); initWeather({ demo });
  calendarExperience = initCalendarExperience({ calendar: getCalendar(), getEvents: () => expandedEvents, getFilteredEvents: getVisibleEvents,
    openEvent: (id, occurrence) => openFromPanel(id, occurrence, false),
    addEvent: addEventOnDay
  });
  homeCalendar = initHomeCalendar({ getEvents: () => expandedEvents,
    openEvent: (id, occurrence) => openFromPanel(id, occurrence, false), addEvent: addEventOnDay,
    onRangeChange: range => { if (!demo && !document.getElementById('view-today').classList.contains('hidden')) setCloudRange(range.start.toISOString(), range.end.toISOString()); }
  });
  if (demo) {
    gate.classList.add('hidden'); document.getElementById('demoBanner').classList.remove('hidden');
    document.getElementById('accountLabel').textContent = 'Preview mode. No real household or Apple data is loaded.';
    startHousehold(demoStore()); localDocs = demoEvents(); rebuildEvents();
    setCalendarStatus('Sample calendar', 'ready');
    initCloudCalendar(null,{demo:true,onEvents:() => {},onCalendars:() => {}}); startFeatures(featureHooks(null)); return;
  }
  onAuthStateChanged(auth,async user => {
    if (!user) { memberVerified = false; gate.classList.remove('hidden'); if (dataStarted) location.reload(); return; }
    try {
      const member = await getDoc(doc(db, 'households', 'home', 'members', user.uid));
      if (!member.exists() || member.data().active !== true) {
        document.getElementById('gateError').textContent = 'This account has not been added to the household yet.';
        await signOut(auth); return;
      }
      memberVerified = true; gate.classList.add('hidden');
      document.getElementById('accountLabel').textContent = `Signed in as ${user.email || 'household member'}`;
      if (dataStarted) return; dataStarted = true;
      startHousehold(firestoreStore(db));
      onSnapshot(query(eventsCol, orderBy('start','asc')), { includeMetadataChanges: true }, snap => {
        localDocs = snap.docs.map(d => ({id:d.id,...d.data()})); rebuildEvents();
        setCalendarStatus(snap.metadata.hasPendingWrites ? 'Saving changes…' : snap.metadata.fromCache ? 'Cached calendar' : 'Shared · up to date', snap.metadata.fromCache ? 'offline' : 'ready');
      }, () => {
        setCalendarStatus('Sync unavailable', 'offline');
        showNotice('The calendar could not sync. Check your connection and household access.');
      });
      startFeatures(featureHooks(app));
      try { await initCloudCalendar(app,{
        onEvents:records => { cloudDocs = records.map(e => ({...e,end:e.editEnd,cloudEnd:e.end,owner:e.owner || 'both',type:'general',checklist:e.checklist || [],repeat:'none'})); rebuildEvents(); },
        onChecklists:records => {cloudChecklistDocs=records;},
        onCalendars:connection => {
          const select = document.getElementById('evtCalendar'); const current = select.value;
          select.replaceChildren(new Option('Hubert’s House','household'));
          for (const c of connection.calendars || []) if (connection.selected.includes(c.id) && c.writable) select.add(new Option(`${c.name} · iCloud`,c.id));
          if ([...select.options].some(o => o.value === current)) select.value = current;
          const preference = document.getElementById('defaultCalendar');
          preference.replaceChildren(...[...select.options].map(option => option.cloneNode(true)));
          preference.value = defaultCalendar();
        }
      }); } catch (error) { console.error('iCloud calendar didn’t start', error); showStartupProblems([{ name:'iCloud calendar', code:error?.code || error?.name || 'error' }]); }
    } catch (error) {
      // Show what failed (a code, never data), and let the next tap start fresh.
      console.error('Starting after sign-in failed', error);
      const detail = error?.code || error?.name || 'startup';
      document.getElementById('gateError').textContent = `Could not finish signing in (${detail}). Tap “Come on in” to try again.`; gate.classList.remove('hidden');
    }
  });
}
function setCalendarStatus(message, state) {
  for (const id of ['calendarDataStatus', 'homeCalendarStatus']) {
    const element = document.getElementById(id); element.textContent = message; element.dataset.state = state;
  }
}
function addEventOnDay(day, lastDay) {
  const start = new Date(day); start.setHours(lastDay ? 0 : 9, 0, 0, 0);
  const end = lastDay ? new Date(lastDay) : new Date(start.getTime() + 3600000);
  openEventModal({ mode: 'create', title: '', start, end, allDay: !!lastDay, owner: 'both', type: 'general', repeat: 'none', notes: '', checklist: [] });
}
function startHousehold(store) {
  initHousehold({ store, onData: (events, items) => { renderWeekBrief(events, items); homeCalendar?.render(); },
    getEventRecords:()=>[...cloudChecklistDocs,...rawDocs],
    editEventChecklist:(id)=>{const record=findEventRecord(id);if(record)openTaskModal(record,new Date(record.start));},
    saveEventChecklist,
    openEvent:(id,occ) => openFromPanel(id,occ,false), newEvent:() => fab.click(), viewChanged: view => {
      getCalendar()?.updateSize();
      if (!demo) {
        if(view==='life')refreshCloud({force:false});
        const range = view === 'today' ? homeCalendar?.getRange() : view === 'calendar' ? { start: getCalendar().view.activeStart, end: getCalendar().view.activeEnd } : null;
        if (range) setCloudRange(range.start.toISOString(), range.end.toISOString());
      }
    }
  });
}
// What features.js needs from the calendar here.
function featureHooks(app) {
  return { app, db:demo ? null : db, demo, startUpgrades, bathChanged, calendarChanged:() => { renderCalendarFromCache(); homeCalendar?.render(); } };
}
function startUpgrades() {
  const click = id => document.getElementById(id)?.click();
  const babyLog = kind => { const button = document.querySelector(`#view-today [data-baby-log="${kind}"]`); if (button && !button.disabled) button.click(); else { showView('settings'); showNotice('Connect Huckleberry to log from here.'); } };
  initUpgrades({
    unlocked:isUnlocked, getEvents:() => expandedEvents, showView, notice:showNotice, logBaby:log => logBabyFromText(log),
    openEvent:(id, occurrence) => openFromPanel(id, occurrence, false),
    openDraft:payload => { if (isUnlocked()) openEventModal(payload); },
    addGrocery:title => { showView('groceries'); const input = document.getElementById('quickGrocery'); input.value = title; document.getElementById('quickGroceryForm').requestSubmit(); },
    searchCalendar:text => { showView('calendar'); requestAnimationFrame(() => { searchInput.value = text; searchInput.dispatchEvent(new Event('input')); searchInput.focus(); }); },
    actions:() => [
      { group:'Go to', icon:'⌂', label:'Today', keywords:'home dashboard', run:() => showView('today') },
      { group:'Go to', icon:'▦', label:'Calendar', keywords:'month week', run:() => showView('calendar') },
      { group:'Go to', icon:'☺', label:'Frankie', keywords:'baby sleep bottles scoreboard charts', run:() => showView('frankie') },
      { group:'Go to', icon:'✓', label:'To-dos', keywords:'life chores tasks checklists', run:() => showView('tasks') },
      { group:'Go to', icon:'🛒', label:'Groceries', keywords:'life shopping list', run:() => showView('groceries') },
      { group:'Go to', icon:'🍽', label:'Meals', keywords:'life dinner meal plan publix bogo recipes', run:() => showView('meals') },
      { group:'Go to', icon:'💡', label:'Devices', keywords:'smart home lights hue sonos music speakers litter robot feeder lock camera fan', run:() => showView('devices') },
      { group:'Go to', icon:'⚙', label:'Settings', keywords:'preferences huckleberry icloud', run:() => showView('settings') },
      { group:'Actions', icon:'＋', label:'New event', keywords:'add plan create', run:() => fab.click() },
      { group:'Actions', icon:'♡', label:'Plan a date night', keywords:'template romance', run:() => openEventModal(eventTemplate('date-night')) },
      { group:'Actions', icon:'◷', label:'Add an appointment', keywords:'doctor template', run:() => openEventModal(eventTemplate('appointment')) },
      { group:'Frankie', icon:'🍼', label:'Log a bottle', keywords:'feed ounces milk formula', run:() => babyLog('bottle') },
      { group:'Frankie', icon:'☾', label:'Start or finish a sleep timer', keywords:'nap', run:() => { showView('today'); click('babySleep'); } },
      { group:'Frankie', icon:'＋', label:'Log a finished sleep', keywords:'nap', run:() => babyLog('sleep-log') },
      { group:'Frankie', icon:'♡', label:'Log a diaper', keywords:'change wet dirty', run:() => babyLog('diaper') },
      { group:'Actions', icon:'◐', label:'Toggle dark mode', keywords:'theme night light', run:() => click('themeToggle') },
      { group:'Actions', icon:'⛶', label:'Monitor mode', keywords:'fullscreen display kiosk', run:() => click('displayBtn') }
    ]
  });
}
// Bath days changed: redraw everything that shows them.
function bathChanged() { renderCalendarFromCache(); homeCalendar?.render(); window.dispatchEvent(new Event('hh:events')); }
function rebuildEvents() {
  rawDocs = [...localDocs,...cloudDocs];
  expandedEvents = [...expandRepeats(normalizeDocs(localDocs)),...cloudDocs.map(e => ({
    id:e.id,title:e.title,start:e.start,end:e.cloudEnd,allDay:e.allDay,
    backgroundColor:(OWNER_STYLE[e.owner] || OWNER_STYLE.both).bg,borderColor:(OWNER_STYLE[e.owner] || OWNER_STYLE.both).border,textColor:'#34432e',editable:!e.readOnlyReason,
    extendedProps:{sourceId:e.id,location:e.location || '',owner:e.owner || 'both',ownerCustom:e.ownerCustom || '',withFrankie:!!e.withFrankie,type:'general',notes:e.notes,checklist:e.checklist || [],icloud:true,isRepeatOccurrence:!!e.recurring}
  }))];
  renderCalendarFromCache(); renderPanels(); updateHouseholdEvents(expandedEvents); window.dispatchEvent(new Event('hh:events'));
  if (!backdrop?.classList.contains("hidden")) updateEventOverlap();
}
function findEventRecord(id) { return rawDocs.find(record=>record.id===id) || cloudChecklistDocs.find(record=>record.id===id); }
async function saveEventChecklist(original,checklist) {
  if(original.icloud) {
    const result=await saveCloudAssignment({owner:original.owner,ownerCustom:original.ownerCustom || '',withFrankie:!!original.withFrankie,checklist},original);
    const metadata=result.assignment || {checklist};
    for(const record of [...cloudDocs,...cloudChecklistDocs])if(eventChecklistKey(record)===eventChecklistKey(original))Object.assign(record,metadata);
    rebuildEvents();return {...original,...metadata};
  }
  const check=current=>{if(!current || checklistKey(current.checklist)!==checklistKey(original.checklist))throw new Error('This checklist changed on another device. Reopen it before saving.');};
  if(demo) {check(findEventRecord(original.id));await saveLocalEvent(original.id,{checklist});}
  else await runTransaction(db,async transaction=>{const ref=doc(db,'events',original.id),snapshot=await transaction.get(ref);check(snapshot.exists()?snapshot.data():null);transaction.update(ref,{checklist,updatedAt:serverTimestamp()});});
  return {...original,checklist};
}
async function saveLocalEvent(id,payload,expectedChecklist) {
  const check=current=>{if(expectedChecklist!==undefined && checklistKey(current?.checklist)!==checklistKey(expectedChecklist))throw new Error('This event checklist changed. Reopen the event before saving.');};
  if (demo) {
    if (id) { const item=localDocs.find(d => d.id === id);check(item);if (item) Object.assign(item,payload,{updatedAt:new Date()}); }
    else localDocs.push({...payload,id:crypto.randomUUID(),createdAt:new Date(),updatedAt:new Date()});
    rebuildEvents(); return;
  }
  if (id && expectedChecklist!==undefined) await runTransaction(db,async transaction=>{const ref=doc(db,'events',id),snapshot=await transaction.get(ref);if(!snapshot.exists())throw new Error('This event was deleted.');check(snapshot.data());transaction.update(ref,payload);});
  else if (id) await updateDoc(doc(db,'events',id),payload);
  else await addDoc(eventsCol,{...payload,createdAt:serverTimestamp()});
}
// Deletes an event. Household events come back with Undo (returns the undo); iCloud ones can't.
async function removeEvent(id) {
  const original = rawDocs.find(d => d.id === id), stored = localDocs.find(d => d.id === id);
  if (original?.icloud) { await deleteCloudEvent(original); cloudDocs=cloudDocs.filter(d => d.id !== id); rebuildEvents(); await refreshCloud(); return null; }
  if (demo) { localDocs=localDocs.filter(d => d.id !== id); rebuildEvents(); return stored ? async () => { localDocs=[...localDocs,stored]; rebuildEvents(); } : null; }
  await deleteDoc(doc(db,'events',id));
  return stored ? async () => { const { id:_, ...data } = stored; await setDoc(doc(db,'events',id),data); } : null;
}
// The delete buttons: no “are you sure?” for household events, just Undo for a few seconds.
async function deleteEventWithUndo(id) {
  const original = rawDocs.find(d => d.id === id);
  if (original?.icloud && !confirm('Delete this event from iCloud? This can’t be undone.')) return false;
  let undo;
  try { undo = await removeEvent(id); } catch (e) { showNotice(e.message); return false; }
  const title = original?.title ? `“${original.title}”` : 'the event';
  showNotice(`Deleted ${title}.`, undo ? { label:'Undo', run:async () => { await undo(); showNotice(`${title[0].toUpperCase()}${title.slice(1)} is back.`); } } : undefined);
  return true;
}

// ---------- UI hooks ----------
function initUIHooks() {
  initDateEditor();
  const holidays = document.getElementById('calendarHolidays'); holidays.checked=holidaysEnabled();
  holidays.addEventListener('change',()=>{try {localStorage.setItem('hh_holidays',holidays.checked?'1':'0');}catch{} renderCalendarFromCache();homeCalendar?.render();});
  const birthdays = document.getElementById('calendarBirthdays'); birthdays.checked=birthdaysShown();
  birthdays.addEventListener('change',()=>{try {localStorage.setItem('hh_birthdays',birthdays.checked?'1':'0');}catch{} renderCalendarFromCache();homeCalendar?.render();window.dispatchEvent(new Event('hh:birthdays'));});
  document.querySelectorAll('[data-event-template]').forEach(button => button.addEventListener('click', () => {
    if (isUnlocked()) openEventModal(eventTemplate(button.dataset.eventTemplate));
  }));
  document.addEventListener('keydown', event => {
    if (!isUnlocked() || !document.getElementById('keyboardShortcuts').checked || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') || document.querySelector('dialog[open], .modal-backdrop:not(.hidden)')) return;
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); fab.click(); }
    if (event.key === '/') { event.preventDefault(); showView('calendar'); requestAnimationFrame(() => searchInput?.focus()); }
  });

  wireCalendarPage();

  fab?.addEventListener("click", () => {
    const start = roundToNextHour(new Date());
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    openEventModal({
      mode: "create",
      title: "",
      start,
      end,
      allDay: false,
      owner: "both",
      ownerCustom: "",
      type: "general",
      repeat: "none",
      repeatUntil: "",
      notes: "",
      checklist: []
    });
  });

  wireEventWindow();

}



// Owners, presets, event data and date helpers live in event-data.js.
// ---------- Start ----------
initApp().catch(() => {
  document.getElementById('gateError').textContent = 'The app could not start. Check your connection and reload.';
});
