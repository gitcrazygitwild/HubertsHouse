import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
process.env.TZ = 'America/New_York';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const clean = source => source.replace(/^import\b[\s\S]*?;\s*$/gm, '').replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|let))/g, '');

// Regression: the live app renders the empty state before Huckleberry answers.
// The placeholder used to replace the chart containers, so the first real
// snapshot crashed with "null is not an object (evaluating '$(id).clientWidth')".
test('Frankie page survives the empty state and renders once a snapshot arrives', async t => {
  const errors = [], virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(await read('index.html'), { url:'https://house.test/', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole });
  t.after(() => dom.window.close());
  const w = dom.window;
  for (const [file, names] of [['household-model.js', ['escapeHTML', 'dateKey']], ['dom.js', ['renderHTML']], ['baby-model.js', ['purrfectWindow', 'miaForecast', 'huckleberryPrediction']],
    ['prediction-log.js', ['MODELS', 'scorePredictions', 'sweetspotEntry']], ['baby-history.js', ['dailySleep', 'dailyBottles', 'timelineRows', 'babySummary', 'dayStart', 'dayKeys', 'localDay', 'sleepKind', 'toOunces']],
    ['baby-sample.js', ['sampleHistory', 'samplePredictions']], ['awards.js', ['frankieAwards']], ['frankie.js', ['renderFrankie', 'initFrankie']]]) {
    w.eval(`(() => { const esc = window.escapeHTML; ${clean(await read(file))}\nObject.assign(window,{${names.join(',')}}); })();`);
  }
  const doc = w.document, timezone = 'America/New_York';
  w.initFrankie(() => {});
  w.renderFrankie({ snapshot:null, timezone, connected:true });
  assert.equal(doc.getElementById('frankieEmpty').hidden, false); assert.equal(doc.getElementById('frankieContent').hidden, true);
  assert.match(doc.getElementById('frankieEmpty').textContent, /trends will live here/);
  assert.ok(doc.getElementById('frankieTimeline'), 'chart containers must survive the empty state');
  const { sleeps, bottles } = w.sampleHistory(Date.now());
  const snapshot = { childId:'c', name:'Frankie', sleeps, bottles, timer:{ active:false }, historyComplete:true, feedsComplete:true, historyDays:60, checkedAt:new Date().toISOString() };
  w.renderFrankie({ snapshot, timezone, predictions:w.samplePredictions(sleeps, timezone), connected:true });
  assert.equal(doc.getElementById('frankieEmpty').hidden, true); assert.equal(doc.getElementById('frankieContent').hidden, false);
  assert.ok(doc.querySelector('#frankieTimeline svg .mark-night')); assert.ok(doc.querySelector('#frankieBottles svg .mark-bottle'));
  assert.ok(doc.querySelector('#frankieSleep svg .mark-nap')); assert.equal(doc.querySelectorAll('#frankieScore .score-card').length, 3);
  // And back to empty (e.g. disconnect), then data again.
  w.renderFrankie({ snapshot:null, timezone, connected:false });
  w.renderFrankie({ snapshot, timezone, connected:true });
  assert.ok(doc.querySelector('#frankieBottles svg .mark-bottle'));
  assert.deepEqual(errors, []);
});
