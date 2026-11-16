// Settings → "Hey Siri, ping Hubert": make or revoke a personal Siri key and
// follow the steps to build the "Ping Hubert" Apple Shortcut.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice } from './household.js';

const $ = id => document.getElementById(id);
let call, state = null, freshKey = null, busy = false;
const message = e => e?.code === 'functions/not-found' ? 'The Siri service is still deploying. Try again in a few minutes.' : e?.message || 'The Siri service could not be reached.';
const when = value => value ? new Date(value).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '';
const copyRow = (id, label, value, secret) => `<label class="field siri-copy"><span>${label}</span><span class="siri-copy-row"><input id="${id}" readonly value="${esc(value)}" ${secret ? 'class="siri-secret"' : ''} /><button type="button" class="btn" data-copy="${id}">Copy</button></span></label>`;

export function shortcutSteps(url, keyHint = 'your key') {
  return `<ol class="siri-steps">
    <li><strong>Open Shortcuts</strong> on your iPhone, tap <b>＋</b>, then tap the name at the top and call it <b>Ping Hubert</b>. That name is what you say to Siri.</li>
    <li>Add <b>Ask for Input</b>. Type: <i>Text</i>. Prompt: <i>What should I log?</i></li>
    <li>Add <b>Get Contents of URL</b> and paste the address above. Tap <b>Show More</b>:
      <ul><li>Method: <b>POST</b></li><li>Headers: add <b>Authorization</b> with the value <b>Bearer ${esc(keyHint)}</b> (the word Bearer, a space, then your key)</li>
      <li>Request Body: <b>JSON</b>. Add a <i>Text</i> field <b>text</b> set to <i>Provided Input</i>, and a <i>Boolean</i> field <b>confirm</b> set to <i>False</i>.</li></ul></li>
    <li>Add <b>Get Dictionary Value</b>: get <i>Value</i> for key <b>speak</b> in <i>Contents of URL</i>.</li>
    <li>Add <b>Choose from Menu</b>. Prompt: the <i>Dictionary Value</i>. Options: <b>Yes</b> and <b>No</b>.</li>
    <li>Under <b>Yes</b>: long-press step 3 → <b>Duplicate</b>, drag the copy under Yes, and change <b>confirm</b> to <i>True</i>. Then add <b>Get Dictionary Value</b> (key <b>speak</b>) and <b>Show Result</b> with that value.</li>
    <li>Under <b>No</b>: add <b>Show Result</b> with the text <i>Okay, nothing logged.</i></li>
    <li>Done. Say <b>“Hey Siri, Ping Hubert”</b>. Siri asks what to log. Say <i>“5 ounces at 5:15”</i>, then <i>“Yes”</i>. It works from your Apple Watch too.</li>
  </ol>
  <p class="tiny muted">Things you can say: “5 ounces at 5:15”, “4 ounces breast milk”, “a bottle” (same as last time), “dirty diaper”, “wet and dirty diaper at 3”, “nap from 1 to 2:30”, “napped 45 minutes”, “fell asleep at 2:40”, “woke up”. Times are Richmond time; a time later than now means earlier today or last night.</p>`;
}
function render() {
  const root = $('siriPanel'); if (!root) return;
  if (!call) { root.innerHTML = `<p class="tiny muted">Available when signed in to the household. This preview doesn’t create keys.</p><details class="siri-how"><summary>See the Shortcut steps</summary>${shortcutSteps('https://…/siri')}</details>`; return; }
  if (!state) { root.innerHTML = '<p class="tiny muted">Loading…</p>'; return; }
  const status = freshKey ? '' : state.hasKey
    ? `<p class="tiny">Your Siri key was made ${esc(when(state.createdAt))}${state.lastUsedAt ? ` · last used ${esc(when(state.lastUsedAt))}` : ' · not used yet'}. For safety it can’t be shown again. Make a new one if you need it (the old one stops working).</p>`
    : '<p class="tiny">Make a personal Siri key, then build the shortcut below. Each of you makes your own.</p>';
  root.innerHTML = `${status}
    ${freshKey ? `<div class="siri-fresh"><p class="tiny"><strong>Here’s your Siri key. Copy it into the shortcut now; it won’t be shown again.</strong></p>${copyRow('siriKey', 'Your Siri key', freshKey, true)}</div>` : ''}
    ${copyRow('siriURL', 'Shortcut address', state.url)}
    <div class="connection-actions"><button type="button" class="btn btn-primary" id="siriCreate">${state.hasKey || freshKey ? 'Make a new key' : 'Make my Siri key'}</button>${state.hasKey || freshKey ? '<button type="button" class="btn" id="siriRevoke">Turn off Siri</button>' : ''}</div>
    <details class="siri-how" ${freshKey ? 'open' : ''}><summary>Set up the “Ping Hubert” shortcut (about 2 minutes)</summary>${shortcutSteps(state.url, freshKey ? 'hh_… (your key)' : 'your key')}</details>
    <p id="siriError" class="form-error" role="alert"></p>`;
  const run = async (button, fn) => { if (busy) return; busy = true; button.disabled = true; $('siriError').textContent = ''; try { await fn(); } catch (e) { $('siriError').textContent = message(e); } finally { busy = false; if (button.isConnected) button.disabled = false; } };
  $('siriCreate').addEventListener('click', event => {
    if (state.hasKey && !confirm('Make a new Siri key? The shortcut on any phone using the old key will stop working until you paste the new one.')) return;
    run(event.currentTarget, async () => { const result = (await call({ action:'create' })).data; freshKey = result.key; state = { ...state, hasKey:true, createdAt:new Date().toISOString(), lastUsedAt:null, url:result.url }; render(); showNotice('Siri key made. Copy it into the shortcut.'); });
  });
  $('siriRevoke')?.addEventListener('click', event => {
    if (!confirm('Turn off Siri logging? Your shortcut will stop working.')) return;
    run(event.currentTarget, async () => { await call({ action:'revoke' }); freshKey = null; state = { ...state, hasKey:false }; render(); showNotice('Siri logging turned off.'); });
  });
  root.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const input = $(button.dataset.copy);
    try { await navigator.clipboard.writeText(input.value); button.textContent = 'Copied'; } catch { input.select(); document.execCommand?.('copy'); button.textContent = 'Copied'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  }));
}
export async function initSiriSettings(app) {
  call = app ? httpsCallable(getFunctions(app, config.functionsRegion), 'siriSetup', { timeout:60000 }) : null;
  render();
  if (!call) return;
  try { state = (await call({ action:'status' })).data; render(); } catch (e) { const root = $('siriPanel'); if (root) root.innerHTML = `<p class="form-error">${esc(message(e))}</p>`; }
}
