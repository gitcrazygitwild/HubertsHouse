import { overlappingEvents, preferredCalendar } from './event-planning.js';
import { initCatCrew } from './cat-crew.js';
import { logBabyFromText } from './baby.js';
import { sweetspotPatch } from './prediction-log.js';
import { initUpgrades } from './upgrades.js';
import { parseQuickAdd, describeDraft } from './quick-add.js';
import { createPlaceWeather, usePlaceWeather, eventWeatherLine, sampleWeatherFetch, searchPlaces, whereBoxText } from './place-weather.js';
import { initPlaceSuggest } from './place-suggest.js';
import { OWNER_STYLE, normalizeOwner, CHECKLIST_PRESETS, normalizeDocs, expandRepeats, advanceRepeat, makeInclusiveAllDayEnd, makeFcEvent, renderPanelCardHTML, renderPanelCardHTMLWithProgress, formatWhenForPanel, toInputValue, fromInputValue, roundToNextHour, escapeHtml } from './event-data.js';
import { ensureCatLinkMarkup, setCatMode, LS_CATMODE } from './cat-mode.js';
import { firestoreStore } from './stores.js';
import { connectEventWindow, initDateEditor, wireEventWindow, openEventModal, openTaskModal, persistMovedEvent, updateEventOverlap, backdrop, defaultCalendar, drawDetailsWhere, whereBox } from './event-window.js';
import { startFeatures, showStartupProblems } from './features.js';
import { renderChecklistUI, addChecklistItemUI, readChecklistUI } from './checklist-ui.js';
import { renderUpcomingList, renderOutstandingList } from './panels.js';
import { initEventDateEditor } from './event-editor.js';
import { holidayEvents, holidaysEnabled } from './holidays.js';
import { birthdayEvents, birthdaysShown } from './birthdays-model.js';
import { bathEvents } from './bath-days.js';
import { trashEvents } from './trash-days.js';
import { checklistKey, eventChecklistKey } from './checklists.js';
// app.js — Hubert’s House
// Household dashboard, authenticated Firebase sync and iCloud calendar integration.
// Upcoming + Outstanding checklist panels + checklist-focused modal
// Month title tap = jump-to-month + swipe left/right to change months/weeks/days

import { config } from './config.js';
import { initHousehold, updateHouseholdEvents, showNotice, showView } from './household.js';
import { initCloudCalendar, setCloudRange, refreshCloud, saveCloudEvent, saveCloudAssignment, deleteCloudEvent } from './cloud-calendar.js';
import { demoStore, demoEvents } from './demo.js';
import { initDashboard } from './dashboard.js';
import { initHomeCalendar } from './home-calendar.js';
import { eventTemplate } from './event-templates.js';
import { initWeather } from './weather.js';
import { renderWeekBrief } from './week-brief.js';
import { dateKey } from './household-model.js';
import { initCalendarExperience, calendarEventContent } from './calendar-view.js';
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

let updatesModalShownThisLoad = false;

// Show/hide gate immediately
if (isUnlocked()) gate?.classList.add("hidden");
else gate?.classList.remove("hidden");

// ---------- Topbar / controls ----------
const logoutBtn = document.getElementById("logoutBtn");

// Calendar nav buttons in the card row
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const todayBtn = document.getElementById("todayBtn");

const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");

const searchFiltersBtn = document.getElementById("searchFiltersBtn");
const closeSearchFiltersBtn = document.getElementById("closeSearchFiltersBtn");
const searchFilters = document.getElementById("searchFilters");
const searchFrom = document.getElementById("searchFrom");
const searchTo = document.getElementById("searchTo");
const clearDatesBtn = document.getElementById("clearDatesBtn");

const ownerFilter = document.getElementById("ownerFilter");
const fab = document.getElementById("fab");

logoutBtn?.addEventListener("click", lock);

// ---------- iOS modal scroll fix ----------
function scrollToTopSafely(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    try { el.scrollTop = 0; } catch {}
  });
}

// ---------- Search UI state ----------
function setSearchUIState() {
  const hasText = !!(searchInput?.value || "").trim();
  const hasDates = !!(searchFrom?.value || searchTo?.value);

  searchClearBtn?.classList.toggle("hidden", !hasText);

  searchFiltersBtn?.classList.toggle("is-active", hasDates);
}

searchClearBtn?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  searchText = "";
  setSearchUIState();
  applySearchAndFilters(true);
});

searchFiltersBtn?.addEventListener("click", () => {
  searchFilters?.classList.toggle("hidden");
  searchFiltersBtn?.setAttribute("aria-expanded", String(!searchFilters?.classList.contains("hidden")));
  searchFiltersBtn?.classList.toggle(
    "is-active",
    !searchFilters?.classList.contains("hidden")
  );
});

closeSearchFiltersBtn?.addEventListener("click", () => {
  searchFilters?.classList.add("hidden");
  searchFiltersBtn?.setAttribute("aria-expanded", "false");
  searchFiltersBtn?.classList.remove("is-active");
});

// Click outside popover closes it
document.addEventListener("click", (e) => {
  if (!searchFilters || searchFilters.classList.contains("hidden")) return;
  const wrap = document.querySelector(".search-wrap");
  if (wrap && !wrap.contains(e.target)) {
    searchFilters.classList.add("hidden");
    searchFiltersBtn?.setAttribute("aria-expanded", "false");
    searchFiltersBtn?.classList.remove("is-active");
  }
});

clearDatesBtn?.addEventListener("click", () => {
  if (searchFrom) searchFrom.value = "";
  if (searchTo) searchTo.value = "";
  setSearchUIState();
  applySearchAndFilters(true);
});


// ---------- Jump-to-month modal ----------
const jumpBackdrop = document.getElementById("jumpBackdrop");
const jumpClose = document.getElementById("jumpClose");
const jumpCancel = document.getElementById("jumpCancel");
const jumpGoBtn = document.getElementById("jumpGoBtn");
const jumpMonthSelect = document.getElementById("jumpMonthSelect");
const jumpYearSelect = document.getElementById("jumpYearSelect");

// Panels
const upcomingListEl = document.getElementById("upcomingList");
const outstandingListEl = document.getElementById("outstandingList");
const updatesListEl = document.getElementById("updatesList");

const updatesBackdrop = document.getElementById("updatesBackdrop");
const updatesClose = document.getElementById("updatesClose");
const updatesDone = document.getElementById("updatesDone");
const updatesModalList = document.getElementById("updatesModalList");
const updatesDontShow = document.getElementById("updatesDontShow");

const LS_UPDATES_HIDE = "huberts_house_updates_hide_v1";
const LS_UPDATES_LASTSEEN = "huberts_house_updates_lastseen_v1";

const outPrev = document.getElementById("outPrev");
const outNext = document.getElementById("outNext");
const outPage = document.getElementById("outPage");

function closeUpdatesModal() {
  updatesBackdrop?.classList.add("hidden");
}

function openUpdatesModal(html) {
  if (updatesModalList) updatesModalList.innerHTML = html || "No new events.";
  updatesBackdrop?.classList.remove("hidden");
}

// ---------- Firebase ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDoc,
  runTransaction,
  writeBatch,
  limit
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = config.firebase;

let db, eventsCol;
let calendar, calendarExperience, homeCalendar;

// In-memory cache from Firestore
let rawDocs = [];
let cloudChecklistDocs = [];
let localDocs = [], cloudDocs = [];
let expandedEvents = [];


// Outstanding pagination
let outstandingPage = 1;
const OUT_PAGE_SIZE = 10;

// Search state
let searchText = "";

// Filter state
let ownerFilterValue = "all";
// What the event windows (event-window.js) share with this file.
connectEventWindow({
  get auth() { return auth; }, get demo() { return demo; },
  get rawDocs() { return rawDocs; }, get localDocs() { return localDocs; }, get cloudDocs() { return cloudDocs; }, get expandedEvents() { return expandedEvents; },
  deleteEventWithUndo, saveEventChecklist, saveLocalEvent, scrollToTopSafely
});

// ---------- Init ----------
initCatCrew();
initDashboard({ onAppearanceChange: () => calendar?.updateSize() });
ensureCatLinkMarkup();
setCatMode((localStorage.getItem(LS_CATMODE) || "0") === "1");
setSearchUIState();

async function initApp() {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app); eventsCol = collection(db, 'events'); auth = getAuth(app);
  initCalendarUI(); initUIHooks(); initWeather({ demo });
  calendarExperience = initCalendarExperience({ calendar, getEvents: () => expandedEvents, getFilteredEvents: getVisibleEvents,
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
      calendar?.updateSize();
      if (!demo) {
        if(view==='life')refreshCloud({force:false});
        const range = view === 'today' ? homeCalendar?.getRange() : view === 'calendar' ? { start: calendar.view.activeStart, end: calendar.view.activeEnd } : null;
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

  prevBtn?.addEventListener("click", () => calendar?.prev());
  nextBtn?.addEventListener("click", () => calendar?.next());
  todayBtn?.addEventListener("click", () => calendar?.today());

  updatesClose?.addEventListener("click", closeUpdatesModal);
  updatesDone?.addEventListener("click", () => {
    if (updatesDontShow?.checked) localStorage.setItem(LS_UPDATES_HIDE, "1");
    closeUpdatesModal();
  });
  updatesBackdrop?.addEventListener("click", (e) => {
    if (e.target === updatesBackdrop) closeUpdatesModal();
  });

  let t = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      searchText = (searchInput.value || "").trim();
      setSearchUIState();
      applySearchAndFilters(true);
    }, 160);
  });

  searchFrom?.addEventListener("change", () => {
    setSearchUIState();
    applySearchAndFilters(true);
  });

  searchTo?.addEventListener("change", () => {
    setSearchUIState();
    applySearchAndFilters(true);
  });

  ownerFilter?.addEventListener("change", () => {
    ownerFilterValue = ownerFilter.value || "all";
    applySearchAndFilters(false);
  });

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

  jumpClose?.addEventListener("click", closeJumpModal);
  jumpCancel?.addEventListener("click", closeJumpModal);
  jumpBackdrop?.addEventListener("click", (e) => {
    if (e.target === jumpBackdrop) closeJumpModal();
  });
  jumpGoBtn?.addEventListener("click", () => {
    const month = Number(jumpMonthSelect?.value ?? 0);
    const year = Number(jumpYearSelect?.value ?? new Date().getFullYear());
    calendar?.gotoDate(new Date(year, month, 1));
    closeJumpModal();
  });

  populateYearSelect();
}

// ---------- Calendar ----------
function initCalendarUI() {
  const calendarEl = document.getElementById("calendarGrid");
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listCustom'].includes(localStorage.getItem('hh_calendar_view'))
      ? localStorage.getItem('hh_calendar_view') : window.innerWidth < 650 ? 'listCustom' : 'dayGridMonth',
    headerToolbar: false,
    eventContent: calendarEventContent,
    eventClassNames: arg => arg.event.extendedProps?.holiday ? ['calendar-holiday', ...(arg.event.extendedProps.birthday ? ['calendar-birthday'] : [])] : [`owner-${normalizeOwner(arg.event.extendedProps?.owner)}`, ...(arg.event.extendedProps?.withFrankie ? ["with-frankie"] : [])],
    dayHeaderFormat: { weekday: 'short' },
    dayHeaderContent: info => {
      // Month headers use abstract UTC weekdays. FullCalendar's formatted text
      // avoids shifting them back a day in timezones west of UTC.
      const weekday = info.text;
      return info.view.type === 'dayGridMonth' ? { html: escapeHtml(weekday) }
        : { html: `<span class="week-column-label">${escapeHtml(weekday)}</span><span class="week-column-number">${info.date.getDate()}</span>` };
    },
    dayMaxEvents: 3,
    fixedWeekCount: false,
    eventDisplay: 'block',
    slotMinTime: '00:00:00',
    scrollTime: '07:00:00',
    slotDuration: '00:30:00',
    eventMinHeight: 30,
    expandRows: true,
    dayCellDidMount: info => {
      const number = info.el.querySelector('.fc-daygrid-day-number');
      if (!number) return;
      number.setAttribute('role', 'button'); number.setAttribute('tabindex', '0');
      number.setAttribute('aria-label', `Add a plan on ${info.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`);
      number.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); calendarExperience?.selectDay(info.date); addEventOnDay(info.date); }
      });
    },

    views: {
      dayGridMonth: {
        eventDisplay: "block",
        displayEventTime: true,
        eventTimeFormat: {
          hour: "numeric",
          meridiem: "narrow"
        }
      },
      listCustom: {
        type: "list",
        duration: { days: 14 },
        buttonText: "Agenda"
      }
    },

    selectable: true,
    selectMinDistance: 6,
    selectMirror: true,
    selectOverlap: true,
    editable: true,
    nowIndicator: true,
    height: "auto",
    longPressDelay: 350,
    selectLongPressDelay: 350,

    datesSet: info => {
      calendarExperience?.render({ rangeChanged: true });
      if (!demo) setCloudRange(info.start.toISOString(),info.end.toISOString());
    },

    dateClick: info => {
      calendarExperience?.selectDay(info.date);
      if (info.allDay) addEventOnDay(info.date);
      else openEventModal({mode:'create',title:'',start:info.date,end:new Date(+info.date+3600000),allDay:false,owner:'both',type:'general',repeat:'none',notes:'',checklist:[]});
    },
    select: info => {
      const end=new Date(info.end); if (info.allDay) end.setDate(end.getDate()-1);
      openEventModal({mode:'create',title:'',start:info.start,end,allDay:info.allDay,owner:'both',type:'general',repeat:'none',notes:'',checklist:[]});
      calendar.unselect();
    },
    eventClick: info => {
      if (info.event.extendedProps?.holiday) { showNotice(`${info.event.title} · ${info.event.extendedProps.birthday ? 'From Apple Contacts' : info.event.extendedProps.federal ? 'U.S. federal holiday' : 'Calendar observance'}`); return; }
      openFromPanel(info.event.extendedProps?.sourceId || info.event.id,info.event.start?.toISOString(),false);
    },

    eventDidMount: (arg) => {
      if (arg.event.extendedProps?.holiday) {arg.el.title=`${arg.event.title} · ${arg.event.extendedProps.birthday?'From Apple Contacts':arg.event.extendedProps.federal?'U.S. federal holiday':'Observance'}`; return;}
      const show = shouldShowEvent(arg.event);
      if (!show) arg.el.style.display = "none";

      const p = arg.event.extendedProps || {};
      if (p.isRepeatOccurrence) {
        arg.event.setProp("editable", false);
        arg.event.setProp("durationEditable", false);
        arg.event.setProp("startEditable", false);
      }

      arg.el.title = `${arg.event.title} · ${arg.event.allDay ? 'All day' : arg.event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    },

    eventDrop: async (info) => {
      const p = info.event.extendedProps || {};
      if (p.isRepeatOccurrence) {
        info.revert();
        alert("Repeating events: edit the series instead (no single-instance moves yet).");
        return;
      }
      try { await persistMovedEvent(info.event); } catch (e) { info.revert(); showNotice(e.message); }
    },

    eventResize: async (info) => {
      const p = info.event.extendedProps || {};
      if (p.isRepeatOccurrence) {
        info.revert();
        alert("Repeating events: edit the series instead (no single-instance resizes yet).");
        return;
      }
      try { await persistMovedEvent(info.event); } catch (e) { info.revert(); showNotice(e.message); }
    }
  });

  calendar.render();
  hookMonthTitleClick();
  attachSwipe(calendarEl);
}

function hookMonthTitleClick() {
  const title = document.getElementById("calendarTitle");
  if (!title) return;
  title.style.cursor = "pointer";
  title.title = "Jump to month";
  title.onclick = () => openJumpModalFromCalendar();
}

function openJumpModalFromCalendar() {
  if (!calendar) return;
  const d = calendar.getDate();
  if (jumpMonthSelect) jumpMonthSelect.value = String(d.getMonth());
  if (jumpYearSelect) jumpYearSelect.value = String(d.getFullYear());
  jumpBackdrop?.classList.remove("hidden");
  scrollToTopSafely(jumpBackdrop?.querySelector(".modal-scroll"));
}

function closeJumpModal() {
  jumpBackdrop?.classList.add("hidden");
}

function populateYearSelect() {
  if (!jumpYearSelect) return;
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now - 5; y <= now + 10; y++) years.push(y);
  jumpYearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  jumpYearSelect.value = String(now);
}

// Swipe month/week/day
function attachSwipe(el) {
  let sx = 0, sy = 0, st = 0;

  el.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    const dt = Date.now() - st;
    if (dt >= 350) return;

    const touch = e.changedTouches?.[0];
    if (!touch) return;

    const dx = touch.clientX - sx;
    const dy = touch.clientY - sy;

    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > 45) return;

    const viewType = calendar?.view?.type;
    if (!viewType) return;

    if (dx < 0) calendar?.next();
    else calendar?.prev();
  }, { passive: true });
}

// ---------- Rendering ----------
function renderCalendarFromCache() {
  if (!calendar) return;
  calendar.batchRendering(() => {
    calendar.removeAllEventSources();
    calendar.addEventSource(getVisibleEvents());
    calendar.addEventSource({id:'us-holidays',events:(info,success)=>success(holidayEvents(info.start,info.end))});
    calendar.addEventSource({id:'birthdays',events:(info,success)=>success(birthdayEvents(info.start,info.end))});
    calendar.addEventSource({id:'bath-days',events:(info,success)=>success(bathEvents(info.start,info.end))});
    calendar.addEventSource({id:'trash-days',events:(info,success)=>success(trashEvents(info.start,info.end))});
  });
  calendarExperience?.render();
}

function renderPanels() {
  renderUpcoming();
  renderOutstanding();
  renderUpdates();
}

function renderUpdates() {
  if (!updatesListEl) return;

  const now = new Date();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recent = rawDocs
    .map(d => {
      const createdAt =
        d.createdAt?.toDate ? d.createdAt.toDate() :
        d.createdAt instanceof Date ? d.createdAt :
        d.createdAt ? new Date(d.createdAt) : null;

      return {
        id: d.id,
        title: d.title || "",
        start: d.start ? new Date(d.start) : null,
        owner: normalizeOwner(d.owner),
        ownerCustom: d.ownerCustom || "",
        type: d.type || "general",
        notes: d.notes || "",
        checklist: Array.isArray(d.checklist) ? d.checklist : [],
        createdAt
      };
    })
    .filter(x => x.createdAt && x.createdAt >= cutoff)
    .sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12);

  if (!recent.length) {
    updatesListEl.textContent = "No new events in the last 7 days.";
    return;
  }

  const html = recent.map(d => {
    const ownerLabel = d.owner === "custom" ? (d.ownerCustom || "Other") : d.owner;
    const when = d.start ? formatWhenForPanel({ start: d.start, end: null, allDay: false }) : "—";
    const style = OWNER_STYLE[d.owner] || OWNER_STYLE.custom;

    return `
      <div class="panel-card" data-open-id="${d.id}" style="border-left: 5px solid ${style.border}; cursor:pointer;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span class="owner-pill">${escapeHtml(ownerLabel)}</span>
          <strong style="font-size:16px;">${escapeHtml(d.title)}</strong>
        </div>
        <div class="tiny muted">${escapeHtml(when)}</div>
        <div class="tiny muted">Added: ${escapeHtml(d.createdAt.toLocaleString())}</div>
      </div>
    `;
  }).join("");

  updatesListEl.innerHTML = html;

  updatesListEl.querySelectorAll("[data-open-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-open-id");
      openFromPanel(id, null, false);
    });
  });

  function maybeShowUpdatesModal(_html, recentItems) {
    if ((localStorage.getItem(LS_UPDATES_HIDE) || "1") === "1") return;
    if (updatesModalShownThisLoad) return;

    const lastSeenMs = Number(localStorage.getItem(LS_UPDATES_LASTSEEN) || "0");
    const newestMs = recentItems?.[0]?.createdAt ? recentItems[0].createdAt.getTime() : 0;

    if (newestMs && newestMs > lastSeenMs) {
      const onlyNew = recentItems.filter(r => r.createdAt && r.createdAt.getTime() > lastSeenMs);

      if (onlyNew.length) {
        const newHtml = onlyNew.map(d => {
          const ownerLabel = d.owner === "custom" ? (d.ownerCustom || "Other") : d.owner;
          const when = d.start ? formatWhenForPanel({ start: d.start, end: null, allDay: false }) : "—";
          const style = OWNER_STYLE[d.owner] || OWNER_STYLE.custom;

          return `
            <div class="panel-card" style="border-left: 5px solid ${style.border};">
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <span class="owner-pill">${escapeHtml(ownerLabel)}</span>
                <strong style="font-size:16px;">${escapeHtml(d.title)}</strong>
              </div>
              <div class="tiny muted">${escapeHtml(when)}</div>
              <div class="tiny muted">Added: ${escapeHtml(d.createdAt.toLocaleString())}</div>
            </div>
          `;
        }).join("");

        openUpdatesModal(newHtml);
        updatesModalShownThisLoad = true;
      }

      localStorage.setItem(LS_UPDATES_LASTSEEN, String(newestMs));
      return;
    }

    if (!lastSeenMs) {
      localStorage.setItem(LS_UPDATES_LASTSEEN, String(Date.now()));
    }
  }

  maybeShowUpdatesModal(html, recent);
}

function getVisibleEvents() {
  let list = expandedEvents.slice();
  list = list.filter(matchOwnerFilter);
  list = list.filter(matchSearch);

  const bounds = getSearchBounds();
  if (bounds) {
    const { from, to } = bounds;
    list = list.filter((e) => {
      const s = new Date(e.start).getTime();
      if (from && s < from.getTime()) return false;
      if (to && s > to.getTime()) return false;
      return true;
    });
  }

  return list;
}

function shouldShowEvent(fcEvent) {
  const p = fcEvent.extendedProps || {};
  const owner = normalizeOwner(p.owner);

  if (ownerFilterValue && ownerFilterValue !== "all") {
    if (ownerFilterValue === "frankie") {
      if (!p.withFrankie) return false;
    } else if (ownerFilterValue === "hanry") {
      if (!(owner === "hanry" || owner === "both")) return false;
    } else if (ownerFilterValue === "karena") {
      if (!(owner === "karena" || owner === "both")) return false;
    } else {
      if (ownerFilterValue !== owner) return false;
    }
  }

  if (searchText) {
    const hay = `${fcEvent.title} ${p.notes || ""} ${p.type || ""} ${p.ownerCustom || ""}`.toLowerCase();
    if (!hay.includes(searchText.toLowerCase())) return false;
  }

  const bounds = getSearchBounds();
  if (bounds) {
    const s = fcEvent.start ? fcEvent.start.getTime() : 0;
    if (bounds.from && s < bounds.from.getTime()) return false;
    if (bounds.to && s > bounds.to.getTime()) return false;
  }

  return true;
}

function matchOwnerFilter(e) {
  if (!ownerFilterValue || ownerFilterValue === "all") return true;
  if (ownerFilterValue === "frankie") return !!e.extendedProps?.withFrankie;
  const o = normalizeOwner(e.extendedProps?.owner);

  if (ownerFilterValue === "hanry") return (o === "hanry" || o === "both");
  if (ownerFilterValue === "karena") return (o === "karena" || o === "both");
  return o === ownerFilterValue;
}

function matchSearch(e) {
  if (!searchText) return true;
  const p = e.extendedProps || {};
  const hay = `${e.title} ${p.notes || ""} ${p.type || ""} ${p.ownerCustom || ""}`.toLowerCase();
  return hay.includes(searchText.toLowerCase());
}

function getSearchBounds() {
  const fromVal = searchFrom?.value || "";
  const toVal = searchTo?.value || "";
  if (!fromVal && !toVal) return null;

  const from = fromVal ? new Date(fromVal + "T00:00:00") : null;
  const to = toVal ? new Date(toVal + "T23:59:59") : null;
  return { from, to };
}

function isSearchActive() {
  const b = getSearchBounds();
  return !!(searchText || b);
}

function applySearchAndFilters(switchToListIfSearching) {
  searchText = (searchInput?.value || "").trim();

  renderCalendarFromCache();
  renderPanels();

  if (switchToListIfSearching && isSearchActive()) {
    openListViewForSearch();
  }
}

function openListViewForSearch() {
  if (!calendar) return;

  const bounds = getSearchBounds();
  let days = 14;
  let anchorDate = new Date();

  if (bounds?.from && bounds?.to) {
    const ms = bounds.to.getTime() - bounds.from.getTime();
    days = Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)) + 1);
    anchorDate = bounds.from;
  } else if (bounds?.from && !bounds?.to) {
    days = 60;
    anchorDate = bounds.from;
  } else if (!bounds?.from && bounds?.to) {
    days = 60;
    anchorDate = new Date(bounds.to.getFullYear(), bounds.to.getMonth(), bounds.to.getDate());
    anchorDate.setDate(anchorDate.getDate() - 30);
  } else {
    days = 365;
    anchorDate = new Date();
  }

  calendar.setOption("views", {
    listCustom: { type: "list", duration: { days }, buttonText: "Agenda" }
  });

  calendar.changeView("listCustom");
  calendar.gotoDate(anchorDate);
}

// ---------- Upcoming ----------
function renderUpcoming() {
  renderUpcomingList(upcomingListEl, expandedEvents.filter(matchOwnerFilter).filter(matchSearch), (id, occ) => openFromPanel(id, occ, false));
}

// ---------- Outstanding ----------
outPrev?.addEventListener("click", () => {
  outstandingPage = Math.max(1, outstandingPage - 1);
  renderOutstanding();
});
outNext?.addEventListener("click", () => {
  outstandingPage += 1;
  renderOutstanding();
});

function renderOutstanding() {
  outstandingPage = renderOutstandingList({ outstandingListEl, outPage, events:expandedEvents.filter(matchOwnerFilter).filter(matchSearch), page:outstandingPage, pageSize:OUT_PAGE_SIZE, onOpen:(id, occ) => openFromPanel(id, occ, true) });
}

function openFromPanel(sourceId, occurrenceStartISO, checklistView) {
  const docData = rawDocs.find(d => d.id === sourceId); if (!docData) return;
  const occStart = occurrenceStartISO ? new Date(occurrenceStartISO) : new Date(docData.start);
  if (checklistView) { openTaskModal(docData,occStart); return; }
  // Household repeats edit the series anchor; Apple recurring instances only
  // allow household assignments, leaving their dates untouched at Apple.
  openEventModal({...docData,mode:'edit',id:sourceId,occurrenceStart:occStart,start:new Date(docData.start),end:docData.end ? new Date(docData.end) : null,owner:normalizeOwner(docData.owner)});
}


// Owners, presets, event data and date helpers live in event-data.js.
// ---------- Start ----------
initApp().catch(() => {
  document.getElementById('gateError').textContent = 'The app could not start. Check your connection and reload.';
});
