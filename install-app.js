// Settings → "Put Hubert's House on your phone or Mac": install the site like an
// app, with its icon. Browsers that support it get an Install button; iPhone, iPad
// and Safari on a Mac get their exact menu steps; a Mac can also download a
// shortcut file.
import { escapeHTML as esc } from './household-model.js';

const $ = id => document.getElementById(id);
const SITE = 'https://huberts-house.web.app/';
let deferredPrompt = null;
// Chrome and Edge announce installability once; keep it for the button.
globalThis.addEventListener?.('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; render(); });
globalThis.addEventListener?.('appinstalled', () => { deferredPrompt = null; render(true); });

export function detectDevice({ userAgent = '', maxTouchPoints = 0, standalone = false } = {}) {
  if (standalone) return 'installed';
  if (/iPhone|iPod/.test(userAgent)) return 'iphone';
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ipad';
  if (/Android/.test(userAgent)) return 'android';
  if (/Macintosh/.test(userAgent)) return /Firefox\//.test(userAgent) ? 'mac-firefox' : /Edg\//.test(userAgent) ? 'mac-edge' : /Chrome\/|Chromium\//.test(userAgent) ? 'mac-chrome' : 'mac-safari';
  return /Edg\//.test(userAgent) ? 'edge' : /Chrome\/|Chromium\//.test(userAgent) ? 'chrome' : 'other';
}
const share = '<span class="install-glyph" aria-hidden="true">⬆︎</span>';
export const STEPS = {
  iphone:['On iPhone', [`In Safari (or Chrome), tap <b>Share</b> ${share}. In Safari it’s at the bottom; you may need to tap <b>⋯</b> first.`, 'Scroll down and tap <b>Add to Home Screen</b>.', 'Keep the name <b>Hubert’s House</b> and tap <b>Add</b>.']],
  ipad:['On iPad', [`In Safari, tap <b>Share</b> ${share} at the top right.`, 'Tap <b>Add to Home Screen</b>, then <b>Add</b>.']],
  'mac-safari':['On a Mac with Safari', ['In the menu bar, choose <b>File → Add to Dock…</b> (macOS Sonoma 14 or newer).', 'Keep the name and click <b>Add</b>. It lands in your Dock and in your Applications folder, and opens in its own window.']],
  'mac-chrome':['On a Mac with Chrome', ['Click the <b>install icon</b> at the right end of the address bar, or choose <b>⋮ → Cast, save, and share → Install page as app…</b>', 'Click <b>Install</b>. It appears in your Applications folder and can be kept in the Dock.']],
  'mac-edge':['On a Mac with Edge', ['Choose <b>⋯ → Apps → Install this site as an app</b>, then <b>Install</b>.']],
  'mac-firefox':['On a Mac with Firefox', ['Firefox can’t install sites as apps. Open this page in <b>Safari</b> and choose <b>File → Add to Dock…</b>, or use Chrome.']],
  android:['On Android', ['In Chrome, tap <b>⋮</b> → <b>Add to home screen</b> → <b>Install</b>.']],
  chrome:['In Chrome', ['Click the <b>install icon</b> in the address bar, or <b>⋮ → Cast, save, and share → Install page as app…</b>']],
  edge:['In Edge', ['Choose <b>⋯ → Apps → Install this site as an app</b>.']],
  other:['In your browser', ['Look for <b>Add to Home Screen</b>, <b>Add to Dock</b> or <b>Install app</b> in the browser’s menu.']]
};
const stepList = ([title, items]) => `<p class="install-device"><strong>${title}</strong></p><ol class="install-steps">${items.map(item => `<li>${item}</li>`).join('')}</ol>`;
// A macOS "internet location" file: double-click opens the site; drag it to the Dock.
export function weblocFile(url = SITE) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${esc(url)}</string>\n</dict>\n</plist>\n`;
}
export function installHTML(device, { canPrompt = false, justInstalled = false } = {}) {
  if (device === 'installed' || justInstalled) return `<p class="install-done">✓ You’re using the Hubert’s House app on this device. To add it somewhere else, open this page there.</p>`;
  const mac = device.startsWith('mac');
  const others = ['iphone', 'mac-safari', 'mac-chrome', 'android'].filter(key => key !== device).map(key => stepList(STEPS[key])).join('');
  return `${canPrompt ? '<div class="connection-actions"><button type="button" class="btn btn-primary" id="installNow">Install Hubert’s House</button></div>' : ''}
    ${stepList(STEPS[device] || STEPS.other)}
    ${mac || device === 'other' || device === 'chrome' || device === 'edge' ? `<div class="connection-actions"><button type="button" class="btn" id="installWebloc">Download a Mac shortcut file</button></div><p class="tiny muted">The file opens Hubert’s House in your browser when you double-click it. Drag it to the right side of the Dock or onto your desktop. It shows a plain link icon; for the real icon use the steps above.</p>` : ''}
    <details class="install-more"><summary class="tiny">Other devices</summary>${others}</details>`;
}
function device() {
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true;
  return detectDevice({ userAgent:globalThis.navigator?.userAgent || '', maxTouchPoints:globalThis.navigator?.maxTouchPoints || 0, standalone });
}
function render(justInstalled = false) {
  const root = $('installPanel'); if (!root) return;
  root.innerHTML = installHTML(device(), { canPrompt:!!deferredPrompt, justInstalled });
  $('installNow')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({}));
    deferredPrompt = null; render(outcome === 'accepted');
  });
  $('installWebloc')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([weblocFile()], { type:'application/x-apple-plist' }));
    link.download = 'Hubert’s House.webloc'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
}
export function initInstall() { render(); }
