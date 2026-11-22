import { overlappingEvents, preferredCalendar } from './event-planning.js';
import { initCatCrew } from './cat-crew.js';
import { initHuckleberry, logBabyFromText } from './baby.js';
import { sweetspotPatch } from './prediction-log.js';
import { initUpgrades } from './upgrades.js';
import { initNewsletterSettings } from './newsletter-settings.js';
import { initSiriSettings } from './siri-settings.js';
import { initWorldBriefing } from './world-briefing.js';
import { initInstall } from './install-app.js';
import { initPullRefresh } from './pull-refresh.js';
import { parseQuickAdd, describeDraft } from './quick-add.js';
import { createPlaceWeather, usePlaceWeather, eventWeatherLine, sampleWeatherFetch, searchPlaces, whereBoxText } from './place-weather.js';
import { initPlaceSuggest } from './place-suggest.js';
import { OWNER_STYLE, normalizeOwner, CHECKLIST_PRESETS, normalizeDocs, expandRepeats, advanceRepeat, makeInclusiveAllDayEnd, makeFcEvent, renderPanelCardHTML, renderPanelCardHTMLWithProgress, formatWhenForPanel, toInputValue, fromInputValue, roundToNextHour, escapeHtml } from './event-data.js';
import { initHypotheses, memoryHypotheses } from './hypotheses-view.js';
import { ensureCatLinkMarkup, setCatMode, LS_CATMODE } from './cat-mode.js';
import { predictionStore, hypothesisStore, settingsStore, trashStore, firestoreStore } from './stores.js';
import { renderChecklistUI, addChecklistItemUI, readChecklistUI } from './checklist-ui.js';
import { renderUpcomingList, renderOutstandingList } from './panels.js';
import { initDevices } from './devices.js';
import { initLitter } from './litter.js';
import { initFeeders } from './feeders.js';
import { initMeals } from './meals.js';
import { initEventDateEditor } from './event-editor.js';
import { holidayEvents, holidaysEnabled } from './holidays.js';
import { birthdayEvents, birthdaysShown } from './birthdays-model.js';
import { bathEvents } from './bath-days.js';
import { initBathDays, memoryBathStore } from './bath-settings.js';
import { trashEvents } from './trash-days.js';
import { initTrashDays, memoryTrashStore } from './trash-settings.js';
import { initBirthdays } from './birthdays.js';
import { checklistKey, eventChecklistKey } from './checklists.js';
// app.js — Hubert’s House
// Household dashboard, authenticated Firebase sync and iCloud calendar integration.
// Upcoming + Outstanding checklist panels + checklist-focused modal
// Month title tap = jump-to-month + swipe left/right to change months/weeks/days

import { config } from './config.js';
import { initHousehold, updateHouseholdEvents, showNotice, showView } from './household.js';
import { initCloudCalendar, setCloudRange, refreshCloud, saveCloudEvent, saveCloudAssignment, deleteCloudEvent } from './cloud-calendar.js';
import { demoStore, demoEvents, demoMealStore } from './demo.js';
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

// ---------- Details Modal ----------
const detailsBackdrop = document.getElementById("detailsBackdrop");
const detailsClose = document.getElementById("detailsClose");
const detailsEditBtn = document.getElementById("detailsEditBtn");
const detailsDeleteBtn = document.getElementById("detailsDeleteBtn");
const detailsScroll = document.getElementById("detailsScroll");
const detailsChecklistBtn = document.getElementById("detailsChecklistBtn");

const detailsOwnerPill = document.getElementById("detailsOwnerPill");
const detailsTitle = document.getElementById("detailsTitle");
const detailsWhen = document.getElementById("detailsWhen");
const detailsType = document.getElementById("detailsType");
const detailsNotes = document.getElementById("detailsNotes");
const detailsChecklist = document.getElementById("detailsChecklist");

let detailsDocId = null;
let detailsOccurrenceStart = null;
// Where it is, and (outside the Richmond area) the weather there that day.
let detailsWhere = { location:'', start:null };
function drawDetailsWhere() {
  const el = document.getElementById('detailsWhere'); if (!el) return;
  const { location, start } = detailsWhere; el.hidden = !location;
  if (!location) { el.textContent = ''; return; }
  const line = eventWeatherLine({ location, start });
  const place = document.createElement('span'); place.textContent = `📍 ${location}`;
  el.replaceChildren(place);
  if (line) { const weather = document.createElement('span'); weather.className = 'details-weather'; weather.textContent = line; const source = document.createElement('small'); source.textContent = ' · Open-Meteo'; weather.append(source); el.append(weather); }
}

function openDetailsModal(payload) {
  detailsDocId = payload.id;
  const original = rawDocs.find(d => d.id === payload.id);
  document.getElementById('detailsSource').textContent = original?.icloud ? `${original.calendarName} · iCloud${original.readOnlyReason ? ' · '+original.readOnlyReason : ''}` : 'Hubert’s House';
  detailsEditBtn.disabled = !!original?.readOnlyReason; detailsDeleteBtn.disabled = !!original?.readOnlyReason;
  detailsChecklistBtn.classList.toggle('hidden',!!original?.icloud);
  detailsOccurrenceStart = payload.occurrenceStart || null;

  const owner = normalizeOwner(payload.owner);
  const ownerLabel = owner === "custom" ? (payload.ownerCustom || "Other") : owner;

  if (detailsOwnerPill) { detailsOwnerPill.textContent = ownerLabel + (original?.withFrankie ? " + Frankie" : ""); detailsOwnerPill.classList.toggle("frankie-tag", !!original?.withFrankie); }
  if (detailsTitle) detailsTitle.textContent = payload.title || "";
  if (detailsWhen) detailsWhen.textContent = formatWhenForPanel({
    start: payload.start ? new Date(payload.start) : null,
    end: payload.end ? new Date(payload.end) : null,
    allDay: !!payload.allDay
  });

  if (detailsType) detailsType.textContent = (payload.type || "general").replace(/^\w/, c => c.toUpperCase());

  const notesVal = (payload.notes || "").trim();
  if (detailsNotes) detailsNotes.textContent = notesVal ? notesVal : "—";
  detailsWhere = { location:(payload.location ?? original?.location ?? '').trim(), start:payload.start }; drawDetailsWhere();

  const items = Array.isArray(payload.checklist) ? payload.checklist : [];
  if (detailsChecklist) {
    if (!items.length) detailsChecklist.textContent = "—";
    else detailsChecklist.textContent = items.map(it => `${it.done ? "✅" : "⬜️"} ${it.text}`).join("\n");
  }

  detailsBackdrop?.classList.remove("hidden");
  scrollToTopSafely(detailsScroll);
}

function closeDetailsModal() {
  detailsDocId = null;
  detailsOccurrenceStart = null;
  detailsBackdrop?.classList.add("hidden");
}

detailsClose?.addEventListener("click", closeDetailsModal);
detailsBackdrop?.addEventListener("click", (e) => {
  if (e.target === detailsBackdrop) closeDetailsModal();
});

detailsChecklistBtn?.addEventListener("click", () => {
  if (!detailsDocId) return;
  const docData = rawDocs.find(d => d.id === detailsDocId);
  if (!docData) return;

  closeDetailsModal();
  openTaskModal(docData, detailsOccurrenceStart);
});

// ---------- Modal: event editor ----------
const backdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");
const eventForm = document.getElementById("eventForm");
const modalTitle = document.getElementById("modalTitle");
const editScroll = document.getElementById("editScroll");
const saveBtnTop = document.getElementById("saveBtnTop");
const saveBtn = document.getElementById("saveBtn");

const evtTitle = document.getElementById("evtTitle");
const evtStart = document.getElementById("evtStart");
const evtEnd = document.getElementById("evtEnd");
const evtAllDay = document.getElementById("evtAllDay");

const evtOwner = document.getElementById("evtOwner");
const ownerCustomWrap = document.getElementById("ownerCustomWrap");
const evtOwnerCustom = document.getElementById("evtOwnerCustom");

const evtType = document.getElementById("evtType");
const evtRepeat = document.getElementById("evtRepeat");
const repeatUntilWrap = document.getElementById("repeatUntilWrap");
const evtRepeatUntil = document.getElementById("evtRepeatUntil");

const checklistEl = document.getElementById("checklist");
const addCheckItemBtn = document.getElementById("addCheckItem");
const evtNotes = document.getElementById("evtNotes");
const evtLocation = document.getElementById("evtLocation");
// Where: suggestions from earlier events' places, then towns; the weather there underneath.
const whereBox = initPlaceSuggest({ input:evtLocation, list:document.getElementById('evtLocationList'), preview:document.getElementById('evtLocationWeather'), search:searchPlaces,
  known:() => [...localDocs, ...cloudDocs].filter(d => d?.location).sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))).map(d => d.location),
  previewText:location => whereBoxText(location, evtStart?.value) });
for (const id of ['evtStartDate', 'evtStartTime', 'evtAllDay']) document.getElementById(id)?.addEventListener('change', () => setTimeout(() => whereBox.refresh()));

const deleteBtn = document.getElementById("deleteBtn");
const cancelBtn = document.getElementById("cancelBtn");

// ---------- Checklist-focused modal ----------
const taskBackdrop = document.getElementById("taskBackdrop");
const taskClose = document.getElementById("taskClose");
const taskDone = document.getElementById("taskDone");
const taskMeta = document.getElementById("taskMeta");
const taskChecklist = document.getElementById("taskChecklist");
const taskAddItem = document.getElementById("taskAddItem");

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
let cloudChecklistDocs = [], editingOriginal = null;
let localDocs = [], cloudDocs = [];
let eventRequestId = null;
let savingEvent = false;
let expandedEvents = [];

let editingDocId = null;
let editingOccurrenceStart = null;

// Outstanding pagination
let outstandingPage = 1;
const OUT_PAGE_SIZE = 10;

// Search state
let searchText = "";

// Filter state
let ownerFilterValue = "all";

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
    initCloudCalendar(null,{demo:true,onEvents:() => {},onCalendars:() => {}}); startUpgrades(); initHypotheses({store:memoryHypotheses([{text:'She sleeps longer on bath nights',factor:'bath',outcome:'nightLength',direction:'more'},{text:'She’s fussier on days Hubert sits on her play mat'}])}); initHuckleberry(null,{demo:true}); initNewsletterSettings(null); initSiriSettings(null); initWorldBriefing(null,{demo:true}); initInstall(); initPullRefresh(); initDevices(null,{demo:true}); initLitter(null,{demo:true}); initFeeders(null,{demo:true}); initMeals(null,{demo:true,store:demoMealStore()}); initBirthdays(null,{demo:true,onChange:() => { renderCalendarFromCache(); homeCalendar?.render(); }}); initBathDays({store:memoryBathStore(),onChange:bathChanged}); initTrashDays({store:memoryTrashStore(),onChange:bathChanged}); return;
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
      startUpgrades(); initHypotheses({store:hypothesisStore(db)}); initHuckleberry(app,{predictions:predictionStore(db)}); initNewsletterSettings(app); initSiriSettings(app); initWorldBriefing(app); initInstall(); initPullRefresh(); initDevices(app); initLitter(app); initFeeders(app); initMeals(app,{store:firestoreStore('householdMeals')}); initBirthdays(app,{onChange:() => { renderCalendarFromCache(); homeCalendar?.render(); }}); initBathDays({store:settingsStore(db),onChange:bathChanged}); initTrashDays({store:trashStore(db),onChange:bathChanged});
      await initCloudCalendar(app,{
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
      });
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
async function removeEvent(id) {
  const original = rawDocs.find(d => d.id === id);
  if (original?.icloud) { await deleteCloudEvent(original); cloudDocs=cloudDocs.filter(d => d.id !== id); rebuildEvents(); await refreshCloud(); }
  else if (demo) { localDocs=localDocs.filter(d => d.id !== id); rebuildEvents(); }
  else await deleteDoc(doc(db,'events',id));
}

// ---------- UI hooks ----------
let eventDateEditor, cloudEventBaseline = '';
function cloudDraftKey() { return JSON.stringify([evtTitle.value,evtStart.value,evtEnd.value,evtAllDay.checked,evtNotes.value,evtLocation?.value || '']); }
function initUIHooks() {
  eventDateEditor = initEventDateEditor({onChange:updateEventOverlap});
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

  modalClose?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);
  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  evtOwner?.addEventListener("change", () => {
    const v = evtOwner.value;
    ownerCustomWrap?.classList.toggle("hidden", v !== "custom");
    if (v !== "custom" && evtOwnerCustom) evtOwnerCustom.value = "";
  });

  evtRepeat?.addEventListener("change", () => {
    const v = evtRepeat.value;
    repeatUntilWrap?.classList.toggle("hidden", v === "none");
    updateDestinationUI();
  });

  evtType?.addEventListener("change", () => {
    maybeAutofillChecklist(evtType.value);
  });

  addCheckItemBtn?.addEventListener("click", () => {
    addChecklistItemUI(checklistEl, { text: "", done: false }, true);
  });

  eventForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleSave();
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!editingDocId) return;
    if (!confirm("Delete this event?")) return;
    try { await removeEvent(editingDocId); } catch (e) { showNotice(e.message); return; }
    closeModal();
  });

  taskClose?.addEventListener("click", closeTaskModal);
  taskDone?.addEventListener("click", saveTaskModal);
  taskBackdrop?.addEventListener("click", (e) => {
    if (e.target === taskBackdrop) closeTaskModal();
  });
  taskAddItem?.addEventListener("click", () => {
    addChecklistItemUI(taskChecklist, { text: "", done: false }, true);
  });

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

// ---------- Event modal ----------
// Who's coming: one tap on a chip instead of a dropdown (the select stays as the source of truth).
function syncOwnerChips() {
  document.querySelectorAll('[data-owner-chip]').forEach(chip => { chip.setAttribute('aria-pressed', String(chip.dataset.ownerChip === evtOwner?.value)); chip.disabled = !!evtOwner?.disabled; });
}
document.querySelector('.owner-chips')?.addEventListener('click', e => {
  const chip = e.target.closest('[data-owner-chip]'); if (!chip || !evtOwner || evtOwner.disabled) return;
  evtOwner.value = chip.dataset.ownerChip; evtOwner.dispatchEvent(new Event('change', { bubbles:true })); syncOwnerChips();
  if (chip.dataset.ownerChip === 'custom') setTimeout(() => evtOwnerCustom?.focus(), 0);
});
// Typing a day or time in the title ("Dinner Fri 7pm") offers to set the date and time from it.
let titleDraft = null;
function titleHint(draft) {
  const hint = document.getElementById('evtTitleHint'); titleDraft = draft;
  if (!hint) return;
  hint.hidden = !draft;
  if (draft) hint.textContent = `📅 Use ${describeDraft(draft).split(' · ').slice(1, 3).join(' · ')}${draft.title ? ` · “${draft.title}”` : ''}`;
}
evtTitle?.addEventListener('input', () => {
  if (editingDocId) return titleHint(null);
  const draft = parseQuickAdd(evtTitle.value);
  titleHint(draft && draft.title ? draft : null);
});
document.getElementById('evtTitleHint')?.addEventListener('click', () => {
  const draft = titleDraft; if (!draft) return;
  evtTitle.value = draft.title;
  if (evtAllDay) evtAllDay.checked = !!draft.allDay;
  setDateTimeInputs(!!draft.allDay, draft.start, draft.end);
  if (draft.owner && draft.owner !== 'both') { evtOwner.value = draft.owner; evtOwner.dispatchEvent(new Event('change', { bubbles:true })); syncOwnerChips(); }
  if (draft.withFrankie) document.getElementById('evtWithFrankie').checked = true;
  if (draft.type && evtType) evtType.value = draft.type;
  titleHint(null); updateEventOverlap();
  showNotice(`Set to ${describeDraft(draft).split(' · ').slice(1, 3).join(' · ')}.`);
});
function openEventModal(payload) {
  const isEdit = payload.mode === "edit";

  editingDocId = isEdit ? payload.id : null;
  editingOccurrenceStart = payload.occurrenceStart || null;
  eventRequestId = crypto.randomUUID();
  document.getElementById('evtError').textContent='';
  const original = rawDocs.find(d => d.id === editingDocId);
  editingOriginal=original ? structuredClone(original) : null;
  const destination = document.getElementById('evtCalendar');
  destination.querySelectorAll('[data-view-only]').forEach(option=>option.remove());
  if(original?.icloud && ![...destination.options].some(option=>option.value===original.calendarId)) {
    const option=new Option(`${original.calendarName} · iCloud (read-only)`,original.calendarId);option.dataset.viewOnly='true';destination.add(option);
  }
  destination.value = isEdit ? (original?.icloud ? original.calendarId : 'household') : defaultCalendar();
  destination.disabled = isEdit;
  updateDestinationUI();

  if (modalTitle) modalTitle.textContent = isEdit ? "Edit event" : "New event";
  deleteBtn?.classList.toggle("hidden", !isEdit);

  if (saveBtnTop) saveBtnTop.textContent = isEdit ? "Save" : "Add";
  if (saveBtn) saveBtn.textContent = isEdit ? "Save changes" : "Add event";
  titleHint(null);

  if (evtTitle) evtTitle.value = payload.title ?? "";
  if (evtAllDay) evtAllDay.checked = !!payload.allDay;

  const owner = normalizeOwner(payload.owner);
  if (evtOwner) evtOwner.value = owner;
  syncOwnerChips();
  document.getElementById("evtWithFrankie").checked = !!(payload.withFrankie ?? original?.withFrankie);
  ownerCustomWrap?.classList.toggle("hidden", owner !== "custom");
  if (evtOwnerCustom) evtOwnerCustom.value = payload.ownerCustom || "";

  if (evtType) evtType.value = payload.type || "general";

  if (evtRepeat) evtRepeat.value = payload.repeat || "none";
  repeatUntilWrap?.classList.toggle("hidden", (payload.repeat || "none") === "none");
  if (evtRepeatUntil) evtRepeatUntil.value = payload.repeatUntil || "";

  setDateTimeInputs(!!payload.allDay, payload.start, payload.end);

  renderChecklistUI(checklistEl, payload.checklist || []);
  if (evtNotes) evtNotes.value = payload.notes || "";
  if (evtLocation) evtLocation.value = payload.location ?? original?.location ?? "";
  whereBox.close(); whereBox.refresh();
  // The folded sections open when they hold something (an edit with notes, a repeat, a checklist…).
  const more = document.getElementById('eventMore'), exact = document.getElementById('eventExact');
  if (more) more.open = !!((payload.notes || '').trim() || (payload.repeat || 'none') !== 'none' || (payload.type || 'general') !== 'general' || (payload.checklist || []).length);
  if (exact) exact.open = !!payload.allDay || (!!payload.start && !!payload.end && new Date(payload.start).toDateString() !== new Date(+new Date(payload.end) - (payload.allDay ? 1 : 0)).toDateString());
  updateDestinationUI();
  cloudEventBaseline=cloudDraftKey();

  backdrop?.classList.remove("hidden");
  updateEventOverlap();

  scrollToTopSafely(editScroll);
  setTimeout(() => (evtTitle?.disabled ? evtOwner : evtTitle)?.focus(), 0);
}

// A required field inside a folded section: open it so the browser can point at it.
document.getElementById('eventForm')?.addEventListener('invalid', event => { const fold = event.target.closest?.('details'); if (fold) fold.open = true; }, true);
document.getElementById('evtAllDay')?.addEventListener('change', event => { if (event.target.checked) { const exact = document.getElementById('eventExact'); if (exact) exact.open = true; } });
function closeModal() {
  editingDocId = null;
  editingOccurrenceStart = null;
  backdrop?.classList.add("hidden");
}

function addHours(date,hours) { return new Date(+new Date(date)+hours*3600000); }
function setDateTimeInputs(isAllDay,startDate,endDate) { eventDateEditor.set(isAllDay,startDate,endDate); }

detailsEditBtn?.addEventListener("click", () => {
  if (!detailsDocId) return;

  const currentId = detailsDocId;
  const currentOccurrenceStart = detailsOccurrenceStart;

  const docData = rawDocs.find(d => d.id === currentId);
  if (!docData) return;

  closeDetailsModal();

  openEventModal({
    mode: "edit",
    id: currentId,
    occurrenceStart: currentOccurrenceStart,
    title: docData.title || "",
    start: docData.start ? new Date(docData.start) : currentOccurrenceStart,
    end: docData.end ? new Date(docData.end) : null,
    allDay: !!docData.allDay,
    owner: normalizeOwner(docData.owner),
    ownerCustom: docData.ownerCustom || "",
    type: docData.type || "general",
    repeat: docData.repeat || "none",
    repeatUntil: docData.repeatUntil || "",
    notes: docData.notes || "",
    checklist: Array.isArray(docData.checklist) ? docData.checklist : []
  });
});

detailsDeleteBtn?.addEventListener("click", async () => {
  if (!detailsDocId) return;
  if (!confirm("Delete this event?")) return;
  try { await removeEvent(detailsDocId); } catch (e) { showNotice(e.message); return; }
  closeDetailsModal();
});

function calendarPreferenceKey() { return `hh_default_calendar_${auth?.currentUser?.uid || (demo ? 'preview' : 'signed-out')}`; }
function defaultCalendar() {
  let saved;
  try { saved = localStorage.getItem(calendarPreferenceKey()); } catch {}
  const calendars = [...document.getElementById('evtCalendar').options].map(option => ({id:option.value,writable:true,selected:true}));
  return preferredCalendar(saved, calendars);
}
document.getElementById('defaultCalendar').addEventListener('change', event => {
  try { localStorage.setItem(calendarPreferenceKey(), event.target.value); } catch {}
  showNotice('Default calendar saved on this device.');
});
function updateEventOverlap() {
  const box = document.getElementById('eventOverlap');
  const cloud = document.getElementById('evtCalendar').value !== 'household';
  const overlaps = overlappingEvents({ id:editingDocId, start:evtStart.value, end:evtEnd.value, allDay:evtAllDay.checked,
    owner:evtOwner.value, ownerCustom:evtOwnerCustom.value, withFrankie:document.getElementById('evtWithFrankie').checked }, expandedEvents);
  box.replaceChildren(); box.classList.toggle('hidden', !overlaps.length);
  if (!overlaps.length) return;
  const label = document.createElement('strong'); label.textContent = 'A little heads-up: plans overlap'; box.append(label);
  const names = overlaps.slice(0, 3).map(event => event.title || 'Untitled event').join(' · ');
  box.append(document.createTextNode(`${names}${overlaps.length > 3 ? ` + ${overlaps.length - 3} more` : ''}. You can still save. Checks the loaded calendars and this occurrence.`));
}
for (const type of ['input', 'change']) document.getElementById('eventForm').addEventListener(type, updateEventOverlap);

function updateDestinationUI() {
  const cloud = document.getElementById('evtCalendar').value !== 'household';
  const original=editingOriginal || rawDocs.find(record=>record.id===editingDocId),readOnly=!!original?.readOnlyReason;
  document.getElementById('evtCalendarHint').textContent = cloud ? 'Event details save to Apple. People and checklists stay in Hubert’s House.' : 'Shared with everyone in Hubert’s House.';
  document.getElementById('eventReadonly').textContent=readOnly ? `${original.readOnlyReason} People and checklists are still editable below.` : '';
  document.getElementById('eventReadonly').hidden=!readOnly;
  for (const id of ['evtTitle','evtLocation','evtStartDate','evtEndDate','evtStartTime','evtEndTime','evtAllDay','evtNotes']) document.getElementById(id).disabled=readOnly;
  document.querySelectorAll('[data-event-date],[data-event-duration]').forEach(button=>{button.disabled=readOnly;});
  deleteBtn.classList.toggle('hidden',!editingDocId || readOnly);
  document.getElementById('eventRepeatNote').hidden=cloud || evtRepeat.value==='none';
  evtRepeat.closest('.row').classList.toggle('hidden',cloud);
  checklistEl.closest('.field').classList.remove('hidden');
  document.getElementById('eventChecklistHint').textContent=cloud ? `Saved in Hubert’s House and shown in Life → To-dos.${original?.recurring ? ' One checklist for the whole series.' : ''}` : 'Also shows in Life → To-dos. Repeating events share one checklist.';
  evtOwner.closest('.row').classList.remove('hidden');
  evtType.closest('.field').classList.toggle('hidden',cloud);
  const frankie = document.getElementById('evtWithFrankie');
  frankie.disabled = !['hanry','karena','both'].includes(evtOwner.value);
  if (frankie.disabled) frankie.checked = false;
  ownerCustomWrap.classList.toggle('hidden',evtOwner.value !== 'custom');
}
document.getElementById('evtCalendar').addEventListener('change',updateDestinationUI);
evtOwner.addEventListener('change',updateDestinationUI);
async function handleSave() {
  if (savingEvent) return;
  savingEvent = true; saveBtn.disabled = true; saveBtnTop.disabled = true;
  document.getElementById('evtError').textContent='';
  try { await saveEventValues(); }
  catch (e) {
    const error=document.getElementById('evtError');
    error.textContent=e.message || 'Could not save this event. Try again.';
    error.scrollIntoView?.({block:'nearest'});
  }
  finally { savingEvent = false; saveBtn.disabled = false; saveBtnTop.disabled = false; }
}
async function saveEventValues() {
  const title = (evtTitle?.value || "").trim();
  if (!title) return;

  const allDay = !!evtAllDay?.checked;

  const owner = normalizeOwner(evtOwner?.value || "both");
  const ownerCustom = owner === "custom" ? (evtOwnerCustom?.value || "").trim() : "";
  const destination=document.getElementById('evtCalendar').value,original=editingOriginal;
  const assignment={owner,ownerCustom,withFrankie:document.getElementById('evtWithFrankie').checked && ['hanry','karena','both'].includes(owner),checklist:readChecklistUI(checklistEl)};
  if(original?.icloud && cloudEventBaseline===cloudDraftKey()) {
    await saveCloudAssignment(assignment,original);closeModal();showNotice('People and checklist saved in Hubert’s House.');await refreshCloud();return;
  }

  const type = evtType?.value || "general";
  const notes = (evtNotes?.value || "").trim();

  const repeat = evtRepeat?.value || "none";
  const repeatUntil = repeat !== "none" ? (evtRepeatUntil?.value || "") : "";

  const start = fromInputValue(evtStart?.value, allDay);
  if (!start || isNaN(start)) throw new Error("Choose a valid start date.");
  let end = evtEnd?.value ? fromInputValue(evtEnd.value, allDay) : null;

  if (allDay && end && end.getTime() === start.getTime()) end = null;

  if (end && (end < start || (!allDay && +end === +start))) {
    throw new Error("End must be after start. Choose the next end date for an overnight plan.");
  }

  const checklist = readChecklistUI(checklistEl);

  const payload = {
    title,
    allDay,
    owner,
    ownerCustom,
    withFrankie: document.getElementById("evtWithFrankie").checked && ["hanry","karena","both"].includes(owner),
    type,
    notes,
    location: (evtLocation?.value || '').trim().slice(0, 300),
    checklist,
    repeat,
    repeatUntil,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    updatedAt: serverTimestamp()
  };

  if (destination !== 'household') {
    const result=await saveCloudEvent({title,notes,location:(evtLocation?.value || '').trim().slice(0, 300),allDay,...assignment,start:start.toISOString(),end:(end || addHours(start,1)).toISOString(),
      startLocal:evtStart.value,endLocal:evtEnd.value || toInputValue(addHours(start,1),false),startDate:evtStart.value.slice(0,10),endDate:evtEnd.value.slice(0,10) || evtStart.value.slice(0,10),repeat:'none'},original,destination,eventRequestId);
    if(result.assignmentSaved===false) {
      // Apple succeeded. Keep the unsaved checklist visible and make the next
      // Save metadata-only, even when this was a brand new Apple event.
      editingDocId=original?.id || `pending:${result.token}`;
      editingOriginal={...payload,id:editingDocId,icloud:true,calendarId:destination,token:result.token,uid:result.uid,assignmentVersion:original?.assignmentVersion || 0,readOnlyReason:'Apple has saved the event. Finish saving its people and checklist here.'};
      document.getElementById('evtCalendar').disabled=true;cloudEventBaseline=cloudDraftKey();updateDestinationUI();
      document.getElementById('evtError').textContent=result.warning;showNotice('Apple event saved. Your checklist is still here; save again to finish.');return;
    }
    closeModal(); showNotice(result.warning || 'Saved. Apple event details and household assignments are up to date.'); await refreshCloud();
  } else {
    await saveLocalEvent(editingDocId,payload,editingOriginal ? editingOriginal.checklist || [] : undefined); closeModal(); showNotice(demo ? 'Saved in this sample preview.' : 'Event saved for the household.');
  }
}

async function persistMovedEvent(fcEvent) {
  const p = fcEvent.extendedProps || {};
  const sourceId = p.sourceId || fcEvent.id;

  const patch = {
    start: fcEvent.start ? fcEvent.start.toISOString() : null,
    end: fcEvent.end ? fcEvent.end.toISOString() : null,
    allDay: fcEvent.allDay,
    updatedAt: serverTimestamp()
  };
  const original = rawDocs.find(d => d.id === sourceId);
  if (original?.icloud) {
    const lastDay = fcEvent.end ? new Date(fcEvent.end) : new Date(fcEvent.start);
    if (fcEvent.allDay && fcEvent.end) lastDay.setDate(lastDay.getDate()-1);
    await saveCloudEvent({title:original.title,notes:original.notes || '',owner:original.owner || 'both',ownerCustom:original.ownerCustom || '',withFrankie:!!original.withFrankie,allDay:fcEvent.allDay,start:patch.start,end:patch.end || addHours(fcEvent.start,1).toISOString(),startLocal:toInputValue(fcEvent.start,false),endLocal:toInputValue(fcEvent.end || addHours(fcEvent.start,1),false),startDate:dateKey(fcEvent.start),endDate:dateKey(lastDay),repeat:'none'},original,original.calendarId,crypto.randomUUID());
    await refreshCloud();
  } else {
    if (fcEvent.allDay && fcEvent.end) { const inclusive=new Date(fcEvent.end); inclusive.setDate(inclusive.getDate()-1); patch.end=inclusive.toISOString(); }
    await saveLocalEvent(sourceId,patch);
  }
}

// ---------- Task modal ----------
let taskDocId = null, taskOriginal = null;

function openTaskModal(docData, occurrenceStart) {
  taskDocId = docData.id;
  taskOriginal=structuredClone(docData);
  document.getElementById('taskError').textContent='';

  const when = formatWhenForPanel({
    start: occurrenceStart || (docData.start ? new Date(docData.start) : null),
    end: docData.end ? new Date(docData.end) : null,
    allDay: !!docData.allDay
  });

  const owner = normalizeOwner(docData.owner);
  const ownerLabel = owner === "custom" ? (docData.ownerCustom || "Other") : owner;

  if (taskMeta) taskMeta.textContent = `${docData.title || ""} — ${when} — ${ownerLabel}`;

  renderChecklistUI(taskChecklist, Array.isArray(docData.checklist) ? docData.checklist : []);

  taskBackdrop?.classList.remove("hidden");
  scrollToTopSafely(taskBackdrop?.querySelector(".modal-scroll"));

}

async function saveTaskModal() {
  if(!taskOriginal || taskDone.disabled)return;
  taskDone.disabled=true;
  try {await saveEventChecklist(taskOriginal,readChecklistUI(taskChecklist));closeTaskModal();showNotice('Checklist saved.');}
  catch(error){document.getElementById('taskError').textContent=error.message;}
  finally{taskDone.disabled=false;}
}

function closeTaskModal() {
  taskDocId = null;
  taskBackdrop?.classList.add("hidden");
}

// ---------- Checklist UI helpers (rows live in checklist-ui.js) ----------
function maybeAutofillChecklist(type) {
  if (!checklistEl) return;
  const current = readChecklistUI(checklistEl);
  if (current.length > 0) return;
  const preset = CHECKLIST_PRESETS[type] || [];
  if (preset.length === 0) return;
  renderChecklistUI(checklistEl, preset.map(t => ({ text: t, done: false })));
}

// Owners, presets, event data and date helpers live in event-data.js.
// ---------- Start ----------
initApp().catch(() => {
  document.getElementById('gateError').textContent = 'The app could not start. Check your connection and reload.';
});
