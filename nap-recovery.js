// Missed-nap recovery: the sleeps logged after a missed nap come out of Huckleberry for a
// moment (the server keeps exact copies), Huckleberry recalculates SweetSpot as of that nap,
// Mack's pick is saved, and the sleeps go back. Until they're back, a panel stays on the
// Frankie page. Moved unchanged from baby.js; `ctx` is baby.js's shared state and actions.
import { escapeHTML as esc } from './household-model.js';
import { recoveredEntry } from './prediction-log.js';
const $ = id => document.getElementById(id);
let ctx;
// The sleeps logged after a missed nap come out of Huckleberry for a moment (the server
// keeps exact copies), Huckleberry recalculates SweetSpot as of that nap, Mack's pick is
// saved, and the sleeps go back. Until they're back, this panel stays on the Frankie page.
let recovery = { active:false };
function drawRecovery() {
  const root = $('rewindPanel'); if (!root) return;
  if (!recovery.active) { root.hidden = true; root.innerHTML = ''; return; }
  const found = recovery.found, n = recovery.count;
  root.hidden = false;
  root.innerHTML = `<h3>Recovering the nap after ${esc(ctx.time(recovery.wake))}</h3>
    <p>${n} later sleep${n === 1 ? ' is' : 's are'} out of Huckleberry for the moment, saved here to put back. ${found ? `Huckleberry now says <strong>${esc(ctx.time(found))}</strong>${recovery.before ? ` (it said ${esc(ctx.time(recovery.before))} before)` : ''}. Save that as Mack’s pick?` : 'Open the Huckleberry app on your phone and wait until its SweetSpot changes, then tap <b>Check SweetSpot</b>.'}</p>
    ${recovery.note ? `<p class="form-error" role="alert">${esc(recovery.note)}</p>` : ''}
    <div class="connection-actions">${found ? '<button type="button" class="btn btn-primary" data-recover="save">Save it and put the sleeps back</button><button type="button" class="btn" data-recover="check">Check again</button>' : '<button type="button" class="btn btn-primary" data-recover="check">Check SweetSpot</button>'}<button type="button" class="btn" data-recover="restore">Put the sleeps back${found ? ' without saving' : ''}</button></div>`;
}
async function recover(step, wake) {
  if (ctx.busy) return; ctx.busy = true; recovery.note = '';
  $('rewindPanel')?.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    if (step === 'start') {
      const later = (ctx.snapshot?.sleeps || []).filter(sleep => Date.parse(sleep.start) >= Date.parse(wake)).length;
      if (!confirm(`Recover the nap after ${ctx.time(wake)}?\n\nHubert’s House will take the ${later} sleep${later === 1 ? '' : 's'} logged after it out of Huckleberry for a moment (exact copies are kept here), you’ll open the Huckleberry app so it recalculates SweetSpot, then everything goes back.\n\nAvoid logging sleeps in Huckleberry until it’s done.`)) return;
      const before = ctx.snapshot?.sweetspot?.time || null;
      const result = ctx.demo ? { count:later } : await ctx.call('rewind', { wake });
      recovery = { active:true, wake, count:result.count, before, found:null };
      if (!ctx.demo) ctx.refresh(true);
    } else if (step === 'check') {
      if (ctx.demo) recovery.found = new Date(Date.parse(recovery.wake) + 95 * 60000).toISOString();
      else {
        const next = await ctx.call('snapshot', { force:true }); ctx.snapshot = next;
        const target = next.sweetspot?.time;
        if (recoveredEntry({ lastWake:recovery.wake, childId:ctx.snapshot.childId, sweetspot:target, before:recovery.before })) recovery.found = target;
        else recovery.note = target ? `Huckleberry hasn’t recalculated yet (it still shows ${ctx.time(target)}). Open the app, give it a few seconds, and check again.` : 'Huckleberry hasn’t shown a SweetSpot yet. Open the app and check again.';
      }
    } else if (step === 'save' || step === 'restore') {
      if (step === 'save') {
        const entry = recoveredEntry({ lastWake:recovery.wake, childId:ctx.snapshot?.childId, sweetspot:recovery.found, before:recovery.before });
        if (entry) await ctx.predictionStore?.record(entry);
      }
      const result = ctx.demo ? { restored:recovery.count, alreadyThere:0 } : await ctx.call('restore');
      const saved = step === 'save';
      recovery = { active:false };
      ctx.showNotice(`${saved ? 'Mack’s pick is saved. ' : ''}All ${result.restored + result.alreadyThere} sleeps are back in Huckleberry.`);
      if (!ctx.demo) { ctx.resetAttempts(); ctx.refresh(true); }
    }
  } catch (e) { recovery.note = ctx.message(e); if (step === 'start') recovery = { active:false }; ctx.showNotice(ctx.message(e)); }
  finally { ctx.busy = false; drawRecovery(); ctx.home(); }
}

export function initNapRecovery(context) {
  ctx = context;
  return { draw:drawRecovery, recover, resume(status) { recovery = { active:true, wake:status.wake, count:status.count, before:null, found:null }; drawRecovery(); } };
}
