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
  for (const [file, names] of [['household-model.js', ['escapeHTML', 'dateKey']], ['dom.js', ['renderHTML']], ['baby-history.js', ['dailySleep', 'dailyBottles', 'dailyPumps', 'timelineRows', 'babySummary', 'dayStart', 'dayKeys', 'localDay', 'sleepKind', 'dayStory', 'dayStoryText', 'nightLine', 'clockAt', 'DEFAULT_NIGHT_LINE', 'toOunces']], ['baby-model.js', ['purrfectWindow', 'miaForecast', 'huckleberryPrediction', 'bottleForecast', 'bottleSleepLinks', 'ageInDays', 'ageLabel', 'halfLifeFor']], ['mia-v1.js', ['miaForecastV1']], ['cat-challenges.js', ['CHALLENGES', 'MACK_EXCUSE', 'nightsFrom', 'currentBedtime', 'morningPicks', 'bottlePicks', 'scoreMornings', 'scoreBottles', 'scorePumps', 'pumpPicks', 'napNightPicks', 'nextSleepKind', 'scoreNapNight']],
    ['prediction-log.js', ['MODELS', 'scorePredictions', 'sweetspotEntry', 'MIA_V2_SINCE']],
    ['baby-sample.js', ['sampleHistory', 'samplePredictions']], ['awards.js', ['frankieAwards']], ['bottle-pace.js', ['bottlePace']], ['frankie.js', ['renderFrankie', 'initFrankie', 'frankieDayText', 'challengeHTML', 'bottleLinksHTML', 'pumpsHTML', 'paceHTML', 'napNightHTML']]]) {
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
  // No pumps logged: the pumps card explains how; the Pump Pool and its chart stay hidden.
  assert.match(doc.getElementById('frankiePumps').textContent, /No pumps logged yet/);
  assert.equal(doc.getElementById('pumpPoolCard').hidden, true); assert.equal(doc.getElementById('pumpChartCard').hidden, true);
  // With Karena's pumps: today's split, the challenge, and a stacked left/right chart.
  const { pumps } = w.sampleHistory(Date.now());
  w.renderFrankie({ snapshot:{ ...snapshot, pumps }, timezone, predictions:w.samplePredictions(sleeps, timezone), connected:true });
  assert.equal(doc.getElementById('pumpPoolCard').hidden, false); assert.equal(doc.getElementById('pumpChartCard').hidden, false);
  assert.match(doc.getElementById('frankiePumps').textContent, /Pumped today.*Left.*Right/s);
  assert.equal(doc.querySelectorAll('#frankiePumpPool .score-card').length, 3); assert.match(doc.getElementById('frankiePumpPool').textContent, /Copycat/);
  assert.ok(doc.querySelector('#frankiePumpChart svg .mark-left') && doc.querySelector('#frankiePumpChart svg .mark-right'));
  assert.match(doc.querySelector('#frankiePumpChart .chart-legend').textContent, /Left.*Right/);
  // And back to empty (e.g. disconnect), then data again.
  w.renderFrankie({ snapshot:null, timezone, connected:false });
  w.renderFrankie({ snapshot, timezone, connected:true });
  assert.ok(doc.querySelector('#frankieBottles svg .mark-bottle'));
  assert.deepEqual(errors, []);
});
