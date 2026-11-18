import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const { createSmartHome, validateApp, authorizeUrl, hueCommand, sonosCommand, hueDevices, sonosDevices, SmartHomeError } = await import('../functions/smart-home.js');
const { encryptCredential, decryptCredential } = await import('../functions/crypto.js');
const view = await import('../devices-view.js');

function fakeDb() {
  const docs = new Map();
  return { docs, doc:path => ({
    get:async () => ({ exists:docs.has(path), data:() => structuredClone(docs.get(path)) }),
    set:async (data, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...structuredClone(data) } : structuredClone(data)); },
    delete:async () => { docs.delete(path); }
  }) };
}
const json = (status, body) => ({ ok:status < 400, status, json:async () => body, text:async () => JSON.stringify(body) });
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method:init.method || 'GET', headers:init.headers || {}, body:init.body });
    for (const [pattern, reply] of routes) if (pattern.test(`${init.method || 'GET'} ${url}`)) return typeof reply === 'function' ? reply(url, init) : reply;
    return json(404, {});
  };
  return { fetch, calls };
}
const KEY = randomBytes(32).toString('base64');
const APP = { clientId:'client-id-1234', clientSecret:'secret-abcdefgh' };
const service = (fetch, db = fakeDb(), clock = { t:Date.parse('2026-11-18T12:00:00Z') }) => ({ db, clock, home:createSmartHome({ db, key:() => KEY, encrypt:encryptCredential, decrypt:decryptCredential, redirectUri:'https://example.test/smartHomeAuth', fetch, now:() => clock.t }) });

test('app details are checked, encrypted, and never returned', async () => {
  assert.throws(() => validateApp({ clientId:'x', clientSecret:'y' }), SmartHomeError);
  const { home, db } = service(fakeFetch([]).fetch);
  const status = await home.saveApp('uid1', 'hue', APP);
  assert.deepEqual(status.hue, { appSaved:true, connected:false, connectedAt:null, connectedBy:null });
  assert.equal(status.redirectUri, 'https://example.test/smartHomeAuth');
  const stored = JSON.stringify(db.docs.get('privateSmartHome/hue'));
  assert.ok(!stored.includes(APP.clientSecret) && !stored.includes(APP.clientId), 'stored encrypted');
  await assert.rejects(home.saveApp('uid1', 'nest', APP), /Philips Hue or Sonos/);
  await assert.rejects(home.devices('sonos'), /Add the Sonos app details/);
});

test('Hue sign-in: state is single-use, tokens are stored, the bridge gives an app key', async () => {
  const { fetch, calls } = fakeFetch([
    [/POST .*\/v2\/oauth2\/token/, json(200, { access_token:'AT1', refresh_token:'RT1', expires_in:3600 })],
    [/PUT .*\/route\/api\/0\/config/, json(200, [{ success:{} }])],
    [/POST .*\/route\/api$/, json(200, [{ success:{ username:'bridge-user' } }])]
  ]);
  const { home, db, clock } = service(fetch);
  await home.saveApp('uid1', 'hue', APP);
  const { url } = await home.startAuth('uid1', 'hue');
  const parsed = new URL(url), state = parsed.searchParams.get('state');
  assert.equal(parsed.origin + parsed.pathname, 'https://api.meethue.com/v2/oauth2/authorize');
  assert.equal(parsed.searchParams.get('client_id'), APP.clientId); assert.ok(state.length >= 30);
  clock.t += 60000;
  assert.deepEqual(await home.finishAuth({ code:'CODE', state }), { ok:true, provider:'hue' });
  const token = calls.find(call => /oauth2\/token/.test(call.url));
  assert.equal(token.headers.authorization, `Basic ${Buffer.from(`${APP.clientId}:${APP.clientSecret}`).toString('base64')}`);
  assert.match(token.body, /grant_type=authorization_code/); assert.match(token.body, /code=CODE/);
  const saved = db.docs.get('privateSmartHome/hue');
  assert.equal(saved.connectedBy, 'uid1'); assert.ok(!JSON.stringify(saved).includes('AT1'));
  assert.deepEqual(decryptCredential(saved.tokens, KEY, 'smart-home:hue').username, 'bridge-user');
  assert.equal((await home.status()).hue.connected, true);
  // The same link can't be used twice; a stale one is turned away.
  assert.equal((await home.finishAuth({ code:'CODE', state })).ok, false);
  const second = new URL((await home.startAuth('uid1', 'hue')).url).searchParams.get('state');
  clock.t += 11 * 60000;
  assert.match((await home.finishAuth({ code:'CODE', state:second })).message, /took too long/);
  assert.match((await home.finishAuth({ code:'CODE', state:'not valid!' })).message, /not valid/);
});

test('Sonos sign-in sends the redirect URI and scope; a cancelled sign-in is reported', async () => {
  const { fetch, calls } = fakeFetch([[/POST .*oauth\/access/, json(200, { access_token:'S1', refresh_token:'SR1', expires_in:86400 })]]);
  const { home } = service(fetch);
  await home.saveApp('uid2', 'sonos', APP);
  const url = new URL((await home.startAuth('uid2', 'sonos')).url);
  assert.equal(url.searchParams.get('scope'), 'playback-control-all'); assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/smartHomeAuth');
  const cancelled = new URL((await home.startAuth('uid2', 'sonos')).url).searchParams.get('state');
  assert.match((await home.finishAuth({ error:'access_denied', state:cancelled })).message, /cancelled/);
  assert.equal((await home.finishAuth({ code:'C', state:url.searchParams.get('state') })).ok, true);
  assert.match(calls.at(-1).body, /redirect_uri=https%3A%2F%2Fexample.test%2FsmartHomeAuth/);
});

test('tokens refresh shortly before they expire, and the new ones are saved', async () => {
  let tokenCalls = 0;
  const { fetch, calls } = fakeFetch([
    [/POST .*oauth\/access/, () => { tokenCalls += 1; return json(200, tokenCalls === 1 ? { access_token:'OLD', refresh_token:'R1', expires_in:3600 } : { access_token:'NEW', expires_in:3600 }); }],
    [/GET .*\/households$/, json(200, { households:[] })]
  ]);
  const { home, db, clock } = service(fetch);
  await home.saveApp('u', 'sonos', APP);
  await home.finishAuth({ code:'C', state:new URL((await home.startAuth('u', 'sonos')).url).searchParams.get('state') });
  await home.devices('sonos'); assert.equal(tokenCalls, 1);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer OLD');
  clock.t += 3599000; // one second before expiry
  assert.deepEqual(await home.devices('sonos'), { household:null, groups:[], favorites:[] });
  assert.equal(tokenCalls, 2); assert.equal(calls.at(-1).headers.authorization, 'Bearer NEW');
  const tokens = decryptCredential(db.docs.get('privateSmartHome/sonos').tokens, KEY, 'smart-home:sonos');
  assert.equal(tokens.accessToken, 'NEW'); assert.equal(tokens.refreshToken, 'R1', 'keeps the refresh token when none is returned');
});

test('Hue rooms join their lights and scenes; commands are checked', async () => {
  const { fetch, calls } = fakeFetch([
    [/resource\/room$/, json(200, { data:[{ id:'r2', metadata:{ name:'Nursery' }, services:[{ rtype:'grouped_light', rid:'g2' }] }, { id:'r1', metadata:{ name:'Kitchen' }, services:[{ rtype:'grouped_light', rid:'g1' }] }, { id:'r3', metadata:{ name:'Empty' }, services:[] }] })],
    [/resource\/grouped_light$/, json(200, { data:[{ id:'g1', on:{ on:true }, dimming:{ brightness:64.4 } }, { id:'g2', on:{ on:false } }] })],
    [/resource\/scene$/, json(200, { data:[{ id:'s1', metadata:{ name:'Relax' }, group:{ rid:'r1', rtype:'room' } }, { id:'s2', metadata:{ name:'Bright' }, group:{ rid:'r1' } }] })]
  ]);
  const { rooms } = await hueDevices({ accessToken:'AT', username:'key' }, { fetch });
  assert.deepEqual(rooms.map(room => [room.name, room.on, room.brightness, room.scenes.map(scene => scene.name)]), [['Kitchen', true, 64, ['Bright', 'Relax']], ['Nursery', false, 0, []]]);
  assert.equal(calls[0].headers['hue-application-key'], 'key');
  assert.deepEqual(hueCommand({ type:'power', target:'g1', on:false }), { path:'/clip/v2/resource/grouped_light/g1', body:{ on:{ on:false } } });
  assert.deepEqual(hueCommand({ type:'brightness', target:'g1', level:'40' }).body, { on:{ on:true }, dimming:{ brightness:40 } });
  assert.deepEqual(hueCommand({ type:'scene', target:'s1' }).body, { recall:{ action:'active' } });
  assert.throws(() => hueCommand({ type:'brightness', target:'g1', level:0 }), /1 to 100/);
  assert.throws(() => hueCommand({ type:'power', target:'../config' }), /no longer available/);
  assert.throws(() => hueCommand({ type:'party' }), /light command/);
});

test('Sonos groups show what is playing; commands map to the Control API', async () => {
  const { fetch } = fakeFetch([
    [/households$/, json(200, { households:[{ id:'HH1' }] })],
    [/HH1\/groups$/, json(200, { groups:[{ id:'G:1', name:'Kitchen', playbackState:'PLAYBACK_STATE_PLAYING' }] })],
    [/HH1\/favorites$/, json(200, { items:[{ id:'7', name:'Lullabies' }] })],
    [/groupVolume$/, json(200, { volume:22, muted:false })],
    [/playbackMetadata$/, json(200, { container:{ name:'Jazz' }, currentItem:{ track:{ name:'So What', artist:{ name:'Miles Davis' }, imageUrl:'http://insecure.example/a.jpg' } } })]
  ]);
  const result = await sonosDevices({ accessToken:'S' }, { fetch });
  assert.deepEqual(result, { household:'HH1', favorites:[{ id:'7', name:'Lullabies' }], groups:[{ id:'G:1', name:'Kitchen', playing:true, volume:22, muted:false, track:{ name:'So What', artist:'Miles Davis', image:null }, source:'Jazz' }] });
  assert.deepEqual(sonosCommand({ type:'toggle', target:'G:1' }), { path:'/groups/G%3A1/playback/togglePlayPause', body:{} });
  assert.deepEqual(sonosCommand({ type:'volume', target:'G:1', level:30 }).body, { volume:30 });
  assert.deepEqual(sonosCommand({ type:'favorite', target:'G:1', favorite:'7' }).body, { favoriteId:'7', playOnCompletion:true });
  assert.throws(() => sonosCommand({ type:'volume', target:'G:1', level:101 }), /0 to 100/);
});

test('a signed-out provider asks to reconnect instead of failing vaguely', async () => {
  const { fetch } = fakeFetch([[/POST .*oauth\/access/, json(200, { access_token:'S1', refresh_token:'SR1', expires_in:86400 })], [/households$/, json(401, {})]]);
  const { home } = service(fetch);
  await home.saveApp('u', 'sonos', APP);
  await home.finishAuth({ code:'C', state:new URL((await home.startAuth('u', 'sonos')).url).searchParams.get('state') });
  await assert.rejects(home.devices('sonos'), error => error.code === 'unauthenticated' && /Connect it again/.test(error.message));
  await home.disconnect('sonos'); assert.equal((await home.status()).sonos.connected, false);
});

test('launcher links: only real links are kept, and tiles fall back to the defaults', () => {
  assert.equal(view.safeDeviceLink('javascript:alert(1)'), ''); assert.equal(view.safeDeviceLink('data:text/html,x'), '');
  assert.equal(view.safeDeviceLink('sonos://'), 'sonos://'); assert.equal(view.safeDeviceLink('shortcuts://run-shortcut?name=Open%20Whisker'), 'shortcuts://run-shortcut?name=Open%20Whisker');
  assert.equal(view.safeDeviceLink('not a link'), '');
  const saved = view.readDeviceLinks(JSON.stringify({ links:{ whisker:'shortcuts://run-shortcut?name=Litter', fake:'x://', hue:'javascript:x' }, extra:[{ name:'Ring', link:'ring://' }, { name:'Bad', link:'javascript:x' }] }));
  assert.deepEqual(saved.links, { whisker:'shortcuts://run-shortcut?name=Litter' });
  assert.deepEqual(saved.extra, [{ id:'x0', name:'Ring', link:'ring://' }]);
  assert.deepEqual(view.readDeviceLinks('{oops'), { links:{}, extra:[] });
  const tiles = view.deviceTiles(saved);
  assert.equal(tiles.length, view.DEVICE_APPS.length + 1);
  assert.equal(tiles.find(tile => tile.id === 'whisker').link, 'shortcuts://run-shortcut?name=Litter');
  assert.equal(tiles.find(tile => tile.id === 'sonos').link, 'sonos://');
  assert.match(view.appStoreSearch('Schlage Home'), /term=Schlage%20Home$/);
  const html = view.launcherHTML(tiles);
  for (const name of ['Philips Hue', 'Sonos', 'Litter-Robot', 'PetLibro', 'Schlage', 'eufy', 'Dreo', 'Ring']) assert.ok(html.includes(name), name);
});

test('panels and Settings explain what to do when not connected', () => {
  assert.match(view.hueHTML({ connected:false }), /Philips Hue isn’t connected yet[\s\S]*data-go="settings"/);
  assert.match(view.sonosHTML({ connected:true, error:'Sonos didn’t answer (503).' }), /Try again/);
  const hue = view.hueHTML(view.sampleHue());
  assert.match(hue, /2 of 4 rooms on/); assert.match(hue, /Movie night/); assert.equal((hue.match(/data-hue-power/g) || []).length, 4);
  const sonos = view.sonosHTML(view.sampleSonos());
  assert.match(sonos, /Here Comes the Sun/); assert.match(sonos, /Play a favorite/); assert.match(sonos, /aria-label="Pause"/);
  const fresh = view.deviceSettingsHTML({ hue:{}, sonos:{ appSaved:true }, redirectUri:'https://x.test/smartHomeAuth' });
  assert.match(fresh, /Add new Hue Remote API app/); assert.match(fresh, /Connect Sonos/); assert.match(fresh, /value="https:\/\/x.test\/smartHomeAuth"/);
  assert.ok(!/<script/i.test(view.hueHTML({ connected:true, rooms:[{ id:'r', groupId:'g', name:'<script>x</script>', on:true, brightness:5, scenes:[] }] })));
});

test('coming back from sign-in shows the result and cleans the address', () => {
  assert.deepEqual(view.readConnectResult('?connected=hue&ok=1'), { ok:true, provider:'hue', message:'Philips Hue is connected. 🎉' });
  assert.equal(view.readConnectResult('?connected=sonos&ok=0&message=Sonos%20sign-in%20was%20cancelled.').message, 'Sonos sign-in was cancelled.');
  assert.equal(view.readConnectResult('?demo=1'), null);
  assert.equal(view.stripConnectParams('?demo=1&connected=hue&ok=1'), '?demo=1');
  assert.equal(view.stripConnectParams('?connected=hue&ok=0&message=x'), '');
});
