import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const { createLitterRobot, signIn, refreshTokens, readLR4, readLR3, readPets, LitterRobotError } = await import('../functions/litter-robot.js');
const { encryptCredential, decryptCredential } = await import('../functions/crypto.js');
const view = await import('../litter-view.js');

const KEY = randomBytes(32).toString('base64');
const jwt = payload => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
const NOW = Date.parse('2026-11-19T15:00:00Z');
const tokens = (exp = NOW / 1000 + 3600) => ({ idToken:jwt({ mid:'user-1', exp }), accessToken:'AT', refreshToken:'RT', expiresAt:exp * 1000, userId:'user-1' });
function fakeDb() {
  const docs = new Map();
  return { docs, doc:path => ({ get:async () => ({ exists:docs.has(path), data:() => structuredClone(docs.get(path)) }),
    set:async (data, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...structuredClone(data) } : structuredClone(data)); }, delete:async () => { docs.delete(path); } }) };
}
const json = (status, body) => ({ ok:status < 400, status, json:async () => body });
const LR4_ROBOT = { unitId:'u1', name:'Throne', serial:'LR4X', isOnline:true, unitPowerStatus:'ON', unitPowerType:'AC', robotStatus:'ROBOT_IDLE', robotCycleState:'CYCLE_STATE_IDLE', displayCode:'DC_MODE_IDLE', isDFIFull:false, DFILevelPercent:72, litterLevelPercentage:0.64, catWeight:11.24, lastSeen:'2026-11-19T14:59:00Z', odometerCleanCycles:1486, sleepStatus:'WAKE', isLaserDirty:false };
const PETS = [
  { petId:'p1', name:'Mack', type:'CAT', isActive:true, weightHistory:[{ weight:11.2, timestamp:'2026-11-19T13:00:00Z' }, { weight:11.3, timestamp:'2026-11-19T06:00:00Z' }, { weight:11.1, timestamp:'2026-11-17T12:00:00Z' }] },
  { petId:'p2', name:'Hubert', type:'CAT', isActive:true, weightHistory:[{ weight:12.4, timestamp:'2026-11-18T22:00:00Z' }] },
  { petId:'p3', name:'Rex', type:'DOG', isActive:true, weightHistory:[] }
];
function whisker({ lr4 = [LR4_ROBOT], lr3 = [], pets = PETS, expired = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, body:init.body ? JSON.parse(init.body) : null, headers:init.headers || {} });
    if (url.startsWith('https://cognito-idp')) return expired ? json(400, { __type:'NotAuthorizedException' }) : json(200, { AuthenticationResult:{ IdToken:jwt({ mid:'user-1', exp:NOW / 1000 + 7200 }), AccessToken:'AT2' } });
    if (url.startsWith('https://lr4.iothings.site')) { const body = JSON.parse(init.body); return json(200, /sendLitterRobot4Command/.test(body.query) ? { data:{ sendLitterRobot4Command:'Command sent' } } : { data:{ getLitterRobot4ByUser:lr4 } }); }
    if (url.startsWith('https://pet-profile')) return json(200, { data:{ getPetsByUser:pets } });
    if (url.includes('/dispatch-commands')) return json(200, {});
    if (url.startsWith('https://v2.api.whisker')) return json(200, lr3);
    return json(404, {});
  };
  return { fetch, calls };
}
const service = (fetch, db = fakeDb(), login = async () => tokens()) => ({ db, home:createLitterRobot({ db, key:() => KEY, encrypt:encryptCredential, decrypt:decryptCredential, fetch, login, now:() => NOW }) });

test('Litter-Robot 4 and 3 readings become one simple shape', () => {
  assert.deepEqual(readLR4(LR4_ROBOT), { id:'u1', serial:'LR4X', name:'Throne', model:'Litter-Robot 4', online:true, status:'Ready', drawer:72, drawerFull:false, litter:64, lastWeight:11.2, cycles:1486, sleeping:false, battery:false, laserDirty:false, lastSeen:'2026-11-19T14:59:00Z', canClean:true });
  assert.equal(readLR4({ ...LR4_ROBOT, isDFIFull:true }).status, 'Drawer full');
  assert.equal(readLR4({ ...LR4_ROBOT, isOnline:false }).status, 'Offline'); assert.equal(readLR4({ ...LR4_ROBOT, isOnline:false }).canClean, false);
  assert.equal(readLR4({ ...LR4_ROBOT, displayCode:'DC_MTR_FAULT_PINCH' }).status, 'Pinch detected');
  const lr3 = readLR3({ litterRobotId:'r3', litterRobotSerial:'LR3X', litterRobotNickname:'Old faithful', unitStatus:'DF1', cycleCount:27, cycleCapacity:30 });
  assert.equal(lr3.drawer, 90); assert.equal(lr3.status, 'Drawer almost full'); assert.equal(lr3.model, 'Litter-Robot 3');
});

test('each cat’s visits today and this week come from SmartWeight readings', () => {
  const cats = readPets(PETS, { now:NOW, timezone:'America/New_York' });
  assert.deepEqual(cats.map(c => [c.name, c.today, c.week, c.weight]), [['Hubert', 0, 1, 12.4], ['Mack', 2, 3, 11.2]], 'the dog is left out; 1 AM ET readings count as today');
  assert.equal(view.litterHeadline({ robots:[readLR4(LR4_ROBOT)], cats }), 'Mack is today’s top visitor with 2 visits.');
  assert.equal(view.litterHeadline({ robots:[readLR4({ ...LR4_ROBOT, DFILevelPercent:95 })], cats }), 'Throne’s waste drawer is almost full.');
});

test('connecting stores only an encrypted session, never the password', async () => {
  const { fetch } = whisker();
  let seen = null;
  const { home, db } = service(fetch, fakeDb(), async (email, password) => { seen = [email, password]; return tokens(); });
  const result = await home.connect('uid1', { email:'cats@example.com', password:'hunter2-secret' });
  assert.deepEqual(seen, ['cats@example.com', 'hunter2-secret']);
  assert.equal(result.robots.length, 1); assert.equal(result.cats.length, 2);
  const stored = JSON.stringify(db.docs.get('privateLitterRobot/household'));
  assert.ok(!stored.includes('hunter2-secret') && !stored.includes('cats@example.com') && !stored.includes('"RT"'));
  assert.equal(decryptCredential(db.docs.get('privateLitterRobot/household').credential, KEY, 'litter-robot:household').userId, 'user-1');
  assert.deepEqual(await home.status(), { connected:true, needsReconnect:false, connectedAt:new Date(NOW).toISOString() });
});

test('snapshots are cached, sessions refresh, and a dead session asks to reconnect', async () => {
  const { fetch, calls } = whisker();
  const db = fakeDb(), { home } = service(fetch, db);
  await home.connect('u', { email:'a@b.co', password:'x' });
  const before = calls.length;
  await home.snapshot(); assert.equal(calls.length, before, 'served from the 2-minute cache');
  await home.snapshot({ force:true }); assert.ok(calls.length > before);
  assert.ok(calls.filter(c => c.url.startsWith('https://lr4')).every(c => c.headers.authorization.startsWith('Bearer ')));
  assert.ok(calls.filter(c => c.url.startsWith('https://v2.api.whisker')).every(c => c.headers['x-api-key']));
  // Nearly expired → refreshed with the refresh token.
  db.docs.get('privateLitterRobot/household').credential = encryptCredential(tokens(NOW / 1000 + 30), KEY, 'litter-robot:household');
  await home.snapshot({ force:true });
  assert.ok(calls.some(c => c.url.startsWith('https://cognito-idp') && c.body.AuthParameters.REFRESH_TOKEN === 'RT'));
  // Refresh refused → reconnect needed.
  const dead = whisker({ expired:true }), db2 = fakeDb(), second = service(dead.fetch, db2, async () => tokens(NOW / 1000 + 30));
  await second.home.connect('u', { email:'a@b.co', password:'x' }).catch(() => {});
  await db2.doc('privateLitterRobot/household').set({ credential:encryptCredential(tokens(NOW / 1000 + 30), KEY, 'litter-robot:household'), cache:null });
  await assert.rejects(second.home.snapshot(), error => error.code === 'unauthenticated');
  assert.equal((await second.home.status()).needsReconnect, true);
});

test('Clean now sends the right command to each model', async () => {
  const four = whisker(), { home } = service(four.fetch);
  await home.connect('u', { email:'a@b.co', password:'x' });
  assert.deepEqual(await home.clean('u1'), { ok:true, name:'Throne' });
  const sent = four.calls.find(c => c.body && /sendLitterRobot4Command/.test(c.body.query || ''));
  assert.deepEqual(sent.body.variables, { serial:'LR4X', command:'cleanCycle' });
  await assert.rejects(home.clean('nope'), /no longer on your Whisker account/);
  const offline = whisker({ lr4:[{ ...LR4_ROBOT, isOnline:false }] }), off = service(offline.fetch);
  await off.home.connect('u', { email:'a@b.co', password:'x' });
  await assert.rejects(off.home.clean('u1'), /offline, so it can’t start a clean/);
  const three = whisker({ lr4:[], lr3:[{ litterRobotId:'r3', litterRobotSerial:'LR3X', litterRobotNickname:'Old', unitStatus:'RDY', cycleCount:3, cycleCapacity:30 }] }), old = service(three.fetch);
  await old.home.connect('u', { email:'a@b.co', password:'x' });
  await old.home.clean('r3');
  const dispatch = three.calls.find(c => c.url.includes('/dispatch-commands'));
  assert.match(dispatch.url, /users\/user-1\/robots\/r3\/dispatch-commands$/); assert.equal(dispatch.body.command, '<C');
});

test('sign-in uses Whisker’s SRP flow and explains a wrong password', async () => {
  const lib = outcome => ({
    CognitoUserPool:class { constructor(options) { this.options = options; } },
    AuthenticationDetails:class { constructor(details) { this.details = details; } },
    CognitoUser:class { authenticateUser(details, callbacks) {
      if (outcome === 'ok') callbacks.onSuccess({ getIdToken:() => ({ getJwtToken:() => jwt({ mid:'user-9', exp:2000000000 }) }), getAccessToken:() => ({ getJwtToken:() => 'A' }), getRefreshToken:() => ({ getToken:() => 'R' }) });
      else callbacks.onFailure({ code:outcome });
    } }
  });
  const ok = await signIn('cats@example.com', 'pw', { lib:lib('ok') });
  assert.equal(ok.userId, 'user-9'); assert.equal(ok.refreshToken, 'R'); assert.equal(ok.expiresAt, 2000000000000);
  await assert.rejects(signIn('cats@example.com', 'pw', { lib:lib('NotAuthorizedException') }), error => error instanceof LitterRobotError && error.code === 'permission-denied');
  await assert.rejects(signIn('not-an-email', 'pw', { lib:lib('ok') }), /Enter the email/);
  await assert.rejects(refreshTokens({ refreshToken:'R' }, { fetch:async () => json(400, {}) }), error => error.code === 'unauthenticated');
});

test('the card and Settings explain each state', () => {
  assert.match(view.litterHTML({ connected:false }), /Litter-Robot isn’t connected yet/);
  const html = view.litterHTML(view.sampleLitter(NOW), { now:NOW });
  assert.match(html, /Mack is today’s top visitor with 4 visits/); assert.match(html, /The Royal Throne/); assert.match(html, /aria-valuenow="72"/);
  assert.match(html, /▲ 0.6 lb \/ 30d/);
  assert.match(view.litterSettingsHTML({ connected:false }), /never your password/);
  assert.match(view.litterSettingsHTML({ connected:true, needsReconnect:true }), /signed this house out/);
  assert.ok(!/<script/.test(view.litterHTML({ connected:true, robots:[], cats:[{ id:'x', name:'<script>', weight:1, today:1, week:1, lastVisit:null, change30:null }], checkedAt:new Date(NOW).toISOString() })));
});
