// Is each outside service still working? Huckleberry and Publix are unofficial, so either
// could change or stop answering without notice; the morning email can fail to send too.
// Each call reports ok() or fail(problem) here, and the latest state lands in the
// members-readable `serviceHealth/{service}` documents (written only by the server).
// The app and the morning email turn them into quiet warnings (service-health-model.js).
// Recording never throws or slows a request down for long; a failed write is ignored.
import { HuckleberryError } from './huckleberry-provider.js';

const OK_EVERY = 30 * 60000; // successes are noted at most every half hour per service
// What kind of trouble an error points to, or null when it's the user's own input
// (a typo, not connected yet), which isn't a service problem.
export function classifyFailure(error) {
  const code = error?.code, reason = error?.details?.reason;
  if (reason === 'PROVIDER_UNAUTHENTICATED' || code === 'unauthenticated' || code === 16) return 'signed-out';
  if (code === 'permission-denied' || code === 7) return 'denied';
  if (['invalid-argument', 'failed-precondition', 'not-found', 'already-exists', 'aborted', 'cancelled'].includes(code)) return null;
  if (error?.name === 'AbortError' || /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|timed? ?out/i.test(`${error?.message || ''} ${error?.cause?.code || ''}`)) return 'unreachable';
  if (error instanceof SyntaxError || error instanceof TypeError || /without any|unexpected|format/i.test(error?.message || '')) return 'changed';
  if (error instanceof HuckleberryError && !['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'resource-exhausted'].includes(code)) return null;
  return 'unreachable';
}
export function createHealth({ db, now = () => new Date() } = {}) {
  const lastOk = new Map(), ref = service => db.doc(`serviceHealth/${service}`);
  async function ok(service) {
    const t = +now();
    if (t - (lastOk.get(service) || 0) < OK_EVERY) return;
    lastOk.set(service, t);
    try { await ref(service).set({ service, lastOk:new Date(t).toISOString(), failingSince:null, problem:null, failures:0 }, { merge:true }); }
    catch { lastOk.delete(service); }
  }
  async function fail(service, problem) {
    if (!problem) return;
    lastOk.delete(service); // the next success is written right away, clearing the warning
    const at = new Date(+now()).toISOString();
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref(service)), current = snap.exists ? snap.data() : {};
        tx.set(ref(service), { service, lastError:at, problem, failingSince:current.failingSince || at, failures:(current.failures || 0) + 1 }, { merge:true });
      });
    } catch { /* never let bookkeeping break the request */ }
  }
  // Runs a call and records how it went (user mistakes aren't counted as failures).
  async function track(service, run) {
    try { const result = await run(); await ok(service); return result; }
    catch (error) { await fail(service, classifyFailure(error)); throw error; }
  }
  return { ok, fail, track };
}
