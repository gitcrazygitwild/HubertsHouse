// Devices page, pure parts (no Firebase): the app launcher, the Philips Hue and Sonos
// panels, the Settings connection steps, and sample data for ?demo=1.
import { escapeHTML as esc } from './household-model.js';

// Each tile opens the company's own app, where each of you is already signed in.
// `scheme` is the app's link; if it doesn't open, iPhones fall back to the App Store
// and computers to `web`. Links can be changed per device (saved on that device).
export const DEVICE_APPS = [
  { id:'hue', name:'Philips Hue', what:'Lights', icon:'💡', scheme:'hue2://', store:'Philips Hue', web:'https://www.philips-hue.com/' },
  { id:'sonos', name:'Sonos', what:'Speakers', icon:'🔊', scheme:'sonos://', store:'Sonos', web:'https://play.sonos.com/' },
  { id:'whisker', name:'Litter-Robot', what:'Whisker app', icon:'🐈', scheme:'', store:'Whisker Litter-Robot', web:'https://www.whisker.com/' },
  { id:'petlibro', name:'PetLibro', what:'Cat feeders', icon:'🥣', scheme:'', store:'PETLIBRO', web:'https://petlibro.com/' },
  { id:'schlage', name:'Schlage', what:'Door lock', icon:'🔒', scheme:'', store:'Schlage Home', web:'https://www.schlage.com/' },
  { id:'eufy', name:'eufy', what:'Cameras', icon:'📷', scheme:'', store:'eufy Security', web:'https://mysecurity.eufylife.com/' },
  { id:'dreo', name:'Dreo', what:'Fans & air', icon:'🌬️', scheme:'', store:'Dreo', web:'https://www.dreo.com/' }
];
export const appStoreSearch = term => `itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=${encodeURIComponent(term)}`;
// Only links that open an app, a Shortcut or a web page; never javascript: and friends.
export function safeDeviceLink(value) {
  const link = String(value || '').trim();
  if (!link || link.length > 500 || /^(javascript|data|vbscript|file):/i.test(link)) return '';
  return /^[a-z][a-z0-9+.-]{1,30}:/i.test(link) ? link : '';
}
// Saved per device: { [id]: link } for built-in tiles, plus extra tiles { id, name, link }.
export function readDeviceLinks(raw) {
  let data; try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { data = null; }
  const links = {}, extra = [];
  for (const [id, link] of Object.entries(data?.links || {})) if (DEVICE_APPS.some(app => app.id === id) && safeDeviceLink(link)) links[id] = safeDeviceLink(link);
  for (const item of Array.isArray(data?.extra) ? data.extra.slice(0, 12) : []) {
    const name = String(item?.name || '').trim().slice(0, 30), link = safeDeviceLink(item?.link);
    if (name && link) extra.push({ id:`x${extra.length}`, name, link });
  }
  return { links, extra };
}
export function deviceTiles(saved = { links:{}, extra:[] }) {
  return [...DEVICE_APPS.map(app => ({ ...app, link:saved.links?.[app.id] || app.scheme, custom:!!saved.links?.[app.id] })),
    ...(saved.extra || []).map(item => ({ id:item.id, name:item.name, what:'Your link', icon:'✦', link:item.link, store:'', web:/^https?:/i.test(item.link) ? item.link : '', custom:true, extra:true }))];
}
export function launcherHTML(tiles) {
  return `<div class="device-tiles">${tiles.map(tile => `<div class="device-tile"><button type="button" class="device-open" data-device-open="${esc(tile.id)}"><span class="device-icon" aria-hidden="true">${esc(tile.icon)}</span><span class="device-name">${esc(tile.name)}<small>${esc(tile.what)}</small></span></button><button type="button" class="device-edit" data-device-edit="${esc(tile.id)}" aria-label="Change the link for ${esc(tile.name)}" title="Change link">⋯</button></div>`).join('')}
  <button type="button" class="device-tile device-add" data-device-add><span aria-hidden="true">＋</span><span>Add an app</span></button></div>`;
}

// ---------- Philips Hue ----------
const notConnected = (name, detail) => `<div class="device-empty"><strong>${esc(name)} isn’t connected yet.</strong><p>${esc(detail)}</p><button type="button" class="btn" data-go="settings" data-devices-setup>Set it up in Settings</button></div>`;
const errorBox = message => `<div class="device-empty"><strong>Couldn’t reach it just now.</strong><p>${esc(message)}</p><button type="button" class="btn" data-devices-refresh>Try again</button></div>`;
export function hueHTML(state) {
  if (!state || state.loading) return '<p class="tiny muted">Checking the lights…</p>';
  if (!state.connected) return notConnected('Philips Hue', 'Connect once and either of you can switch rooms and scenes from here.');
  if (state.error) return errorBox(state.error);
  const rooms = state.rooms || [];
  if (!rooms.length) return '<p class="tiny muted">No rooms found on your Hue bridge.</p>';
  const anyOn = rooms.some(room => room.on);
  return `<div class="device-panel-actions"><span class="tiny muted">${rooms.filter(room => room.on).length} of ${rooms.length} rooms on</span><button type="button" class="btn" data-hue-all="off" ${anyOn ? '' : 'disabled'}>All off</button></div>
  <div class="hue-rooms">${rooms.map(room => `<section class="hue-room${room.on ? ' on' : ''}" style="--glow:${room.on ? Math.max(0.25, room.brightness / 100) : 0}">
    <header><h3>${esc(room.name)}</h3><label class="device-switch"><input type="checkbox" data-hue-power="${esc(room.groupId)}" ${room.on ? 'checked' : ''} aria-label="${esc(room.name)} lights" /><span aria-hidden="true"></span></label></header>
    <label class="hue-dim"><span class="sr-only">${esc(room.name)} brightness</span><input type="range" min="1" max="100" value="${Math.max(1, room.brightness || 1)}" data-hue-dim="${esc(room.groupId)}" ${room.on ? '' : 'disabled'} /><output>${room.on ? `${room.brightness}%` : 'Off'}</output></label>
    ${room.scenes?.length ? `<div class="hue-scenes">${room.scenes.slice(0, 8).map(scene => `<button type="button" class="chip" data-hue-scene="${esc(scene.id)}" data-room="${esc(room.id)}">${esc(scene.name)}</button>`).join('')}</div>` : ''}
  </section>`).join('')}</div>`;
}

// ---------- Sonos ----------
export function sonosHTML(state) {
  if (!state || state.loading) return '<p class="tiny muted">Finding the speakers…</p>';
  if (!state.connected) return notConnected('Sonos', 'Connect once to see what’s playing, skip songs, change the volume and start your favorites.');
  if (state.error) return errorBox(state.error);
  const groups = state.groups || [];
  if (!groups.length) return '<p class="tiny muted">No speakers are online right now.</p>';
  const favorites = state.favorites || [];
  return `<div class="sonos-groups">${groups.map(group => `<section class="sonos-group${group.playing ? ' playing' : ''}">
    <div class="sonos-now">${group.track?.image ? `<img src="${esc(group.track.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="sonos-art" aria-hidden="true">♪</span>'}
      <div><h3>${esc(group.name)}</h3><p>${group.track ? `<strong>${esc(group.track.name)}</strong>${group.track.artist ? ` · ${esc(group.track.artist)}` : ''}` : '<span class="muted">Nothing queued</span>'}</p>${group.source ? `<small class="muted">${esc(group.source)}</small>` : ''}</div></div>
    <div class="sonos-controls" role="group" aria-label="${esc(group.name)} playback"><button type="button" class="btn" data-sonos="previous" data-group="${esc(group.id)}" aria-label="Previous song">⏮</button><button type="button" class="btn btn-primary" data-sonos="toggle" data-group="${esc(group.id)}" aria-label="${group.playing ? 'Pause' : 'Play'}">${group.playing ? '⏸' : '▶'}</button><button type="button" class="btn" data-sonos="next" data-group="${esc(group.id)}" aria-label="Next song">⏭</button></div>
    ${group.volume === null ? '' : `<label class="sonos-volume"><span aria-hidden="true">🔈</span><span class="sr-only">${esc(group.name)} volume</span><input type="range" min="0" max="100" value="${group.volume}" data-sonos-volume="${esc(group.id)}" /><output>${group.volume}</output></label>`}
    ${favorites.length ? `<label class="sonos-favorite"><span class="sr-only">Play a favorite on ${esc(group.name)}</span><select data-sonos-favorite="${esc(group.id)}"><option value="">Play a favorite…</option>${favorites.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label>` : ''}
  </section>`).join('')}</div>`;
}

// ---------- Settings: connecting Hue and Sonos ----------
export const DEVICE_SETUP = {
  hue:{ name:'Philips Hue', site:'https://developers.meethue.com/my-apps/', idLabel:'ClientId', secretLabel:'ClientSecret', steps:[
    'Open <a href="https://developers.meethue.com/my-apps/" target="_blank" rel="noopener">developers.meethue.com</a> and sign in or make a free account (any of your emails).',
    'Choose <b>Add new Hue Remote API app</b>. App name: <i>Hubert’s House</i>. Application description: <i>Our household dashboard</i>.',
    'For <b>Callback URL</b>, paste the address below, then submit.',
    'Copy the app’s <b>ClientId</b> and <b>ClientSecret</b> into the boxes here and save.',
    'Tap <b>Connect Philips Hue</b>, sign in with your Hue account and allow access. Your Hue bridge needs to be on.'] },
  sonos:{ name:'Sonos', site:'https://developer.sonos.com/', idLabel:'Key', secretLabel:'Secret', steps:[
    'Open <a href="https://developer.sonos.com/" target="_blank" rel="noopener">developer.sonos.com</a> and sign in or make a free account.',
    'Go to <b>Integrations</b> → <b>New Control Integration</b>. Name it <i>Hubert’s House</i> and fill in the short description.',
    'Under <b>API keys</b>, add a key. For the <b>Redirect URI</b>, paste the address below and save.',
    'Copy the <b>Key</b> and <b>Secret</b> into the boxes here and save.',
    'Tap <b>Connect Sonos</b>, sign in with your Sonos account and choose your home.'] }
};
const when = value => value ? new Date(value).toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }) : '';
export function deviceSettingsHTML(status, { demo = false, open = {} } = {}) {
  if (!status) return '<p class="tiny muted">Loading…</p>';
  return Object.entries(DEVICE_SETUP).map(([provider, setup]) => {
    const info = status[provider] || {}, badge = info.connected ? '<span class="status-badge connected">Connected</span>' : info.appSaved ? '<span class="status-badge">Ready to connect</span>' : '<span class="status-badge">Not set up</span>';
    const form = `<form class="connection-form device-app-form" data-device-app="${provider}"><label class="field"><span>${setup.idLabel}</span><input name="clientId" autocomplete="off" spellcheck="false" required /></label><label class="field"><span>${setup.secretLabel}</span><input name="clientSecret" type="password" autocomplete="off" spellcheck="false" required /></label><button class="btn btn-primary" type="submit" ${demo ? 'disabled' : ''}>Save app details</button></form>`;
    const steps = `<ol class="siri-steps">${setup.steps.map(step => `<li>${step}</li>`).join('')}</ol><label class="field siri-copy"><span>${provider === 'hue' ? 'Callback URL' : 'Redirect URI'}</span><span class="siri-copy-row"><input id="deviceRedirect-${provider}" readonly value="${esc(status.redirectUri || '')}" /><button type="button" class="btn" data-copy="deviceRedirect-${provider}">Copy</button></span></label>`;
    let body;
    if (info.connected) body = `<p class="tiny">Connected ${esc(when(info.connectedAt))}. Both of you can use it on the Devices page.</p><div class="connection-actions"><button type="button" class="btn" data-go="devices">Open Devices</button><button type="button" class="btn btn-danger" data-device-disconnect="${provider}" ${demo ? 'disabled' : ''}>Disconnect</button></div><details class="siri-how" ${open[provider] ? 'open' : ''}><summary>Replace the app details</summary>${steps}${form}</details>`;
    else if (info.appSaved) body = `<p class="tiny">App details saved. One more step: sign in with your ${esc(setup.name)} account.</p><div class="connection-actions"><button type="button" class="btn btn-primary" data-device-connect="${provider}" ${demo ? 'disabled' : ''}>Connect ${esc(setup.name)}</button></div><details class="siri-how" ${open[provider] ? 'open' : ''}><summary>Replace the app details</summary>${steps}${form}</details>`;
    else body = `<p class="tiny">${esc(setup.name)} lets households use its official remote control with a free developer app. It takes about five minutes, once.</p><details class="siri-how" ${open[provider] || !demo ? 'open' : ''}><summary>How to set it up</summary>${steps}${form}</details>`;
    return `<div class="device-provider"><div class="section-heading"><h3>${esc(setup.name)}</h3>${badge}</div>${body}</div>`;
  }).join('') + (demo ? '<p class="tiny muted">This preview doesn’t connect accounts.</p>' : '');
}
// After the company's sign-in page sends you back: ?connected=hue&ok=1 (or ok=0&message=…).
export function readConnectResult(search) {
  const params = new URLSearchParams(search || ''), provider = params.get('connected');
  if (!['hue', 'sonos'].includes(provider) && params.get('ok') === null) return null;
  const name = DEVICE_SETUP[provider]?.name || 'The device';
  return params.get('ok') === '1' ? { ok:true, provider, message:`${name} is connected. 🎉` } : { ok:false, provider, message:(params.get('message') || `${name} couldn’t be connected.`).slice(0, 200) };
}
export const stripConnectParams = search => { const params = new URLSearchParams(search || ''); ['connected', 'ok', 'message'].forEach(key => params.delete(key)); const out = params.toString(); return out ? `?${out}` : ''; };

// ---------- Preview data ----------
export const sampleHue = () => ({ connected:true, rooms:[
  { id:'r1', groupId:'g1', name:'Living room', on:true, brightness:72, scenes:[{ id:'s1', name:'Bright' }, { id:'s2', name:'Movie night' }, { id:'s3', name:'Relax' }] },
  { id:'r2', groupId:'g2', name:'Kitchen', on:true, brightness:100, scenes:[{ id:'s4', name:'Concentrate' }, { id:'s5', name:'Dimmed' }] },
  { id:'r3', groupId:'g3', name:'Nursery', on:false, brightness:12, scenes:[{ id:'s6', name:'Nightlight' }, { id:'s7', name:'Sunrise' }] },
  { id:'r4', groupId:'g4', name:'Bedroom', on:false, brightness:40, scenes:[{ id:'s8', name:'Read' }, { id:'s9', name:'Nightlight' }] }] });
export const sampleSonos = () => ({ connected:true, favorites:[{ id:'f1', name:'Lullabies' }, { id:'f2', name:'Sunday Morning Jazz' }, { id:'f3', name:'NPR News' }], groups:[
  { id:'gk', name:'Kitchen', playing:true, volume:24, muted:false, track:{ name:'Here Comes the Sun', artist:'The Beatles', image:null }, source:'Sunday Morning Jazz' },
  { id:'gn', name:'Nursery', playing:false, volume:12, muted:false, track:{ name:'Brahms’ Lullaby', artist:'Sleepy Strings', image:null }, source:'Lullabies' },
  { id:'gl', name:'Living room', playing:false, volume:30, muted:false, track:null, source:'' }] });
export const sampleDeviceStatus = () => ({ hue:{ appSaved:true, connected:true, connectedAt:'2026-11-01T12:00:00Z' }, sonos:{ appSaved:true, connected:true, connectedAt:'2026-11-02T12:00:00Z' }, redirectUri:'https://us-central1-huberts-house.cloudfunctions.net/smartHomeAuth' });
