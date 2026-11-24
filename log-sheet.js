// The log window (bottle, diaper, finished sleep, pump): time chips and drag bars, amount
// chips, "same as last", and a Save button that says what it will do. Edits from Recent
// logs open it too. Moved unchanged from baby.js; `ctx` is baby.js's shared state and actions.
const $ = id => document.getElementById(id);
let ctx, formChild, formVersion, formId, formEdit = null;
const LOG_LOOK = { bottle:['🍼','Bottle','Save bottle'], diaper:['♡','Diaper change','Save diaper'], 'sleep-log':['☾','Finished sleep','Save sleep'], pump:['🤱','Pump','Save pump'] };
const lengthText = minutes => minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
const AMOUNTS = { oz:[2, 3, 4, 5, 6], ml:[60, 90, 120, 150, 180] };
const fmtAmount = (amount, units) => `${Number(amount)} ${units}`;
// The most recent bottle, from history or Huckleberry's own "last bottle".
function lastBottle() {
  const fromHistory = ctx.snapshot?.bottles?.at(-1), fromPrefs = ctx.snapshot?.lastBottle;
  const pick = !fromPrefs?.time || (fromHistory && Date.parse(fromHistory.start) >= Date.parse(fromPrefs.time)) ? fromHistory && { amount:fromHistory.amount, units:fromHistory.units, type:fromHistory.type } : { amount:fromPrefs.amount, units:fromPrefs.units, type:fromPrefs.type };
  return pick?.amount ? pick : null;
}
function relativeTime(value) {
  const date = new Date(value); if (isNaN(date)) return '';
  const minutes = Math.round((Date.now() - date) / 60000), clock = date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const label = date >= day ? 'Today' : date >= new Date(+day - 86400000) ? 'Yesterday' : date.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
  return minutes <= 1 && minutes >= -1 ? `Now · ${clock}` : `${label} · ${clock}${minutes > 1 && minutes < 600 ? ` · ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`} ago` : ''}`;
}
// Readouts, chip and pill states follow the form's real inputs.
// Drag bars: each one sets its real field, then the window refreshes from the fields.
const SLIDER_FIELD = { babyLogAmountSlider:'babyLogAmount', babyLogLeftSlider:'babyLogLeft', babyLogRightSlider:'babyLogRight' };
function applyLogSlider(target) {
  if (!target?.classList?.contains('log-slider')) return;
  const value = Number(target.value), agoTime = () => ctx.inputTime(Math.round((Date.now() + value * 60000) / 60000) * 60000); // nearest minute, so "45m" reads "45 min ago"
  if (target.id === 'babyLogStartAgo') $('babyLogStart').value = agoTime();
  else if (target.id === 'babyLogEndAgo') $('babyLogEnd').value = agoTime();
  else if (target.id === 'babyLogLength') $('babyLogStart').value = ctx.inputTime(new Date($('babyLogEnd').value) - value * 60000);
  else if (SLIDER_FIELD[target.id]) $(SLIDER_FIELD[target.id]).value = String(value);
}
function syncLogSliders() {
  const clamp = (input, value) => { input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), value))); };
  const ago = id => -Math.round((Date.now() - new Date($(id).value)) / 300000) * 5; // minutes, to the nearest 5
  clamp($('babyLogStartAgo'), ago('babyLogStart')); clamp($('babyLogEndAgo'), ago('babyLogEnd'));
  clamp($('babyLogLength'), Math.round((new Date($('babyLogEnd').value) - new Date($('babyLogStart').value)) / 60000));
  // Bottle and pump ranges follow the units.
  const ranges = { oz:{ bottle:[0.5, 10, 0.25], side:[0, 8, 0.25] }, ml:{ bottle:[15, 300, 5], side:[0, 240, 5] } };
  const set = (input, [min, max, step], value, label) => { input.min = min; input.max = max; input.step = step; clamp(input, value); const ends = input.nextElementSibling?.children; if (ends) { ends[0].textContent = label(min); ends[1].textContent = label(max); } };
  const bottleUnits = $('babyLogUnits').value === 'ml' ? 'ml' : 'oz', pumpUnits = $('babyLogPumpUnits').value === 'ml' ? 'ml' : 'oz';
  set($('babyLogAmountSlider'), ranges[bottleUnits].bottle, Number($('babyLogAmount').value) || 0, v => v === 0.5 ? '½' : `${v} ${bottleUnits}`);
  for (const side of ['Left', 'Right']) set($(`babyLog${side}Slider`), ranges[pumpUnits].side, Number($(`babyLog${side}`).value) || 0, v => `${v}`);
}
function syncLogForm() {
  syncLogSliders();
  const kind = $('babyLogKind').value, start = $('babyLogStart').value, end = $('babyLogEnd').value;
  $('babyLogStartText').textContent = relativeTime(start);
  if (kind === 'sleep-log') {
    const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
    $('babyLogDuration').textContent = Number.isFinite(minutes) && minutes > 0 ? `${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m of sleep` : 'Wake-up must be after sleep started';
  }
  for (const group of document.querySelectorAll('[data-time-chips]')) {
    const input = $(group.dataset.timeChips), minutes = Math.round((Date.now() - new Date(input.value)) / 60000);
    group.querySelectorAll('[data-ago]').forEach(chip => chip.setAttribute('aria-pressed', String(Math.abs(minutes - Number(chip.dataset.ago)) <= 1)));
  }
  for (const group of document.querySelectorAll('[data-pills]')) {
    const value = $(group.dataset.pills).value;
    group.querySelectorAll('[data-value]').forEach(pill => pill.setAttribute('aria-pressed', String(pill.dataset.value === value)));
  }
  const units = $('babyLogUnits').value, amount = Number($('babyLogAmount').value);
  if ($('babyLogAmountChips').dataset.units !== units) {
    $('babyLogAmountChips').dataset.units = units;
    $('babyLogAmountChips').innerHTML = AMOUNTS[units].map(value => `<button type="button" data-amount="${value}">${value} ${units}</button>`).join('');
  }
  $('babyLogAmountChips').querySelectorAll('[data-amount]').forEach(chip => chip.setAttribute('aria-pressed', String(Number(chip.dataset.amount) === amount)));
  // The exact time box stays tucked away unless "Other time…" is chosen or no chip matches.
  for (const group of document.querySelectorAll('[data-time-chips]')) {
    const block = group.parentElement, box = block.querySelector('.log-custom-time'), slider = block.querySelector('.log-slider');
    const ago = (Date.now() - new Date($(group.dataset.timeChips).value)) / 60000;
    // On the drag bar's 5-minute grid and within its range: no need for the exact box.
    const onSlider = slider && ago >= -1 && ago <= -Number(slider.min) + 1 && Math.abs(ago - Math.round(ago / 5) * 5) <= 1;
    if (box) box.hidden = onSlider && box.dataset.open !== 'true';
    group.querySelector('[data-other-time]')?.setAttribute('aria-pressed', String(!!box && !box.hidden));
  }
  const slept = Math.round((new Date(end) - new Date(start)) / 60000);
  document.querySelectorAll('#babyLogLengths [data-length]').forEach(chip => chip.setAttribute('aria-pressed', String(Math.abs(slept - Number(chip.dataset.length)) <= 1)));
  const left = Number($('babyLogLeft').value) || 0, right = Number($('babyLogRight').value) || 0, pumpUnits = $('babyLogPumpUnits').value;
  $('babyLogPumpTotal').textContent = `${Math.round((left + right) * 100) / 100} ${pumpUnits} in all`;
  // Say exactly what Save will do.
  if (!formEdit) {
    const diaper = { pee:'wet', poo:'dirty', both:'wet + dirty', dry:'dry' }[$('babyLogDiaper').value] || '';
    $('babyLogSave').textContent = kind === 'bottle' ? `Save ${fmtAmount(amount || 0, units)} bottle` : kind === 'diaper' ? `Save ${diaper} diaper` : kind === 'sleep-log' ? (slept > 0 ? `Save ${lengthText(slept)} sleep` : 'Save sleep') : kind === 'pump' ? `Save ${Math.round((left + right) * 100) / 100} ${pumpUnits} pump` : 'Save';
  }
}
// prefill: {start, end, amount, units, bottleType, mode} from quick add.
function openLog(kind, prefill = {}, editing = null) {
  if (ctx.busy || !ctx.snapshot) return false;
  formChild = ctx.connection.selected; formVersion = ctx.connection.connectionVersion; formId = crypto.randomUUID(); formEdit = editing;
  $('babyLogForm').reset(); $('babyLogKind').value = kind; $('babyLogError').textContent = ''; $('babyLogNotesWrap').open = false;
  const [icon, title, save] = LOG_LOOK[kind]; $('babyLogIcon').textContent = icon; $('babyLogFor').textContent = kind === 'pump' ? 'FOR KARENA' : 'FOR FRANKIE';
  document.querySelectorAll('.log-custom-time').forEach(box => { delete box.dataset.open; }); $('babyLogTitle').textContent = editing ? `Edit ${title.toLowerCase()}` : title; $('babyLogSave').textContent = editing ? 'Save changes' : save;
  $('babyLogNotesWrap').hidden = !!editing; // notes stay as they are in Huckleberry
  $('babyLogStartLabel').textContent = kind === 'sleep-log' ? 'Fell asleep' : kind === 'diaper' ? 'Changed' : 'When';
  $('babyLogStart').value = ctx.inputTime(prefill.start || Date.now() - (kind === 'sleep-log' ? 3600000 : 0)); $('babyLogEnd').value = ctx.inputTime(prefill.end || Date.now());
  // New bottles start from the last bottle logged (amount, units, milk).
  const last = lastBottle(), same = $('babyLogSame');
  $('babyLogAmount').value = String(prefill.amount ?? last?.amount ?? 4); $('babyLogUnits').value = prefill.units || last?.units || 'oz';
  $('babyLogMilk').value = prefill.bottleType || last?.type || 'Formula';
  same.hidden = !last || !!editing; if (last) { same.textContent = `Same as last · ${fmtAmount(last.amount, last.units)} ${last.type || ''}`.trim(); same.dataset.amount = last.amount; same.dataset.units = last.units; same.dataset.type = last.type || 'Formula'; }
  if (prefill.mode) $('babyLogDiaper').value = prefill.mode;
  // Pumps start from Karena's last session (or what was typed), in the same units.
  const lastPump = ctx.snapshot.pumps?.at(-1);
  const half = kind === 'pump' && prefill.left == null && prefill.amount ? Math.round(prefill.amount / 2 * 100) / 100 : null; // "pumped 5 oz" → 2.5 a side to start
  $('babyLogLeft').value = String(prefill.left ?? half ?? lastPump?.left ?? 2); $('babyLogRight').value = String(prefill.right ?? half ?? lastPump?.right ?? 2);
  $('babyLogPumpUnits').value = prefill.units && kind === 'pump' ? prefill.units : lastPump?.units || 'oz';
  // Only mention the time zone when this device isn't on the household's.
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('babyLogZone').textContent = deviceZone === ctx.zone() ? '' : `Times are in this device’s time zone (${deviceZone.replaceAll('_', ' ')}).`;
  document.querySelectorAll('[data-log-fields]').forEach(group => { const active = group.dataset.logFields === kind; group.hidden = !active; group.querySelectorAll('input,select').forEach(input => { input.disabled = !active; }); });
  syncLogForm(); $('babyLogDialog').showModal();
  return true;
}

export function initLogSheet(context) {
  ctx = context;
  return { open:openLog, init() {
  $('babyLogCancel').addEventListener('click', () => { if (!ctx.busy) $('babyLogDialog').close(); });
  $('babyLogDialog').addEventListener('cancel', e => { if (ctx.busy) e.preventDefault(); });
  $('babyLogForm').addEventListener('input', e => { applyLogSlider(e.target); formId = crypto.randomUUID(); syncLogForm(); });
  $('babyLogClose').addEventListener('click', () => { if (!ctx.busy) $('babyLogDialog').close(); });
  // Chips, stepper and pills set the real inputs, then count as an edit.
  const changed = () => { formId = crypto.randomUUID(); syncLogForm(); };
  $('babyLogForm').addEventListener('click', e => {
    const chip = e.target.closest('[data-ago]'), step = e.target.closest('[data-step]'), amount = e.target.closest('[data-amount]'), pill = e.target.closest('[data-pills] [data-value]'), same = e.target.closest('#babyLogSame');
    const other = e.target.closest('[data-other-time]'), length = e.target.closest('[data-length]'), pumpStep = e.target.closest('[data-pump-step]');
    if (other) { const box = other.closest('.log-block').querySelector('.log-custom-time'); box.dataset.open = 'true'; box.hidden = false; syncLogForm(); box.querySelector('input')?.focus(); return; }
    if (length) { $('babyLogStart').value = ctx.inputTime(new Date($('babyLogEnd').value) - Number(length.dataset.length) * 60000); changed(); return; }
    if (pumpStep) { const [id, dir] = pumpStep.dataset.pumpStep.split(':'), ml = $('babyLogPumpUnits').value === 'ml', input = $(id); input.value = String(Math.max(0, Math.round((Number(input.value || 0) + Number(dir) * (ml ? 10 : 0.25)) * 100) / 100)); changed(); return; }
    if (chip) { const input = $(chip.closest('[data-time-chips]').dataset.timeChips); input.value = ctx.inputTime(Date.now() - Number(chip.dataset.ago) * 60000); changed(); }
    else if (step) { const ml = $('babyLogUnits').value === 'ml', input = $('babyLogAmount'), next = Math.max(ml ? 5 : 0.5, Number(input.value || 0) + Number(step.dataset.step) * (ml ? 10 : 0.5)); input.value = String(Math.round(next * 10) / 10); changed(); }
    else if (amount) { $('babyLogAmount').value = amount.dataset.amount; changed(); }
    else if (pill) { $(pill.closest('[data-pills]').dataset.pills).value = pill.dataset.value; changed(); }
    else if (same) { $('babyLogAmount').value = same.dataset.amount; $('babyLogUnits').value = same.dataset.units; $('babyLogMilk').value = same.dataset.type; changed(); }
  });
  $('babyLogForm').addEventListener('submit', async e => {
    e.preventDefault(); if (ctx.busy) return;
    const kind = $('babyLogKind').value, start = new Date($('babyLogStart').value), end = new Date($('babyLogEnd').value);
    if (isNaN(start) || +start > Date.now() + 60000 || +start < Date.now() - 30 * 86400000 || (kind === 'sleep-log' && (isNaN(end) || end <= start || +end > Date.now() + 60000 || end - start > 48 * 3600000))) { $('babyLogError').textContent = 'Choose valid times within the past 30 days. A finished sleep needs an end after its start, within 48 hours.'; return; }
    const entry = formEdit ? {change:'edit',kind:formEdit.kind,id:formEdit.id,version:formEdit.version,start:start.toISOString()} : {kind,start:start.toISOString(),requestId:formId,notes:$('babyLogNotes').value};
    if (kind === 'sleep-log') entry.end = end.toISOString();
    if (kind === 'bottle') Object.assign(entry,{amount:Number($('babyLogAmount').value),units:$('babyLogUnits').value,bottleType:$('babyLogMilk').value});
    if (kind === 'diaper') entry.mode = $('babyLogDiaper').value;
    if (kind === 'pump') { Object.assign(entry, { left:Number($('babyLogLeft').value) || 0, right:Number($('babyLogRight').value) || 0, units:$('babyLogPumpUnits').value }); if (!(entry.left + entry.right > 0)) { $('babyLogError').textContent = 'Add how much came from at least one side.'; return; } }
    const controls = [...e.currentTarget.querySelectorAll('input,textarea,select,button')].filter(control => !control.disabled);
    ctx.busy = true; controls.forEach(control => { control.disabled = true; }); $('babyLogError').textContent = ''; ctx.home();
    try {
      if (formEdit) { await ctx.changeLog(entry,formChild,formVersion); $('babyLogDialog').close(); ctx.showNotice(ctx.demo ? 'Sample log updated.' : 'Updated in Huckleberry.'); }
      else { await ctx.write(entry,formChild,formVersion); $('babyLogDialog').close(); ctx.showNotice(ctx.demo ? 'Sample log saved.' : 'Saved in Huckleberry.'); }
      await ctx.refresh(true); if ($('frankieLogsDetails')?.open) ctx.loadLogs();
    }
    catch (e) { $('babyLogError').textContent = ctx.message(e); }
    finally { ctx.busy = false; controls.forEach(control => { control.disabled = false; }); ctx.home(); }
  });
  } };
}
