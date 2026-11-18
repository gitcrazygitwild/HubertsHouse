// Settings → "Birthdays from Apple Contacts", and loading the list the calendar, Today
// and the email use (birthdays-model.js). The server reads Contacts over CardDAV with
// the Apple Calendar connection (functions/carddav.js).
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice } from './household.js';
import { setBirthdayList, birthdaysInRange } from './birthdays-model.js';

const $ = id => document.getElementById(id);
const failure = e => e?.code === 'functions/not-found' ? 'The birthdays service is still deploying. Try again in a few minutes.' : e?.message || 'Birthdays could not be loaded.';
// Preview: a few made-up birthdays around today so they show on the calendar.
export function sampleBirthdays(now = new Date()) {
  const at = days => { const d = new Date(now); d.setDate(d.getDate() + days); return { month:d.getMonth() + 1, day:d.getDate() }; };
  return [{ name:'Grandma June', ...at(0), year:1954 }, { name:'Sam Rivera', ...at(3), year:null }, { name:'Aunt Lou', ...at(9), year:1981 }, { name:'Theo', ...at(20), year:2023 }];
}
export function birthdayPanelHTML(state, { demo = false } = {}) {
  if (!state) return '<p class="tiny muted">Loading…</p>';
  if (state.error) return `<p class="form-error">${esc(state.error)}</p><button type="button" class="btn" data-birthday-refresh>Try again</button>`;
  if (!state.connected) return '<p class="tiny muted">Connect Apple Calendar above first. Birthdays use the same Apple connection.</p>';
  const count = state.birthdays?.length || 0, coming = birthdaysInRange(new Date(), new Date(Date.now() + 30 * 86400000), state.birthdays || []);
  const next = coming.length ? `<p class="tiny">Coming up: ${coming.slice(0, 4).map(b => `${esc(b.title.replace(/^🎂 /, ''))} (${esc(new Date(`${b.date}T12:00:00`).toLocaleDateString([], { month:'short', day:'numeric' }))})`).join(' · ')}</p>` : '';
  if (!state.owner) return state.enabled ? `<p class="tiny">Showing ${count} birthday${count === 1 ? '' : 's'} from the Contacts of the household member who shared Apple Calendar.</p>${next}` : '<p class="tiny muted">The household member who connected Apple Calendar can turn this on from their Settings.</p>';
  const updated = state.fetchedAt ? ` Updated ${esc(new Date(state.fetchedAt).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }))}${state.stale ? ' (iCloud didn’t answer just now)' : ''}.` : '';
  return `<label class="inline-field shortcut-setting"><input id="birthdayToggle" type="checkbox" ${state.enabled ? 'checked' : ''} ${demo ? 'disabled' : ''} /> Show birthdays from my Contacts</label>
    ${state.enabled ? `<p class="tiny">${count} birthday${count === 1 ? '' : 's'} found.${updated} Add or fix one in the Contacts app on your iPhone; it shows up here within 12 hours, or tap Refresh.</p>${next}<div class="connection-actions"><button type="button" class="btn" data-birthday-refresh ${demo ? 'disabled' : ''}>Refresh now</button></div>`
      : '<p class="tiny muted">If your Apple calendars are shared with the household, these birthdays are too. Use the “Birthdays” switch on the calendar to hide them on one device.</p>'}`;
}
export async function initBirthdays(app, { demo = false, onChange = () => {} } = {}) {
  const panel = $('birthdayPanel');
  const call = demo || !app ? null : httpsCallable(getFunctions(app, config.functionsRegion), 'birthdays', { timeout:120000 });
  let state = null, busy = false;
  const apply = next => { state = next; setBirthdayList(state?.enabled ? state.birthdays : []); if (panel) panel.innerHTML = birthdayPanelHTML(state, { demo }); onChange(); };
  const run = async (input, done) => {
    if (!call || busy) return; busy = true; panel?.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    try { apply((await call(input)).data); if (done) showNotice(done(state)); }
    catch (e) { showNotice(failure(e)); apply(state || { error:failure(e) }); }
    finally { busy = false; }
  };
  panel?.addEventListener('change', event => {
    if (event.target.id !== 'birthdayToggle') return;
    const enabled = event.target.checked;
    run({ action:'set', enabled }, next => enabled ? `🎂 ${next.birthdays.length} birthdays added from Contacts.` : 'Birthdays from Contacts turned off.');
  });
  panel?.addEventListener('click', event => { if (event.target.closest('[data-birthday-refresh]')) run({ force:true }, next => `Birthdays refreshed: ${next.birthdays.length} found.`); });
  if (demo) { apply({ connected:true, owner:true, enabled:true, birthdays:sampleBirthdays(), fetchedAt:new Date().toISOString() }); return; }
  if (panel) panel.innerHTML = birthdayPanelHTML(null);
  if (call) await run({});
}
