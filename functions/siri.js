// "Hey Siri, Frankie log": an Apple Shortcut sends what was said to the `siri`
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
// Forgiving on purpose: Shortcuts are typed by hand on a phone. The key is found
// in the Authorization header with or without "Bearer" (any case), in an
// X-Siri-Key header, or in a JSON "key" field; quotes and invisible characters
// picked up when pasting are ignored. A key is "hh_" + 43 base64url characters.
const KEY_PATTERN = /hh_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
const clean = value => String(value ?? '').replace(/[\u200B-\u200D\u2060\uFEFF"'“”‘’<>]/g, '');
export function readKey(headers = {}, body = {}) {
  for (const value of [headers.authorization, headers.Authorization, headers['x-siri-key'], body?.key]) {
    const match = clean(value).match(KEY_PATTERN);
    if (match) return match[0];
  }
  return null;
}
// Shortcuts bodies vary with how the action was set up: JSON, a form, plain
// text, or raw bytes; field names may be capitalized; "confirm" may be a
// Boolean or the text "True". Read the words and the confirmation either way.
export function readRequest(raw) {
  let body = raw;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { const text = body.trim(); try { body = JSON.parse(text); } catch { body = { text }; } }
  if (!body || typeof body !== 'object') body = {};
  const lower = Object.fromEntries(Object.entries(body).map(([key, value]) => [key.trim().toLowerCase(), value]));
  let text = ['text', 'input', 'message', 'log', 'say'].map(key => lower[key]).find(value => typeof value === 'string' && value.trim());
  // One unrecognized text field (e.g. a misnamed key): use it.
  if (!text) { const strings = Object.entries(lower).filter(([key, value]) => !['key', 'confirm'].includes(key) && typeof value === 'string' && value.trim() && !/^hh_/.test(value.trim())); if (strings.length === 1) text = strings[0][1]; }
  const confirm = lower.confirm === true || (typeof lower.confirm === 'string' && /^(true|yes|1)$/i.test(lower.confirm.trim()));
  return { text:String(text || '').trim(), confirm, key:lower.key, fields:Object.keys(lower) };
}
// Dictation spells some numbers out ("five ounces at five fifteen") and drops the colon
// in times ("at 515"). Turn those into what the parser reads: "5 ounces at 5:15".
const ONES = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19 };
const TENS = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
export function normalizeSpeech(text) {
  let out = ` ${String(text || '')} `;
  out = out.replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})(?:[\\s-]+(${Object.keys(ONES).filter(w => ONES[w] && ONES[w] < 10).join('|')}))?\\b`, 'gi'), (_, tens, ones) => String(TENS[tens.toLowerCase()] + (ones ? ONES[ones.toLowerCase()] : 0)));
  out = out.replace(new RegExp(`\\b(${Object.keys(ONES).join('|')})\\b`, 'gi'), word => String(ONES[word.toLowerCase()]));
  out = out.replace(/\b(\d+) oh (\d)\b/gi, '$1 0$2'); // "five oh five" → 5 05
  out = out.replace(/\b(\d+) and a half\b/gi, (_, n) => `${n}.5`);
  out = out.replace(/\bmillilit(?:er|re)s?\b/gi, 'ml').replace(/\b(\d) (\d{2}) ?ml\b/gi, '$1$2 ml'); // "one twenty ml" → 120 ml
  const clock = (h, m) => Number(h) >= 1 && Number(h) <= 12 && Number(m) < 60;
  out = out.replace(/\b(at|from|to|until|til|till) (\d{1,2}) (\d{2})\b/gi, (all, word, h, m) => clock(h, m) ? `${word} ${h}:${m}` : all);
  out = out.replace(/\b(at|from|to|until|til|till) (\d{1,2})(\d{2})\b/gi, (all, word, h, m) => clock(h, m) ? `${word} ${h}:${m}` : all);
  out = out.replace(/\b(\d{1,2}) (\d{2}) ?(am|pm|a\.m\.|p\.m\.)/gi, (all, h, m, ampm) => clock(h, m) ? `${h}:${m} ${ampm}` : all);
  return out.replace(/\s+/g, ' ').trim();
}
// When nothing could be read, say back exactly what arrived, so a shortcut sending
// the wrong thing (the question, the shortcut's name) is easy to spot.
export function notUnderstood(said) {
  const heard = said.length > 80 ? `${said.slice(0, 77)}…` : said;
  if (/what should i log/i.test(said)) return `I received the question “${heard}” instead of your answer. In Get Contents of URL, set the text field to Provided Input.`;
  if (/^(hey siri,? )?frankie log\.?$/i.test(said)) return 'I received the shortcut’s name instead of your answer. In Get Contents of URL, set the text field to Provided Input from Ask for Input.';
  return `I heard “${heard}”, but couldn’t tell what to log. Try “5 ounces at 5:15”, “dirty diaper”, “pumped left 2, right 2.5”, “fell asleep at 2:40” or “woke up”.`;
}
export const EMPTY_TEXT_HINT = 'I got your request but no words. In Get Contents of URL, set the text field to Provided Input from Ask for Input, not Shortcut Input.';
// Why no key was found, in words Siri can say.
export function missingKeyHint(headers = {}, body = {}) {
  const auth = clean(headers.authorization || headers.Authorization || headers['x-siri-key'] || body?.key || '').trim();
  if (!auth) return 'This shortcut needs your Siri key. In Get Contents of URL, add a header named Authorization with the value Bearer, a space, then your key from Hubert’s House settings.';
  if (!/hh_/.test(auth)) return 'I found an Authorization header but no Siri key in it. The value should be Bearer, a space, then your key, which starts with h h underscore.';
  return 'Your Siri key looks cut off or has extra characters. Copy it again from Hubert’s House settings, or make a new key.';
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
  const words = normalizeSpeech(said);
  const log = parseBabyLog(/\b(frankie|baby)\b/i.test(words) ? words : `frankie ${words}`, now);
  if (!log) throw new SiriError(notUnderstood(said));
  const entry = { kind:log.kind, start:log.start.toISOString(), requestId:requestId(keyHash, said, now) };
  const name = snapshot?.name || 'Frankie';
  if (log.kind === 'pump') {
    // Both sides are required: Huckleberry's single-total pump format isn't confirmed, so it's never written.
    if (log.left == null) throw new SiriError(log.amount ? `How much from each side? Try “pumped left 2, right ${Math.max(0, log.amount - 2)}”.` : 'How much from each side? Try “pumped left 2 ounces, right 2 and a half”.');
    const both = log.left + log.right;
    if (!(both > 0)) throw new SiriError('That adds up to nothing. Try “pumped left 2, right 2 and a half”.');
    Object.assign(entry, { left:log.left, right:log.right, units:log.units, ...(log.minutes ? { minutes:log.minutes } : {}) });
    const u = n => UNITS[log.units][n === 1 ? 0 : 1], total = Math.round(both * 100) / 100;
    return { entry, speak:`Log a pump at ${clock(log.start)}: left ${log.left} ${u(log.left)}, right ${log.right} ${u(log.right)}, ${total} in all?`, done:`Logged ${total} ${u(total)} pumped at ${clock(log.start)}: left ${log.left}, right ${log.right}.` };
  }
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

export const SLOW_SNAPSHOT = 'Huckleberry is slow to answer right now. Nothing was logged. Try again in a minute.';
export const SLOW_WRITE = 'Huckleberry is slow to answer. It may still save, so check Huckleberry before you try again.';
// The HTTPS handler. deps: db (Firestore), huckleberry(uid, input), members() → uids, now().
// Siri must always get JSON back: if Huckleberry is slow, answer in words before the
// Shortcut (or the platform) gives up and returns an error page instead.
export function createSiriHandler({ db, huckleberry, members, now = () => new Date(), budgetMs = 40000 }) {
  return async (request, response) => {
    const started = Date.now();
    const reply = (status, body) => { if (!response.headersSent) response.status(status).json(body); };
    const inTime = (promise, message) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new SiriError(message)), Math.max(1000, budgetMs - (Date.now() - started))); })]).finally(() => clearTimeout(timer)); };
    try {
      if (request.method !== 'POST') return reply(405, { ok:false, speak:'Hubert only listens to the Frankie log shortcut.' });
      const body = readRequest(request.body);
      const key = readKey(request.headers, body);
      if (!key) return reply(401, { ok:false, speak:missingKeyHint(request.headers, body) });
      const keyHash = hashSiriKey(key), keyRef = db.doc(`siriKeys/${keyHash}`), record = await keyRef.get();
      if (!record.exists) return reply(401, { ok:false, speak:'That Siri key isn’t valid anymore. Make a new one in Hubert’s House settings.' });
      const owner = record.data().uid;
      // The caller must still be a member, even when their Siri key exists.
      if (!(await members()).includes(owner)) return reply(403, { ok:false, speak:'This Siri key no longer has household access.' });
      let snapshot;
      try { snapshot = await inTime(huckleberry(owner, { action:'snapshot', light:true }), SLOW_SNAPSHOT); } catch (error) { if (error instanceof SiriError) throw error; }
      if (!snapshot?.childId) return reply(409, { ok:false, speak:'Hubert can’t reach Huckleberry right now. Check the connection in settings.' });
      if (!body.text) return reply(200, { ok:false, speak:EMPTY_TEXT_HINT });
      const plan = planSiriLog({ text:body.text, snapshot, now:now(), keyHash });
      await keyRef.update({ lastUsedAt:now().toISOString() }).catch(() => {});
      if (!body.confirm) return reply(200, { ok:true, needsConfirm:true, speak:plan.speak });
      await inTime(huckleberry(owner, { action:'write', childId:snapshot.childId, connectionVersion:snapshot.connection?.connectionVersion, entry:plan.entry }), SLOW_WRITE);
      return reply(200, { ok:true, saved:true, speak:plan.done });
    } catch (error) {
      if (error instanceof SiriError) return reply(200, { ok:false, speak:error.message });
      return reply(200, { ok:false, speak:error?.code === 'aborted' ? 'Huckleberry changed while I was saving. Try again.' : 'Hubert couldn’t save that to Huckleberry. Try again in a minute.' });
    }
  };
}
