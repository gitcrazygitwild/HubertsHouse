import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

// html/body are 100% tall, so bottom padding on <body> lands behind the fixed phone
// menu instead of after the page. The content itself must leave room for the menu,
// including in compact density (whose padding shorthand would otherwise win).
test('on phones, the page content clears the fixed bottom menu', async () => {
  const [styles, mobile, compact, index] = await Promise.all([css('styles.css'), css('mobile.css'), css('compact.css'), css('index.html')]);
  assert.match(styles, /html,\s*body\s*\{\s*height:\s*100%/);
  const rule = mobile.match(/@media \(max-width: 650px\) \{\s*([^{}]*\.house-main[^{}]*)\{\s*padding-bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom/);
  assert.ok(rule, 'mobile.css pads .house-main for the menu');
  assert.match(rule[1], /:root\[data-density="compact"\] \.house-main/);
  assert.ok(Number(rule[2]) >= 80, 'at least the menu height plus room');
  assert.ok(index.indexOf('mobile.css') > index.indexOf('compact.css'), 'mobile.css loads after compact.css so it wins');
  assert.match(compact, /:root\[data-density="compact"\] \.house-main \{ padding:/);
});

test('on iPhones the bottom tabs stay put: no see-through blur behind them, no page bounce', async () => {
  const mobile = await css('mobile.css');
  assert.match(mobile, /overscroll-behavior-y:\s*none/);
  assert.match(mobile, /\.house-sidebar[^{]*\{[^}]*backdrop-filter:\s*none !important/);
});
