import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectDevice, installHTML, weblocFile } from '../install-app.js';

const UA = {
  iphone:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  macSafari:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macChrome:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macEdge:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  android:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
};

test('each device gets its own install steps', () => {
  assert.equal(detectDevice({userAgent:UA.iphone}), 'iphone');
  assert.equal(detectDevice({userAgent:UA.macSafari, maxTouchPoints:5}), 'ipad'); // iPadOS reports as a Mac with touch
  assert.equal(detectDevice({userAgent:UA.macSafari}), 'mac-safari');
  assert.equal(detectDevice({userAgent:UA.macChrome}), 'mac-chrome');
  assert.equal(detectDevice({userAgent:UA.macEdge}), 'mac-edge');
  assert.equal(detectDevice({userAgent:UA.android}), 'android');
  assert.equal(detectDevice({userAgent:UA.iphone, standalone:true}), 'installed');
  assert.match(installHTML('iphone'), /Add to Home Screen/); assert.doesNotMatch(installHTML('iphone'), /installWebloc/);
  assert.match(installHTML('mac-safari'), /File → Add to Dock…/); assert.match(installHTML('mac-safari'), /Download a Mac shortcut file/);
  assert.match(installHTML('mac-chrome', {canPrompt:true}), /id="installNow"/);
  assert.match(installHTML('installed'), /You’re using the Hubert’s House app/);
});

test('the Mac shortcut file opens the site, and phones and computers get real icons', async () => {
  const file = weblocFile();
  assert.match(file, /<key>URL<\/key>\s*<string>https:\/\/huberts-house\.web\.app\/<\/string>/); assert.match(file, /^<\?xml/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png" \/>/);
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.type === 'image/png'), size);
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) { const bytes = await readFile(new URL(`../${icon.src.slice(2)}`, import.meta.url)); assert.ok(bytes.length > 100, icon.src); }
  const png = await readFile(new URL('../apple-touch-icon.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180);
});
