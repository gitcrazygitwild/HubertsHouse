// Frankie page → Recent logs: the last week from Huckleberry, filtered, with Edit and Delete.
// Loaded only while that card is open. Moved unchanged from baby.js; `ctx` is baby.js's
// shared state and actions.
import { renderHTML } from './dom.js';
import { logsHTML, describeLog, logKey } from './baby-logs.js';
const $ = id => document.getElementById(id);
let ctx;
const logs = {entries:null, filter:'all', showAll:false, loading:false, error:''};
let sampleLogs = null;
const LOG_FORM = {sleep:'sleep-log', bottle:'bottle', diaper:'diaper'};
function renderLogs() {
  const root = $('frankieLogs'); if (!root) return;
  document.querySelectorAll('[data-log-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.logFilter === logs.filter)));
  $('frankieLogsError').textContent = logs.error;
  if (!logs.entries) { renderHTML(root, `<p class="tiny muted log-empty">${logs.loading ? 'Loading recent logs from Huckleberry…' : ctx.snapshot ? 'Open to load recent logs.' : 'Connect Huckleberry in Settings to see recent logs.'}</p>`); return; }
  renderHTML(root, logsHTML({entries:logs.entries, timezone:ctx.zone(), filter:logs.filter, showAll:logs.showAll}));
}
async function loadLogs() {
  if (!ctx.snapshot || logs.loading) { renderLogs(); return; }
  logs.loading = true; logs.error = ''; renderLogs();
  try { logs.entries = ctx.demo ? demoLogs() : (await ctx.call('recent')).entries || []; }
  catch (e) { logs.error = ctx.message(e); }
  finally { logs.loading = false; renderLogs(); }
}
async function changeLog(entry, childId = ctx.connection.selected, connectionVersion = ctx.connection.connectionVersion) {
  if (ctx.demo) demoChange(entry); else await ctx.call('change',{entry,childId,connectionVersion});
}
// Sample logs for the preview: the last three days of sample sleep and bottles, plus diapers.
function demoLogs() {
  if (sampleLogs) return sampleLogs.map(entry => ({...entry}));
  const since = Date.now() - 3 * 86400000, modes = ['pee','both','poo','pee'];
  const sleeps = ctx.snapshot.sleeps.filter(item => Date.parse(item.start) >= since).map((item, i) => ({kind:'sleep',id:`s${i}`,version:'1.000000000',start:item.start,end:item.end}));
  const bottles = ctx.snapshot.bottles.filter(item => Date.parse(item.start) >= since).map((item, i) => ({kind:'bottle',id:`b${i}`,version:'1.000000000',start:item.start,amount:item.amount,units:item.units,bottleType:item.type}));
  const diapers = bottles.map((item, i) => ({kind:'diaper',id:`d${i}`,version:'1.000000000',start:new Date(Date.parse(item.start) + 20 * 60000).toISOString(),mode:modes[i % modes.length]})).filter(item => Date.parse(item.start) < Date.now());
  sampleLogs = [...sleeps, ...bottles, ...diapers].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return sampleLogs.map(entry => ({...entry}));
}
function demoChange(entry) {
  demoLogs(); const index = sampleLogs.findIndex(item => item.kind === entry.kind && item.id === entry.id);
  if (index < 0) return;
  if (entry.change === 'delete') sampleLogs.splice(index, 1);
  else { const {change, ...fields} = entry; sampleLogs[index] = {...sampleLogs[index], ...fields}; sampleLogs.sort((a, b) => Date.parse(b.start) - Date.parse(a.start)); }
}
function editLog(entry) {
  const prefill = {start:entry.start, end:entry.end, amount:entry.amount, units:entry.units, bottleType:entry.bottleType, mode:entry.mode};
  ctx.openLog(LOG_FORM[entry.kind], prefill, entry);
}
async function deleteLog(entry, button) {
  if (ctx.busy) return;
  const {noun, what, when} = describeLog(entry, ctx.zone());
  if (!confirm(`Delete this ${noun} (${what}, ${when}) from ${ctx.demo ? 'the sample logs' : 'Huckleberry'}? This can’t be undone.`)) return;
  ctx.busy = true; button.disabled = true; logs.error = ''; ctx.home();
  try { await changeLog({change:'delete', kind:entry.kind, id:entry.id, version:entry.version}); ctx.showNotice(ctx.demo ? 'Sample log deleted.' : 'Deleted from Huckleberry.'); await ctx.refresh(true); }
  catch (e) { logs.error = ctx.message(e); }
  finally { ctx.busy = false; if (button.isConnected) button.disabled = false; ctx.home(); await loadLogs(); }
}
function initLogs() {
  const card = $('frankieLogsCard'); if (!card) return;
  $('frankieLogsDetails').addEventListener('toggle', e => { if (e.currentTarget.open) loadLogs(); });
  card.addEventListener('click', e => {
    const filter = e.target.closest('[data-log-filter]'), find = key => logs.entries?.find(entry => logKey(entry) === key);
    if (filter) { logs.filter = filter.dataset.logFilter; logs.showAll = false; renderLogs(); return; }
    if (e.target.closest('[data-log-more]')) { logs.showAll = true; renderLogs(); return; }
    if (e.target.closest('[data-log-refresh]')) { loadLogs(); return; }
    const edit = e.target.closest('[data-log-edit]'), remove = e.target.closest('[data-log-delete]');
    if (edit && find(edit.dataset.logEdit)) editLog(find(edit.dataset.logEdit));
    if (remove && find(remove.dataset.logDelete)) deleteLog(find(remove.dataset.logDelete), remove);
  });
  renderLogs();
}

export function initRecentLogs(context) {
  ctx = context; initLogs();
  return { load:loadLogs, change:changeLog };
}
