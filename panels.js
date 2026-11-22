// The Calendar page's side panels: the next five plans, and plans with unchecked checklist
// items (paged). They draw the events they're given; app.js filters them and opens the window.
import { renderPanelCardHTML, renderPanelCardHTMLWithProgress } from './event-data.js';

export function renderUpcomingList(upcomingListEl, events, onOpen) {
  if (!upcomingListEl) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const list = events.slice();

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

  upcomingListEl.innerHTML = top.map(renderPanelCardHTML).join("");
  upcomingListEl.querySelectorAll("[data-open-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-open-id");
      const occ = el.getAttribute("data-occ");
      onOpen(id, occ);
    });
  });
}

// Returns the page actually shown (clamped to the last page).
export function renderOutstandingList({ outstandingListEl, outPage, events, page, pageSize, onOpen }) {
  if (!outstandingListEl || !outPage) return page;
  let outstandingPage = page;

  const list = events.slice();

  const withUnchecked = list.filter((e) => {
    const items = e.extendedProps?.checklist || [];
    return Array.isArray(items) && items.some(it => !it.done);
  });

  withUnchecked.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const totalPages = Math.max(1, Math.ceil(withUnchecked.length / pageSize));
  outstandingPage = Math.min(outstandingPage, totalPages);

  const startIdx = (outstandingPage - 1) * pageSize;
  const pageItems = withUnchecked.slice(startIdx, startIdx + pageSize);

  outPage.textContent = `Page ${outstandingPage} / ${totalPages}`;

  if (pageItems.length === 0) {
    outstandingListEl.textContent = "No outstanding checklist items 🎉";
    return outstandingPage;
  }

  outstandingListEl.innerHTML = pageItems.map(renderPanelCardHTMLWithProgress).join("");
  outstandingListEl.querySelectorAll("[data-open-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-open-id");
      const occ = el.getAttribute("data-occ");
      onOpen(id, occ);
    });
  });
  return outstandingPage;
}
