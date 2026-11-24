// Starting the app's parts after sign-in (or in the preview). Each part starts on its own:
// one that throws, now or later, is reported and the rest carry on. (A single bad line in
// the meals setup once kept the whole app from opening.) app.js keeps the calendar and
// the household lists, which everything else hangs off, and passes in the hooks it owns.
import { initHuckleberry } from './baby.js';
import { initNewsletterSettings } from './newsletter-settings.js';
import { initSiriSettings } from './siri-settings.js';
import { initWorldBriefing } from './world-briefing.js';
import { initInstall } from './install-app.js';
import { initPullRefresh } from './pull-refresh.js';
import { initHypotheses, memoryHypotheses } from './hypotheses-view.js';
import { predictionStore, hypothesisStore, settingsStore, trashStore, firestoreStore, healthStore } from './stores.js';
import { initHealth, memoryHealthStore } from './health-view.js';
import { initDevices } from './devices.js';
import { initLitter } from './litter.js';
import { initFeeders } from './feeders.js';
import { initMeals } from './meals.js';
import { initBathDays, memoryBathStore } from './bath-settings.js';
import { initTrashDays, memoryTrashStore } from './trash-settings.js';
import { initBirthdays } from './birthdays.js';
import { demoMealStore } from './demo.js';

const describe = error => String(error?.code || error?.name || 'error').replace(/^[a-z]+\//, '');

// Runs each [name, start] in order. A part that throws, or whose promise rejects, is passed
// to onFailure({ name, code, error }); the others keep going. Returns the parts that failed
// straight away, plus `settled`, which resolves with every failure once async parts finish.
export function startParts(parts, onFailure = () => {}) {
  const failures = [], pending = [];
  const fail = (name, error) => { const failure = { name, code:describe(error), error }; failures.push(failure); try { onFailure(failure); } catch { /* reporting must not throw */ } };
  for (const [name, start] of parts) {
    try {
      const result = start();
      if (result && typeof result.then === 'function') pending.push(Promise.resolve(result).catch(error => fail(name, error)));
    } catch (error) { fail(name, error); }
  }
  return { failures:[...failures], settled:Promise.all(pending).then(() => [...failures]) };
}

// Every part after the calendar and the household lists, in the order they start.
export function featureParts({ app = null, db = null, demo = false, startUpgrades, calendarChanged, bathChanged }) {
  const sampleHunches = [{ text:'She sleeps longer on bath nights', factor:'bath', outcome:'nightLength', direction:'more' }, { text:'She’s fussier on days Hubert sits on her play mat' }];
  const sampleHealth = () => ['huckleberry', 'publix', 'email'].map(service => ({ service, lastOk:new Date(Date.now() - 20 * 60000).toISOString(), problem:null }));
  return [
    ['Quick add and Now & Next', () => startUpgrades()],
    ['Hunches', () => initHypotheses({ store:demo ? memoryHypotheses(sampleHunches) : hypothesisStore(db) })],
    ['Huckleberry', () => demo ? initHuckleberry(null, { demo:true }) : initHuckleberry(app, { predictions:predictionStore(db) })],
    ['Morning email settings', () => initNewsletterSettings(app)],
    ['Siri settings', () => initSiriSettings(app)],
    ['Headlines and markets', () => initWorldBriefing(app, demo ? { demo:true } : undefined)],
    ['Add to Home Screen', () => initInstall()],
    ['Pull to refresh', () => initPullRefresh()],
    ['Devices', () => initDevices(app, demo ? { demo:true } : undefined)],
    ['Litter-Robot', () => initLitter(app, demo ? { demo:true } : undefined)],
    ['Feeders', () => initFeeders(app, demo ? { demo:true } : undefined)],
    ['Meals', () => initMeals(app, demo ? { demo:true, store:demoMealStore() } : { store:firestoreStore(db, 'householdMeals') })],
    ['Birthdays', () => initBirthdays(app, { ...(demo ? { demo:true } : {}), onChange:calendarChanged })],
    ['Bath days', () => initBathDays({ store:demo ? memoryBathStore() : settingsStore(db), onChange:bathChanged })],
    ['Trash days', () => initTrashDays({ store:demo ? memoryTrashStore() : trashStore(db), onChange:bathChanged })],
    ['Connections', () => initHealth({ store:demo ? memoryHealthStore(sampleHealth()) : healthStore(db) })]
  ];
}

// A quiet banner naming what didn't start (with its code, never data), and a way to retry.
export function startupProblemText(failures) {
  const names = [...new Map(failures.map(f => [f.name, f])).values()];
  return `${names.length === 1 ? 'One part' : `${names.length} parts`} of Hubert’s House didn’t start: ${names.map(f => `${f.name} (${f.code})`).join(', ')}. Everything else is working.`;
}
export function showStartupProblems(failures, root = document) {
  if (!failures.length) return;
  let box = root.getElementById('startupProblems');
  if (!box) {
    box = root.createElement('div'); box.id = 'startupProblems'; box.className = 'startup-problems'; box.setAttribute('role', 'status');
    (root.querySelector('.house-main') || root.body).prepend(box);
  }
  box.replaceChildren();
  const text = root.createElement('span'); text.textContent = startupProblemText(failures);
  const retry = root.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Reload'; retry.addEventListener('click', () => location.reload());
  box.append(text, retry); box.hidden = false;
}

// Starts every part; failures show in the banner and the console as they happen.
export function startFeatures(options) {
  const seen = [];
  return startParts(featureParts(options), failure => {
    console.error(`Hubert’s House: “${failure.name}” didn’t start`, failure.error);
    seen.push(failure); showStartupProblems(seen);
  });
}
