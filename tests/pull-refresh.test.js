import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initPullRefresh, pullDistance, isStandalone, PULL_READY, PULL_MAX } from '../pull-refresh.js';

function page(html = '<main><p id="text">Hello</p><input id="field"><div id="scroller" style="overflow:auto"></div></main>') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual:true });
  const win = dom.window, reloads = [];
  const touch = (type, target, y, x = 100) => { const e = new win.Event(type, { bubbles:true }); Object.defineProperty(e, 'touches', { value:type === 'touchend' ? [] : [{ clientX:x, clientY:y }] }); target.dispatchEvent(e); };
  const pull = (target, dy, dx = 0) => { touch('touchstart', target, 100); for (let i = 1; i <= 5; i++) touch('touchmove', target, 100 + dy * i / 5, 100 + dx * i / 5); touch('touchend', target, 0); };
  return { dom, win, doc:win.document, reloads, touch, pull };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('the pull has a rubber band and a ceiling', () => {
  assert.equal(pullDistance(-20), 0); assert.equal(pullDistance(80), 40); assert.equal(pullDistance(1000), PULL_MAX);
  assert.ok(PULL_READY < PULL_MAX);
});

test('only the installed app gets it (browsers already have their own)', () => {
  const { win } = page();
  win.matchMedia = () => ({ matches:false });
  assert.equal(isStandalone(win), false); assert.equal(initPullRefresh({ win }), null);
  win.matchMedia = () => ({ matches:true });
  assert.equal(isStandalone(win), true);
  assert.ok(initPullRefresh({ win, reload:() => {} })); assert.equal(initPullRefresh({ win }), null, 'only once');
});

test('pulling far enough from the top refreshes; a short pull springs back', async () => {
  const { win, doc, pull, reloads } = page();
  const ptr = initPullRefresh({ win, enabled:true, reload:() => reloads.push(1) });
  const text = doc.getElementById('text');
  pull(text, 60); await wait(200);
  assert.equal(reloads.length, 0); assert.equal(ptr.distance, 0, 'springs back');
  pull(text, 160); await wait(200);
  assert.equal(reloads.length, 1); assert.match(ptr.element.textContent, /Refreshing/);
});

test('no refresh while scrolled down, typing, in a dialog, in a scrolled box, or swiping sideways', async () => {
  const { win, doc, pull, reloads } = page('<main><p id="text">Hi</p><input id="field"><div id="box"><p id="inner">x</p></div><dialog id="d"><p id="dp">d</p></dialog><div class="item-row" id="row">row</div></main>');
  initPullRefresh({ win, enabled:true, reload:() => reloads.push(1) });
  pull(doc.getElementById('field'), 200);
  doc.getElementById('d').setAttribute('open', ''); pull(doc.getElementById('text'), 200); doc.getElementById('d').removeAttribute('open');
  const box = doc.getElementById('box'); Object.defineProperties(box, { scrollTop:{ value:40 }, scrollHeight:{ value:500 }, clientHeight:{ value:100 } }); pull(doc.getElementById('inner'), 200);
  pull(doc.getElementById('row'), 30, 160);
  Object.defineProperty(win, 'scrollY', { value:300, configurable:true }); pull(doc.getElementById('text'), 200);
  await wait(200);
  assert.equal(reloads.length, 0);
  Object.defineProperty(win, 'scrollY', { value:0, configurable:true }); pull(doc.getElementById('text'), 200); await wait(200);
  assert.equal(reloads.length, 1, 'and it still works afterwards');
});
