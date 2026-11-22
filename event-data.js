// Household events as data: owners and their colors, checklist presets, turning saved
// records into calendar events (with repeats), date-input helpers and the panel cards.
// Pure: no DOM state, no Firebase. Moved out of app.js unchanged (cleanup plan, step 1).

export const OWNER_STYLE = {
  hanry:  { bg: "#f0ddca", border: "#bc8f62" },
  karena: { bg: "#e5ddef", border: "#a18ab8" },
  both:   { bg: "#dfe7d3", border: "#96aa7c" },
  custom: { bg: "#dbe5eb", border: "#8ba4b2" }
};

export function normalizeOwner(rawOwner) {
  const o = String(rawOwner || "").toLowerCase();
  if (o === "hanry") return "hanry";
  if (o === "karena") return "karena";
  if (o === "both") return "both";
  return "custom";
}

export const CHECKLIST_PRESETS = {
  general: [],
  wedding: ["RSVP", "Gift", "Travel", "Outfit", "Hotel"],
  trip: ["Book travel", "Lodging", "Packing list", "Car / rides", "Itinerary"],
  appointment: ["Add address", "Bring ID", "Arrive early", "Paperwork"],
  party: ["Invite list", "Food/drinks", "Music", "Supplies", "Cleanup plan"]
};

export function normalizeDocs(docs) {
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
      withFrankie: !!d.withFrankie && ["hanry","karena","both"].includes(owner),
      type: d.type || "general",
      notes: d.notes || "",
      location: d.location || "",
      checklist: Array.isArray(d.checklist) ? d.checklist : [],
      repeat: d.repeat || "none",
      repeatUntil: d.repeatUntil || ""
    };
  }).filter(d => d.start instanceof Date && !isNaN(d.start));
}

export function expandRepeats(norm) {
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
      withFrankie: d.withFrankie,
      type: d.type,
      notes: d.notes,
      location: d.location,
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

export function advanceRepeat(date, repeat) {
  const d = new Date(date);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  else if (repeat === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + 1);
  return d;
}

export function makeInclusiveAllDayEnd(endDate) {
  if (!(endDate instanceof Date) || isNaN(endDate)) return null;
  const x = new Date(endDate);
  x.setDate(x.getDate() + 1);
  return x;
}

export function makeFcEvent({ id, title, start, end, allDay, style, extra }) {
  let endForFc = end ? new Date(end) : null;
  if (allDay && endForFc) endForFc = makeInclusiveAllDayEnd(endForFc);

  return {
    id,
    title,
    start: start.toISOString(),
    end: endForFc ? endForFc.toISOString() : undefined,
    allDay: !!allDay,
    backgroundColor: style.bg,
    borderColor: style.border,
    textColor: "#30372d",
    extendedProps: extra
  };
}

export function renderPanelCardHTML(e) {
  const p = e.extendedProps || {};
  const owner = normalizeOwner(p.owner);
  const ownerLabel = owner === "custom" ? (p.ownerCustom || "Other") : owner;

  const when = formatWhenForPanel({
    start: new Date(e.start),
    end: e.end ? new Date(e.end) : null,
    allDay: !!e.allDay
  });

  const style = OWNER_STYLE[owner] || OWNER_STYLE.custom;
  const pillColor = style.border;

  return `
    <div class="panel-card" data-open-id="${p.sourceId || e.id}" data-occ="${String(e.start)}" style="border-left: 5px solid ${pillColor}; cursor: pointer;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
        <span class="owner-pill">${escapeHtml(ownerLabel)}</span>
        <strong style="font-size: 16px;">${escapeHtml(e.title || "")}</strong>
      </div>
      <div class="tiny muted">${escapeHtml(when)}</div>
    </div>
  `;
}

export function renderPanelCardHTMLWithProgress(e) {
  const p = e.extendedProps || {};
  const items = Array.isArray(p.checklist) ? p.checklist : [];
  const done = items.filter(i => i.done).length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return renderPanelCardHTML(e).replace(
    "</div>\n    </div>",
    ` <span class="progress-pill">${done}/${total} (${pct}%)</span></div>\n    </div>`
  );
}

export function formatWhenForPanel({ start, end, allDay }) {
  if (!start) return "";
  const optsDate = { weekday: "short", month: "short", day: "numeric" };
  const optsTime = { hour: "numeric", minute: "2-digit" };

  if (allDay) return `${start.toLocaleDateString(undefined, optsDate)} (all day)`;

  const d = start.toLocaleDateString(undefined, optsDate);
  const t1 = start.toLocaleTimeString(undefined, optsTime);
  if (!end) return `${d} • ${t1}`;
  const t2 = end.toLocaleTimeString(undefined, optsTime);
  return `${d} • ${t1}–${t2}`;
}

export function toInputValue(dateObj, allDay) {
  let d = dateObj;
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d)) d = new Date();

  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());

  if (allDay) return `${y}-${m}-${day}`;

  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function fromInputValue(value, allDay) {
  if (!value) return new Date();
  if (allDay) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(value);
}

export function roundToNextHour(d) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  x.setHours(x.getHours() + 1);
  return x;
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
