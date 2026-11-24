// The built page: every app module preloaded, nothing stray printed into the page, and the
// service worker shipped but not preloaded. (A comment once cut a build line short and
// printed the file list across the top of the live page.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';

test('the build writes a clean index.html with module preloads', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio:'pipe' });
  const html = await readFile('dist/index.html', 'utf8'), head = html.slice(0, html.indexOf('<body'));
  const preloads = [...head.matchAll(/<link rel="modulepreload" href="\.\/([\w-]+\.js)\?v=[^"]+" \/>/g)].map(m => m[1]);
  assert.ok(preloads.length > 50, `expected the app modules to be preloaded, found ${preloads.length}`);
  assert.ok(preloads.includes('app.js') && preloads.includes('features.js'));
  assert.ok(!preloads.includes('sw.js'), 'the service worker is registered, not imported');
  assert.doesNotMatch(head.replace(/<[^>]*>/g, ''), /\.js/, 'no file names printed as text in the page head');
  assert.doesNotMatch(html, />[^<]*app\.js,[^<]*</, 'no file list printed anywhere');
  await access('dist/sw.js');
});
