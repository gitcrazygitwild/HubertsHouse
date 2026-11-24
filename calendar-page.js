// The Calendar page: the FullCalendar month/week/list views, search and the person filter,
// jump-to-month, the Upcoming and Outstanding panels, and the updates list. Moved unchanged
// from app.js; what it shares with app.js (the event lists, preview mode and a few helpers)
// comes in through `ctx` (connectCalendarPage), set by app.js at startup.
import { OWNER_STYLE, normalizeOwner, formatWhenForPanel, escapeHtml } from './event-data.js';
import { openEventModal, openTaskModal, persistMovedEvent } from './event-window.js';
import { renderUpcomingList, renderOutstandingList } from './panels.js';
import { holidayEvents } from './holidays.js';
import { birthdayEvents } from './birthdays-model.js';
import { bathEvents } from './bath-days.js';
import { trashEvents } from './trash-days.js';
import { showNotice } from './household.js';
import { setCloudRange } from './cloud-calendar.js';
import { calendarEventContent } from './calendar-view.js';

let ctx = {};
export function connectCalendarPage(context) { ctx = context; }
let calendar;
export function getCalendar() { return calendar; }

let updatesModalShownThisLoad = false;

// Calendar nav buttons in the card row
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const todayBtn = document.getElementById("todayBtn");

export const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");

const searchFiltersBtn = document.getElementById("searchFiltersBtn");
const closeSearchFiltersBtn = document.getElementById("closeSearchFiltersBtn");
const searchFilters = document.getElementById("searchFilters");
const searchFrom = document.getElementById("searchFrom");
const searchTo = document.getElementById("searchTo");
const clearDatesBtn = document.getElementById("clearDatesBtn");

const ownerFilter = document.getElementById("ownerFilter");

// ---------- Search UI state ----------
export function setSearchUIState() {
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

// Outstanding pagination
let outstandingPage = 1;
const OUT_PAGE_SIZE = 10;

// Search state
let searchText = "";

// Filter state
let ownerFilterValue = "all";

// ---------- Calendar ----------
export function initCalendarUI() {
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
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ctx.calendarExperience?.selectDay(info.date); ctx.addEventOnDay(info.date); }
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
      ctx.calendarExperience?.render({ rangeChanged: true });
      if (!ctx.demo) setCloudRange(info.start.toISOString(),info.end.toISOString());
    },

    dateClick: info => {
      ctx.calendarExperience?.selectDay(info.date);
      if (info.allDay) ctx.addEventOnDay(info.date);
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
  ctx.scrollToTopSafely(jumpBackdrop?.querySelector(".modal-scroll"));
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
export function renderCalendarFromCache() {
  if (!calendar) return;
  calendar.batchRendering(() => {
    calendar.removeAllEventSources();
    calendar.addEventSource(getVisibleEvents());
    calendar.addEventSource({id:'us-holidays',events:(info,success)=>success(holidayEvents(info.start,info.end))});
    calendar.addEventSource({id:'birthdays',events:(info,success)=>success(birthdayEvents(info.start,info.end))});
    calendar.addEventSource({id:'bath-days',events:(info,success)=>success(bathEvents(info.start,info.end))});
    calendar.addEventSource({id:'trash-days',events:(info,success)=>success(trashEvents(info.start,info.end))});
  });
  ctx.calendarExperience?.render();
}

export function renderPanels() {
  renderUpcoming();
  renderOutstanding();
  renderUpdates();
}

function renderUpdates() {
  if (!updatesListEl) return;

  const now = new Date();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recent = ctx.rawDocs
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

export function getVisibleEvents() {
  let list = ctx.expandedEvents.slice();
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
  renderUpcomingList(upcomingListEl, ctx.expandedEvents.filter(matchOwnerFilter).filter(matchSearch), (id, occ) => openFromPanel(id, occ, false));
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
  outstandingPage = renderOutstandingList({ outstandingListEl, outPage, events:ctx.expandedEvents.filter(matchOwnerFilter).filter(matchSearch), page:outstandingPage, pageSize:OUT_PAGE_SIZE, onOpen:(id, occ) => openFromPanel(id, occ, true) });
}

export function openFromPanel(sourceId, occurrenceStartISO, checklistView) {
  const docData = ctx.rawDocs.find(d => d.id === sourceId); if (!docData) return;
  const occStart = occurrenceStartISO ? new Date(occurrenceStartISO) : new Date(docData.start);
  if (checklistView) { openTaskModal(docData,occStart); return; }
  // Household repeats edit the series anchor; Apple recurring instances only
  // allow household assignments, leaving their dates untouched at Apple.
  openEventModal({...docData,mode:'edit',id:sourceId,occurrenceStart:occStart,start:new Date(docData.start),end:docData.end ? new Date(docData.end) : null,owner:normalizeOwner(docData.owner)});
}

export function wireCalendarPage() {
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
