// app.js — Hubert’s House (FULL JS)
// Firebase sync + gate (remember device) + mobile-friendly + owner colors + notes + checklist + recurring
// Upcoming + Outstanding panels + checklist-focused modal + swipe months + month-title jump modal
// Theme randomizer + smooth theme transitions + optional time-of-day auto theme

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

/* ---------------- Firebase config ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBEXNyX6vIbHwGCpI3fpVUb5llubOjt9qQ",
  authDomain: "huberts-house.firebaseapp.com",
  projectId: "huberts-house",
  storageBucket: "huberts-house.firebasestorage.app",
  messagingSenderId: "233498547172",
  appId: "1:233498547172:web:e250d2f14b0e19c6322df1",
  measurementId: "G-CX5MN6WBFP"
};

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const on = (el, evt, fn, opts) => el && el.addEventListener(evt, fn, opts);

/* ---------------- Theme (random + smooth transition + time-of-day auto) ---------------- */
const LS_THEME = "huberts_house_theme_v3";

const THEMES = [
  {
    name: "Midnight Neon",
    vars: {
      "--bg": "#0b1020",
      "--bg2": "#070b17",
      "--card": "rgba(17,26,53,.72)",
      "--text": "#e9ecf1",
      "--muted": "#9aa6c4",
      "--border": "rgba(255,255,255,0.18)",
      "--accent": "#7aa2ff",
      "--blob1": "rgba(122,162,255,.60)",
      "--blob2": "rgba(255,107,107,.48)",
      "--blob3": "rgba(116,217,155,.42)"
    }
  },
  {
    name: "Grape Pop",
    vars: {
      "--bg": "#12071a",
      "--bg2": "#0b0510",
      "--card": "rgba(26,13,38,.70)",
      "--text": "#f6ecff",
      "--muted": "#d0b7ff",
      "--border": "rgba(255,255,255,0.16)",
      "--accent": "#bb86fc",
      "--blob1": "rgba(187,134,252,.55)",
      "--blob2": "rgba(255,180,120,.40)",
      "--blob3": "rgba(116,217,155,.30)"
    }
  },
  {
    name: "Mint Soda",
    vars: {
      "--bg": "#061615",
      "--bg2": "#040f0f",
      "--card": "rgba(10,31,29,.68)",
      "--text": "#e8fff8",
      "--muted": "#a8d4c7",
      "--border": "rgba(255,255,255,0.16)",
      "--accent": "#66f2c1",
      "--blob1": "rgba(102,242,193,.42)",
      "--blob2": "rgba(122,162,255,.32)",
      "--blob3": "rgba(255,107,143,.28)"
    }
  },
  // A lighter “daytime” theme (still subtle)
  {
    name: "Soft Daylight",
    vars: {
      "--bg": "#0b1222",
      "--bg2": "#0a0f1c",
      "--card": "rgba(230,236,255,.10)",
      "--text": "#f4f6ff",
      "--muted": "#c1c9e6",
      "--border": "rgba(255,255,255,0.22)",
      "--accent": "#8fb3ff",
      "--blob1": "rgba(143,179,255,.45)",
      "--blob2": "rgba(255,196,156,.28)",
      "--blob3": "rgba(166,255,215,.22)"
    }
  }
];

function applyTheme(theme) {
  const root = document.documentElement;

  // Smooth fade (no extra CSS needed; we do a quick opacity pulse)
  root.style.transition = "filter .25s ease";
  root.style.filter = "brightness(0.98)";
  setTimeout(() => (root.style.filter = "brightness(1)"), 60);

  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  localStorage.setItem(LS_THEME, JSON.stringify(theme));
}

function pickRandomTheme() {
  const t = THEMES[Math.floor(Math.random() * THEMES.length)];
  applyTheme(t);
  return t;
}

function initTheme() {
  const saved = localStorage.getItem(LS_THEME);
  if (saved) {
    try {
      applyTheme(JSON.parse(saved));
      return;
    } catch {}
  }

  // Time-of-day auto theme (only if no saved theme)
  const hr = new Date().getHours();
  const isDay = hr >= 7 && hr < 19;
  const t = isDay ? THEMES.find((x) => x.name === "Soft Daylight") : THEMES[0];
  applyTheme(t || THEMES[0]);
}

/* ---------------- Gate (password) ---------------- */
const PASSWORD = "mack"; // case-insensitive
const LS_UNLOCK = "huberts_house_unlocked";

const gate = $("gate");
const gateForm = $("gateForm");
const gateInput = $("gateInput");
const rememberDevice = $("rememberDevice"); // optional in some HTML versions

function showGate() {
  gate?.classList.remove("hidden");
  setTimeout(() => gateInput?.focus?.(), 50);
}

function hideGate() {
  gate?.classList.add("hidden");
}

function isUnlocked() {
  return localStorage.getItem(LS_UNLOCK) === "1";
}

on(gateForm, "submit", (e) => {
  e.preventDefault();
  const pw = (gateInput?.value || "").trim().toLowerCase();

  if (pw === PASSWORD) {
    // Remember device checkbox defaults to true if present; otherwise remember by default
    const remember = rememberDevice ? !!rememberDevice.checked : true;
    if (remember) localStorage.setItem(LS_UNLOCK, "1");
    else localStorage.removeItem(LS_UNLOCK);

    if (gateInput) gateInput.value = "";
    hideGate();
  } else {
    if (gateInput) {
      gateInput.value = "";
      gateInput.focus();
    }
    alert("Wrong password.");
  }
});

/* ---------------- UI elements ---------------- */
const statusEl = $("status");
const logoutBtn = $("logoutBtn");
const todayBtn = $("todayBtn");
const themeBtn = $("themeBtn");
const fab = $("fab");

const ownerFilter = $("ownerFilter");
const listRangeSelect = $("listRangeSelect");

const searchInput = $("searchInput");
const searchFrom = $("searchFrom"); // optional
const searchTo = $("searchTo");     // optional
const searchFiltersBtn = $("searchFiltersBtn"); // optional
const searchFilters = $("searchFilters");       // optional
const clearDatesBtn = $("clearDatesBtn");       // optional

const upcomingList = $("upcomingList");
const outstandingList = $("outstandingList");
const outPrev = $("outPrev");
const outNext = $("outNext");
const outPage = $("outPage");

/* Event modal */
const backdrop = $("modalBackdrop");
const modalClose = $("modalClose");
const cancelBtn = $("cancelBtn");
const deleteBtn = $("deleteBtn");
const eventForm = $("eventForm");
const modalTitle = $("modalTitle");

const evtTitle = $("evtTitle");
const evtStart = $("evtStart");
const evtEnd = $("evtEnd");
const evtAllDay = $("evtAllDay");
const evtOwner = $("evtOwner");
const evtType = $("evtType");
const evtNotes = $("evtNotes");
const ownerCustomWrap = $("ownerCustomWrap");
const evtOwnerCustom = $("evtOwnerCustom");

const evtRepeat = $("evtRepeat");
const repeatUntilWrap = $("repeatUntilWrap");
const evtRepeatUntil = $("evtRepeatUntil");

const checklistEl = $("checklist");
const addCheckItem = $("addCheckItem");

/* Checklist-focused modal */
const taskBackdrop = $("taskBackdrop");
const taskClose = $("taskClose");
const taskDone = $("taskDone");
const taskMeta = $("taskMeta");
const taskChecklistEl = $("taskChecklist");
const taskAddItem = $("taskAddItem");

/* Jump modal */
const jumpBackdrop = $("jumpBackdrop");
const jumpClose = $("jumpClose");
const jumpCancel = $("jumpCancel");
const jumpGoBtn = $("jumpGoBtn");
const jumpMonthSelect = $("jumpMonthSelect");
const jumpYearSelect = $("jumpYearSelect");

/* Quick add chips (optional) */
const quickChips = Array.from(document.querySelectorAll(".chip"));

/* ---------------- Owner styles ---------------- */
const OWNER_STYLE = {
  hanry:  { backgroundColor: "rgba(122,162,255,0.35)", borderColor: "rgba(122,162,255,0.85)", textColor: "#e9ecf1" },
  karena: { backgroundColor: "rgba(255,107,107,0.28)", borderColor: "rgba(255,107,107,0.85)", textColor: "#e9ecf1" },
  both:   { backgroundColor: "rgba(116,217,155,0.28)", borderColor: "rgba(116,217,155,0.85)", textColor: "#e9ecf1" },
  custom: { backgroundColor: "rgba(186,140,255,0.25)", borderColor: "rgba(186,140,255,0.78)", textColor: "#e9ecf1" }
};

function mapLegacyOwner(owner) {
  if (!owner) return null;
  if (owner === "his") return "hanry";
  if (owner === "hers") return "karena";
  if (owner === "both") return "both";
  return null;
}

function ownerKeyOf(e) {
  return e.ownerKey || mapLegacyOwner(e.owner) || "both";
}
function ownerLabelOf(e) {
  if (e.ownerLabel) return e.ownerLabel;
  const k = ownerKeyOf(e);
  if (k === "hanry") return "hanry";
  if (k === "karena") return "Karena";
  if (k === "both") return "Both";
  if (k === "custom") return "Other";
  return "Both";
}

/* ---------------- Checklist presets ---------------- */
const CHECKLIST_PRESETS = {
  wedding: ["RSVP", "Book travel", "Book hotel", "Buy gift", "Outfit", "Transportation"],
  trip: ["Book travel", "Book lodging", "Packing list", "House/pet plan", "Itinerary highlights"],
  appointment: ["Add questions", "Bring documents/ID", "Arrive 10 min early"],
  party: ["Confirm time/location", "Bring something", "Gift (if needed)", "Transportation"],
  general: []
};

/* ---------------- State ---------------- */
let db, eventsCol, calendar;
let rawEvents = [];
let editingEventId = null;
let currentRange = null;

let currentChecklist = [];

let ownerFilterValue = "all";
let listRangeDays = 7;

let searchQuery = "";
let searchFromValue = "";
let searchToValue = "";

let preSearchView = null;
let preSearchDate = null;

let outPageIdx = 0;
const OUT_PAGE_SIZE = 10;

/* Task modal state */
let taskEventId = null;
let taskChecklist = [];
let taskPersistTimer = null;

/* ---------------- Init ---------------- */
initTheme();
on(themeBtn, "click", () => pickRandomTheme());

on(logoutBtn, "click", () => {
  localStorage.removeItem(LS_UNLOCK);
  showGate();
});

if (isUnlocked()) hideGate();
else showGate();

/* ---------------- Firestore init ---------------- */
async function initApp() {
  statusEl && (statusEl.textContent = "Sync: connecting…");

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  eventsCol = collection(db, "events");

  initCalendarUI();

  const q = query(eventsCol, orderBy("start", "asc"));
  onSnapshot(
    q,
    (snap) => {
      rawEvents = [];
      snap.forEach((d) => rawEvents.push({ id: d.id, ...d.data() }));

      rebuildCalendarEvents();
      renderUpcoming();
      renderOutstanding();
      statusEl && (statusEl.textContent = "Sync: live");
    },
    (err) => {
      console.error(err);
      statusEl && (statusEl.textContent = "Sync: error (check rules)");
    }
  );
}

/* ---------------- Calendar setup ---------------- */
function initCalendarUI() {
  const calendarEl = $("calendar");
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    initialDate: new Date(),
    headerToolbar: {
      left: "prev,next",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listRange"
    },
    views: {
      listRange: { type: "list", duration: { days: listRangeDays }, buttonText: "List" },
      listAll: { type: "list", duration: { years: 5 } }
    },
    selectable: true,
    editable: true,
    nowIndicator: true,
    height: "auto",
    longPressDelay: 350,
    selectLongPressDelay: 350,

    datesSet: (info) => {
      currentRange = { start: info.start, end: info.end };
      rebuildCalendarEvents();
      bindMonthTitleClick();
    },

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
        ownerKey: "both",
        ownerLabel: "Both",
        type: "general",
        checklist: [],
        notes: "",
        recurrence: { freq: "none", until: null }
      });
    },

    select: (info) => {
      const start = info.start;
      let end = info.end || null;
      if (!end && !info.allDay) end = new Date(start.getTime() + 60 * 60 * 1000);
      openEventModal({
        mode: "create",
        title: "",
        start,
        end,
        allDay: info.allDay,
        ownerKey: "both",
        ownerLabel: "Both",
        type: "general",
        checklist: [],
        notes: "",
        recurrence: { freq: "none", until: null }
      });
    },

    eventClick: (info) => openEditModalFromEvent(info.event),

    eventDrop: async (info) => {
      if (info.event.extendedProps?.isRecurringInstance) {
        alert("Edit the repeating event to move the whole series (single-instance moves not supported yet).");
        info.revert();
        return;
      }
      await persistMovedEvent(info.event);
    },
    eventResize: async (info) => {
      if (info.event.extendedProps?.isRecurringInstance) {
        alert("Edit the repeating event to resize the whole series (single-instance edits not supported yet).");
        info.revert();
        return;
      }
      await persistMovedEvent(info.event);
    }
  });

  calendar.render();
  calendar.changeView("dayGridMonth");
  calendar.today();

  // Swipe months (optional)
  attachSwipeNavigation($("calendarWrap"));

  // Month title click -> jump modal
  bindMonthTitleClick();

  on(todayBtn, "click", () => calendar?.today());

  on(ownerFilter, "change", () => {
    ownerFilterValue = ownerFilter.value || "all";
    rebuildCalendarEvents();
    renderUpcoming();
    renderOutstanding();
  });

  on(listRangeSelect, "change", () => {
    listRangeDays = Number(listRangeSelect.value || "7") || 7;
    calendar.setOption("views", {
      ...calendar.getOption("views"),
      listRange: { type: "list", duration: { days: listRangeDays }, buttonText: "List" },
      listAll: { type: "list", duration: { years: 5 } }
    });
    if (calendar.view.type === "listRange") calendar.changeView("listRange", calendar.getDate());
  });

  // Search UI (works whether you have date filters or not)
  on(searchFiltersBtn, "click", () => searchFilters?.classList.toggle("hidden"));
  on(clearDatesBtn, "click", () => {
    if (searchFrom) searchFrom.value = "";
    if (searchTo) searchTo.value = "";
    searchFromValue = "";
    searchToValue = "";
    updateFiltersBtnState();
    enterSearchModeIfNeeded();
    rebuildCalendarEvents();
    renderUpcoming();
    renderOutstanding();
  });

  on(searchInput, "input", () => {
    searchQuery = (searchInput.value || "").trim().toLowerCase();
    enterSearchModeIfNeeded();
    rebuildCalendarEvents();
    renderUpcoming();
    renderOutstanding();
  });

  on(searchFrom, "change", () => {
    searchFromValue = (searchFrom.value || "").trim();
    searchFilters?.classList.remove("hidden");
    updateFiltersBtnState();
    enterSearchModeIfNeeded();
    rebuildCalendarEvents();
    renderUpcoming();
    renderOutstanding();
  });

  on(searchTo, "change", () => {
    searchToValue = (searchTo.value || "").trim();
    searchFilters?.classList.remove("hidden");
    updateFiltersBtnState();
    enterSearchModeIfNeeded();
    rebuildCalendarEvents();
    renderUpcoming();
    renderOutstanding();
  });

  // Quick add chips (optional)
  quickChips.forEach((btn) => {
    on(btn, "click", () => openQuickAdd(btn.dataset.template || "general"));
  });

  on(fab, "click", () => {
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    openEventModal({
      mode: "create",
      title: "",
      start,
      end,
      allDay: false,
      ownerKey: "both",
      ownerLabel: "Both",
      type: "general",
      checklist: [],
      notes: "",
      recurrence: { freq: "none", until: null }
    });
  });

  // Event modal handlers
  on(modalClose, "click", closeEventModal);
  on(cancelBtn, "click", closeEventModal);
  on(backdrop, "click", (e) => e.target === backdrop && closeEventModal());

  on(evtOwner, "change", () => {
    const isCustom = evtOwner.value === "custom";
    ownerCustomWrap?.classList.toggle("hidden", !isCustom);
    if (isCustom) setTimeout(() => evtOwnerCustom?.focus?.(), 50);
  });

  on(evtRepeat, "change", () => {
    const isRepeating = evtRepeat.value !== "none";
    repeatUntilWrap?.classList.toggle("hidden", !isRepeating);
    if (!isRepeating && evtRepeatUntil) evtRepeatUntil.value = "";
  });

  on(evtType, "change", () => {
    const type = evtType.value || "general";
    if (currentChecklist.length > 0) {
      const ok = confirm("Replace your current checklist with this type’s preset?");
      if (!ok) return;
    }
    setChecklistPreset(type);
  });

  on(addCheckItem, "click", () => {
    currentChecklist.push({ text: "", done: false });
    renderChecklist(checklistEl, currentChecklist, { allowRemove: true, onChange: () => {} });
  });

  on(evtAllDay, "change", () => {
    // preserve entered values when toggling
    const allDay = !!evtAllDay.checked;
    const prevStart = evtStart?.value || "";
    const prevEnd = evtEnd?.value || "";

    evtStart.type = allDay ? "date" : "datetime-local";
    evtEnd.type = allDay ? "date" : "datetime-local";

    if (evtStart) evtStart.value = convertInputValue(prevStart, allDay);
    if (evtEnd) evtEnd.value = prevEnd ? convertInputValue(prevEnd, allDay) : "";
  });

  on(eventForm, "submit", async (e) => {
    e.preventDefault();
    await handleSaveEvent();
  });

  on(deleteBtn, "click", async () => {
    if (!editingEventId) return;
    if (!confirm("Delete this event?")) return;
    await deleteDoc(doc(db, "events", editingEventId));
    closeEventModal();
  });

  // Jump modal handlers
  on(jumpClose, "click", closeJumpModal);
  on(jumpCancel, "click", closeJumpModal);
  on(jumpBackdrop, "click", (e) => e.target === jumpBackdrop && closeJumpModal());
  on(jumpGoBtn, "click", () => {
    if (!calendar) return;
    const m = Number(jumpMonthSelect?.value ?? 0);
    const y = Number(jumpYearSelect?.value ?? new Date().getFullYear());
    calendar.gotoDate(new Date(y, m, 1));
    closeJumpModal();
  });

  // Outstanding paging
  on(outPrev, "click", () => {
    outPageIdx = Math.max(0, outPageIdx - 1);
    renderOutstanding();
  });
  on(outNext, "click", () => {
    outPageIdx += 1;
    renderOutstanding();
  });

  // Checklist-focused modal handlers
  on(taskClose, "click", closeTaskModal);
  on(taskDone, "click", closeTaskModal);
  on(taskBackdrop, "click", (e) => e.target === taskBackdrop && closeTaskModal());
  on(taskAddItem, "click", () => {
    taskChecklist.push({ text: "", done: false });
    renderTaskChecklist();
  });
}

/* ---------------- Search mode helpers ---------------- */
function updateFiltersBtnState() {
  const active = !!(searchFromValue || searchToValue);
  searchFiltersBtn?.classList.toggle("is-active", active);
}

function enterSearchModeIfNeeded() {
  if (!calendar) return;
  const hasText = !!searchQuery;
  const hasRange = !!(searchFromValue || searchToValue);

  if (hasText || hasRange) {
    if (!preSearchView) {
      preSearchView = calendar.view.type;
      preSearchDate = calendar.getDate();
    }
    if (hasText && !hasRange) calendar.changeView("listAll");
    else calendar.changeView("listRange");
  } else {
    if (preSearchView) {
      calendar.changeView(preSearchView);
      if (preSearchDate) calendar.gotoDate(preSearchDate);
    }
    preSearchView = null;
    preSearchDate = null;
  }
}

/* ---------------- Month title click -> jump ---------------- */
function populateYearSelect(centerYear) {
  if (!jumpYearSelect) return;
  jumpYearSelect.innerHTML = "";
  const start = centerYear - 10;
  const end = centerYear + 10;
  for (let y = start; y <= end; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    jumpYearSelect.appendChild(opt);
  }
}

function openJumpModal() {
  if (!calendar) return;
  const d = calendar.getDate();
  if (jumpMonthSelect) jumpMonthSelect.value = String(d.getMonth());
  populateYearSelect(d.getFullYear());
  if (jumpYearSelect) jumpYearSelect.value = String(d.getFullYear());
  jumpBackdrop?.classList.remove("hidden");
}

function closeJumpModal() {
  jumpBackdrop?.classList.add("hidden");
}

function bindMonthTitleClick() {
  const titleEl = document.querySelector(".fc .fc-toolbar-title");
  if (!titleEl) return;
  if (titleEl.dataset.boundJump === "1") return;
  titleEl.dataset.boundJump = "1";
  titleEl.style.cursor = "pointer";
  titleEl.title = "Tap to jump to a month";
  titleEl.addEventListener("pointerup", (e) => {
    e.preventDefault();
    openJumpModal();
  });
}

/* ---------------- Swipe navigation ---------------- */
function attachSwipeNavigation(targetEl) {
  if (!targetEl) return;

  let sx = 0, sy = 0;
  let tracking = false;
  let locked = false;

  const MIN_X = 40;
  const MIN_LOCK = 12;
  const MAX_Y = 80;

  targetEl.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    tracking = true;
    locked = false;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });

  targetEl.addEventListener("touchmove", (e) => {
    if (!tracking || !e.touches || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (!locked && Math.abs(dx) > MIN_LOCK && Math.abs(dy) < MAX_Y) locked = true;
    if (locked) e.preventDefault();
  }, { passive: false });

  targetEl.addEventListener("touchend", (e) => {
    if (!tracking || !e.changedTouches || e.changedTouches.length !== 1) return;
    tracking = false;

    const ex = e.changedTouches[0].clientX;
    const ey = e.changedTouches[0].clientY;
    const dx = ex - sx;
    const dy = ey - sy;

    if (Math.abs(dx) >= MIN_X && Math.abs(dy) <= MAX_Y) {
      if (dx < 0) calendar?.next();
      else calendar?.prev();
    }
  }, { passive: true });
}

/* ---------------- Data filtering ---------------- */
function passesOwnerFilter(ownerKey) {
  if (ownerFilterValue === "all") return true;
  return (ownerKey || "both") === ownerFilterValue;
}

function passesSearchFilter(e) {
  const hasText = !!searchQuery;
  const hasRange = !!(searchFromValue || searchToValue);
  if (!hasText && !hasRange) return true;

  if (hasText) {
    const t = (e.title || "").toLowerCase();
    const n = (e.notes || "").toLowerCase();
    if (!(t.includes(searchQuery) || n.includes(searchQuery))) return false;
  }

  if (hasRange && e.start) {
    const startDay = new Date(e.start).toISOString().slice(0, 10);
    if (searchFromValue && startDay < searchFromValue) return false;
    if (searchToValue && startDay > searchToValue) return false;
  }

  return true;
}

/* ---------------- Recurrence expansion ---------------- */
function normalizeRecurrence(r) {
  const freq = r?.freq || "none";
  const until = r?.until || null;
  return { freq, until };
}

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d;
}

function expandRecurringEvent(base, rangeStart, rangeEnd) {
  const rec = normalizeRecurrence(base.recurrence);
  if (rec.freq === "none") return [];

  const baseStart = new Date(base.start);
  const baseEnd = base.end ? new Date(base.end) : null;
  const durationMs = baseEnd ? (baseEnd.getTime() - baseStart.getTime()) : 0;
  const untilDate = rec.until ? new Date(rec.until + "T23:59:59") : null;

  const out = [];
  let cur = new Date(baseStart);

  let guard = 0;
  while (cur < rangeStart && guard++ < 5000) {
    cur = addInterval(cur, rec.freq);
    if (untilDate && cur > untilDate) return out;
  }

  guard = 0;
  while (cur < rangeEnd && guard++ < 5000) {
    if (!untilDate || cur <= untilDate) {
      const occStart = new Date(cur);
      const occEnd = baseEnd ? new Date(occStart.getTime() + durationMs) : null;
      out.push({ start: occStart, end: occEnd, seriesId: base.id });
    } else break;
    cur = addInterval(cur, rec.freq);
  }
  return out;
}

/* ---------------- Calendar event normalization ---------------- */
function checklistProgress(checklist) {
  if (!Array.isArray(checklist) || checklist.length === 0) return null;
  const total = checklist.length;
  let done = 0;
  for (const item of checklist) if (item?.done) done++;
  return { done, total };
}

function normalizeForCalendar(e, overrides = {}) {
  const ownerKey = ownerKeyOf(e);
  const style = OWNER_STYLE[ownerKey] || OWNER_STYLE.both;

  const checklist = Array.isArray(e.checklist) ? e.checklist : [];
  const prog = checklistProgress(checklist);
  const title = prog ? `${e.title || ""} (${prog.done}/${prog.total})` : (e.title || "");

  return {
    id: overrides.id || e.id,
    title: title || "(untitled)",
    start: overrides.start || e.start,
    end: overrides.end || (e.end || undefined),
    allDay: !!e.allDay,
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    textColor: style.textColor,
    editable: !overrides.isRecurringInstance,
    extendedProps: {
      ownerKey,
      ownerLabel: e.ownerLabel || ownerLabelOf(e),
      notes: e.notes || "",
      type: e.type || "general",
      checklist,
      recurrence: e.recurrence || { freq: "none", until: null },
      isRecurringInstance: !!overrides.isRecurringInstance,
      seriesId: overrides.seriesId || null
    }
  };
}

function rebuildCalendarEvents() {
  if (!calendar) return;

  calendar.removeAllEvents();

  const rs = currentRange?.start ? new Date(currentRange.start) : null;
  const re = currentRange?.end ? new Date(currentRange.end) : null;

  for (const e of rawEvents) {
    if (!e.start) continue;
    const ok = ownerKeyOf(e);
    if (!passesOwnerFilter(ok)) continue;
    if (!passesSearchFilter(e)) continue;

    const rec = normalizeRecurrence(e.recurrence);
    if (rec.freq !== "none" && rs && re) {
      const occs = expandRecurringEvent({ ...e, id: e.id }, rs, re);
      for (const occ of occs) {
        const occId = `${occ.seriesId}__${occ.start.toISOString()}`;
        calendar.addEvent(
          normalizeForCalendar(e, {
            id: occId,
            start: occ.start.toISOString(),
            end: occ.end ? occ.end.toISOString() : undefined,
            isRecurringInstance: true,
            seriesId: occ.seriesId
          })
        );
      }
    } else {
      calendar.addEvent(normalizeForCalendar(e));
    }
  }
}

/* ---------------- Upcoming + Outstanding panels ---------------- */
function isSameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function formatWhen(e) {
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : null;

  if (e.allDay) {
    return start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " (all day)";
  }

  const s = start.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (!end) return s;
  const e2 = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${s}–${e2}`;
}

function shouldIncludeInUpcoming(e, now) {
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : null;

  // include all-day events today
  if (e.allDay && isSameLocalDate(start, now)) return true;

  // include future or ongoing timed events
  if (start >= now) return true;
  if (end && end >= now) return true;

  return false;
}

function hasOutstandingChecklist(e) {
  const list = Array.isArray(e.checklist) ? e.checklist : [];
  return list.length > 0 && list.some((x) => x && !x.done);
}

function panelItemHtml(e) {
  const ok = ownerKeyOf(e);
  const label = ownerLabelOf(e);
  const when = formatWhen(e);
  const prog = checklistProgress(Array.isArray(e.checklist) ? e.checklist : []);
  const progText = prog ? `${prog.done}/${prog.total}` : "";

  const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));

  return `
    <div class="panel-item owner-${safe(ok)}" data-id="${safe(e.id)}">
      <div class="panel-left">
        <div class="panel-titleline">
          <span class="owner-pill ${safe(ok)}">${safe(label)}</span>
          <div class="panel-titletext">${safe(e.title || "(untitled)")}</div>
        </div>
        <div class="panel-meta tiny muted">${safe(when)}</div>
      </div>
      <div class="prog">${progText ? safe(progText) : ""}</div>
    </div>
  `;
}

function renderUpcoming() {
  if (!upcomingList) return;
  const now = new Date();

  const filtered = rawEvents
    .filter((e) => e.start)
    .filter((e) => passesOwnerFilter(ownerKeyOf(e)) && passesSearchFilter(e))
    .filter((e) => shouldIncludeInUpcoming(e, now))
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 5);

  if (!filtered.length) {
    upcomingList.textContent = "No upcoming events.";
    return;
  }

  upcomingList.innerHTML = filtered.map(panelItemHtml).join("");

  // click -> normal edit modal
  upcomingList.querySelectorAll(".panel-item").forEach((el) => {
    on(el, "click", () => {
      const id = el.getAttribute("data-id");
      const ev = rawEvents.find((x) => x.id === id);
      if (ev) openEventModalFromRaw(ev);
    });
  });
}

function renderOutstanding() {
  if (!outstandingList) return;

  const outstanding = rawEvents
    .filter((e) => e.start)
    .filter((e) => passesOwnerFilter(ownerKeyOf(e)) && passesSearchFilter(e))
    .filter((e) => hasOutstandingChecklist(e))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const totalPages = Math.max(1, Math.ceil(outstanding.length / OUT_PAGE_SIZE));
  if (outPageIdx > totalPages - 1) outPageIdx = totalPages - 1;

  const start = outPageIdx * OUT_PAGE_SIZE;
  const page = outstanding.slice(start, start + OUT_PAGE_SIZE);

  if (outPage) outPage.textContent = `Page ${outPageIdx + 1} / ${totalPages}`;
  if (outPrev) outPrev.disabled = outPageIdx === 0;
  if (outNext) outNext.disabled = outPageIdx >= totalPages - 1;

  if (!page.length) {
    outstandingList.textContent = "No outstanding checklist items 🎉";
    return;
  }

  outstandingList.innerHTML = page.map(panelItemHtml).join("");

  // click -> checklist-focused modal
  outstandingList.querySelectorAll(".panel-item").forEach((el) => {
    on(el, "click", () => {
      const id = el.getAttribute("data-id");
      const ev = rawEvents.find((x) => x.id === id);
      if (ev) openTaskModal(ev);
    });
  });
}

/* ---------------- Quick add templates ---------------- */
function openQuickAdd(kind) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  let title = "New event";
  let allDay = false;
  let type = "general";
  let checklist = [];

  if (kind === "dinner") {
    title = "Dinner";
    start.setHours(19, 0, 0, 0);
    end.setHours(20, 30, 0, 0);
  } else if (kind === "groceries") {
    title = "Grocery run";
    start.setDate(start.getDate() + 1);
    start.setHours(17, 0, 0, 0);
    end.setTime(start.getTime() + 60 * 60 * 1000);
  } else if (kind === "weekend") {
    title = "Weekend plan";
    const d = new Date(start);
    const day = d.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    d.setHours(10, 0, 0, 0);
    start.setTime(d.getTime());
    end.setTime(d.getTime() + 90 * 60 * 1000);
    type = "party";
    checklist = (CHECKLIST_PRESETS.party || []).map((t) => ({ text: t, done: false }));
  } else if (kind === "reminder") {
    title = "Reminder";
    allDay = true;
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    checklist = [{ text: "Do the thing", done: false }];
  }

  openEventModal({
    mode: "create",
    title,
    start,
    end,
    allDay,
    ownerKey: "both",
    ownerLabel: "Both",
    type,
    checklist,
    notes: "",
    recurrence: { freq: "none", until: null }
  });
}

/* ---------------- Event modal ---------------- */
function convertInputValue(value, allDay) {
  if (!value) return "";
  if (allDay) return value.includes("T") ? value.split("T")[0] : value;
  if (!value.includes("T")) return `${value}T09:00`;
  return value;
}

function toInputValue(dateObj, allDay) {
  if (!(dateObj instanceof Date)) dateObj = new Date(dateObj);
  const pad = (n) => String(n).padStart(2, "0");
  const y = dateObj.getFullYear();
  const m = pad(dateObj.getMonth() + 1);
  const d = pad(dateObj.getDate());
  if (allDay) return `${y}-${m}-${d}`;
  const hh = pad(dateObj.getHours());
  const mm = pad(dateObj.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function fromInputValue(value, allDay) {
  if (allDay) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(value);
}

function setChecklistPreset(type) {
  const preset = CHECKLIST_PRESETS[type] || [];
  currentChecklist = preset.map((t) => ({ text: t, done: false }));
  renderChecklist(checklistEl, currentChecklist, { allowRemove: true, onChange: () => {} });
}

function renderChecklist(container, list, { allowRemove, onChange }) {
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tiny muted";
    empty.textContent = "No items yet.";
    container.appendChild(empty);
    return;
  }

  list.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "check-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!item.done;
    on(cb, "change", () => {
      list[idx].done = cb.checked;
      onChange?.();
    });

    const text = document.createElement("input");
    text.type = "text";
    text.value = item.text || "";
    text.placeholder = "Checklist item…";
    on(text, "input", () => {
      list[idx].text = text.value;
      onChange?.();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost remove";
    remove.textContent = "✕";
    remove.disabled = !allowRemove;
    remove.style.opacity = allowRemove ? "1" : "0.35";
    on(remove, "click", () => {
      if (!allowRemove) return;
      list.splice(idx, 1);
      onChange?.();
      renderChecklist(container, list, { allowRemove, onChange });
    });

    row.appendChild(cb);
    row.appendChild(text);
    row.appendChild(remove);
    container.appendChild(row);
  });
}

function ownerFromInputs() {
  const ownerKey = evtOwner?.value || "both";
  if (ownerKey === "custom") {
    const label = (evtOwnerCustom?.value || "").trim();
    return { ownerKey: "custom", ownerLabel: label || "Other" };
  }
  if (ownerKey === "hanry") return { ownerKey: "hanry", ownerLabel: "hanry" };
  if (ownerKey === "karena") return { ownerKey: "karena", ownerLabel: "Karena" };
  return { ownerKey: "both", ownerLabel: "Both" };
}

function buildRecurrenceFromForm() {
  const freq = evtRepeat?.value || "none";
  if (freq === "none") return { freq: "none", until: null };
  const until = (evtRepeatUntil?.value || "").trim();
  return { freq, until: until || null };
}

function openEventModal(payload) {
  const isEdit = payload.mode === "edit";
  editingEventId = isEdit ? payload.id : null;

  modalTitle && (modalTitle.textContent = isEdit ? "Edit event" : "New event");
  deleteBtn?.classList.toggle("hidden", !isEdit);

  if (evtTitle) evtTitle.value = payload.title ?? "";
  if (evtAllDay) evtAllDay.checked = !!payload.allDay;

  if (evtStart) evtStart.type = payload.allDay ? "date" : "datetime-local";
  if (evtEnd) evtEnd.type = payload.allDay ? "date" : "datetime-local";

  if (evtStart) evtStart.value = toInputValue(payload.start, !!payload.allDay);
  if (evtEnd) evtEnd.value = payload.end ? toInputValue(payload.end, !!payload.allDay) : "";

  if (evtOwner) evtOwner.value = payload.ownerKey || "both";
  const isCustom = (payload.ownerKey || "both") === "custom";
  ownerCustomWrap?.classList.toggle("hidden", !isCustom);
  if (evtOwnerCustom) evtOwnerCustom.value = isCustom ? (payload.ownerLabel || "") : "";

  if (evtType) evtType.value = payload.type || "general";
  if (evtNotes) evtNotes.value = payload.notes || "";

  const rec = normalizeRecurrence(payload.recurrence);
  if (evtRepeat) evtRepeat.value = rec.freq || "none";
  repeatUntilWrap?.classList.toggle("hidden", (evtRepeat?.value || "none") === "none");
  if (evtRepeatUntil) evtRepeatUntil.value = rec.until ? rec.until : "";

  currentChecklist = Array.isArray(payload.checklist) ? payload.checklist : [];
  renderChecklist(checklistEl, currentChecklist, { allowRemove: true, onChange: () => {} });

  backdrop?.classList.remove("hidden");
  setTimeout(() => evtTitle?.focus?.(), 50);
}

function openEventModalFromRaw(raw) {
  openEventModal({
    mode: "edit",
    id: raw.id,
    title: raw.title || "",
    start: new Date(raw.start),
    end: raw.end ? new Date(raw.end) : null,
    allDay: !!raw.allDay,
    ownerKey: ownerKeyOf(raw),
    ownerLabel: ownerLabelOf(raw),
    type: raw.type || "general",
    checklist: Array.isArray(raw.checklist) ? raw.checklist : [],
    notes: raw.notes || "",
    recurrence: normalizeRecurrence(raw.recurrence)
  });
}

function closeEventModal() {
  editingEventId = null;
  currentChecklist = [];
  backdrop?.classList.add("hidden");
}

async function handleSaveEvent() {
  const title = (evtTitle?.value || "").trim();
  if (!title) return;

  const allDay = !!evtAllDay?.checked;
  const { ownerKey, ownerLabel } = ownerFromInputs();

  if (ownerKey === "custom" && (!ownerLabel || ownerLabel === "Other")) {
    alert("Please type a name for 'Other…'.");
    evtOwnerCustom?.focus?.();
    return;
  }

  const type = evtType?.value || "general";
  const notes = (evtNotes?.value || "").trim();
  const recurrence = buildRecurrenceFromForm();

  const start = fromInputValue(evtStart?.value || "", allDay);
  const end = (evtEnd?.value || "") ? fromInputValue(evtEnd.value, allDay) : null;

  if (end && end.getTime() < start.getTime()) {
    alert("End must be after start.");
    return;
  }

  const checklist = (currentChecklist || [])
    .map((x) => ({ text: (x.text || "").trim(), done: !!x.done }))
    .filter((x) => x.text.length);

  const payload = {
    title,
    allDay,
    ownerKey,
    ownerLabel,
    type,
    notes,
    checklist,
    recurrence,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    updatedAt: serverTimestamp()
  };

  if (editingEventId) {
    await updateDoc(doc(db, "events", editingEventId), payload);
  } else {
    await addDoc(eventsCol, { ...payload, createdAt: serverTimestamp() });
  }

  closeEventModal();
}

async function persistMovedEvent(fcEvent) {
  const patch = {
    start: fcEvent.start ? fcEvent.start.toISOString() : null,
    end: fcEvent.end ? fcEvent.end.toISOString() : null,
    allDay: fcEvent.allDay,
    updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "events", fcEvent.id), patch);
}

function openEditModalFromEvent(event) {
  // If this is a recurring instance, we edit the SERIES doc instead
  const seriesId = event.extendedProps?.seriesId || event.id;
  const raw = rawEvents.find((x) => x.id === seriesId);
  if (!raw) return;
  openEventModalFromRaw(raw);
}

/* ---------------- Checklist-focused modal (fast checking) ---------------- */
function openTaskModal(e) {
  taskEventId = e.id;
  taskChecklist = Array.isArray(e.checklist)
    ? e.checklist.map((x) => ({ text: (x?.text || ""), done: !!x?.done }))
    : [];

  renderTaskMeta(e);
  renderTaskChecklist();

  taskBackdrop?.classList.remove("hidden");
}

function closeTaskModal() {
  taskEventId = null;
  taskChecklist = [];
  taskBackdrop?.classList.add("hidden");
}

function renderTaskMeta(e) {
  if (!taskMeta) return;

  const prog = checklistProgress(taskChecklist);
  const progText = prog ? `${prog.done}/${prog.total}` : "";

  const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));

  taskMeta.innerHTML = `
    <div class="line">
      <div class="title">${safe(e.title || "(untitled)")}</div>
      <div class="prog">${progText ? safe(progText) : ""}</div>
    </div>
    <div class="line">
      <span class="owner-pill ${safe(ownerKeyOf(e))}">${safe(ownerLabelOf(e))}</span>
      <div class="tiny muted" style="text-align:right;">${safe(formatWhen(e))}</div>
    </div>
  `;
}

function renderTaskChecklist() {
  const onChange = () => debouncedPersistTaskChecklist();
  renderChecklist(taskChecklistEl, taskChecklist, { allowRemove: true, onChange });

  // Keep meta progress fresh
  if (taskEventId) {
    const raw = rawEvents.find((x) => x.id === taskEventId);
    if (raw) renderTaskMeta(raw);
  }
}

function debouncedPersistTaskChecklist() {
  if (!taskEventId) return;
  if (taskPersistTimer) clearTimeout(taskPersistTimer);

  taskPersistTimer = setTimeout(async () => {
    try {
      const cleaned = (taskChecklist || [])
        .map((x) => ({ text: (x.text || "").trim(), done: !!x.done }))
        .filter((x) => x.text.length);

      await updateDoc(doc(db, "events", taskEventId), {
        checklist: cleaned,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
    }
  }, 450);
}

/* ---------------- Boot Firestore + calendar ---------------- */
initApp().catch((err) => {
  console.error(err);
  statusEl && (statusEl.textContent = "Sync: error");
  alert("Firebase failed to initialize. Check firebaseConfig + Firestore rules.");
});