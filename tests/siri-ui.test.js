import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { escapeHTML } from '../household-model.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('signed in: make a key (shown once), see the steps, make a new one, turn it off', async t => {
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'), { url:'https://house.test/', runScripts:'outside-only' }), w = dom.window, calls = [], notices = [];
  t.after(() => dom.window.close());
  let keys = 0;
  w.confirm = () => true;
  Object.assign(w, { config:{ functionsRegion:'us-central1' }, esc:escapeHTML, showNotice:m => notices.push(m), getFunctions:() => ({}),
    httpsCallable:() => async data => { calls.push(data.action); return { data:data.action === 'status' ? { hasKey:false, url:'https://example/siri' } : data.action === 'create' ? { hasKey:true, key:`hh_${'a'.repeat(42)}${++keys}`, url:'https://example/siri' } : { hasKey:false } }; } });
  const source = (await readFile(new URL('../siri-settings.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '').replace(/\bexport /g, '');
  w.eval(`${source};window.initSiri=initSiriSettings;`); await w.initSiri({}); await settle();
  const doc = w.document;
  assert.equal(doc.getElementById('siriCreate').textContent, 'Make my Siri key'); assert.equal(doc.getElementById('siriKey'), null);
  doc.getElementById('siriCreate').click(); await settle();
  assert.equal(doc.getElementById('siriKey').value, `hh_${'a'.repeat(42)}1`); assert.equal(doc.getElementById('siriURL').value, 'https://example/siri');
  assert.equal(doc.querySelector('.siri-how').open, true); assert.ok(doc.querySelector('[data-copy="siriKey"]'));
  doc.getElementById('siriCreate').click(); await settle();
  assert.equal(doc.getElementById('siriKey').value, `hh_${'a'.repeat(42)}2`);
  doc.getElementById('siriRevoke').click(); await settle();
  assert.equal(doc.getElementById('siriKey'), null); assert.equal(doc.getElementById('siriCreate').textContent, 'Make my Siri key');
  assert.deepEqual(calls, ['status', 'create', 'create', 'revoke']); assert.ok(notices.includes('Siri logging turned off.'));
});
