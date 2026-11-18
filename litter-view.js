// Litter-Robot card (Devices page) and its Settings connection, pure parts.
import { escapeHTML as esc } from './household-model.js';

const ago = (iso, now = Date.now()) => {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${Math.floor(minutes / 1440)}d ago`;
};
const bar = (label, value, warn) => value == null ? '' : `<div class="lr-meter${warn ? ' warn' : ''}"><span>${esc(label)}</span><div class="lr-bar" role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i style="width:${value}%"></i></div><strong>${value}%</strong></div>`;
// A short line for the whole household: the busiest cat today, or a heads-up.
export function litterHeadline(state) {
  const robot = state?.robots?.[0], cats = state?.cats || [];
  if (robot?.drawerFull || robot?.drawer >= 90) return `${robot.name}’s waste drawer is ${robot.drawerFull ? 'full' : 'almost full'}.`;
  const top = [...cats].sort((a, b) => b.today - a.today)[0];
  if (top?.today) { const tie = cats.filter(cat => cat.today === top.today).length > 1; return tie ? `A tie today: ${cats.filter(cat => cat.today === top.today).map(cat => cat.name).join(' & ')} with ${top.today} visit${top.today === 1 ? '' : 's'} each.` : `${top.name} is today’s top visitor with ${top.today} visit${top.today === 1 ? '' : 's'}.`; }
  return cats.length ? 'No visits logged yet today.' : '';
}
export function litterHTML(state, { now = Date.now() } = {}) {
  if (!state || state.loading) return '<p class="tiny muted">Checking the litter box…</p>';
  if (!state.connected) return `<div class="device-empty"><strong>Litter-Robot isn’t connected yet.</strong><p>Connect your Whisker account once to see the waste drawer, start a clean, and see which cat has been visiting.</p><button type="button" class="btn" data-go="settings">Set it up in Settings</button></div>`;
  if (state.error) return `<div class="device-empty"><strong>Couldn’t reach Whisker just now.</strong><p>${esc(state.error)}</p><button type="button" class="btn" data-litter-refresh>Try again</button></div>`;
  const robots = state.robots || [], cats = state.cats || [];
  if (!robots.length && !cats.length) return '<p class="tiny muted">No Litter-Robot found on this Whisker account.</p>';
  const robotCards = robots.map(robot => {
    const alerts = [robot.drawerFull ? 'Empty the waste drawer' : robot.drawer >= 90 ? 'Waste drawer almost full' : '', robot.laserDirty ? 'Wipe the cat sensors' : '', robot.battery ? 'Running on battery backup' : '', !robot.online ? 'Offline: check its power and Wi-Fi' : ''].filter(Boolean);
    return `<section class="lr-robot${robot.drawerFull || robot.drawer >= 90 ? ' needs-empty' : ''}"><header><div><h3>${esc(robot.name)}</h3><small>${esc(robot.model)} · ${esc(robot.status)}${robot.sleeping ? ' · sleep mode' : ''}</small></div>
      <button type="button" class="btn" data-litter-clean="${esc(robot.id)}" ${robot.canClean ? '' : 'disabled'}>Clean now</button></header>
      ${bar('Waste drawer', robot.drawer, robot.drawer >= 80)}${bar('Litter', robot.litter, robot.litter != null && robot.litter < 30)}
      <p class="tiny muted">${robot.cycles ? `${robot.cycles.toLocaleString()} cleans so far` : ''}${robot.lastWeight ? ` · last visitor weighed ${robot.lastWeight} lb` : ''}</p>
      ${alerts.length ? `<ul class="lr-alerts">${alerts.map(alert => `<li>${esc(alert)}</li>`).join('')}</ul>` : ''}</section>`;
  }).join('');
  const most = Math.max(1, ...cats.map(cat => cat.week));
  const catRows = cats.length ? `<div class="lr-cats"><h3>Who’s been visiting</h3>${cats.map(cat => `<div class="lr-cat"><span class="lr-cat-name">${esc(cat.name)}</span>
      <span class="lr-visits"><strong>${cat.today}</strong> today · ${cat.week} this week<i class="lr-week" style="width:${Math.round(cat.week / most * 100)}%" aria-hidden="true"></i></span>
      <span class="lr-weight">${cat.weight ? `${cat.weight} lb` : '—'}${cat.change30 ? ` <small class="${Math.abs(cat.change30) >= 0.5 ? 'warn' : ''}">${cat.change30 > 0 ? '▲' : '▼'} ${Math.abs(cat.change30)} lb / 30d</small>` : ''}</span>
      <small class="muted">${cat.lastVisit ? `last ${esc(ago(cat.lastVisit, now))}` : 'no visits yet'}</small></div>`).join('')}</div>` : '<p class="tiny muted">Add Hubert, Mack and Mia as pets in the Whisker app (with SmartWeight on) to see who’s visiting.</p>';
  const headline = litterHeadline(state);
  return `${headline ? `<p class="lr-headline">🐈 ${esc(headline)}</p>` : ''}${robotCards}${catRows}<p class="tiny muted">Checked ${esc(ago(state.checkedAt, now))} · through Whisker’s unofficial connection, so a Whisker app update can interrupt it.</p>`;
}
export function litterSettingsHTML(status, { demo = false } = {}) {
  if (!status) return '<p class="tiny muted">Loading…</p>';
  if (status.connected && !status.needsReconnect) return `<p class="tiny">Connected${status.connectedAt ? ` ${esc(new Date(status.connectedAt).toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }))}` : ''}. Both of you can see it on the Devices page.</p><div class="connection-actions"><button type="button" class="btn" data-go="devices">Open Devices</button><button type="button" class="btn btn-danger" data-litter-disconnect ${demo ? 'disabled' : ''}>Disconnect</button></div>`;
  return `${status.needsReconnect ? '<p class="form-error">Whisker signed this house out. Sign in again to reconnect.</p>' : ''}<form id="litterForm" class="connection-form"><label class="field"><span>Whisker email</span><input name="email" type="email" autocomplete="username" required /></label><label class="field"><span>Whisker password</span><input name="password" type="password" autocomplete="current-password" required /></label><p class="tiny muted">Used once to sign in; Hubert’s House keeps only an encrypted session, never your password. This is an unofficial connection (the same one Home Assistant uses), so a Whisker app update can interrupt it.</p><button type="submit" class="btn btn-primary" ${demo ? 'disabled' : ''}>Connect Litter-Robot</button></form>${demo ? '<p class="tiny muted">This preview doesn’t connect accounts.</p>' : ''}`;
}
export function sampleLitter(now = Date.now()) {
  const at = minutes => new Date(now - minutes * 60000).toISOString();
  return { connected:true, checkedAt:at(1), robots:[{ id:'lr4-1', serial:'LR4C000001', name:'The Royal Throne', model:'Litter-Robot 4', online:true, status:'Ready', drawer:72, drawerFull:false, litter:64, lastWeight:11.2, cycles:1486, sleeping:false, battery:false, laserDirty:false, lastSeen:at(1), canClean:true }],
    cats:[{ id:'p1', name:'Hubert', weight:12.4, today:3, week:19, lastVisit:at(48), change30:0.1 }, { id:'p2', name:'Mack', weight:11.2, today:4, week:22, lastVisit:at(14), change30:-0.2 }, { id:'p3', name:'Mia', weight:8.6, today:2, week:15, lastVisit:at(190), change30:0.6 }] };
}
