// PetLibro feeders for the Devices page. PetLibro has no public API; this follows the
// community clients (Home Assistant's PETLIBRO integration, node "petlibro-api"):
// POST JSON to api.us.petlibro.com with a `token` header from /member/auth/login.
// PetLibro allows one signed-in session per account, so the household connects a
// second PetLibro account that the feeders are shared with (otherwise the phone app
// would be signed out). Tokens expire without a refresh token, so the password's MD5
// (what PetLibro's login takes) is kept encrypted to sign in again; the password itself is not.
import { createHash, randomUUID } from 'node:crypto';

export class PetLibroError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new PetLibroError(code, message); };
const BASE = 'https://api.us.petlibro.com';
const APP = { appId:1, appSn:'c35772530d1041699c87fe62348507a8' }; // the Android app's public identifiers
const EXPIRED = 1009, CACHE_MS = 2 * 60000;
export const md5 = text => createHash('md5').update(String(text)).digest('hex');
const text = (value, max = 60) => String(value ?? '').slice(0, max);
// The first field that is present, from a few names the API has used.
const pick = (data, ...keys) => { for (const key of keys) if (data?.[key] !== undefined && data[key] !== null && data[key] !== '') return data[key]; return undefined; };
const bool = value => value === true || value === 1 || value === '1' || value === 'true';

export function createPetLibroClient({ fetch = globalThis.fetch, timezone = 'America/New_York' } = {}) {
  async function post(path, body, token) {
    const response = await fetch(`${BASE}${path}`, { method:'POST', body:JSON.stringify(body ?? {}), signal:AbortSignal.timeout(15000),
      headers:{ 'content-type':'application/json', source:'ANDROID', language:'EN', timezone, version:'1.3.45', ...(token ? { token } : {}) } });
    if (!response.ok) fail('unavailable', `PetLibro didn’t answer (${response.status}). Try again in a minute.`);
    const data = await response.json().catch(() => null);
    if (typeof data === 'number') return data; // some commands answer with a bare number
    if (data?.code === EXPIRED) fail('unauthenticated', 'PetLibro signed this house out.');
    if (data?.code !== 0) fail('unavailable', `PetLibro said: ${text(data?.msg || 'something went wrong', 120)}.`);
    return data.data;
  }
  return {
    async login(email, passwordHash) {
      const response = await fetch(`${BASE}/member/auth/login`, { method:'POST', signal:AbortSignal.timeout(15000), headers:{ 'content-type':'application/json', source:'ANDROID', language:'EN', timezone, version:'1.3.45' },
        body:JSON.stringify({ ...APP, country:'US', email, password:passwordHash, phoneBrand:'', phoneSystemVersion:'', timezone, thirdId:null, type:null }) });
      const data = await response.json().catch(() => null);
      if (data?.code === 0 && data.data?.token) return String(data.data.token);
      if (!response.ok && response.status >= 500) fail('unavailable', 'PetLibro sign-in isn’t answering right now. Try again in a minute.');
      fail('permission-denied', 'PetLibro didn’t accept that email and password. Use the second account the feeders are shared with.');
    },
    devices:token => post('/device/device/list', {}, token),
    realInfo:(token, sn) => post('/device/device/realInfo', { id:sn, deviceSn:sn }, token),
    grainStatus:(token, sn) => post('/device/data/grainStatus', { id:sn, deviceSn:sn }, token),
    feed:(token, sn, portions) => post('/device/device/manualFeeding', { id:sn, deviceSn:sn, grainNum:portions, requestId:randomUUID().replace(/-/g, '') }, token)
  };
}

// One feeder in a simple shape. Readings PetLibro doesn't send stay null and are hidden.
export function readFeeder(device = {}, info = {}, grain = {}) {
  const all = { ...device, ...info };
  const battery = Number(pick(all, 'electricQuantity', 'batteryPercent'));
  const surplus = pick(all, 'surplusGrain'), outlet = pick(all, 'grainOutletState'), product = text(pick(all, 'productName', 'productIdentifier') || 'Feeder');
  const quantity = Number(pick(grain || {}, 'todayFeedingQuantity', 'todayFeedingQuantities')), times = Number(pick(grain || {}, 'todayFeedingTimes'));
  const online = pick(all, 'online');
  return { id:text(pick(all, 'deviceSn'), 80), name:text(pick(all, 'name', 'deviceName') || product), product, online:online === undefined ? null : bool(online),
    foodLow:surplus === undefined ? null : !bool(surplus), dispenserBlocked:outlet === undefined ? null : !bool(outlet),
    battery:Number.isFinite(battery) && battery >= 0 && battery <= 100 ? Math.round(battery) : null,
    todayPortions:Number.isFinite(quantity) ? quantity : null, todayFeeds:Number.isFinite(times) ? times : null, isFeeder:!/fountain|dockstream|water/i.test(product) };
}

export function createPetLibro({ db, key, encrypt, decrypt, client = createPetLibroClient(), now = Date.now, log = () => {} }) {
  const ref = db.doc('privatePetLibro/household'), owner = 'petlibro:household';
  async function session() {
    const snap = await ref.get(), record = snap.exists ? snap.data() : null;
    if (!record?.credential) fail('failed-precondition', 'Connect PetLibro in Settings first.');
    return { record, secret:decrypt(record.credential, key(), owner) };
  }
  // Run with the saved token; if PetLibro says it expired, sign in again once.
  async function withToken(work) {
    const { record, secret } = await session();
    try { return await work(secret.token, record); }
    catch (error) {
      if (error.code !== 'unauthenticated') throw error;
      let token;
      try { token = await client.login(secret.email, secret.passwordHash); }
      catch (again) { await ref.set({ needsReconnect:true }, { merge:true }); throw new PetLibroError('unauthenticated', 'PetLibro signed this house out. Connect it again in Settings.'); }
      await ref.set({ credential:encrypt({ ...secret, token }, key(), owner), needsReconnect:false }, { merge:true });
      return work(token, record);
    }
  }
  async function readAll(token) {
    const list = (await client.devices(token)) || [];
    const devices = (Array.isArray(list) ? list : []).filter(device => device?.deviceSn).slice(0, 8);
    const feeders = await Promise.all(devices.map(async device => {
      const [info, grain] = await Promise.all([client.realInfo(token, device.deviceSn).catch(error => { if (error.code === 'unauthenticated') throw error; return {}; }),
        client.grainStatus(token, device.deviceSn).catch(error => { if (error.code === 'unauthenticated') throw error; return {}; })]);
      return { feeder:readFeeder(device, info, grain), keys:Object.keys({ ...device, ...(info || {}) }).sort() };
    }));
    // Field names only (never values), to adjust the parser if PetLibro changes them.
    if (feeders.length) log('PetLibro fields', { fields:[...new Set(feeders.flatMap(item => item.keys))].slice(0, 80) });
    return { feeders:feeders.map(item => item.feeder), checkedAt:new Date(now()).toISOString() };
  }
  return {
    async status() {
      const snap = await ref.get(), record = snap.exists ? snap.data() : null;
      return { connected:!!record?.credential, needsReconnect:record?.needsReconnect === true, connectedAt:record?.connectedAt || null };
    },
    async connect(uid, { email, password }) {
      const address = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) fail('invalid-argument', 'Enter the PetLibro account email.');
      if (!password || String(password).length > 200) fail('invalid-argument', 'Enter the PetLibro account password.');
      const passwordHash = md5(password), token = await client.login(address, passwordHash);
      const first = await readAll(token);
      await ref.set({ credential:encrypt({ email:address, passwordHash, token }, key(), owner), connectedAt:new Date(now()).toISOString(), connectedBy:uid, needsReconnect:false, cache:first });
      return { connected:true, ...first };
    },
    async disconnect() { await ref.delete(); return { connected:false }; },
    async snapshot({ force = false } = {}) {
      const snap = await ref.get(), cache = snap.exists ? snap.data()?.cache : null;
      if (!force && cache?.checkedAt && now() - Date.parse(cache.checkedAt) < CACHE_MS && snap.data()?.credential) return { connected:true, ...cache };
      const fresh = await withToken(token => readAll(token));
      await ref.set({ cache:fresh }, { merge:true });
      return { connected:true, ...fresh };
    },
    async feed(feederId, portions) {
      const amount = Math.round(Number(portions));
      if (!(amount >= 1 && amount <= 6)) fail('invalid-argument', 'Choose 1 to 6 portions.');
      return withToken(async token => {
        const list = (await client.devices(token)) || [], device = list.find(item => item?.deviceSn === String(feederId || ''));
        if (!device) fail('not-found', 'That feeder is no longer on the PetLibro account. Refresh the page.');
        await client.feed(token, device.deviceSn, amount);
        await ref.set({ cache:null }, { merge:true });
        return { ok:true, name:text(device.name || device.productName || 'Feeder'), portions:amount };
      });
    }
  };
}
