// PetLibro feeders card (Devices page) and its Settings connection, pure parts.
import { escapeHTML as esc } from './household-model.js';

const ago = (iso, now = Date.now()) => { const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };
// A portion is about 1/12 cup on PetLibro's Granary feeders.
const cups = portions => { const value = Math.round(portions / 12 * 4) / 4; return value ? `about ${value} cup${value === 1 ? '' : 's'}` : ''; };
export function feederAlerts(feeder) {
  return [feeder.online === false ? 'Offline: check its power and Wi-Fi' : '', feeder.foodLow ? 'Food is running low: top up the hopper' : '', feeder.dispenserBlocked ? 'The food outlet may be blocked' : '',
    feeder.battery != null && feeder.battery <= 20 ? `Backup battery at ${feeder.battery}%` : ''].filter(Boolean);
}
export function feedersHTML(state, { now = Date.now() } = {}) {
  if (!state || state.loading) return '<p class="tiny muted">Checking the feeders…</p>';
  if (!state.connected) return '<div class="device-empty"><strong>PetLibro isn’t connected yet.</strong><p>Connect once to see each feeder’s food level and today’s meals, and feed from here.</p><button type="button" class="btn" data-go="settings">Set it up in Settings</button></div>';
  if (state.error) return `<div class="device-empty"><strong>Couldn’t reach PetLibro just now.</strong><p>${esc(state.error)}</p><button type="button" class="btn" data-feeder-refresh>Try again</button></div>`;
  const feeders = (state.feeders || []);
  if (!feeders.length) return '<p class="tiny muted">No feeders found. Make sure they’re shared with the account you connected.</p>';
  return feeders.map(feeder => {
    const alerts = feederAlerts(feeder), today = feeder.todayPortions != null ? `${feeder.todayPortions} portion${feeder.todayPortions === 1 ? '' : 's'} today${feeder.todayPortions ? ` (${cups(feeder.todayPortions)})` : ''}${feeder.todayFeeds != null ? ` · ${feeder.todayFeeds} meal${feeder.todayFeeds === 1 ? '' : 's'}` : ''}` : '';
    return `<section class="lr-robot feeder${alerts.length ? ' needs-empty' : ''}"><header><div><h3>${esc(feeder.name)}</h3><small>${esc(feeder.product)}${feeder.online === true ? ' · online' : ''}${feeder.foodLow === false ? ' · food OK' : ''}${feeder.battery != null ? ` · battery ${feeder.battery}%` : ''}</small></div>
      ${feeder.isFeeder ? `<div class="feeder-actions"><label class="sr-only" for="portions-${esc(feeder.id)}">Portions</label><select id="portions-${esc(feeder.id)}" data-feeder-portions="${esc(feeder.id)}">${[1, 2, 3, 4].map(n => `<option value="${n}">${n} portion${n === 1 ? '' : 's'}</option>`).join('')}</select><button type="button" class="btn" data-feeder-feed="${esc(feeder.id)}" ${feeder.online === false ? 'disabled' : ''}>Feed now</button></div>` : ''}</header>
      ${today ? `<p class="feeder-today">${esc(today)}</p>` : ''}${alerts.length ? `<ul class="lr-alerts">${alerts.map(alert => `<li>${esc(alert)}</li>`).join('')}</ul>` : ''}</section>`;
  }).join('') + `<p class="tiny muted">Checked ${esc(ago(state.checkedAt, now))} · through PetLibro’s unofficial connection, so an app update can interrupt it.</p>`;
}
export const FEEDER_STEPS = [
  'PetLibro lets an account be signed in on only one device, so give Hubert’s House its own account (otherwise your phone’s PetLibro app gets signed out).',
  'Make a second PetLibro account with another email. With Gmail, you can add <code>+house</code> to yours (<i>you+house@gmail.com</i>); it still arrives in your inbox.',
  'In your main PetLibro app, open each feeder and share it with that second email (look for <b>Share</b> or <b>Family</b> in the feeder’s settings), then accept the share on the second account.',
  'Sign in below with the second account.'
];
export function feederSettingsHTML(status, { demo = false } = {}) {
  if (!status) return '<p class="tiny muted">Loading…</p>';
  if (status.connected && !status.needsReconnect) return `<p class="tiny">Connected${status.connectedAt ? ` ${esc(new Date(status.connectedAt).toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }))}` : ''}. Both of you can see the feeders on the Devices page.</p><div class="connection-actions"><button type="button" class="btn" data-go="devices">Open Devices</button><button type="button" class="btn btn-danger" data-feeder-disconnect ${demo ? 'disabled' : ''}>Disconnect</button></div>`;
  return `${status.needsReconnect ? '<p class="form-error">PetLibro signed this house out. Sign in again to reconnect.</p>' : ''}<ol class="siri-steps">${FEEDER_STEPS.map(step => `<li>${step}</li>`).join('')}</ol>
    <form id="feederForm" class="connection-form"><label class="field"><span>PetLibro email (the second account)</span><input name="email" type="email" autocomplete="username" required /></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label><p class="tiny muted">Hubert’s House keeps only an encrypted, scrambled form of the password so it can sign back in when PetLibro signs it out. This is an unofficial connection (the one Home Assistant uses).</p><button type="submit" class="btn btn-primary" ${demo ? 'disabled' : ''}>Connect PetLibro</button></form>${demo ? '<p class="tiny muted">This preview doesn’t connect accounts.</p>' : ''}`;
}
export function sampleFeeders(now = Date.now()) {
  return { connected:true, checkedAt:new Date(now - 60000).toISOString(), feeders:[
    { id:'PLAF103A', name:'Breakfast Club', product:'Granary Smart Feeder', online:true, foodLow:false, dispenserBlocked:false, battery:null, todayPortions:6, todayFeeds:2, isFeeder:true },
    { id:'PLAF103B', name:'Mia’s Diner', product:'Granary Smart Feeder', online:true, foodLow:true, dispenserBlocked:false, battery:null, todayPortions:3, todayFeeds:1, isFeeder:true }] };
}
