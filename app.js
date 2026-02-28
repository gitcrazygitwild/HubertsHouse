// app.js — Hubert’s House (v6 FULL)
// Firebase sync + password gate + theme dice + search/list-range + owner filter
// Upcoming + Outstanding checklist panels + checklist-focused modal
// Month title tap = jump-to-month + swipe left/right to change months
//
// NOTE: Gate is client-side only (not real security).

// ---------- Gate ----------
const PASSWORD = "Mack"; // not real security
const LS_UNLOCK = "huberts_house_unlocked_v1";

const gate = document.getElementById("gate");
const gateForm = document.getElementById("gateForm");
const gateInput = document.getElementById("gateInput");
const rememberDevice = document.getElementById("rememberDevice");

// Allow temporary unlock without localStorage (if remember unchecked)
let sessionUnlocked = false;

function isUnlocked() {
  if (sessionUnlocked) return true;
  return localStorage.getItem(LS_UNLOCK) === "1";
}

function unlock() {
  const remember = rememberDevice?.checked ?? true;
  if (remember) localStorage.setItem(LS_UNLOCK, "1");
  sessionUnlocked = true;
  gate?.classList.add("hidden");
}

function lock() {
  sessionUnlocked = false;
  localStorage.removeItem(LS_UNLOCK);
  gate?.classList.remove("hidden");
  closeModal();
  closeTaskModal();
  closeJumpModal();
}

gateForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const pw = String(gateInput?.value ?? "").trim();
  if (pw.toLowerCase() === PASSWORD.toLowerCase()) {
    unlock();
    if (gateInput) gateInput.value = "";
  } else {
    if (gateInput) {
      gateInput.value = "";
      gateInput.focus();
    }
    alert("Wrong password.");
  }
});

// Show/hide gate immediately
if (isUnlocked()) gate?.classList.add("hidden");
else gate?.classList.remove("hidden");

// ---------- Topbar / controls ----------
const statusEl = document.getElementById("status");

const logoutBtn = document.getElementById("logoutBtn");
const todayBtn = document.getElementById("todayBtn");
const themeBtn = document.getElementById("themeBtn");
const focusBtn = document.getElementById("focusBtn");

const searchInput = document.getElementById("searchInput");
const searchFiltersBtn = document.getElementById("searchFiltersBtn");
const searchFilters = document.getElementById("searchFilters");
const searchFrom = document.getElementById("searchFrom");
const searchTo = document.getElementById("searchTo");
const clearDatesBtn = document.getElementById("clearDatesBtn");

const listRangeSelect = document.getElementById("listRangeSelect");
const ownerFilter = document.getElementById("ownerFilter");

const quickAddBtn = document.getElementById("quickAddBtn");

logoutBtn?.addEventListener("click", lock);
todayBtn?.addEventListener("click", () => calendar?.today());

searchFiltersBtn?.addEventListener("click", () => {
  searchFilters?.classList.toggle("hidden");
  searchFiltersBtn?.classList.toggle("is-active", !searchFilters?.classList.contains("hidden"));
});

document.addEventListener("click", (e) => {
  // click-outside closes search filters
  if (!searchFilters || searchFilters.classList.contains("hidden")) return;
  const wrap = searchFilters.closest(".search-filters-wrap");
  if (wrap && !wrap.contains(e.target)) {
    searchFilters.classList.add("hidden");
    searchFiltersBtn?.classList.remove("is-active");
  }
});

clearDatesBtn?.addEventListener("click", () => {
  if (searchFrom) searchFrom.value = "";
  if (searchTo) searchTo.value = "";
  applySearchAndFilters();
});

// Focus mode: top-row button toggles panel visibility
function setFocusMode(on) {
  document.body.classList.toggle("focus-on", on);
  focusBtn?.setAttribute("aria-pressed", on ? "true" : "false");

  const upcoming = document.getElementById("upcoming");
  const outstanding = document.getElementById("outstanding");
  if (upcoming) upcoming.style.display = on ? "none" : "";
  if (outstanding) outstanding.style.display = on ? "none" : "";
}

focusBtn?.addEventListener("click", () => {
  const on = document.body.classList.contains("focus-on");
  setFocusMode(!on);
});

// ---------- Theme (🎲) ----------
const LS_THEME = "huberts_house_theme_v1";
const LS_DENSITY = "huberts_house_density_v1";

const THEMES = ["aurora", "sunset", "mint", "grape", "mono"];
const DENSITIES = ["compact", "cozy"];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
}
function applyDensity(d) {
  document.documentElement.dataset.density = d;
  localStorage.setItem(LS_DENSITY, d);
}
function cycleThemeAndDensity() {
  const curTheme = document.documentElement.dataset.theme || "aurora";
  const curDensity = document.documentElement.dataset.density || "cozy";
  const nextTheme = THEMES[(THEMES.indexOf(curTheme) + 1) % THEMES.length];
  const nextDensity = DENSITIES[(DENSITIES.indexOf(curDensity) + 1) % DENSITIES.length];
  applyTheme(nextTheme);
  applyDensity(nextDensity);
}
themeBtn?.addEventListener("click", cycleThemeAndDensity);

// initial load (persisted)
applyTheme(localStorage.getItem(LS_THEME) || "aurora");
applyDensity(localStorage.getItem(LS_DENSITY) || "cozy");

// ---------- Modal: event editor ----------
const backdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");
const eventForm = document.getElementById("eventForm");
const modalTitle = document.getElementById("modalTitle");

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

const deleteBtn = document.getElementById("deleteBtn");
const cancelBtn = document.getElementById("cancelBtn");

const fab = document.getElementById("fab");

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
const outPrev = document.getElementById("outPrev");
const outNext = document.getElementById("outNext");
const outPage = document.getElementById("outPage");

// ---------- Colors / owners ----------
const OWNER_STYLE = {
  hanry:  { bg: "rgba(122,162,255,0.35)", border: "rgba(122,162,255,0.85)" },
  karena: { bg: "rgba(255,107,107,0.28)", border: "rgba(255,107,107,0.85)" },
  both:   { bg: "rgba(116,217,155,0.28)", border: "rgba(116,217,155,0.85)" },
  custom: { bg: "rgba(184,140,255,0.26)", border: "rgba(184,140,255,0.85)" }
};

function normalizeOwner(rawOwner) {
  const o = String(rawOwner || "").toLowerCase();
  if (o === "hanry") return "hanry";
  if (o === "karena") return "karena";
  if (o === "both") return "both";
  return "custom";
}

// ---------- Checklist presets ----------
const CHECKLIST_PRESETS = {
  general: [],
  wedding: ["RSVP", "Gift", "Travel", "Outfit", "Hotel"],
  trip: ["Book travel", "Lodging", "Packing list", "Car / rides", "Itinerary"],
  appointment: ["Add address", "Bring ID", "Arrive early", "Paperwork"],
  party: ["Invite list", "Food/drinks", "Music", "Supplies", "Cleanup plan"]
};

// ---------- Firebase (CDN imports ONLY) ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBEXNyX6vIbHwGCpI3fpVUb5llubOjt9qQ",
  authDomain: "huberts-house.firebaseapp.com",
  projectId: "huberts-house",
  storageBucket: "huberts-house.firebasestorage.app",
  messagingSenderId: "233498547172",
  appId: "1:233498547172:web:e250d2f14b0e19c6322df1",
  measurementId: "G-CX5MN6WBFP"
};

let db, eventsCol;
let calendar;

// In-memory cache from Firestore
let rawDocs = [];         // [{id,...data}]
let expandedEvents = [];  // normalized + expanded repeats (each has sourceId)

let editingDocId = null; // Firestore doc id
let editingSourceId = null; // for repeat occurrence click (maps to doc id)
let editingOccurrenceStart = null;

// Outstanding pagination
let outstandingPage = 1;
const OUT_PAGE_SIZE = 10;

// Search state
let searchText = "";

// Filter state
let ownerFilterValue = "all";

// ---------- Init ----------
async function initApp() {
  setStatus("connecting", "Sync: connecting…");

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  eventsCol = collection(db, "events");

  initCalendarUI();
  initUIHooks();

  const q = query(eventsCol, orderBy("start", "asc"));
  onSnapshot(q, (snap) => {
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    rawDocs = docs;

    expandedEvents = expandRepeats(normalizeDocs(rawDocs));
    renderCalendarFromCache();
    renderPanels();

    setStatus("live", "Sync: live");
  }, (err) => {
    console.error(err);
    setStatus("error", "Sync: error (check rules)");
  });
}

function setStatus(kind, text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.status = kind;
}

// ---------- UI hooks ----------
function initUIHooks() {
  // Search debounce
  let t = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      searchText = (searchInput.value || "").trim();
      applySearchAndFilters(true);
    }, 180);
  });

  searchFrom?.addEventListener("change", () => applySearchAndFilters(true));
  searchTo?.addEventListener("change", () => applySearchAndFilters(true));

  listRangeSelect?.addEventListener("change", () => {
    // If user is in list view, refresh it
    if (calendar && calendar.view?.type === "listCustom") openListView();
    else renderPanels();
  });

  ownerFilter?.addEventListener("change", () => {
    ownerFilterValue = ownerFilter.value || "all";
    applySearchAndFilters(false);
  });

  quickAddBtn?.addEventListener("click", () => {
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
}

// ---------- Calendar ----------
function initCalendarUI() {
  const calendarEl = document.getElementById("calendar");

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    headerToolbar: {
      left: "prev,next",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listBtn"
    },
    customButtons: {
      listBtn: { text: "List", click: () => openListView() }
    },
    views: {
      listCustom: { type: "list", duration: { days: 7 }, buttonText: "List" }
    },
    selectable: true,
    editable: true,
    nowIndicator: true,
    height: "auto",
    longPressDelay: 350,
    selectLongPressDelay: 350,

    datesSet: () => hookMonthTitleClick(),

    dateClick: (info) => {
      const start = new Date(info.date);
      start.setHours(9, 0, 0, 0);
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
    },

    select: (info) => {
      const start = info.start;
      const end = info.end || new Date(start.getTime() + 60 * 60 * 1000);
      openEventModal({
        mode: "create",
        title: "",
        start,
        end,
        allDay: info.allDay,
        owner: "both",
        ownerCustom: "",
        type: "general",
        repeat: "none",
        repeatUntil: "",
        notes: "",
        checklist: []
      });
    },

    eventClick: (info) => {
      const ev = info.event;
      const p = ev.extendedProps || {};
      const sourceId = p.sourceId || ev.id;

      const docData = rawDocs.find(d => d.id === sourceId);
      if (!docData) return;

      openEventModal({
        mode: "edit",
        id: sourceId,
        occurrenceStart: ev.start ? new Date(ev.start) : null,
        title: docData.title || "",
        start: docData.start ? new Date(docData.start) : ev.start,
        end: docData.end ? new Date(docData.end) : ev.end,
        allDay: !!docData.allDay,
        owner: normalizeOwner(docData.owner),
        ownerCustom: docData.ownerCustom || "",
        type: docData.type || "general",
        repeat: docData.repeat || "none",
        repeatUntil: docData.repeatUntil || "",
        notes: docData.notes || "",
        checklist: Array.isArray(docData.checklist) ? docData.checklist : []
      });
    },

    eventDidMount: (arg) => {
      const show = shouldShowEvent(arg.event);
      if (!show) arg.el.style.display = "none";

      const p = arg.event.extendedProps || {};
      if (p.isRepeatOccurrence) {
        arg.event.setProp("editable", false);
        arg.event.setProp("durationEditable", false);
        arg.event.setProp("startEditable", false);
      }
    },

    eventDrop: async (info) => {
      const p = info.event.extendedProps || {};
      if (p.isRepeatOccurrence) {
        info.revert();
        alert("Repeating events: edit the series instead (no single-instance moves yet).");
        return;
      }
      await persistMovedEvent(info.event);
    },

    eventResize: async (info) => {
      const p = info.event.extendedProps || {};
      if (p.isRepeatOccurrence) {
        info.revert();
        alert("Repeating events: edit the series instead (no single-instance resizes yet).");
        return;
      }
      await persistMovedEvent(info.event);
    }
  });

  calendar.render();
  hookMonthTitleClick();
  attachSwipe(calendarEl);

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

  evtAllDay?.addEventListener("change", () => {
    preserveDatesOnAllDayToggle(!!evtAllDay.checked);
  });

  evtOwner?.addEventListener("change", () => {
    const v = evtOwner.value;
    ownerCustomWrap?.classList.toggle("hidden", v !== "custom");
    if (v !== "custom" && evtOwnerCustom) evtOwnerCustom.value = "";
  });

  evtRepeat?.addEventListener("change", () => {
    const v = evtRepeat.value;
    repeatUntilWrap?.classList.toggle("hidden", v === "none");
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
    await deleteDoc(doc(db, "events", editingDocId));
    closeModal();
  });

  taskClose?.addEventListener("click", closeTaskModal);
  taskDone?.addEventListener("click", closeTaskModal);
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

function hookMonthTitleClick() {
  const title = document.querySelector(".fc-toolbar-title");
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
    if (dt > 650) return;

    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - sx;
    const dy = touch.clientY - sy;

    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > 45) return;

    if (dx < 0) calendar?.next();
    else calendar?.prev();
  }, { passive: true });
}

// =====================
// PART 2 STARTS BELOW
// - Rendering (calendar + panels)
// - Search/filter helpers
// - Upcoming + Outstanding panels
// - Modals + checklist autosave
// - Repeat expansion engine
// - Utilities (date helpers, escapeHtml, etc.)
// =====================

// ---------- Rendering ----------
function renderCalendarFromCache() {
  if (!calendar) return;

  calendar.removeAllEvents();
  for (const e of getVisibleEvents()) calendar.addEvent(e);

  const searchActive = isSearchActive();
  if (!searchActive && calendar.view?.type === "listCustom") {
    calendar.changeView("dayGridMonth");
  }
}

function renderPanels() {
  renderUpcoming();
  renderOutstanding();
}

function getVisibleEvents() {
  let list = expandedEvents.slice();
  list = list.filter((e) => matchOwnerFilter(e));
  list = list.filter((e) => matchSearch(e));

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
    if (ownerFilterValue !== owner) return false;
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
  return normalizeOwner(e.extendedProps?.owner) === ownerFilterValue;
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
    openListView();
  }
}

function openListView() {
  if (!calendar) return;

  const days = Number(listRangeSelect?.value || 7);
  calendar.setOption("views", {
    listCustom: { type: "list", duration: { days }, buttonText: "List" }
  });

  calendar.changeView("listCustom");

  const bounds = getSearchBounds();
  if (bounds?.from) calendar.gotoDate(bounds.from);
  else calendar.gotoDate(new Date());
}

// ---------- Upcoming ----------
function renderUpcoming() {
  if (!upcomingListEl) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  let list = expandedEvents.slice();
  list = list.filter(matchOwnerFilter);
  list = list.filter(matchSearch);

  const upcoming = [];
  for (const e of list) {
    const start = new Date(e.start);
    const end = e.end ? new Date(e.end) : null;
    const isAllDay = !!e.allDay;

    if (isAllDay) {
      if (start.getTime() >= todayStart.getTime()) upcoming.push(e);
      continue;
    }

    if (start.toDateString() === now.toDateString()) {
      const endTime = end ? end.getTime() : start.getTime();
      if (endTime >= now.getTime()) upcoming.push(e);
    } else if (start.getTime() > now.getTime()) {
      upcoming.push(e);
    }
  }

  upcoming.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const top = upcoming.slice(0, 5);
  if (top.length === 0) {
    upcomingListEl.textContent = "No upcoming events.";
    return;
  }

  upcomingListEl.innerHTML = top.map(renderPanelItemHTML).join("");
  upcomingListEl.querySelectorAll("[data-open-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-open-id");
      const occ = el.getAttribute("data-occ");
      openFromPanel(id, occ, false);
    });
  });
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
  if (!outstandingListEl || !outPage) return;

  let list = expandedEvents.slice();
  list = list.filter(matchOwnerFilter);
  list = list.filter(matchSearch);

  const withUnchecked = list.filter((e) => {
    const items = e.extendedProps?.checklist || [];
    return Array.isArray(items) && items.some(it => !it.done);
  });

  withUnchecked.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const totalPages = Math.max(1, Math.ceil(withUnchecked.length / OUT_PAGE_SIZE));
  outstandingPage = Math.min(outstandingPage, totalPages);

  const startIdx = (outstandingPage - 1) * OUT_PAGE_SIZE;
  const pageItems = withUnchecked.slice(startIdx, startIdx + OUT_PAGE_SIZE);

  outPage.textContent = `Page ${outstandingPage} / ${totalPages}`;

  if (pageItems.length === 0) {
    outstandingListEl.textContent = "No outstanding checklist items 🎉";
    return;
  }

  outstandingListEl.innerHTML = pageItems.map(renderPanelItemHTMLWithProgress).join("");
  outstandingListEl.querySelectorAll("[data-open-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-open-id");
      const occ = el.getAttribute("data-occ");
      openFromPanel(id, occ, true);
    });
  });
}

// ---------- Panel open helper ----------
function openFromPanel(sourceId, occurrenceStartISO, checklistView) {
  const docData = rawDocs.find(d => d.id === sourceId);
  if (!docData) return;

  const occStart = occurrenceStartISO ? new Date(occurrenceStartISO) : (docData.start ? new Date(docData.start) : null);

  if (checklistView) {
    openTaskModal(docData, occStart);
  } else {
    openEventModal({
      mode: "edit",
      id: sourceId,
      occurrenceStart: occStart,
      title: docData.title || "",
      start: docData.start ? new Date(docData.start) : occStart,
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
  }
}

// ---------- Repeat expansion ----------
function normalizeDocs(docs) {
  return docs.map((d) => {
    const owner = normalizeOwner(d.owner);
    const start = d.start ? new Date(d.start) : null;
    const end = d.end ? new Date(d.end) : null;

    return {
      id: d.id,
      title: d.title || "",
      start,
      end,
      allDay: !!d.allDay,
      owner,
      ownerCustom: d.ownerCustom || "",
      type: d.type || "general",
      notes: d.notes || "",
      checklist: Array.isArray(d.checklist) ? d.checklist : [],
      repeat: d.repeat || "none",
      repeatUntil: d.repeatUntil || ""
    };
  }).filter(d => d.start instanceof Date && !isNaN(d.start));
}

function expandRepeats(norm) {
  const horizonDays = 240;
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const out = [];
  for (const d of norm) {
    const style = OWNER_STYLE[d.owner] || OWNER_STYLE.custom;

    const base = {
      sourceId: d.id,
      owner: d.owner,
      ownerCustom: d.ownerCustom,
      type: d.type,
      notes: d.notes,
      checklist: d.checklist
    };

    const repeat = d.repeat || "none";
    if (repeat === "none") {
      out.push(makeFcEvent({
        id: d.id,
        title: d.title,
        start: d.start,
        end: d.end,
        allDay: d.allDay,
        style,
        extra: { ...base, isRepeatOccurrence: false }
      }));
      continue;
    }

    const until = d.repeatUntil ? new Date(d.repeatUntil + "T23:59:59") : horizon;
    const stop = until.getTime() < horizon.getTime() ? until : horizon;

    let cur = new Date(d.start);
    let count = 0;

    while (cur.getTime() <= stop.getTime() && count < 400) {
      const occStart = new Date(cur);
      const durMs = d.end ? (new Date(d.end).getTime() - new Date(d.start).getTime()) : 0;
      const occEndAdj = d.end ? new Date(occStart.getTime() + durMs) : null;

      const occId = `${d.id}__${occStart.toISOString().slice(0,10)}`;

      out.push(makeFcEvent({
        id: occId,
        title: d.title,
        start: occStart,
        end: occEndAdj,
        allDay: d.allDay,
        style,
        extra: { ...base, isRepeatOccurrence: true }
      }));

      cur = advanceRepeat(cur, repeat);
      count++;
    }
  }

  return out;
}

function advanceRepeat(date, repeat) {
  const d = new Date(date);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  else if (repeat === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + 1);
  return d;
}

function makeFcEvent({ id, title, start, end, allDay, style, extra }) {
  return {
    id,
    title,
    start: start.toISOString(),
    end: end ? end.toISOString() : undefined,
    allDay: !!allDay,
    backgroundColor: style.bg,
    borderColor: style.border,
    textColor: "#e9ecf1",
    extendedProps: extra
  };
}

// ---------- Utilities ----------
function roundToNextHour(d) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  x.setHours(x.getHours() + 1);
  return x;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Start ----------
initApp().catch((err) => {
  console.error(err);
  setStatus("error", "Sync: error");
  alert("Firebase failed to initialize. Check firebaseConfig + Firestore rules.");
});

