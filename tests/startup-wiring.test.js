// The signed-in startup path never runs in the preview or the UI tests (they use sample data),
// so check its wiring here. Every store in stores.js takes the Firestore database first; a call
// without it throws "invalid-argument" on the real site and stops the app from starting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('every store is given the database first', async () => {
  const [app, stores] = await Promise.all([readFile('app.js', 'utf8'), readFile('stores.js', 'utf8')]);
  const names = [...stores.matchAll(/export function (\w+)\(db\b/g)].map(m => m[1]);
  assert.ok(names.includes('firestoreStore'), 'stores.js should export firestoreStore(db, …)');
  let calls = 0;
  for (const name of names) for (const m of app.matchAll(new RegExp(`\\b${name}\\(([^)]*)\\)`, 'g'))) {
    if (/^\s*import\b/m.test(app.slice(app.lastIndexOf('\n', m.index) + 1, m.index))) continue;
    calls++;
    assert.match(m[1], /^\s*db\s*(,|$)/, `${name}(${m[1]}) in app.js must pass db first`);
  }
  assert.ok(calls >= 5, 'expected the stores to be created in app.js');
});
