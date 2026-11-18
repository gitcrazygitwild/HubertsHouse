// Litter-Robot (Whisker) for the Devices page. Whisker has no public API; this follows
// the community library Home Assistant uses (pylitterbot): Amazon Cognito sign-in,
// then Whisker's GraphQL (Litter-Robot 4, pet profiles) and REST (Litter-Robot 3) APIs.
// Like Huckleberry: one household connection, the password is used once to sign in and
// never stored, only the encrypted session is kept. Requests stay few (one cached
// snapshot every couple of minutes) and nothing sensitive is logged.
import cognito from 'amazon-cognito-identity-js';

export class LitterRobotError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new LitterRobotError(code, message); };
const decode = value => Buffer.from(value, 'base64').toString('utf8');
// Whisker's public app identifiers (from pylitterbot, base64 there too). Not secrets.
const USER_POOL_ID = decode('dXMtZWFzdC0xX3JqaE5uWlZBbQ=='), CLIENT_ID = decode('NDU1MnVqZXUzYWljOTBuZjhxbjUzbGV2bW4=');
const API_KEY = decode('cDduZE1vajYxbnBSWlA1Q1Z6OXY0VWowYkc3Njl4eTY3NThRUkJQYg==');
const LR4 = 'https://lr4.iothings.site/graphql', PETS = 'https://pet-profile.iothings.site/graphql/', LR3 = 'https://v2.api.whisker.iothings.site';
const COGNITO = 'https://cognito-idp.us-east-1.amazonaws.com/';
const MINUTE = 60000, DAY = 86400000, CACHE_MS = 2 * MINUTE;

const claims = token => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };
const tokensFrom = (idToken, accessToken, refreshToken) => {
  const payload = claims(idToken);
  if (!payload.mid) fail('failed-precondition', 'Whisker signed in but didn’t share an account. Try again.');
  return { idToken, accessToken, refreshToken, expiresAt:(payload.exp || 0) * 1000, userId:String(payload.mid) };
};

// Sign in with Whisker's own Secure Remote Password flow; the password never leaves this call.
export async function signIn(email, password, { lib = cognito } = {}) {
  const username = String(email || '').trim(), secret = String(password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 254) fail('invalid-argument', 'Enter the email you use in the Whisker app.');
  if (!secret || secret.length > 200) fail('invalid-argument', 'Enter your Whisker password.');
  const pool = new lib.CognitoUserPool({ UserPoolId:USER_POOL_ID, ClientId:CLIENT_ID });
  const user = new lib.CognitoUser({ Username:username, Pool:pool });
  return new Promise((resolve, reject) => {
    user.authenticateUser(new lib.AuthenticationDetails({ Username:username, Password:secret }), {
      onSuccess:session => { try { resolve(tokensFrom(session.getIdToken().getJwtToken(), session.getAccessToken().getJwtToken(), session.getRefreshToken().getToken())); } catch (error) { reject(error); } },
      onFailure:error => reject(error?.code === 'NotAuthorizedException' || error?.code === 'UserNotFoundException'
        ? new LitterRobotError('permission-denied', 'Whisker didn’t accept that email and password. Use the ones from the Whisker app.')
        : new LitterRobotError('unavailable', 'Whisker sign-in isn’t answering right now. Try again in a minute.')),
      mfaRequired:() => reject(new LitterRobotError('failed-precondition', 'Your Whisker account asks for a code at sign-in, which this connection can’t answer.')),
      newPasswordRequired:() => reject(new LitterRobotError('failed-precondition', 'Whisker wants you to set a new password first. Do that in the Whisker app, then connect here.'))
    });
  });
}
// Renew the session with the refresh token (plain Cognito call, no password).
export async function refreshTokens(tokens, { fetch = globalThis.fetch } = {}) {
  const response = await fetch(COGNITO, { method:'POST', headers:{ 'content-type':'application/x-amz-json-1.1', 'x-amz-target':'AWSCognitoIdentityProviderService.InitiateAuth' },
    body:JSON.stringify({ AuthFlow:'REFRESH_TOKEN_AUTH', ClientId:CLIENT_ID, AuthParameters:{ REFRESH_TOKEN:tokens.refreshToken } }), signal:AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 400) fail('unauthenticated', 'Whisker signed this house out. Connect Litter-Robot again in Settings.');
  if (!response.ok || !data.AuthenticationResult?.IdToken) fail('unavailable', 'Whisker isn’t answering right now. Try again in a minute.');
  return tokensFrom(data.AuthenticationResult.IdToken, data.AuthenticationResult.AccessToken, data.AuthenticationResult.RefreshToken || tokens.refreshToken);
}

// ---------- Reading the robots ----------
const LR4_FIELDS = 'unitId name serial isOnline unitPowerStatus unitPowerType robotStatus robotCycleState displayCode isDFIFull DFILevelPercent litterLevelPercentage catWeight lastSeen odometerCleanCycles sleepStatus isLaserDirty isBonnetRemoved';
const PET_FIELDS = 'petId name type weight lastWeightReading isActive weightHistory { weight timestamp }';
const LR4_STATUS = { ROBOT_BONNET:'Bonnet removed', ROBOT_CAT_DETECT:'Cat inside', ROBOT_CAT_DETECT_DELAY:'Waiting to clean', ROBOT_CLEAN:'Cleaning', ROBOT_EMPTY:'Emptying', ROBOT_FIND_DUMP:'Cleaning', ROBOT_IDLE:'Ready', ROBOT_POWER_DOWN:'Powering down', ROBOT_POWER_OFF:'Off', ROBOT_POWER_UP:'Powering up' };
const LR4_FAULTS = { DC_CAT_DETECT_30M:'Cat sensor fault', DC_MTR_FAULT_OT_AMP:'Motor fault', DC_MTR_FAULT_OT_SLP:'Motor fault', DC_MTR_FAULT_PINCH:'Pinch detected' };
const LR3_STATUS = { RDY:'Ready', CCP:'Cleaning', CCC:'Clean cycle done', CD:'Cat inside', CST:'Waiting to clean', CSI:'Cat sensor interrupted', CSF:'Cat sensor fault', DF1:'Drawer almost full', DF2:'Drawer almost full', DFS:'Drawer full', SDF:'Drawer full', BR:'Bonnet removed', P:'Paused', OFF:'Off', OFFLINE:'Offline', PD:'Pinch detected', OTF:'Motor fault', DHF:'Position fault', DPF:'Position fault', HPF:'Position fault', EC:'Emptying' };
const pct = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : null;
const text = (value, max = 60) => String(value ?? '').slice(0, max);
export function readLR4(robot) {
  const status = !robot.isOnline ? 'Offline' : robot.unitPowerStatus === 'OFF' ? 'Off' : LR4_FAULTS[robot.displayCode] || (robot.robotCycleState === 'CYCLE_STATE_PAUSE' ? 'Paused' : robot.robotCycleState === 'CYCLE_STATE_CAT_DETECT' ? 'Cat sensor interrupted' : null)
    || (robot.robotStatus === 'ROBOT_IDLE' && robot.isDFIFull ? 'Drawer full' : LR4_STATUS[robot.robotStatus] || 'Unknown');
  return { id:text(robot.unitId, 80), serial:text(robot.serial, 80), name:text(robot.name || 'Litter-Robot'), model:'Litter-Robot 4', online:robot.isOnline === true, status,
    drawer:pct(robot.DFILevelPercent), drawerFull:robot.isDFIFull === true, litter:robot.litterLevelPercentage == null ? null : pct(Number(robot.litterLevelPercentage) * 100),
    lastWeight:Number(robot.catWeight) > 0 ? Math.round(Number(robot.catWeight) * 10) / 10 : null, cycles:Number(robot.odometerCleanCycles) || 0, sleeping:robot.sleepStatus != null && robot.sleepStatus !== 'WAKE',
    battery:robot.unitPowerType === 'DC', laserDirty:robot.isLaserDirty === true, lastSeen:robot.lastSeen || null, canClean:robot.isOnline === true && robot.unitPowerStatus !== 'OFF' };
}
export function readLR3(robot) {
  const capacity = Number(robot.cycleCapacity) || 30, count = Number(robot.cycleCount) || 0, code = String(robot.unitStatus || '');
  return { id:text(robot.litterRobotId, 80), serial:text(robot.litterRobotSerial, 80), name:text(robot.litterRobotNickname || 'Litter-Robot'), model:'Litter-Robot 3', online:code !== 'OFFLINE', status:LR3_STATUS[code] || 'Unknown',
    drawer:pct(count / capacity * 100), drawerFull:['DFS', 'SDF'].includes(code), litter:null, lastWeight:null, cycles:count, sleeping:robot.sleepModeActive === '1' || robot.sleepModeActive === true,
    battery:robot.powerStatus === 'DC', laserDirty:false, lastSeen:robot.lastSeen || null, canClean:!['OFFLINE', 'OFF'].includes(code) };
}
// Each cat's visits come from Whisker's pet profiles (SmartWeight readings). Today
// means since local midnight in `timezone`.
export function readPets(pets = [], { now = Date.now(), timezone = 'America/New_York' } = {}) {
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
  const today = day(now);
  return pets.filter(pet => pet && pet.isActive !== false && (!pet.type || /cat/i.test(pet.type))).map(pet => {
    const history = (pet.weightHistory || []).map(entry => ({ t:Date.parse(entry.timestamp), w:Number(entry.weight) })).filter(entry => Number.isFinite(entry.t) && entry.w > 0 && entry.t <= now).sort((a, b) => a.t - b.t);
    const recent = history.filter(entry => entry.t >= now - 7 * DAY), month = history.filter(entry => entry.t >= now - 30 * DAY);
    const latest = history.at(-1)?.w ?? (Number(pet.lastWeightReading) || Number(pet.weight) || null);
    const firstMonth = month.length >= 4 ? month.slice(0, Math.ceil(month.length / 4)).reduce((s, e) => s + e.w, 0) / Math.ceil(month.length / 4) : null;
    const lastMonth = month.length >= 4 ? month.slice(-Math.ceil(month.length / 4)).reduce((s, e) => s + e.w, 0) / Math.ceil(month.length / 4) : null;
    return { id:text(pet.petId, 80), name:text(pet.name || 'Cat', 40), weight:latest == null ? null : Math.round(latest * 10) / 10,
      today:history.filter(entry => day(entry.t) === today).length, week:recent.length, lastVisit:history.length ? new Date(history.at(-1).t).toISOString() : null,
      change30:firstMonth != null && lastMonth != null ? Math.round((lastMonth - firstMonth) * 10) / 10 : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- The household service ----------
export function createLitterRobot({ db, key, encrypt, decrypt, fetch = globalThis.fetch, login = signIn, now = Date.now, timezone = 'America/New_York' }) {
  const ref = db.doc('privateLitterRobot/household'), owner = 'litter-robot:household';
  const call = async (tokens, url, init = {}) => {
    const response = await fetch(url, { ...init, headers:{ authorization:`Bearer ${tokens.idToken}`, 'content-type':'application/json', 'user-agent':'huberts-house', ...(url.startsWith(LR3) ? { 'x-api-key':API_KEY } : {}), ...init.headers }, signal:AbortSignal.timeout(15000) });
    if (response.status === 401) fail('unauthenticated', 'Whisker signed this house out. Connect Litter-Robot again in Settings.');
    if (!response.ok) fail('unavailable', `Whisker didn’t answer (${response.status}). Try again in a minute.`);
    const data = await response.json().catch(() => null);
    if (data?.errors?.length && !data.data) fail('unavailable', 'Whisker couldn’t read your robot just now.');
    return data;
  };
  const graph = (tokens, url, query, variables) => call(tokens, url, { method:'POST', body:JSON.stringify({ query, variables }) });
  async function session() {
    const snap = await ref.get(), record = snap.exists ? snap.data() : null;
    if (!record?.credential) fail('failed-precondition', 'Connect Litter-Robot in Settings first.');
    let tokens = decrypt(record.credential, key(), owner);
    if (tokens.expiresAt - now() < 2 * MINUTE) {
      try { tokens = await refreshTokens(tokens, { fetch }); }
      catch (error) { if (error.code === 'unauthenticated') await ref.set({ needsReconnect:true }, { merge:true }); throw error; }
      await ref.set({ credential:encrypt(tokens, key(), owner), needsReconnect:false }, { merge:true });
    }
    return { tokens, record };
  }
  async function readAll(tokens) {
    const [lr4, lr3, pets] = await Promise.all([
      graph(tokens, LR4, `query GetLR4($userId: String!) { getLitterRobot4ByUser(userId: $userId) { ${LR4_FIELDS} } }`, { userId:tokens.userId }).then(r => r?.data?.getLitterRobot4ByUser || []).catch(error => { if (error.code === 'unauthenticated') throw error; return []; }),
      call(tokens, `${LR3}/users/${encodeURIComponent(tokens.userId)}/robots`).then(r => Array.isArray(r) ? r : []).catch(error => { if (error.code === 'unauthenticated') throw error; return []; }),
      graph(tokens, PETS, `query GetPetsByUser($userId: String!) { getPetsByUser(userId: $userId) { ${PET_FIELDS} } }`, { userId:tokens.userId }).then(r => r?.data?.getPetsByUser || []).catch(error => { if (error.code === 'unauthenticated') throw error; return []; })
    ]);
    const robots = [...lr4.filter(r => r?.serial).map(readLR4), ...lr3.filter(r => r?.litterRobotSerial).map(readLR3)].slice(0, 6);
    return { robots, cats:readPets(pets, { now:now(), timezone }).slice(0, 8), checkedAt:new Date(now()).toISOString() };
  }
  return {
    async status() {
      const snap = await ref.get(), record = snap.exists ? snap.data() : null;
      return { connected:!!record?.credential, needsReconnect:record?.needsReconnect === true, connectedAt:record?.connectedAt || null };
    },
    async connect(uid, { email, password }) {
      const tokens = await login(email, password);
      const first = await readAll(tokens); // proves the account works before saving it
      await ref.set({ credential:encrypt(tokens, key(), owner), connectedAt:new Date(now()).toISOString(), connectedBy:uid, needsReconnect:false, cache:first });
      return { connected:true, ...first };
    },
    async disconnect() { await ref.delete(); return { connected:false }; },
    async snapshot({ force = false } = {}) {
      const { tokens, record } = await session();
      if (!force && record.cache?.checkedAt && now() - Date.parse(record.cache.checkedAt) < CACHE_MS) return { connected:true, ...record.cache };
      const fresh = await readAll(tokens);
      await ref.set({ cache:fresh }, { merge:true });
      return { connected:true, ...fresh };
    },
    async clean(robotId) {
      const { tokens } = await session(), { robots } = await readAll(tokens);
      const robot = robots.find(item => item.id === String(robotId || ''));
      if (!robot) fail('not-found', 'That Litter-Robot is no longer on your Whisker account. Refresh the page.');
      if (!robot.canClean) fail('failed-precondition', `${robot.name} is ${robot.status.toLowerCase()}, so it can’t start a clean right now.`);
      if (robot.model === 'Litter-Robot 4') {
        const result = await graph(tokens, LR4, 'mutation sendCommand($serial: String!, $command: String!, $value: String, $commandSource: String) { sendLitterRobot4Command(input: { serial: $serial, command: $command, value: $value, commandSource: $commandSource }) }', { serial:robot.serial, command:'cleanCycle' });
        if (/error/i.test(String(result?.data?.sendLitterRobot4Command || '')) || result?.errors?.length) fail('unavailable', `${robot.name} didn’t accept the clean. Try again from the Whisker app.`);
      } else {
        await call(tokens, `${LR3}/users/${encodeURIComponent(tokens.userId)}/robots/${encodeURIComponent(robot.id)}/dispatch-commands`, { method:'POST', body:JSON.stringify({ command:'<C', litterRobotId:robot.id }) });
      }
      await ref.set({ cache:null }, { merge:true });
      return { ok:true, name:robot.name };
    }
  };
}
