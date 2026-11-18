// Devices page: one tap into each smart-home app, plus Philips Hue and Sonos controls
// through their official cloud APIs (functions/smart-home.js). Settings holds the
// one-time connection for each.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { showNotice, showView } from './household.js';
import { renderHTML } from './dom.js';
import { appStoreSearch, safeDeviceLink, readDeviceLinks, deviceTiles, launcherHTML, hueHTML, sonosHTML, deviceSettingsHTML, readConnectResult, stripConnectParams, sampleHue, sampleSonos, sampleDeviceStatus } from './devices-view.js';

const $ = id => document.getElementById(id);
const LINKS_KEY = 'hh_device_links', REFRESH = 60000;
const failure = e => e?.code === 'functions/not-found' ? 'The devices service is still deploying. Try again in a few minutes.' : e?.message || 'The devices service could not be reached.';
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function loadLinks() { try { return readDeviceLinks(localStorage.getItem(LINKS_KEY)); } catch { return readDeviceLinks(null); } }
function saveLinks(saved) { try { localStorage.setItem(LINKS_KEY, JSON.stringify({ links:saved.links, extra:saved.extra.map(({ name, link }) => ({ name, link })) })); } catch { /* private mode: links last for this visit */ } }

// Try the app; if this page is still showing after a moment, the app isn't installed
// (or the link is wrong): offer the App Store on iPhone, the website elsewhere.
function openTile(tile) {
  const fallback = isApple() && tile.store ? appStoreSearch(tile.store) : tile.web;
  if (!tile.link || /^https?:/i.test(tile.link)) { const url = tile.link || fallback; if (url) window.open(url, '_blank', 'noopener'); return; }
  let left = false; const away = () => { left = true; };
  document.addEventListener('visibilitychange', away, { once:true }); window.addEventListener('pagehide', away, { once:true });
  location.href = tile.link;
  setTimeout(() => {
    document.removeEventListener('visibilitychange', away); window.removeEventListener('pagehide', away);
    if (left || document.visibilityState === 'hidden' || !fallback) return;
    if (isApple()) location.href = fallback; else showNotice(`${tile.name} didn’t open here.`, { label:'Open the website', run:() => window.open(fallback, '_blank', 'noopener') });
  }, 1600);
}

export function initDevices(app, { demo = false } = {}) {
  const view = $('view-devices'); if (!view) return;
  const call = demo || !app ? null : httpsCallable(getFunctions(app, config.functionsRegion), 'smartHome', { timeout:60000 });
  let saved = loadLinks(), status = demo ? sampleDeviceStatus() : null, hue = demo ? sampleHue() : { loading:true }, sonos = demo ? sampleSonos() : { loading:true };
  let last = 0, timer = null, busy = false; const openSetup = {};
  const drawLauncher = () => renderHTML($('deviceLauncher'), launcherHTML(deviceTiles(saved)));
  const drawPanels = () => { renderHTML($('huePanel'), hueHTML(hue)); renderHTML($('sonosPanel'), sonosHTML(sonos)); };
  const drawSettings = () => { const root = $('devicesSettingsPanel'); if (root) renderHTML(root, deviceSettingsHTML(status, { demo, open:openSetup })); };

  // After Hue or Sonos sends the browser back from their sign-in page.
  const result = readConnectResult(location.search);
  if (result) { history.replaceState(null, '', `${location.pathname}${stripConnectParams(location.search)}${location.hash}`); showNotice(result.message); if (!result.ok) showView('settings'); }

  async function refresh(force = false) {
    if (demo) { drawPanels(); return; }
    if (!call || (!force && Date.now() - last < 15000)) return; last = Date.now();
    try { status = (await call({ action:'status' })).data; } catch (e) { hue = sonos = { connected:true, error:failure(e) }; drawPanels(); return; }
    drawSettings();
    const load = async provider => { if (!status[provider]?.connected) return { connected:false }; try { return { connected:true, ...(await call({ action:'devices', provider })).data }; } catch (e) { return { connected:true, error:failure(e) }; } };
    [hue, sonos] = await Promise.all([load('hue'), load('sonos')]); drawPanels();
  }
  async function control(provider, command, optimistic) {
    if (optimistic) { optimistic(); drawPanels(); }
    if (demo) return;
    try { await call({ action:'control', provider, command }); setTimeout(() => refresh(true), provider === 'sonos' ? 1200 : 600); }
    catch (e) { showNotice(failure(e)); refresh(true); }
  }
  const room = groupId => hue.rooms?.find(item => item.groupId === groupId), group = id => sonos.groups?.find(item => item.id === id);

  view.addEventListener('click', event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.deviceOpen) { const tile = deviceTiles(saved).find(item => item.id === target.dataset.deviceOpen); if (tile) openTile(tile); }
    else if (target.dataset.deviceEdit) {
      const id = target.dataset.deviceEdit, tile = deviceTiles(saved).find(item => item.id === id); if (!tile) return;
      const answer = prompt(`Link that opens ${tile.name}. Paste an app link, a Shortcut link (shortcuts://run-shortcut?name=…) or a web address.${tile.extra ? ' Leave empty to remove this tile.' : ' Leave empty to go back to the default.'}`, tile.link || '');
      if (answer === null) return;
      if (answer.trim() && !safeDeviceLink(answer)) { showNotice('That doesn’t look like a link. It should start with something like sonos:// or https://.'); return; }
      if (tile.extra) saved.extra = saved.extra.filter(item => item.id !== id).concat(answer.trim() ? [{ ...tile, link:safeDeviceLink(answer) }] : []);
      else if (answer.trim()) saved.links[id] = safeDeviceLink(answer); else delete saved.links[id];
      saveLinks(saved); saved = loadLinks(); drawLauncher();
    } else if (target.hasAttribute('data-device-add')) {
      const name = prompt('Name for the new tile (for example, Ring or Nest):'); if (!name?.trim()) return;
      const link = prompt(`Link that opens ${name.trim()}: an app link, a Shortcut link (shortcuts://run-shortcut?name=…) or a web address.`); if (!link?.trim()) return;
      if (!safeDeviceLink(link)) { showNotice('That doesn’t look like a link. It should start with something like ring:// or https://.'); return; }
      saved.extra.push({ name:name.trim().slice(0, 30), link:safeDeviceLink(link) }); saveLinks(saved); saved = loadLinks(); drawLauncher();
    } else if (target.dataset.go) showView(target.dataset.go);
    else if (target.hasAttribute('data-devices-refresh')) { hue = hue.connected ? { loading:true } : hue; sonos = sonos.connected ? { loading:true } : sonos; drawPanels(); refresh(true); }
    else if (target.dataset.hueAll) { const on = (hue.rooms || []).filter(item => item.on); on.forEach(item => control('hue', { type:'power', target:item.groupId, on:false }, () => { item.on = false; })); }
    else if (target.dataset.hueScene) { const item = hue.rooms?.find(r => r.id === target.dataset.room); control('hue', { type:'scene', target:target.dataset.hueScene }, () => { if (item) item.on = true; }); showNotice(`${target.textContent} in the ${item?.name.toLowerCase() || 'room'}.`); }
    else if (target.dataset.sonos) { const item = group(target.dataset.group); control('sonos', { type:target.dataset.sonos, target:target.dataset.group }, target.dataset.sonos === 'toggle' && item ? () => { item.playing = !item.playing; } : null); }
  });
  view.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.huePower) { const item = room(input.dataset.huePower); control('hue', { type:'power', target:input.dataset.huePower, on:input.checked }, () => { if (item) item.on = input.checked; }); }
    else if (input.dataset.hueDim) { const item = room(input.dataset.hueDim), level = Number(input.value); control('hue', { type:'brightness', target:input.dataset.hueDim, level }, () => { if (item) { item.on = true; item.brightness = level; } }); }
    else if (input.dataset.sonosVolume) { const item = group(input.dataset.sonosVolume), level = Number(input.value); control('sonos', { type:'volume', target:input.dataset.sonosVolume, level }, () => { if (item) item.volume = level; }); }
    else if (input.dataset.sonosFavorite && input.value) { const item = group(input.dataset.sonosFavorite), name = input.selectedOptions[0]?.textContent; control('sonos', { type:'favorite', target:input.dataset.sonosFavorite, favorite:input.value }, () => { if (item) { item.playing = true; item.source = name; } }); showNotice(`Playing ${name} on ${item?.name || 'Sonos'}.`); }
  });
  view.addEventListener('input', event => { const output = event.target.closest('label')?.querySelector('output'); if (output && event.target.type === 'range') output.textContent = event.target.dataset.hueDim ? `${event.target.value}%` : event.target.value; });

  // Settings card.
  const settings = $('devicesSettingsPanel');
  settings?.addEventListener('click', async event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.copy) { const input = $(target.dataset.copy); try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand?.('copy'); } target.textContent = 'Copied'; setTimeout(() => { target.textContent = 'Copy'; }, 1500); return; }
    if (target.dataset.go) { showView(target.dataset.go); return; }
    if (!call || busy) return;
    const provider = target.dataset.deviceConnect || target.dataset.deviceDisconnect; if (!provider) return;
    if (target.dataset.deviceDisconnect && !confirm('Disconnect it from Hubert’s House? You can connect again any time.')) return;
    busy = true; target.disabled = true;
    try {
      if (target.dataset.deviceConnect) { const { url } = (await call({ action:'connect', provider })).data; location.href = url; return; }
      status = (await call({ action:'disconnect', provider })).data; drawSettings(); last = 0; refresh(true); showNotice('Disconnected.');
    } catch (e) { showNotice(failure(e)); } finally { busy = false; if (target.isConnected) target.disabled = false; }
  });
  settings?.addEventListener('toggle', event => { const form = event.target.querySelector?.('[data-device-app]'); if (form) openSetup[form.dataset.deviceApp] = event.target.open; }, true);
  settings?.addEventListener('submit', async event => {
    const form = event.target.closest('[data-device-app]'); if (!form) return; event.preventDefault();
    if (!call || busy) return; busy = true; const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const data = new FormData(form);
      status = (await call({ action:'saveApp', provider:form.dataset.deviceApp, clientId:data.get('clientId'), clientSecret:data.get('clientSecret') })).data;
      openSetup[form.dataset.deviceApp] = false; drawSettings(); showNotice('Saved. Now tap Connect to sign in.');
    } catch (e) { showNotice(failure(e)); } finally { busy = false; if (button.isConnected) button.disabled = false; }
  });

  drawLauncher(); drawPanels(); drawSettings();
  // Load when the Devices page (or Settings) opens, and keep it fresh while it's showing.
  const visible = () => !view.classList.contains('hidden') && document.visibilityState === 'visible';
  const watch = () => { clearInterval(timer); if (visible()) { refresh(); timer = setInterval(() => { if (visible()) refresh(true); }, REFRESH); } };
  new MutationObserver(watch).observe(view, { attributes:true, attributeFilter:['class'] });
  new MutationObserver(() => { if (!$('view-settings')?.classList.contains('hidden') && !status && call) refresh(true); }).observe($('view-settings') || view, { attributes:true, attributeFilter:['class'] });
  document.addEventListener('visibilitychange', watch);
  watch();
  if (!demo && call && !$('view-settings')?.classList.contains('hidden')) refresh(true);
}
