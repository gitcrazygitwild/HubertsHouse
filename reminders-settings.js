// Settings → Reminders on this phone: turn on Web Push (bins out tonight, bath night,
// Frankie's next bottle), choose which, send a test, or turn off. iPhones need the
// home-screen app (iOS 16.4 or later); Safari tabs can't receive them.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { showNotice } from './household.js';

const $ = id => document.getElementById(id);
const CHOICES = [['bins', '🗑️ Bins out tonight', '7 PM the evening before a pickup'], ['bath', '🛁 Bath night', '5:30 PM on bath days'], ['bottle', '🍼 Frankie’s next bottle', 'About 20 minutes before it’s due, while she’s awake']];
let call = null, demo = false, state = { supported:false, permission:'default', subscribed:false, prefs:null, endpoint:null }, busy = false;
const message = e => e?.code === 'functions/not-found' ? 'Reminders are still deploying. Try again in a few minutes.' : e?.message || 'Reminders couldn’t be reached. Try again shortly.';
export function pushSupport(win = globalThis) {
  const nav = win.navigator || {}, ios = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches;
  const apis = 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win;
  if (apis) return { ok:true };
  return { ok:false, reason:ios && !standalone ? 'ios-tab' : 'unsupported' };
}
// The server's public key (base64url) → the bytes PushManager wants.
export function keyBytes(base64url) {
  const pad = '='.repeat((4 - base64url.length % 4) % 4), raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export function remindersHTML(s, { demo:preview = false } = {}) {
  if (preview) return `<p class="tiny muted">In the household app, each phone can get reminders. This preview doesn’t turn any on.</p>${choiceList(s.prefs || { bins:true, bath:true, bottle:true }, true)}`;
  if (!s.supported) return s.reason === 'ios-tab'
    ? '<p class="tiny">On iPhone, reminders work in the home-screen app: tap <b>Share</b> → <b>Add to Home Screen</b>, open Hubert’s House from there, and come back to this card.</p>'
    : '<p class="tiny muted">This browser can’t show reminders. Try the home-screen app on your phone.</p>';
  if (s.permission === 'denied') return '<p class="tiny">Notifications are blocked for Hubert’s House on this phone. On iPhone: <b>Settings → Notifications → Hubert’s House → Allow Notifications</b>, then come back here.</p>';
  if (!s.subscribed) return `<p class="tiny">Get a tap on the shoulder on this phone for the things that are easy to forget. Each phone chooses its own.</p><button type="button" class="btn btn-primary" data-push="on"${busy ? ' disabled' : ''}>Turn on reminders</button>`;
  return `${choiceList(s.prefs, false)}<div class="connection-actions"><button type="button" class="btn" data-push="test"${busy ? ' disabled' : ''}>Send a test</button><button type="button" class="btn" data-push="off"${busy ? ' disabled' : ''}>Turn off on this phone</button></div>`;
}
function choiceList(prefs, disabled) {
  return `<div class="push-choices">${CHOICES.map(([key, label, hint]) => `<label class="push-choice"><input type="checkbox" data-push-pref="${key}"${prefs[key] ? ' checked' : ''}${disabled || busy ? ' disabled' : ''} /><span><strong>${label}</strong><small>${hint}</small></span></label>`).join('')}</div>`;
}
function render() { const root = $('remindersPanel'); if (root) root.innerHTML = remindersHTML(state, { demo }); }
async function registration() { return navigator.serviceWorker.register('./sw.js', { scope:'./' }); }
async function refresh() {
  const support = pushSupport();
  state = { ...state, supported:support.ok, reason:support.reason, permission:globalThis.Notification?.permission || 'default' };
  if (!support.ok || !call) return render();
  try {
    const reg = await registration(), sub = await reg.pushManager.getSubscription();
    if (!sub) { state = { ...state, subscribed:false, endpoint:null }; return render(); }
    const status = await call({ action:'status', endpoint:sub.endpoint });
    state = { ...state, subscribed:!!status.data.subscribed, prefs:status.data.prefs || null, endpoint:sub.endpoint };
    if (!status.data.subscribed) await sub.unsubscribe().catch(() => {}); // the server forgot this phone
  } catch { /* leave the card as it is */ }
  render();
}
async function act(kind) {
  if (busy) return; busy = true; render();
  try {
    if (kind === 'on') {
      const permission = await Notification.requestPermission(); state.permission = permission;
      if (permission !== 'granted') return;
      const reg = await registration(), { data } = await call({ action:'key' });
      const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:keyBytes(data.publicKey) });
      const result = await call({ action:'subscribe', subscription:sub.toJSON(), prefs:{ bins:true, bath:true, bottle:true }, label:navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device' });
      state = { ...state, subscribed:true, prefs:result.data.prefs, endpoint:sub.endpoint };
      showNotice('Reminders are on for this phone. 🐾');
    } else if (kind === 'test') {
      const result = await call({ action:'test', endpoint:state.endpoint });
      showNotice(result.data.sent ? 'Test sent. It should arrive in a few seconds.' : 'This phone wasn’t reachable; turn reminders on again.');
      if (!result.data.sent) state.subscribed = false;
    } else if (kind === 'off') {
      await call({ action:'unsubscribe', endpoint:state.endpoint }).catch(() => {});
      const reg = await registration(); await (await reg.pushManager.getSubscription())?.unsubscribe();
      state = { ...state, subscribed:false, endpoint:null }; showNotice('Reminders are off for this phone.');
    }
  } catch (e) { showNotice(message(e)); }
  finally { busy = false; render(); }
}
export function initReminders(app, { demo:preview = false } = {}) {
  demo = preview; call = !demo && app ? httpsCallable(getFunctions(app, config.functionsRegion), 'reminders') : null;
  const root = $('remindersPanel'); if (!root) return;
  root.addEventListener('click', event => { const button = event.target.closest('[data-push]'); if (button && !demo) act(button.dataset.push); });
  root.addEventListener('change', async event => {
    const box = event.target.closest('[data-push-pref]'); if (!box || demo || !state.subscribed) return;
    const prefs = { ...state.prefs, [box.dataset.pushPref]:box.checked };
    try { state.prefs = (await call({ action:'prefs', endpoint:state.endpoint, prefs })).data.prefs; } catch (e) { box.checked = !box.checked; showNotice(message(e)); }
  });
  render(); refresh();
}
