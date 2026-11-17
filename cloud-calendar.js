import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice } from './household.js';
const $ = id => document.getElementById(id);
let functions, connection = {connected:false}, onEvents, onCalendars, onChecklists, demo = false, checkedAt, lastError = '', range;
let inFlight = null, generation = 0, lastAttempt = 0, loadedRangeKey = '';
const POLL_MS = 5 * 60000;
const rangeKey = () => range ? `${range.start}/${range.end}` : '';
export const cloudState = () => connection;
async function call(name,data = {}) { const result = await httpsCallable(functions,name,{timeout:120000})(data); return result.data; }
function message(error) { return error.code === 'functions/not-found' ? 'The iCloud service has not been deployed yet.' : error.message || 'iCloud is unavailable. Try again shortly.'; }
function adoptConnection(next) {
  if (JSON.stringify(next) === JSON.stringify(connection)) return;
  connection = next; checkedAt = null; loadedRangeKey = '';
  onChecklists?.([]); onEvents([]); onCalendars(connection); render();
}
function status() {
  const badge = $('icloudBadge');
  badge.textContent = demo ? 'Sample preview' : !config.calendarServiceEnabled ? 'Setup needed' : lastError ? 'Needs attention' : connection.connected ? 'Connected' : 'Not connected';
  badge.classList.toggle('connected', connection.connected && !lastError);
  $('homeSyncStatus').textContent = demo ? 'Sample data · explore Settings' : !config.calendarServiceEnabled ? 'iCloud · setup needed' : lastError ? 'iCloud · needs attention' : checkedAt ? `iCloud · checked ${new Date(checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : connection.connected ? 'iCloud · connected' : 'Connect iCloud →';
  const calendarStatus = $('calendarSyncSummary');
  if (calendarStatus) calendarStatus.textContent = lastError || $('homeSyncStatus').textContent;
}
export async function initCloudCalendar(app, options) {
  onEvents = options.onEvents; onCalendars = options.onCalendars; onChecklists=options.onChecklists; demo = !!options.demo;
  functions = app ? getFunctions(app,config.functionsRegion) : null;
  render();
  if (demo || !config.calendarServiceEnabled) return;
  await refreshCloud();
  setInterval(() => { if (document.visibilityState === 'visible') refreshCloud({force:false}); },POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCloud({force:false}); });
}
export function setCloudRange(start,end) {
  if (range?.start === start && range?.end === end) return;
  range = {start,end}; refreshCloud({force:false});
}
export async function refreshCloud({force = true} = {}) {
  if (!functions || demo || !config.calendarServiceEnabled) return;
  if (!force && inFlight) { await inFlight; return refreshCloud({force:false}); }
  const nowMs = Date.now();
  const withinBaseline = !range || (+new Date(range.start) >= nowMs - 7 * 86400000 && +new Date(range.end) <= nowMs + 50 * 86400000);
  if (!force && nowMs - lastAttempt < POLL_MS && (withinBaseline || rangeKey() === loadedRangeKey)) return;
  const version = ++generation;
  if (inFlight) { await inFlight; if (version !== generation) return; }
  lastAttempt = Date.now();
  const requestedRange = rangeKey();
  inFlight = (async () => {
    try {
      const nextConnection = await call('calendarStatus');
      if (version !== generation) return;
      lastError = ''; adoptConnection(nextConnection);
      if (!connection.connected) { status(); return; }
      const now = new Date(), from = new Date(now.getTime() - 7 * 86400000), to = new Date(now.getTime() + 50 * 86400000);
      const ranges = [{start:from.toISOString(),end:to.toISOString()}];
      if (range && (new Date(range.start) < from || new Date(range.end) > to)) {
        const rangeStart = new Date(range.start), rangeEnd = new Date(range.end);
        if (rangeEnd - rangeStart > 366 * 86400000) throw new Error('Choose an iCloud date range of one year or less.');
        for (let cursor = rangeStart.getTime(); cursor < rangeEnd.getTime(); cursor += 120 * 86400000) {
          ranges.push({start:new Date(cursor).toISOString(),end:new Date(Math.min(cursor + 120 * 86400000,rangeEnd.getTime())).toISOString()});
        }
      }
      const results = await Promise.all(ranges.map(r => call('calendarEvents',{...r,connectionVersion:connection.connectionVersion})));
      if (version !== generation) return;
      const records = new Map(); for (const result of results) for (const event of result.events) records.set(event.id,event);
      loadedRangeKey = requestedRange; onChecklists?.(results[0].checklists || []); onEvents([...records.values()]); checkedAt = results[0].checkedAt; lastError = ''; status();
      if ($('cloudError')) $('cloudError').textContent = '';
      if ($('cloudChecked')) $('cloudChecked').textContent = `Last checked ${new Date(checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}. Checks every five minutes while this page is open.`;
    } catch (e) { if (version !== generation) return; lastError = message(e); status(); if ($('cloudError')) $('cloudError').textContent = lastError; }
  })();
  try { await inFlight; } finally { inFlight = null; }
}
function render() {
  status(); const panel = $('icloudPanel');
  const settingsVersion = connection.connectionVersion;
  if (demo || !config.calendarServiceEnabled) {
    panel.innerHTML = `<div class="connection-note"><strong>${demo ? 'Explore the house first.' : 'One-time setup needed'}</strong><p>${demo ? 'This preview uses sample events. Your Apple Account is never connected in preview mode.' : 'Your private calendar service needs to be activated before connecting iCloud. After setup, you can choose calendars and use an Apple app-specific password here.'}</p></div><p class="tiny">iCloud updates appear here on refresh and every five minutes while open. Regular events can be created, edited, and deleted. Recurring events and invitations appear here; manage those in Apple Calendar.</p>`;
    return;
  }
  if (connection.canManage === false) {
    panel.innerHTML = `<p><strong>Shared household calendars</strong></p><p>${connection.connected ? 'These selected Apple calendars are shared with you. You can create and edit events in writable calendars, and changes appear in Apple Calendar and both household dashboards.' : 'The household Apple connection is disconnected. The person who connected it can reconnect in Settings.'}</p>${connection.connected ? `<div>${connection.calendars.map(c => `<p class="tiny">${esc(c.name)}${!c.writable ? ' · read-only' : ''}</p>`).join('')}</div>` : ''}<p class="tiny muted">The person who connected Apple manages the account and which calendars are shared. Owners, Frankie labels, and checklists are shared in Hubert’s House.</p><button type="button" class="btn" id="refreshCloud">Refresh now</button><p id="cloudChecked" class="tiny">Checks every five minutes while this page is open.</p><p id="cloudError" class="form-error" role="alert">${esc(lastError)}</p>`;
    bindRefresh(); return;
  }
  if (!connection.connected) {
    panel.innerHTML = `<form id="icloudForm" class="connection-form"><label class="field"><span>Apple Account email</span><input id="appleEmail" type="email" autocomplete="username" required /></label><label class="field"><span>App-specific password</span><input id="applePassword" type="password" autocomplete="new-password" placeholder="xxxx-xxxx-xxxx-xxxx" required /></label><p class="tiny">Create one at <a href="https://account.apple.com/" target="_blank" rel="noopener noreferrer">account.apple.com ↗</a> under Sign-In and Security → App-Specific Passwords. Give it the name “Hubert’s House.”</p><button class="btn btn-primary" type="submit">Connect iCloud</button><p id="cloudError" class="form-error" role="alert">${esc(lastError)}</p></form>`;
    $('icloudForm').addEventListener('submit',async e => {
      e.preventDefault(); const button = e.currentTarget.querySelector('button'); button.disabled = true; $('cloudError').textContent = '';
      const email = $('appleEmail').value; const passwordInput = $('applePassword');
      try { const pending = call('calendarConnect',{email,password:passwordInput.value,connectionVersion:settingsVersion}); passwordInput.value = ''; connection = await pending; lastError = ''; generation++; render(); onCalendars(connection); showNotice('Connected. Choose the calendars to share with your household.'); }
      catch (error) { lastError = message(error); $('cloudError').textContent = lastError; status(); }
      finally { passwordInput.value = ''; button.disabled = false; }
    });
    return;
  }
  panel.innerHTML = `<p><strong>Shared with your household.</strong> Choose up to six calendars to share. Both adults can view and edit events in selected writable calendars. Unselected calendars stay private; your account manages this connection and selection.</p><form id="calendarChoices">${connection.calendars.map(c => `<label class="calendar-choice"><input type="checkbox" name="calendar" value="${esc(c.id)}" ${connection.selected.includes(c.id) ? 'checked' : ''} /><span>${esc(c.name)}${!c.writable ? ' · read-only' : ''}</span></label>`).join('')}<div class="connection-actions"><button class="btn btn-primary" type="submit">Save shared calendars</button><button type="button" class="btn" id="refreshCloud">Refresh now</button><button type="button" class="btn" id="disconnectCloud">Disconnect household</button></div></form><p id="cloudChecked" class="tiny">${checkedAt ? `Last checked ${esc(new Date(checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}. ` : ''}Checks every five minutes while this page is open.</p><p class="tiny">Recurring events and invitations are displayed here. Manage them in Apple Calendar. Owners and checklists stay privately in Hubert’s House, including for read-only Apple events. Find all saved event checklists in Chores & Lists.</p><p id="cloudError" class="form-error" role="alert">${esc(lastError)}</p>`;
  $('calendarChoices').addEventListener('submit',async e => {
    e.preventDefault(); const selected = [...e.currentTarget.querySelectorAll('input:checked')].map(x => x.value);
    if (selected.length > 6) { $('cloudError').textContent = 'Choose up to six calendars.'; return; }
    const button = e.currentTarget.querySelector('[type=submit]'); button.disabled = true;
    try { connection = await call('calendarSelect',{selected,connectionVersion:settingsVersion}); generation++; onChecklists?.([]); onEvents([]); onCalendars(connection); lastError = ''; render(); await refreshCloud(); showNotice('Shared calendar selection saved.'); }
    catch (error) { $('cloudError').textContent = message(error); } finally { button.disabled = false; }
  });
  bindRefresh();
  $('disconnectCloud').addEventListener('click',async e => {
    if (!confirm('Disconnect Apple Calendar for everyone in the household? The calendars will disappear from both dashboards. Your events will stay in Apple Calendar.')) return;
    e.target.disabled = true;
    try { connection = await call('calendarDisconnect',{connectionVersion:settingsVersion}); generation++; checkedAt = null; lastError = ''; onChecklists?.([]); onEvents([]); onCalendars(connection); render(); showNotice('Household Apple Calendar disconnected.'); }
    catch (error) { $('cloudError').textContent = message(error); e.target.disabled = false; }
  });
}
function bindRefresh() {
  $('refreshCloud').addEventListener('click',async e => { e.target.disabled = true; try { await refreshCloud(); if (!lastError) showNotice('Calendars are up to date.'); } finally { e.target.disabled = false; } });
}
export async function saveCloudEvent(event,original,calendarId,requestId) {
  if (!connection.connected) throw new Error('Connect iCloud in Settings first.');
  if (original?.readOnlyReason) throw new Error(original.readOnlyReason);
  return call('calendarSave',{calendarId,token:original?.token || null,etag:original?.etag || null,requestId,event,assignmentVersion:original?.assignmentVersion || 0,connectionVersion:original?.connectionVersion ?? connection.connectionVersion});
}
export async function saveCloudAssignment(assignment,original) {
  if (!connection.connected) throw new Error('Connect iCloud in Settings first.');
  return call('calendarAssign',{calendarId:original.calendarId,token:original.token,uid:original.uid,assignmentVersion:original.assignmentVersion || 0,connectionVersion:original.connectionVersion ?? connection.connectionVersion,assignment,context:{title:original.title,start:original.start,end:original.end,allDay:!!original.allDay,recurring:!!original.recurring}});
}
export async function deleteCloudEvent(original) {
  if (original.readOnlyReason) throw new Error(original.readOnlyReason);
  await call('calendarDelete',{calendarId:original.calendarId,token:original.token,etag:original.etag,connectionVersion:original.connectionVersion ?? connection.connectionVersion});
}
