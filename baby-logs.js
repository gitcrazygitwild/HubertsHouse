// Frankie page → Recent logs: the last week of Huckleberry entries, newest first,
// each with Edit and Delete. Rendering only; baby.js loads and changes entries.
import { escapeHTML as esc } from './household-model.js';

export const LOG_FILTERS = [['all', 'All'], ['sleep', 'Sleep'], ['bottle', 'Bottles'], ['diaper', 'Diapers']];
const DIAPER = { pee:'Wet diaper', poo:'Dirty diaper', both:'Wet and dirty diaper', dry:'Dry diaper' };
const SHOWN_DAYS = 2; // older days sit behind "Show older"
const clock = (value, timezone) => new Date(value).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:timezone });
const length = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
const dayKey = (value, timezone) => new Date(value).toLocaleDateString('en-CA', { timeZone:timezone });
export const logKey = entry => `${entry.kind}:${entry.id}`;

export function describeLog(entry, timezone) {
  if (entry.kind === 'sleep') {
    const minutes = Math.round((Date.parse(entry.end) - Date.parse(entry.start)) / 60000);
    return { icon:'☾', noun:'sleep', what:`Sleep · ${length(minutes)}`, when:`${clock(entry.start, timezone)} – ${clock(entry.end, timezone)}` };
  }
  if (entry.kind === 'bottle') return { icon:'🍼', noun:'bottle', what:`${entry.amount} ${entry.units} ${String(entry.bottleType).toLowerCase()}`, when:clock(entry.start, timezone) };
  return { icon:'♡', noun:'diaper change', what:DIAPER[entry.mode] || 'Diaper', when:clock(entry.start, timezone) };
}
function dayLabel(key, timezone, now) {
  if (key === dayKey(now, timezone)) return 'Today';
  if (key === dayKey(now - 86400000, timezone)) return 'Yesterday';
  return new Date(`${key}T12:00:00Z`).toLocaleDateString([], { weekday:'long', month:'short', day:'numeric', timeZone:'UTC' });
}
export function logsHTML({ entries, timezone, filter = 'all', showAll = false, now = Date.now(), days = 7 }) {
  const label = LOG_FILTERS.find(([key]) => key === filter)?.[1].toLowerCase() || '';
  const shown = entries.filter(entry => filter === 'all' || entry.kind === filter);
  if (!shown.length) return `<p class="tiny muted log-empty">No ${filter === 'all' ? '' : `${label} `}logs in the last ${days} days.</p>`;
  const groups = new Map();
  for (const entry of shown) { const key = dayKey(entry.start, timezone); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); }
  const all = [...groups], visible = showAll ? all : all.slice(0, SHOWN_DAYS), hidden = all.slice(visible.length).reduce((sum, [, list]) => sum + list.length, 0);
  return visible.map(([key, list]) => `<div class="log-day"><h3>${esc(dayLabel(key, timezone, now))}</h3><ul class="log-list">${list.map(entry => {
    const { icon, what, when } = describeLog(entry, timezone), id = esc(logKey(entry));
    return `<li class="log-row log-${esc(entry.kind)}"><span class="log-icon" aria-hidden="true">${icon}</span><div class="log-text"><strong>${esc(what)}</strong><span>${esc(when)}</span></div>
      <div class="log-actions"><button type="button" class="btn log-edit" data-log-edit="${id}" aria-label="Edit ${esc(what)} at ${esc(when)}">Edit</button><button type="button" class="btn log-delete" data-log-delete="${id}" aria-label="Delete ${esc(what)} at ${esc(when)}">Delete</button></div></li>`;
  }).join('')}</ul></div>`).join('') + (hidden ? `<button type="button" class="btn log-more" data-log-more>Show older (${hidden})</button>` : '');
}
