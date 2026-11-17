// Settings → "Hey Siri, Frankie log": make or revoke a personal Siri key and
// follow the steps to build the "Frankie log" Apple Shortcut.
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
  const step = (title, items) => `<li><strong>${title}</strong>${items.length ? `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}</li>`;
  return `<p class="tiny">Do this on your iPhone. Keep this page open — you’ll copy the <b>Shortcut address</b> and <b>your key</b> from it (your clipboard holds one at a time, so you’ll switch back once).</p>
  <ol class="siri-steps">
    ${step('Create the shortcut', ['Open the <b>Shortcuts</b> app and tap <b>＋</b> (top right).', 'Tap the name at the top → <b>Rename</b> → type <b>Frankie log</b> → Done. That name is what you say to Siri. (Avoid names starting with “Ping”: Siri hears that as Find My.)'])}
    ${step('Ask what to log', ['Tap the search bar at the bottom, type <b>Ask for Input</b>, tap it.', 'Tap <b>Prompt</b> and type <i>What should I log?</i> (leave the type as Text).'])}
    ${step('Send it to Hubert (preview)', ['Search <b>Get Contents of URL</b> and tap it.', 'Copy the <b>Shortcut address</b> here, then tap <b>URL</b> and paste.', 'Tap the small <b>›</b> on that action to expand it:',
      'Method: change <b>GET</b> to <b>POST</b>.', `Headers: <b>Add new header</b>. Key: <code>Authorization</code>. Value: <code>Bearer </code> (the word Bearer and a space), then paste ${esc(keyHint)}.`,
      'Request Body: <b>JSON</b>. <b>Add new field → Text</b>: key <code>text</code>; for the value, pick <b>Provided Input</b> from the suggestions above the keyboard (the answer from Ask for Input; <b>not</b> “Shortcut Input”, which is empty when you start from Siri).', '<b>Add new field → Boolean</b>: key <code>confirm</code>, leave it <b>False</b>.'])}
    ${step('Read back what Hubert understood', ['Search <b>Get Dictionary Value</b>, tap it, tap <b>Key</b> and type <code>speak</code>. It should read “Get Value for speak in Contents of URL”.', 'Search <b>Choose from Menu</b>. Tap <b>Prompt</b> and pick <b>Dictionary Value</b>. Rename the options <b>One → Yes</b> and <b>Two → No</b>.'])}
    ${step('If you say “Yes”, save it', ['<b>Long-press</b> the Get Contents of URL action → <b>Duplicate</b>, and drag the copy <b>directly under “Yes”</b>.', 'Expand the copy (<b>›</b>) and change <b>confirm</b> to <b>True</b>. Check its Method still says <b>POST</b>: a copy left on GET is rejected by Google before it reaches Hubert.',
      'Right under it (still in Yes): <b>Get Dictionary Value</b> with key <code>speak</code>. Tap its blue <b>Contents of URL</b> to check it highlights the copy under Yes, not the first one.', 'Right under that: <b>Show Content</b> (older iPhones: <b>Show Result</b>) set to <b>Dictionary Value</b>.'])}
    ${step('If you say “No”', ['Under <b>No</b>: <b>Show Content</b> with the text <i>Okay, nothing logged.</i>', 'Tap <b>Done</b>.'])}
    ${step('Try it', ['Say <b>“Hey Siri, Frankie log”</b> → <i>“5 ounces at 5:15”</i> → <i>“Yes”</i>.', 'The first time, allow the shortcut to connect (choose <b>Always Allow</b>).', 'Apple Watch: open the shortcut, tap <b>ⓘ</b>, turn on <b>Show on Apple Watch</b>.'])}
  </ol>
  <p class="tiny muted"><b>Want it quicker, with no Yes/No?</b> Skip the read-back and the menu: in the one Get Contents of URL, set <b>confirm</b> to <b>True</b>, then add <b>Get Dictionary Value</b> (<code>speak</code>) and <b>Show Content</b>. Siri just says what it logged. A misheard entry saves right away, so listen to what it says, and fix mistakes in Huckleberry.</p>
  <p class="tiny muted"><b>Not working?</b> Both URL actions must be <b>POST</b>; the header is exactly <code>Authorization</code> with <code>Bearer</code>, a space, then your key; fields are lowercase <code>text</code> and <code>confirm</code> (False in the first, True in the copy). If Siri repeats the question after “Yes”, the last Get Dictionary Value is reading the first URL action. If Siri says it got <i>no words</i>, the <code>text</code> field is set to Shortcut Input instead of Provided Input. If Siri opens something else, rename the shortcut so it doesn’t match an app or home-screen icon. If Shortcuts says it <i>couldn’t convert from Rich Text to Dictionary</i>, a web page came back instead of Hubert’s answer. If that happens only after “Yes”, check the copy under Yes: it must be <b>POST</b>, with no empty header row under Authorization (Google’s page says “Your client has issued a malformed or illegal request”). Otherwise check the URL is exactly the Shortcut address above, lowercase <code>siri</code>, with nothing after it.</p>
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
    <details class="siri-how" ${freshKey ? 'open' : ''}><summary>Set up the “Frankie log” shortcut (about 2 minutes)</summary>${shortcutSteps(state.url, freshKey ? 'hh_… (your key)' : 'your key')}</details>
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
