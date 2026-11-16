// "Hey Siri, ping Hubert": an Apple Shortcut sends what was said to the `siri`
// HTTPS function with a personal key. The text is parsed with the same code as
// the app's quick-add bar, read back for confirmation, then saved through the
// existing guarded Huckleberry write path (createHuckleberryHandler).
import { createHash, randomBytes } from 'node:crypto';
import { parseBabyLog } from './shared/quick-add.js';

export const SIRI_TZ = 'America/New_York';
export class SiriError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// Keys are random 32-byte secrets shown once; only their SHA-256 is stored.
export const newSiriKey = () => `hh_${randomBytes(32).toString('base64url')}`;
export const hashSiriKey = key => createHash('sha256').update(String(key)).digest('hex');
export function readKey(headers = {}, body = {}) {
  const auth = String(headers.authorization || headers.Authorization || '');
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(body.key || '').trim();
  return /^hh_[A-Za-z0-9_-]{40,60}$/.test(key) ? key : null;
}

const clock = date => date.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone:SIRI_TZ });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const UNITS = { oz:['ounce', 'ounces'], ml:['milliliter', 'milliliters'] };
// Same idempotency idea as the app: a stable request ID per key + text + 10-minute slot,
// so an accidental double-run of the Shortcut cannot save two bottles.
function requestId(keyHash, text, now) {
  const h = createHash('sha256').update(`${keyHash}|${text.toLowerCase().trim()}|${Math.floor(+now / 600000)}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Turn what was said into a Huckleberry entry and the sentence Siri reads back.
export function planSiriLog({ text, snapshot, now = new Date(), keyHash = '' }) {
  const said = String(text || '').trim().slice(0, 200);
  if (!said) throw new SiriError('I didn’t hear anything. Try “5 ounces at 5:15”.');
  // Frankie is implied: "5 ounces at 5:15" means Frankie's bottle.
  const log = parseBabyLog(/\b(frankie|baby)\b/i.test(said) ? said : `frankie ${said}`, now);
  if (!log) throw new SiriError('I didn’t catch that. Try “5 ounces at 5:15”, “dirty diaper”, “fell asleep at 2:40” or “woke up”.');
  const entry = { kind:log.kind, start:log.start.toISOString(), requestId:requestId(keyHash, said, now) };
  const name = snapshot?.name || 'Frankie';
  if (log.kind === 'bottle') {
    const last = latestBottle(snapshot);
    const amount = log.amount ?? last?.amount, units = log.units || last?.units || 'oz', type = log.bottleType || last?.type || 'Formula';
    if (!amount) throw new SiriError('How much? Try “4 ounces at 3:15”.');
    Object.assign(entry, { amount, units, bottleType:type });
    const unit = UNITS[units][amount === 1 ? 0 : 1];
    // "a 5-ounce bottle" (adjective) but "Logged 5 ounces".
    return { entry, speak:`Log a ${amount}-${UNITS[units][0]} ${type.toLowerCase()} bottle for ${name} at ${clock(log.start)}?`, done:`Logged ${amount} ${unit} of ${type.toLowerCase()} at ${clock(log.start)}.` };
  }
  if (log.kind === 'diaper') {
    if (!log.mode) throw new SiriError('Was it wet, dirty, both or dry?');
    entry.mode = log.mode;
    const kind = { pee:'wet', poo:'dirty', both:'wet and dirty', dry:'dry' }[log.mode];
    return { entry, speak:`Log a ${kind} diaper for ${name} at ${clock(log.start)}?`, done:`Logged a ${kind} diaper at ${clock(log.start)}.` };
  }
  if (log.kind === 'sleep-log') {
    entry.end = log.end.toISOString();
    const minutes = Math.round((log.end - log.start) / 60000), length = minutes >= 60 ? `${plural(Math.floor(minutes / 60), 'hour')}${minutes % 60 ? ` ${plural(minutes % 60, 'minute')}` : ''}` : plural(minutes, 'minute');
    return { entry, speak:`Log a ${length} sleep for ${name}, ${clock(log.start)} to ${clock(log.end)}?`, done:`Logged ${length} of sleep.` };
  }
  const timer = snapshot?.timer;
  if (log.kind === 'sleep-start') {
    if (timer?.active) throw new SiriError(`${name}’s sleep timer is already running. Say “woke up” to finish it.`);
    return { entry, speak:`Start ${name}’s sleep timer from ${clock(log.start)}?`, done:`Sleep timer started at ${clock(log.start)}. Sweet dreams.` };
  }
  if (!timer?.active) throw new SiriError(`${name} isn’t on a sleep timer right now.`);
  Object.assign(entry, { timerId:timer.uuid, expectedStart:timer.start });
  return { entry, speak:`Finish ${name}’s sleep at ${clock(log.start)}?`, done:`Sleep saved. ${name} woke at ${clock(log.start)}.` };
}
function latestBottle(snapshot) {
  const history = snapshot?.bottles?.at(-1), prefs = snapshot?.lastBottle;
  if (prefs?.time && (!history || Date.parse(prefs.time) > Date.parse(history.start))) return { amount:prefs.amount, units:prefs.units, type:prefs.type };
  return history ? { amount:history.amount, units:history.units, type:history.type } : null;
}

// The HTTPS handler. deps: db (Firestore), huckleberry(uid, input), members() → uids, now().
export function createSiriHandler({ db, huckleberry, members, now = () => new Date() }) {
  return async (request, response) => {
    const reply = (status, body) => response.status(status).json(body);
    try {
      if (request.method !== 'POST') return reply(405, { ok:false, speak:'Hubert only listens to the Ping Hubert shortcut.' });
      const body = typeof request.body === 'object' && request.body ? request.body : {};
      const key = readKey(request.headers, body);
      if (!key) return reply(401, { ok:false, speak:'This shortcut needs your Siri key from Hubert’s House settings.' });
      const keyHash = hashSiriKey(key), keyRef = db.doc(`siriKeys/${keyHash}`), record = await keyRef.get();
      if (!record.exists) return reply(401, { ok:false, speak:'That Siri key isn’t valid anymore. Make a new one in Hubert’s House settings.' });
      const owner = record.data().uid;
      // The caller must still be a member, even when their Siri key exists.
      if (!(await members()).includes(owner)) return reply(403, { ok:false, speak:'This Siri key no longer has household access.' });
      let snapshot;
      try { snapshot = await huckleberry(owner, { action:'snapshot' }); } catch { /* handled below */ }
      if (!snapshot?.childId) return reply(409, { ok:false, speak:'Hubert can’t reach Huckleberry right now. Check the connection in settings.' });
      const plan = planSiriLog({ text:body.text, snapshot, now:now(), keyHash });
      await keyRef.update({ lastUsedAt:now().toISOString() }).catch(() => {});
      if (body.confirm !== true) return reply(200, { ok:true, needsConfirm:true, speak:plan.speak });
      await huckleberry(owner, { action:'write', childId:snapshot.childId, connectionVersion:snapshot.connection?.connectionVersion, entry:plan.entry });
      return reply(200, { ok:true, saved:true, speak:plan.done });
    } catch (error) {
      if (error instanceof SiriError) return reply(200, { ok:false, speak:error.message });
      return reply(200, { ok:false, speak:error?.code === 'aborted' ? 'Huckleberry changed while I was saving. Try again.' : 'Hubert couldn’t save that to Huckleberry. Try again in a minute.' });
    }
  };
}
