// Monitor mode: the dashboard as a shared display (a bigger clock and header, full screen
// where the browser allows it, and the screen kept awake while the page is visible).
// Moved unchanged from household.js. Remembers the choice on this device (hh_display).
const $ = id => document.getElementById(id);
let wakeLock, displayMode = false, monitorFullscreen = false, notice = () => {}, layoutChanged = () => {};

async function setDisplayMode(on) {
  displayMode = on; document.body.classList.toggle('display-mode', on);
  document.body.classList.toggle('monitor-mode', on);
  localStorage.setItem('hh_display', on ? '1' : '0');
  $('displayBtn').setAttribute('aria-pressed', String(on));
  { const button = $('displayBtn'), label = button.querySelector('.btn-label'), text = on ? 'Exit monitor' : 'Monitor mode'; if (label) { label.textContent = text; button.title = text; } else button.textContent = text; }
  $('settingsDisplayBtn').textContent = on ? 'Exit monitor mode' : 'Open monitor mode';
  if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = null; }
  if (on && document.visibilityState === 'visible') {
    try {
      if (!navigator.wakeLock) throw new Error('unsupported');
      wakeLock = await navigator.wakeLock.request('screen');
      $('wakeStatus').textContent = 'Keeping this screen awake while the page is visible.';
      wakeLock.addEventListener('release', () => { $('wakeStatus').textContent = 'Screen wake lock released by this device.'; });
    } catch { $('wakeStatus').textContent = 'Screen wake lock is unavailable. Adjust your device’s auto-lock setting for a shared display.'; }
  } else if (!on) $('wakeStatus').textContent = '';
  requestAnimationFrame(() => layoutChanged());
}
async function toggleMonitor() {
  if (displayMode) {
    monitorFullscreen = false;
    setDisplayMode(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  // Request fullscreen directly from the click so browser user activation is retained.
  const request = document.documentElement.requestFullscreen?.();
  setDisplayMode(true);
  try {
    if (!request) throw new Error('unsupported');
    await request; monitorFullscreen = !!document.fullscreenElement;
  } catch { notice('Monitor layout is on. This browser does not support full screen; use its full-screen controls if available.'); }
}

export function initMonitor(options = {}) {
  notice = options.notice || notice; layoutChanged = options.layoutChanged || layoutChanged;
  $('displayBtn').addEventListener('click', toggleMonitor);
  $('settingsDisplayBtn').addEventListener('click', toggleMonitor);
  document.addEventListener('fullscreenchange', () => {
    if (monitorFullscreen && !document.fullscreenElement) { monitorFullscreen = false; setDisplayMode(false); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && displayMode && !document.fullscreenElement) setDisplayMode(false); });
  return {
    // Coming back to the page: ask for the wake lock again (browsers drop it when hidden).
    resume() { if (displayMode) setDisplayMode(true); },
    restore() { if (localStorage.getItem('hh_display') === '1') setDisplayMode(true); },
    get on() { return displayMode; }
  };
}
