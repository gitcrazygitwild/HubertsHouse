// Settings → Morning newsletter: per-person preferences, the shared sending
// Gmail account (stored encrypted on the server) and a "send me one now" test.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import { config } from './config.js';
import { escapeHTML as esc } from './household-model.js';
import { showNotice } from './household.js';

const $ = id => document.getElementById(id);
let call, state = null, busy = false;
const SKIPPED = { baby:'Frankie’s latest', diapers:'diapers', icloud:'Apple Calendar', forecast:'weather', briefing:'headlines' };
const message = e => e?.code === 'functions/not-found' ? 'The newsletter service is still deploying. Try again in a few minutes.'
  : ['functions/internal', 'functions/deadline-exceeded'].includes(e?.code) ? `The newsletter took too long to put together. Try again in a minute. (${e.code.replace('functions/', '')})`
  : e?.message || 'The newsletter service could not be reached.';
function render() {
  const root = $('newsletterPanel'); if (!root) return;
  if (!call) { root.innerHTML = '<p class="tiny muted">The newsletter is available when signed in to the household. This preview doesn’t send email.</p>'; return; }
  if (!state) { root.innerHTML = '<p class="tiny muted">Loading…</p>'; return; }
  const p = state.prefs;
  root.innerHTML = `<form id="newsletterPrefsForm" class="connection-form">
      <label class="inline-field shortcut-setting"><input id="nlEnabled" type="checkbox" ${p.enabled ? 'checked' : ''} /> Email me the morning newsletter at 6:30am</label>
      <label class="field"><span>Greet me as</span><input id="nlName" maxlength="40" value="${esc(p.name)}" placeholder="hanry or Karena" /></label>
      <label class="inline-field shortcut-setting"><input id="nlAfterDark" type="checkbox" ${p.afterDark ? 'checked' : ''} /> Include the after-dark joke</label>
      <div class="connection-actions"><button class="btn btn-primary" type="submit">Save</button><button class="btn" type="button" id="nlTest" ${state.senderConfigured ? '' : 'disabled'}>Send me one now</button></div>
    </form>
    <div class="newsletter-sender">${state.senderConfigured
      ? `<p class="tiny">Sending from <strong>${esc(state.senderEmail)}</strong> to each person’s login email. <button type="button" class="text-link" id="nlChangeSender">Change</button></p>`
      : ''}
      <form id="newsletterSenderForm" class="connection-form" ${state.senderConfigured ? 'hidden' : ''}>
        <p class="tiny muted">One Gmail account sends the newsletter for the whole household. Use a <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Google app password</a> (needs 2-Step Verification), not your Gmail password. It’s checked with Gmail, then stored encrypted on the server.</p>
        <label class="field"><span>Sending Gmail address</span><input id="nlSenderEmail" type="email" autocomplete="off" required /></label>
        <label class="field"><span>Google app password</span><input id="nlSenderPassword" type="password" autocomplete="new-password" required placeholder="16 characters" /></label>
        <div class="connection-actions"><button class="btn" type="submit">Save sending account</button>${state.senderConfigured ? '<button class="btn" type="button" id="nlRemoveSender">Remove</button>' : ''}</div>
      </form></div>
    ${lastTestNote(state.lastTest)}
    <p id="newsletterError" class="form-error" role="alert"></p>`;
  // After a failed test, reload the progress trail so the step it stopped at shows.
  const fail = async e => { $('newsletterError').textContent = message(e); try { state = { ...state, ...(await call({ action:'status' })).data }; const note = $('newsletterLastTest'); if (note) note.outerHTML = lastTestNote(state.lastTest); } catch { /* keep the message */ } };
  const run = async (button, fn) => { if (busy) return; busy = true; if (button) button.disabled = true; $('newsletterError').textContent = ''; try { await fn(); } catch (e) { fail(e); } finally { busy = false; if (button?.isConnected) button.disabled = false; } };
  $('newsletterPrefsForm').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => {
    state.prefs = (await call({ action:'savePrefs', prefs:{ enabled:$('nlEnabled').checked, name:$('nlName').value, afterDark:$('nlAfterDark').checked } })).data.prefs; showNotice('Newsletter settings saved.'); render();
  }); });
  $('nlTest').addEventListener('click', event => run(event.currentTarget, async () => { const { to, skipped = [] } = (await call({ action:'sendTest' })).data; showNotice(`Newsletter sent to ${to}.${skipped.length ? ` A slow service was left out (${skipped.map(key => SKIPPED[key] || key).join(', ')}); it should be back next time.` : ''}`); }));
  $('nlChangeSender')?.addEventListener('click', () => { $('newsletterSenderForm').hidden = false; $('nlSenderEmail').focus(); });
  $('nlRemoveSender')?.addEventListener('click', event => { if (confirm('Stop sending the newsletter for everyone?')) run(event.currentTarget, async () => { await call({ action:'clearSender' }); state.senderConfigured = false; state.senderEmail = ''; render(); }); });
  $('newsletterSenderForm').addEventListener('submit', event => { event.preventDefault(); const password = $('nlSenderPassword').value; $('nlSenderPassword').value = '';
    run(event.submitter, async () => { const result = (await call({ action:'setSender', email:$('nlSenderEmail').value, password })).data; Object.assign(state, result); showNotice('Sending account saved.'); render(); }); });
}
// The last "Send me one now": where it got to, so a failure names its step.
export function lastTestNote(test) {
  if (!test?.updatedAt) return '<p id="newsletterLastTest" class="tiny muted" hidden></p>';
  const when = new Date(test.updatedAt).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }), seconds = Math.round((test.ms || 0) / 1000);
  const text = test.ok ? `Last test sent ${when} (${seconds}s).`
    : test.finished ? `Last test ${when}: ${test.error || 'it didn’t finish'}`
    : `Last test ${when} stopped while ${test.step} (after ${seconds}s). That step is where to look.`;
  return `<p id="newsletterLastTest" class="tiny ${test.ok ? 'muted' : 'newsletter-last-fail'}">${esc(text)}</p>`;
}
export async function initNewsletterSettings(app) {
  call = app ? httpsCallable(getFunctions(app, config.functionsRegion), 'newsletter', { timeout:300000 }) : null;
  render();
  if (!call) return;
  try { state = (await call({ action:'status' })).data; render(); } catch (e) { const root = $('newsletterPanel'); if (root) root.innerHTML = `<p class="form-error">${esc(message(e))}</p>`; }
}
