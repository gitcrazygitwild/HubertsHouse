// Night feed mode: a dim, full-screen panel for 3 AM (the clock, time since the last bottle,
// the next bottle, and three big buttons). Keeps the screen awake while open.
// Moved unchanged from baby.js; `ctx` is baby.js's shared state and actions.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { bottleForecast, sleepAwareBottle } from './baby-model.js';
const $ = id => document.getElementById(id);
let ctx;
// A dim, full-screen panel for 3 AM: the clock, time since the last bottle, the
// bottle forecast, and three big buttons. Keeps the screen awake while open.
let nightLock = null, nightTimer = null;
function nightPanel() {
  let panel = $('nightMode'); if (panel) return panel;
  panel = document.createElement('div'); panel.id = 'nightMode'; panel.className = 'night-mode'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Night feed mode');
  document.body.append(panel);
  panel.addEventListener('click', e => {
    const action = e.target.closest('[data-night]')?.dataset.night;
    if (action === 'close') closeNight();
    else if (action === 'sleep') ctx.toggleSleep();
    else if (action === 'bottle' || action === 'diaper') ctx.openLog(action);
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('babyLogDialog').open) closeNight(); });
  return panel;
}
function renderNight() {
  const panel = $('nightMode'); if (!panel || panel.hidden || !ctx.snapshot) return;
  const timer = ctx.snapshot.timer, lastBottle = ctx.snapshot.bottles?.at(-1) || (ctx.snapshot.lastBottle?.time ? { start:ctx.snapshot.lastBottle.time, amount:ctx.snapshot.lastBottle.amount, units:ctx.snapshot.lastBottle.units, type:ctx.snapshot.lastBottle.type } : null);
  const next = sleepAwareBottle(bottleForecast(ctx.snapshot.bottles || [], { timezone:ctx.zone() }), timer?.active ? ctx.wakeCall : null), wake = ctx.snapshot.sleeps.at(-1)?.end;
  const clock = new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone:ctx.zone() });
  renderHTML(panel, `<button type="button" class="night-close" data-night="close">Done</button>
    <div class="night-clock" aria-live="off">${esc(clock)}</div>
    <div class="night-stats">
      <div><span>Last bottle</span><strong>${lastBottle ? `${esc(ctx.ago(lastBottle.start))} ago` : '—'}</strong><small>${lastBottle ? `${esc(lastBottle.amount ?? '')} ${esc(lastBottle.units || '')} ${esc((lastBottle.type || '').toLowerCase())} · ${esc(ctx.time(lastBottle.start))}` : 'No bottle logged'}</small></div>
      <div><span>Next bottle</span><strong>${next.available ? `~${esc(ctx.time(next.target))}` : '—'}</strong><small>${next.available ? next.waitingForWake ? 'when she wakes, by the cats’ average call' : `usually every ${Math.floor(next.typicalMinutes / 60)}h ${next.typicalMinutes % 60}m${next.phase === 'overdue' ? ' · any time now' : ''}` : esc(next.reason)}</small></div>
      <div><span>${timer?.active ? 'Asleep' : 'Awake'}</span><strong>${timer?.active ? esc(ctx.ago(timer.start)) : wake ? esc(ctx.ago(wake)) : '—'}</strong><small>${timer?.active ? `since ${esc(ctx.time(timer.start))}` : wake ? `since ${esc(ctx.time(wake))}` : ''}</small></div>
    </div>
    <div class="night-actions">
      <button type="button" data-night="sleep"${ctx.busy ? ' disabled' : ''}>${timer?.active ? '☀ Finish sleep' : '☾ Start sleep'}</button>
      <button type="button" data-night="bottle"${ctx.busy ? ' disabled' : ''}>🍼 Bottle</button>
      <button type="button" data-night="diaper"${ctx.busy ? ' disabled' : ''}>♡ Diaper</button>
    </div>
    <p class="night-tip">${ctx.demo ? 'Sample data · ' : ''}Screen stays awake while this is open.</p>`);
}
async function openNight() {
  if (!ctx.snapshot) return;
  const panel = nightPanel(); panel.hidden = false; document.documentElement.classList.add('night-open');
  renderNight(); panel.querySelector('[data-night="close"]')?.focus();
  nightTimer = setInterval(renderNight, 30000);
  try { nightLock = await navigator.wakeLock?.request('screen'); } catch { nightLock = null; }
}
function closeNight() {
  const panel = $('nightMode'); if (panel) panel.hidden = true;
  document.documentElement.classList.remove('night-open');
  clearInterval(nightTimer); nightLock?.release?.().catch(() => {}); nightLock = null;
  $('babyNight')?.focus();
}

export function initNightMode(context) {
  ctx = context;
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && $('nightMode') && !$('nightMode').hidden && !nightLock) { try { nightLock = await navigator.wakeLock?.request('screen'); } catch {} } });
  return { open:openNight, render:renderNight, close:closeNight };
}
