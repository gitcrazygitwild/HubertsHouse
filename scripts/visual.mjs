// Before/after screenshots for refactors: nothing should change on screen.
//   npm run build && node scripts/visual.mjs capture /tmp/before     (on main)
//   npm run build && node scripts/visual.mjs capture /tmp/after      (on your branch)
//   node scripts/visual.mjs compare /tmp/before /tmp/after           (lists every screen that differs)
// Captures the preview (?demo=1, sample data, no network) with the clock frozen, at phone,
// tablet and desktop widths, light and dark, for every page plus the event and bottle sheets.
// Uses the machine's Playwright + Chromium (not a project dependency). Compare runs in the
// same browser, so before and after must be captured on the same machine.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [mode, a, b] = process.argv.slice(2);
const WIDTHS = [390, 900, 1400], THEMES = ['light', 'dark'], NOW = '2026-11-22T20:30:30Z';
const SCREENS = [
  ['today', null], ['calendar', 'calendar'], ['frankie', 'frankie'], ['life', 'life'], ['devices', 'devices'], ['settings', 'settings'],
  ['event-editor', page => page.click('#quickEvent')], ['bottle-sheet', page => page.click('#view-today [data-baby-log="bottle"]')]
];
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.json':'application/json' };

function serve(dir) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try { const body = await readFile(join(dir, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type':TYPES[extname(path)] || 'text/html' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function capture(out) {
  await mkdir(out, { recursive:true });
  const server = await serve('dist'), url = `http://127.0.0.1:${server.address().port}/?demo=1`, browser = await chromium.launch();
  let count = 0;
  for (const width of WIDTHS) for (const theme of THEMES) {
    for (const [name, open] of SCREENS) {
      const context = await browser.newContext({ viewport:{ width, height:900 }, deviceScaleFactor:1, colorScheme:theme, reducedMotion:'reduce' });
      await context.addInitScript(t => { try { localStorage.setItem('hh_theme', t); } catch {} }, theme);
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      // The preview itself makes no data calls; the page still loads its libraries (Firebase SDK, fonts).
      await page.goto(url, { waitUntil:'networkidle' }); await page.waitForTimeout(500);
      if (await page.locator('#gate:not(.hidden)').count()) throw new Error('The preview showed the sign-in screen; the app did not start.');
      if (typeof open === 'string') await page.evaluate(view => document.querySelector(`.house-nav [data-view="${view}"]`)?.click(), open);
      else if (open) await open(page).catch(() => {});
      await page.waitForTimeout(500);
      // Tall enough to show everything at once (phones scroll inside .house-main).
      const height = await page.evaluate(() => Math.min(16000, Math.max(document.documentElement.scrollHeight, document.querySelector('.house-main')?.scrollHeight || 0, document.querySelector('dialog[open]')?.scrollHeight || 0, 900)));
      await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
      await page.screenshot({ path:join(out, `${name}-${width}-${theme}.png`), animations:'disabled', caret:'hide' });
      await context.close(); count++;
    }
  }
  await browser.close(); server.close();
  console.log(`${count} screenshots in ${out}`);
}

async function compare(before, after) {
  const browser = await chromium.launch(), page = await browser.newPage(), names = (await readdir(before)).filter(n => n.endsWith('.png') && !n.startsWith('diff-')).sort(), changed = [];
  for (const name of names) {
    let next; try { next = await readFile(join(after, name)); } catch { changed.push(`${name}: missing after`); continue; }
    const prev = await readFile(join(before, name));
    if (prev.equals(next)) continue;
    const result = await page.evaluate(async ([x, y]) => {
      const load = src => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
      const [p, n] = await Promise.all([load(x), load(y)]);
      if (p.width !== n.width || p.height !== n.height) return { size:`${p.width}×${p.height} → ${n.width}×${n.height}` };
      const c = Object.assign(document.createElement('canvas'), { width:p.width, height:p.height }), g = c.getContext('2d');
      g.drawImage(p, 0, 0); const A = g.getImageData(0, 0, c.width, c.height); g.drawImage(n, 0, 0); const B = g.getImageData(0, 0, c.width, c.height);
      let diff = 0; const D = g.createImageData(c.width, c.height);
      for (let i = 0; i < A.data.length; i += 4) {
        const same = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) < 24;
        if (!same) diff++;
        D.data[i] = same ? A.data[i] * 0.3 + 178 : 255; D.data[i + 1] = same ? A.data[i + 1] * 0.3 + 178 : 0; D.data[i + 2] = same ? A.data[i + 2] * 0.3 + 178 : 60; D.data[i + 3] = 255;
      }
      g.putImageData(D, 0, 0);
      return { diff, png:diff ? c.toDataURL('image/png') : null };
    }, [`data:image/png;base64,${prev.toString('base64')}`, `data:image/png;base64,${next.toString('base64')}`]);
    if (result.size) changed.push(`${name}: size ${result.size}`);
    else if (result.diff) { changed.push(`${name}: ${result.diff} pixels differ (diff-${name})`); await writeFile(join(after, `diff-${name}`), Buffer.from(result.png.split(',')[1], 'base64')); }
  }
  await browser.close();
  console.log(changed.length ? `Changed:\n${changed.join('\n')}` : `All ${names.length} screens match.`);
  process.exit(changed.length ? 1 : 0);
}

if (mode === 'capture' && a) await capture(a);
else if (mode === 'compare' && a && b) await compare(a, b);
else { console.error('Usage: node scripts/visual.mjs capture <dir>  |  compare <before> <after>'); process.exit(2); }
