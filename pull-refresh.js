// Pull down to refresh, for the installed app (Add to Home Screen), where iOS and
// Android give no browser refresh. In a normal browser tab the browser's own
// pull-to-refresh is left alone. Pulling past the line reloads the page, which
// fetches fresh data and any new version; the #view hash keeps you on the same page.
// The indicator moves at half the finger's speed: release after pulling ~110px to refresh.
export const PULL_READY = 55, PULL_MAX = 100;
// Rubber-band resistance: the indicator moves less than the finger.
export const pullDistance = dy => dy <= 0 ? 0 : Math.min(PULL_MAX, dy * 0.5);
const blocked = target => !!target?.closest?.('input, textarea, select, [contenteditable], dialog, .modal-backdrop, .day-strip, .chart-wrap, [data-no-pull]');
// The touch began inside something that scrolls on its own and isn't at its top.
function innerScrolled(target, root) {
  for (let el = target; el && el !== root && el.nodeType === 1; el = el.parentElement) if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
  return false;
}
export function isStandalone(win = globalThis) {
  return !!(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator?.standalone === true);
}
export function initPullRefresh({ win = globalThis, enabled = isStandalone(win), reload = () => win.location.reload() } = {}) {
  const doc = win.document;
  if (!enabled || !doc?.body || doc.getElementById('pullRefresh')) return null;
  const bar = doc.createElement('div');
  bar.id = 'pullRefresh'; bar.className = 'pull-refresh'; bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<span class="pull-refresh-icon">↓</span><span class="pull-refresh-text">Pull to refresh</span>';
  doc.body.prepend(bar);
  const status = doc.createElement('div'); status.className = 'sr-only'; status.setAttribute('role', 'status'); doc.body.append(status);
  let startY = null, startX = 0, distance = 0, refreshing = false;
  const draw = () => {
    const ready = distance >= PULL_READY;
    bar.style.transform = `translate(-50%, ${Math.round(distance - 48)}px)`;
    bar.style.opacity = String(Math.min(1, distance / 40));
    bar.classList.toggle('ready', ready && !refreshing); bar.classList.toggle('refreshing', refreshing);
    bar.querySelector('.pull-refresh-text').textContent = refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh';
  };
  const reset = () => { startY = null; distance = 0; bar.classList.add('settling'); draw(); };
  const opened = () => doc.querySelector('dialog[open]') || doc.querySelector('.modal-backdrop:not(.hidden)');
  doc.addEventListener('touchstart', event => {
    if (refreshing || event.touches.length !== 1 || (win.scrollY || doc.documentElement.scrollTop) > 0 || opened() || blocked(event.target) || innerScrolled(event.target, doc.body)) { startY = null; return; }
    startY = event.touches[0].clientY; startX = event.touches[0].clientX; distance = 0; bar.classList.remove('settling');
  }, { passive:true });
  doc.addEventListener('touchmove', event => {
    if (startY == null) return;
    if ((win.scrollY || doc.documentElement.scrollTop) > 0 || innerScrolled(event.target, doc.body)) { reset(); return; }
    const dy = event.touches[0].clientY - startY, dx = event.touches[0].clientX - startX;
    // A sideways swipe (chore and grocery rows swipe) is not a pull.
    if (distance === 0 && Math.abs(dx) > 12 && Math.abs(dx) > dy) { reset(); return; }
    distance = pullDistance(dy); draw();
  }, { passive:true });
  const end = () => {
    if (startY == null) return;
    if (distance >= PULL_READY && !refreshing) {
      refreshing = true; startY = null; distance = PULL_READY; bar.classList.add('settling'); draw(); status.textContent = 'Refreshing';
      setTimeout(() => reload(), 150);
      return;
    }
    reset();
  };
  doc.addEventListener('touchend', end, { passive:true });
  doc.addEventListener('touchcancel', reset, { passive:true });
  return { element:bar, get distance() { return distance; } };
}
