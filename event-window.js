// The event windows: the details card, the add/edit window (title, the date chips and drag
// clock, where, who's coming, more) and the checklist window, with their buttons. Moved
// unchanged from app.js; what they share with it (the event lists, preview mode, sign-in and
// the save helpers) comes in through `ctx` (connectEventWindow), set by app.js at startup.
import { CHECKLIST_PRESETS, formatWhenForPanel, fromInputValue, normalizeOwner, toInputValue } from './event-data.js';
import { addChecklistItemUI, readChecklistUI, renderChecklistUI } from './checklist-ui.js';
import { dateKey } from './household-model.js';
import { describeDraft, parseQuickAdd } from './quick-add.js';
import { eventWeatherLine, searchPlaces, whereBoxText } from './place-weather.js';
import { initPlaceSuggest } from './place-suggest.js';
import { initEventDateEditor } from './event-editor.js';
import { overlappingEvents, preferredCalendar } from './event-planning.js';
import { refreshCloud, saveCloudAssignment, saveCloudEvent } from './cloud-calendar.js';
import { showNotice } from './household.js';
import { serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';

let ctx = {};
export function connectEventWindow(context) { ctx = context; }
let editingOriginal = null;

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
export function drawDetailsWhere() {
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
  const original = ctx.rawDocs.find(d => d.id === payload.id);
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
  ctx.scrollToTopSafely(detailsScroll);
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
  const docData = ctx.rawDocs.find(d => d.id === detailsDocId);
  if (!docData) return;

  closeDetailsModal();
  openTaskModal(docData, detailsOccurrenceStart);
});

// ---------- Modal: event editor ----------
export const backdrop = document.getElementById("modalBackdrop");
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
export const whereBox = initPlaceSuggest({ input:evtLocation, list:document.getElementById('evtLocationList'), preview:document.getElementById('evtLocationWeather'), search:searchPlaces,
  known:() => [...ctx.localDocs, ...ctx.cloudDocs].filter(d => d?.location).sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))).map(d => d.location),
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

let eventRequestId = null;
let savingEvent = false;

let editingDocId = null;
let editingOccurrenceStart = null;

let eventDateEditor, cloudEventBaseline = '';
function cloudDraftKey() { return JSON.stringify([evtTitle.value,evtStart.value,evtEnd.value,evtAllDay.checked,evtNotes.value,evtLocation?.value || '']); }

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
export function openEventModal(payload) {
  const isEdit = payload.mode === "edit";

  editingDocId = isEdit ? payload.id : null;
  editingOccurrenceStart = payload.occurrenceStart || null;
  eventRequestId = crypto.randomUUID();
  document.getElementById('evtError').textContent='';
  const original = ctx.rawDocs.find(d => d.id === editingDocId);
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

  ctx.scrollToTopSafely(editScroll);
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

  const docData = ctx.rawDocs.find(d => d.id === currentId);
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
  if (await ctx.deleteEventWithUndo(detailsDocId)) closeDetailsModal();
});

function calendarPreferenceKey() { return `hh_default_calendar_${ctx.auth?.currentUser?.uid || (ctx.demo ? 'preview' : 'signed-out')}`; }
export function defaultCalendar() {
  let saved;
  try { saved = localStorage.getItem(calendarPreferenceKey()); } catch {}
  const calendars = [...document.getElementById('evtCalendar').options].map(option => ({id:option.value,writable:true,selected:true}));
  return preferredCalendar(saved, calendars);
}
document.getElementById('defaultCalendar').addEventListener('change', event => {
  try { localStorage.setItem(calendarPreferenceKey(), event.target.value); } catch {}
  showNotice('Default calendar saved on this device.');
});
export function updateEventOverlap() {
  const box = document.getElementById('eventOverlap');
  const cloud = document.getElementById('evtCalendar').value !== 'household';
  const overlaps = overlappingEvents({ id:editingDocId, start:evtStart.value, end:evtEnd.value, allDay:evtAllDay.checked,
    owner:evtOwner.value, ownerCustom:evtOwnerCustom.value, withFrankie:document.getElementById('evtWithFrankie').checked }, ctx.expandedEvents);
  box.replaceChildren(); box.classList.toggle('hidden', !overlaps.length);
  if (!overlaps.length) return;
  const label = document.createElement('strong'); label.textContent = 'A little heads-up: plans overlap'; box.append(label);
  const names = overlaps.slice(0, 3).map(event => event.title || 'Untitled event').join(' · ');
  box.append(document.createTextNode(`${names}${overlaps.length > 3 ? ` + ${overlaps.length - 3} more` : ''}. You can still save. Checks the loaded calendars and this occurrence.`));
}
for (const type of ['input', 'change']) document.getElementById('eventForm').addEventListener(type, updateEventOverlap);

function updateDestinationUI() {
  const cloud = document.getElementById('evtCalendar').value !== 'household';
  const original=editingOriginal || ctx.rawDocs.find(record=>record.id===editingDocId),readOnly=!!original?.readOnlyReason;
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
    await ctx.saveLocalEvent(editingDocId,payload,editingOriginal ? editingOriginal.checklist || [] : undefined); closeModal(); showNotice(ctx.demo ? 'Saved in this sample preview.' : 'Event saved for the household.');
  }
}

export async function persistMovedEvent(fcEvent) {
  const p = fcEvent.extendedProps || {};
  const sourceId = p.sourceId || fcEvent.id;

  const patch = {
    start: fcEvent.start ? fcEvent.start.toISOString() : null,
    end: fcEvent.end ? fcEvent.end.toISOString() : null,
    allDay: fcEvent.allDay,
    updatedAt: serverTimestamp()
  };
  const original = ctx.rawDocs.find(d => d.id === sourceId);
  if (original?.icloud) {
    const lastDay = fcEvent.end ? new Date(fcEvent.end) : new Date(fcEvent.start);
    if (fcEvent.allDay && fcEvent.end) lastDay.setDate(lastDay.getDate()-1);
    await saveCloudEvent({title:original.title,notes:original.notes || '',owner:original.owner || 'both',ownerCustom:original.ownerCustom || '',withFrankie:!!original.withFrankie,allDay:fcEvent.allDay,start:patch.start,end:patch.end || addHours(fcEvent.start,1).toISOString(),startLocal:toInputValue(fcEvent.start,false),endLocal:toInputValue(fcEvent.end || addHours(fcEvent.start,1),false),startDate:dateKey(fcEvent.start),endDate:dateKey(lastDay),repeat:'none'},original,original.calendarId,crypto.randomUUID());
    await refreshCloud();
  } else {
    if (fcEvent.allDay && fcEvent.end) { const inclusive=new Date(fcEvent.end); inclusive.setDate(inclusive.getDate()-1); patch.end=inclusive.toISOString(); }
    await ctx.saveLocalEvent(sourceId,patch);
  }
}

// ---------- Task modal ----------
let taskDocId = null, taskOriginal = null;

export function openTaskModal(docData, occurrenceStart) {
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
  ctx.scrollToTopSafely(taskBackdrop?.querySelector(".modal-scroll"));

}

async function saveTaskModal() {
  if(!taskOriginal || taskDone.disabled)return;
  taskDone.disabled=true;
  try {await ctx.saveEventChecklist(taskOriginal,readChecklistUI(taskChecklist));closeTaskModal();showNotice('Checklist saved.');}
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

export function initDateEditor() {
  eventDateEditor = initEventDateEditor({onChange:updateEventOverlap});
}
export function wireEventWindow() {
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
    if (await ctx.deleteEventWithUndo(editingDocId)) closeModal();
  });

  taskClose?.addEventListener("click", closeTaskModal);
  taskDone?.addEventListener("click", saveTaskModal);
  taskBackdrop?.addEventListener("click", (e) => {
    if (e.target === taskBackdrop) closeTaskModal();
  });
  taskAddItem?.addEventListener("click", () => {
    addChecklistItemUI(taskChecklist, { text: "", done: false }, true);
  });
}
