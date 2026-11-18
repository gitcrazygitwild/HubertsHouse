// Smart home: Philips Hue and Sonos through their official cloud APIs.
// - The household registers its own free developer app with each company and pastes
//   the app's client ID and secret into Settings (stored encrypted, never returned).
//   Nothing lives in Secret Manager, so a deploy can't fail for a missing secret.
// - "Connect" sends one adult through the company's own sign-in page (OAuth). The
//   tokens are encrypted and shared by the household, like the Huckleberry link.
// - Hubert's House never sees the household's Hue or Sonos password.
import { randomBytes } from 'node:crypto';

export class SmartHomeError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new SmartHomeError(code, message); };
export const PROVIDERS = ['hue', 'sonos'];
const STATE_MINUTES = 10, REFRESH_EARLY = 120000;
const HUE = { authorize:'https://api.meethue.com/v2/oauth2/authorize', token:'https://api.meethue.com/v2/oauth2/token', route:'https://api.meethue.com/route' };
const SONOS = { authorize:'https://api.sonos.com/login/v3/oauth', token:'https://api.sonos.com/login/v3/oauth/access', control:'https://api.ws.sonos.com/control/api/v1' };
export const providerName = provider => provider === 'hue' ? 'Philips Hue' : 'Sonos';
const checkProvider = provider => { if (!PROVIDERS.includes(provider)) fail('invalid-argument', 'Choose Philips Hue or Sonos.'); return provider; };
const id = value => { if (typeof value !== 'string' || !/^(?!\.)[\w.:-]{1,200}$/.test(value)) fail('invalid-argument', 'That device is no longer available. Refresh the page.'); return value; };

export function validateApp(input = {}) {
  const clientId = String(input.clientId || '').trim(), clientSecret = String(input.clientSecret || '').trim();
  if (!/^[\w.-]{8,200}$/.test(clientId)) fail('invalid-argument', 'Paste the client ID (Hue) or key (Sonos) from the developer site.');
  if (!/^[\w.-]{8,200}$/.test(clientSecret)) fail('invalid-argument', 'Paste the client secret from the developer site.');
  return { clientId, clientSecret };
}
export function authorizeUrl(provider, { clientId, state, redirectUri }) {
  if (provider === 'hue') return `${HUE.authorize}?${new URLSearchParams({ client_id:clientId, response_type:'code', state })}`;
  return `${SONOS.authorize}?${new URLSearchParams({ client_id:clientId, response_type:'code', state, scope:'playback-control-all', redirect_uri:redirectUri })}`;
}
// One token request for both companies: Basic auth with the app's ID and secret.
export async function tokenRequest(provider, app, form, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  const response = await fetch(provider === 'hue' ? HUE.token : SONOS.token, {
    method:'POST', headers:{ authorization:`Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`, 'content-type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams(form).toString(), signal:AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) fail(response.status === 400 || response.status === 401 ? 'permission-denied' : 'unavailable',
    `${providerName(provider)} didn’t accept the sign-in. ${response.status === 401 ? 'Check the client ID and secret in Settings.' : 'Try connecting again.'}`);
  return { accessToken:data.access_token, refreshToken:data.refresh_token || form.refresh_token || null, expiresAt:now + Math.max(60, Number(data.expires_in) || 3600) * 1000 };
}

// ---------- Hue (CLIP v2 through the remote route) ----------
async function hueFetch(fetch, tokens, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${HUE.route}${path}`, { method, headers:{ authorization:`Bearer ${tokens.accessToken}`, ...(tokens.username ? { 'hue-application-key':tokens.username } : {}), ...(body ? { 'content-type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(15000) });
  if (response.status === 401) fail('unauthenticated', 'Philips Hue signed this house out. Connect it again in Settings.');
  const data = await response.json().catch(() => null);
  if (!response.ok) fail('unavailable', `Philips Hue didn’t answer (${response.status}). Is the bridge online?`);
  return data;
}
// After sign-in the bridge needs an app key ("username"): press the virtual link button, then register.
export async function hueRegister(tokens, { fetch = globalThis.fetch } = {}) {
  await hueFetch(fetch, tokens, '/api/0/config', { method:'PUT', body:{ linkbutton:true } });
  const result = await hueFetch(fetch, tokens, '/api', { method:'POST', body:{ devicetype:'huberts_house#cloud' } });
  const username = Array.isArray(result) ? result.find(item => item?.success?.username)?.success.username : null;
  if (!username) fail('failed-precondition', 'The Hue bridge didn’t give Hubert’s House access. Make sure the bridge is online and try connecting again.');
  return username;
}
export async function hueDevices(tokens, { fetch = globalThis.fetch } = {}) {
  const [rooms, groups, scenes] = await Promise.all(['room', 'grouped_light', 'scene'].map(kind => hueFetch(fetch, tokens, `/clip/v2/resource/${kind}`)));
  const lightOf = new Map((groups?.data || []).map(group => [group.id, group]));
  return { rooms:(rooms?.data || []).map(room => {
    const groupId = room.services?.find(service => service.rtype === 'grouped_light')?.rid, group = lightOf.get(groupId);
    return { id:room.id, name:String(room.metadata?.name || 'Room').slice(0, 60), archetype:room.metadata?.archetype || '', groupId:groupId || null,
      on:!!group?.on?.on, brightness:Math.round(group?.dimming?.brightness ?? 0),
      scenes:(scenes?.data || []).filter(scene => scene.group?.rid === room.id).map(scene => ({ id:scene.id, name:String(scene.metadata?.name || 'Scene').slice(0, 40) })).sort((a, b) => a.name.localeCompare(b.name)) };
  }).filter(room => room.groupId).sort((a, b) => a.name.localeCompare(b.name)) };
}
export function hueCommand(command = {}) {
  if (command.type === 'power') return { path:`/clip/v2/resource/grouped_light/${id(command.target)}`, body:{ on:{ on:command.on === true } } };
  if (command.type === 'brightness') { const level = Math.round(Number(command.level)); if (!(level >= 1 && level <= 100)) fail('invalid-argument', 'Choose a brightness from 1 to 100.'); return { path:`/clip/v2/resource/grouped_light/${id(command.target)}`, body:{ on:{ on:true }, dimming:{ brightness:level } } }; }
  if (command.type === 'scene') return { path:`/clip/v2/resource/scene/${id(command.target)}`, body:{ recall:{ action:'active' } } };
  fail('invalid-argument', 'That isn’t a light command.');
}

// ---------- Sonos (Control API) ----------
async function sonosFetch(fetch, tokens, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${SONOS.control}${path}`, { method, headers:{ authorization:`Bearer ${tokens.accessToken}`, ...(body ? { 'content-type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(15000) });
  if (response.status === 401) fail('unauthenticated', 'Sonos signed this house out. Connect it again in Settings.');
  if (response.status === 410 || response.status === 404) fail('aborted', 'Your speakers were regrouped. Refresh the page.');
  const text = await response.text().catch(() => '');
  if (!response.ok) fail('unavailable', `Sonos didn’t answer (${response.status}). Are the speakers online?`);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}
export async function sonosDevices(tokens, { fetch = globalThis.fetch } = {}) {
  const { households = [] } = await sonosFetch(fetch, tokens, '/households');
  const household = households[0]?.id;
  if (!household) return { household:null, groups:[], favorites:[] };
  const [{ groups = [] }, favorites] = await Promise.all([sonosFetch(fetch, tokens, `/households/${encodeURIComponent(household)}/groups`), sonosFetch(fetch, tokens, `/households/${encodeURIComponent(household)}/favorites`).catch(() => ({ items:[] }))]);
  const details = await Promise.all(groups.map(async group => {
    const [volume, meta] = await Promise.all([sonosFetch(fetch, tokens, `/groups/${encodeURIComponent(group.id)}/groupVolume`).catch(() => ({})), sonosFetch(fetch, tokens, `/groups/${encodeURIComponent(group.id)}/playbackMetadata`).catch(() => ({}))]);
    const track = meta.currentItem?.track || {};
    return { id:group.id, name:String(group.name || 'Speaker').slice(0, 60), playing:group.playbackState === 'PLAYBACK_STATE_PLAYING', volume:Number.isFinite(volume.volume) ? volume.volume : null, muted:!!volume.muted,
      track:track.name ? { name:String(track.name).slice(0, 120), artist:String(track.artist?.name || '').slice(0, 80), image:/^https:\/\//.test(track.imageUrl || '') ? track.imageUrl : null } : null,
      source:String(meta.container?.name || '').slice(0, 80) };
  }));
  return { household, groups:details.sort((a, b) => a.name.localeCompare(b.name)), favorites:(favorites.items || []).slice(0, 24).map(item => ({ id:String(item.id), name:String(item.name || 'Favorite').slice(0, 60) })) };
}
export function sonosCommand(command = {}) {
  const group = `/groups/${encodeURIComponent(id(command.target))}`;
  const actions = { toggle:'playback/togglePlayPause', next:'playback/skipToNextTrack', previous:'playback/skipToPreviousTrack' };
  if (actions[command.type]) return { path:`${group}/${actions[command.type]}`, body:{} };
  if (command.type === 'volume') { const volume = Math.round(Number(command.level)); if (!(volume >= 0 && volume <= 100)) fail('invalid-argument', 'Choose a volume from 0 to 100.'); return { path:`${group}/groupVolume`, body:{ volume } }; }
  if (command.type === 'favorite') return { path:`${group}/favorites`, body:{ favoriteId:id(command.favorite), playOnCompletion:true } };
  fail('invalid-argument', 'That isn’t a speaker command.');
}

// ---------- The household service (Firestore + encryption injected for tests) ----------
// db: Firestore; key(): encryption key; encrypt/decrypt from crypto.js; redirectUri: this
// deployment's smartHomeAuth URL; members(): active member uids.
export function createSmartHome({ db, key, encrypt, decrypt, redirectUri, fetch = globalThis.fetch, now = Date.now }) {
  const doc = provider => db.doc(`privateSmartHome/${provider}`);
  const owner = provider => `smart-home:${provider}`;
  const load = async provider => { const snap = await doc(provider).get(); return snap.exists ? snap.data() : null; };
  async function tokensFor(provider) {
    const record = await load(provider);
    if (!record?.app) fail('failed-precondition', `Add the ${providerName(provider)} app details in Settings first.`);
    if (!record.tokens) fail('failed-precondition', `Connect ${providerName(provider)} in Settings first.`);
    const app = decrypt(record.app, key(), owner(provider)); let tokens = decrypt(record.tokens, key(), owner(provider));
    if (tokens.expiresAt - now() < REFRESH_EARLY && tokens.refreshToken) {
      const fresh = await tokenRequest(provider, app, { grant_type:'refresh_token', refresh_token:tokens.refreshToken }, { fetch, now:now() });
      tokens = { ...tokens, ...fresh };
      await doc(provider).set({ tokens:encrypt(tokens, key(), owner(provider)), refreshedAt:new Date(now()).toISOString() }, { merge:true });
    }
    return tokens;
  }
  return {
    async status() {
      const out = {};
      for (const provider of PROVIDERS) { const record = await load(provider); out[provider] = { appSaved:!!record?.app, connected:!!record?.tokens, connectedAt:record?.connectedAt || null, connectedBy:record?.connectedBy || null }; }
      return { ...out, redirectUri };
    },
    async saveApp(uid, provider, input) {
      checkProvider(provider);
      await doc(provider).set({ app:encrypt(validateApp(input), key(), owner(provider)), tokens:null, connectedAt:null, appSavedBy:uid, appSavedAt:new Date(now()).toISOString() }, { merge:true });
      return this.status();
    },
    async startAuth(uid, provider) {
      checkProvider(provider);
      const record = await load(provider);
      if (!record?.app) fail('failed-precondition', `Add the ${providerName(provider)} app details first.`);
      const app = decrypt(record.app, key(), owner(provider)), state = randomBytes(24).toString('base64url');
      await db.doc(`privateSmartHomeState/${state}`).set({ provider, uid, createdAt:new Date(now()).toISOString() });
      return { url:authorizeUrl(provider, { clientId:app.clientId, state, redirectUri }) };
    },
    // The company redirects here with ?code&state after sign-in. Returns where to send the browser.
    async finishAuth({ code, state, error }) {
      if (typeof state !== 'string' || !/^[\w-]{20,64}$/.test(state)) return { ok:false, message:'That sign-in link is not valid.' };
      const ref = db.doc(`privateSmartHomeState/${state}`), snap = await ref.get();
      if (!snap.exists) return { ok:false, message:'That sign-in link has expired. Start again from Settings.' };
      const { provider, uid, createdAt } = snap.data(); await ref.delete();
      if (now() - Date.parse(createdAt) > STATE_MINUTES * 60000) return { ok:false, provider, message:'That sign-in took too long. Start again from Settings.' };
      if (error || typeof code !== 'string' || !code) return { ok:false, provider, message:`${providerName(provider)} sign-in was cancelled.` };
      try {
        const record = await load(provider), app = decrypt(record.app, key(), owner(provider));
        const tokens = await tokenRequest(provider, app, { grant_type:'authorization_code', code, ...(provider === 'sonos' ? { redirect_uri:redirectUri } : {}) }, { fetch, now:now() });
        if (provider === 'hue') tokens.username = await hueRegister(tokens, { fetch });
        await doc(provider).set({ tokens:encrypt(tokens, key(), owner(provider)), connectedAt:new Date(now()).toISOString(), connectedBy:uid }, { merge:true });
        return { ok:true, provider };
      } catch (err) { return { ok:false, provider, message:err instanceof SmartHomeError ? err.message : `${providerName(provider)} couldn’t be connected. Try again.` }; }
    },
    async disconnect(provider) { checkProvider(provider); await doc(provider).set({ tokens:null, connectedAt:null }, { merge:true }); return this.status(); },
    async devices(provider) {
      checkProvider(provider);
      const tokens = await tokensFor(provider);
      return provider === 'hue' ? hueDevices(tokens, { fetch }) : sonosDevices(tokens, { fetch });
    },
    async control(provider, command) {
      checkProvider(provider);
      const { path, body } = provider === 'hue' ? hueCommand(command) : sonosCommand(command), tokens = await tokensFor(provider);
      if (provider === 'hue') await hueFetch(fetch, tokens, path, { method:'PUT', body }); else await sonosFetch(fetch, tokens, path, { method:'POST', body });
      return { ok:true };
    }
  };
}
