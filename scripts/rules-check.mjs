// Firestore security rules, checked against the Firestore emulator over REST.
// CI runs it with:  npm run rules   (firebase emulators:exec starts the emulator and sets
// FIRESTORE_EMULATOR_HOST). Locally, start any Firestore emulator with firestore.rules
// and point FIRESTORE_EMULATOR_HOST at it. Add a case here with every rules change.
const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080', project = process.env.GCLOUD_PROJECT || 'demo-hh';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = uid => `${b64({ alg:'none', typ:'JWT' })}.${b64({ sub:uid, user_id:uid, iss:`https://securetoken.google.com/${project}`, aud:project, iat:1700000000, exp:4100000000, auth_time:1700000000, firebase:{ sign_in_provider:'password' } })}.`;
const val = v => typeof v === 'string' ? { stringValue:v } : typeof v === 'boolean' ? { booleanValue:v } : Number.isInteger(v) ? { integerValue:String(v) } : Array.isArray(v) ? { arrayValue:{ values:v.map(val) } } : { mapValue:{ fields:Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const fields = o => ({ fields:Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)])) });
async function req(method, path, body, auth) {
  const r = await fetch(`${base}/${path}`, { method, headers:{ 'content-type':'application/json', authorization:`Bearer ${auth}` }, body:body ? JSON.stringify(body) : undefined });
  return r.status;
}
for (let i = 0; i < 40; i++) { try { await fetch(`http://${host}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
// Admin setup (owner bypasses rules).
console.log('setup member', await req('PATCH', 'households/home/members/m1', fields({ active:true }), 'owner'));
const meal = { name:'Chili', ingredients:['beans', 'turkey'], favorite:true, plannedFor:'2026-11-22', lastMade:'', version:0 };
const results = [];
const expect = async (label, want, status) => { results.push(`${status === want ? 'PASS' : 'FAIL'} ${label}: ${status} (want ${want})`); };
await expect('member creates a meal', 200, await req('PATCH', 'householdMeals/a', fields(meal), token('m1')));
await expect('member reads it', 200, await req('GET', 'householdMeals/a', null, token('m1')));
await expect('stranger cannot read', 403, await req('GET', 'householdMeals/a', null, token('x9')));
await expect('stranger cannot create', 403, await req('PATCH', 'householdMeals/b', fields(meal), token('x9')));
await expect('extra field rejected', 403, await req('PATCH', 'householdMeals/c', fields({ ...meal, secret:'x' }), token('m1')));
await expect('empty name rejected', 403, await req('PATCH', 'householdMeals/c', fields({ ...meal, name:'' }), token('m1')));
await expect('26 ingredients rejected', 403, await req('PATCH', 'householdMeals/c', fields({ ...meal, ingredients:Array.from({ length:26 }, (_, i) => `x${i}`) }), token('m1')));
await expect('create must start at version 0', 403, await req('PATCH', 'householdMeals/c', fields({ ...meal, version:3 }), token('m1')));
await expect('update bumps version', 200, await req('PATCH', 'householdMeals/a', fields({ ...meal, plannedFor:'', version:1 }), token('m1')));
await expect('stale update rejected', 403, await req('PATCH', 'householdMeals/a', fields({ ...meal, version:1 }), token('m1')));
await expect('stranger cannot delete', 403, await req('DELETE', 'householdMeals/a', null, token('x9')));
await expect('member deletes', 200, await req('DELETE', 'householdMeals/a', null, token('m1')));
await expect('server-only Publix cache is closed', 403, await req('GET', 'privatePublixDeals/store-1588', null, token('m1')));
await expect('household items still work', 200, await req('PATCH', 'householdItems/g', fields({ kind:'grocery', title:'chicken thighs', owner:'both', due:'', cadence:'none', list:'', category:'Meat & fish', quantity:'for Chicken tacos', completed:false, version:0 }), token('m1')));
// Undo (stores.js restore): a deleted item or dinner comes back under its old id at version 0.
await expect('Undo restores a deleted dinner', 200, await req('PATCH', 'householdMeals/a', fields(meal), token('m1')));
await expect('member deletes a to-do', 200, await req('DELETE', 'householdItems/g', null, token('m1')));
await expect('Undo restores it', 200, await req('PATCH', 'householdItems/g', fields({ kind:'grocery', title:'chicken thighs', owner:'both', due:'', cadence:'none', list:'', category:'Meat & fish', quantity:'for Chicken tacos', completed:false, version:0 }), token('m1')));
const full = { ...meal, steps:['Brown the turkey.', 'Simmer.'], minutes:45 };
await expect('meal with steps and minutes', 200, await req('PATCH', 'householdMeals/r1', fields(full), token('m1')));
await expect('21 steps rejected', 403, await req('PATCH', 'householdMeals/r2', fields({ ...full, steps:Array.from({ length:21 }, (_, i) => `s${i}`) }), token('m1')));
await expect('steps must be a list', 403, await req('PATCH', 'householdMeals/r2', fields({ ...full, steps:'do it' }), token('m1')));
await expect('minutes over 600 rejected', 403, await req('PATCH', 'householdMeals/r2', fields({ ...full, minutes:601 }), token('m1')));
await expect('minutes must be a whole number', 403, await req('PATCH', 'householdMeals/r2', fields({ ...full, minutes:'45' }), token('m1')));
await expect('an older meal without steps can still be updated', 200, await req('PATCH', 'householdMeals/old', fields(meal), token('m1')));
await expect('...to add steps', 200, await req('PATCH', 'householdMeals/old', fields({ ...full, version:1 }), token('m1')));
await expect('member saves bath days', 200, await req('PATCH', 'householdSettings/home', fields({ bathDays:[0, 3] }), token('m1')));
await expect('member reads bath days', 200, await req('GET', 'householdSettings/home', null, token('m1')));
await expect('member can clear bath days', 200, await req('PATCH', 'householdSettings/home', fields({ bathDays:[] }), token('m1')));
await expect('stranger cannot read settings', 403, await req('GET', 'householdSettings/home', null, token('x9')));
await expect('stranger cannot write settings', 403, await req('PATCH', 'householdSettings/home', fields({ bathDays:[1] }), token('x9')));
await expect('day 7 rejected', 403, await req('PATCH', 'householdSettings/home', fields({ bathDays:[7] }), token('m1')));
await expect('text days rejected', 403, await req('PATCH', 'householdSettings/home', fields({ bathDays:['Wed'] }), token('m1')));
await expect('more than 7 entries rejected', 403, await req('PATCH', 'householdSettings/home', fields({ bathDays:[0,1,2,3,4,5,6,0] }), token('m1')));
await expect('extra field rejected', 403, await req('PATCH', 'householdSettings/home', fields({ bathDays:[0], admin:true }), token('m1')));
await expect('other settings docs rejected', 403, await req('PATCH', 'householdSettings/other', fields({ bathDays:[0] }), token('m1')));
await expect('settings cannot be deleted', 403, await req('DELETE', 'householdSettings/home', null, token('m1')));
const ev = { title:'Weekend away', start:'2026-11-27T00:00:00', checklist:[], owner:'both' };
await expect('event with a location', 200, await req('PATCH', 'events/e1', fields({ ...ev, location:'Nags Head, NC' }), token('m1')));
await expect('event without a location still fine', 200, await req('PATCH', 'events/e2', fields(ev), token('m1')));
await expect('location over 300 characters rejected', 403, await req('PATCH', 'events/e3', fields({ ...ev, location:'x'.repeat(301) }), token('m1')));
await expect('location must be text', 403, await req('PATCH', 'events/e3', fields({ ...ev, location:true }), token('m1')));
const hunch = { text:'She sleeps longer on bath nights', factor:'bath', outcome:'nightLength', direction:'more' };
await expect('member saves a hunch', 200, await req('PATCH', 'babyHypotheses/h1', fields(hunch), token('m1')));
await expect('member saves a free-text hunch', 200, await req('PATCH', 'babyHypotheses/h2', fields({ text:'Fussier when Hubert sits on her mat' }), token('m1')));
await expect('member reads hunches', 200, await req('GET', 'babyHypotheses/h1', null, token('m1')));
await expect('stranger cannot read hunches', 403, await req('GET', 'babyHypotheses/h1', null, token('x9')));
await expect('stranger cannot save a hunch', 403, await req('PATCH', 'babyHypotheses/h3', fields(hunch), token('x9')));
await expect('empty hunch rejected', 403, await req('PATCH', 'babyHypotheses/h3', fields({ text:'' }), token('m1')));
await expect('hunch over 300 characters rejected', 403, await req('PATCH', 'babyHypotheses/h3', fields({ text:'x'.repeat(301) }), token('m1')));
await expect('odd direction rejected', 403, await req('PATCH', 'babyHypotheses/h3', fields({ ...hunch, direction:'sideways' }), token('m1')));
await expect('extra field on a hunch rejected', 403, await req('PATCH', 'babyHypotheses/h3', fields({ ...hunch, admin:true }), token('m1')));
await expect('Claude’s note can be added', 200, await req('PATCH', 'babyHypotheses/h2', fields({ text:'Fussier when Hubert sits on her mat', note:'Checked: no link in the logs.' }), token('m1')));
await expect('stranger cannot delete a hunch', 403, await req('DELETE', 'babyHypotheses/h1', null, token('x9')));
await expect('member deletes a hunch', 200, await req('DELETE', 'babyHypotheses/h1', null, token('m1')));
const bins = { trash:{ day:1, every:1, anchor:'2026-11-23' }, recycling:{ day:1, every:2, anchor:'2026-11-23' }, bump:true };
await expect('member saves trash days', 200, await req('PATCH', 'householdSettings/home?updateMask.fieldPaths=trash', fields({ trash:bins }), token('m1')));
await expect('bath days still save alongside', 200, await req('PATCH', 'householdSettings/home?updateMask.fieldPaths=bathDays', fields({ bathDays:[0, 3] }), token('m1')));
await expect('a doc with only trash is fine', 200, await req('PATCH', 'householdSettings/home', fields({ trash:bins }), token('m1')));
await expect('stranger cannot save trash days', 403, await req('PATCH', 'householdSettings/home', fields({ trash:bins }), token('x9')));
await expect('weekday 7 rejected', 403, await req('PATCH', 'householdSettings/home', fields({ trash:{ ...bins, trash:{ ...bins.trash, day:7 } } }), token('m1')));
await expect('every 3 weeks rejected', 403, await req('PATCH', 'householdSettings/home', fields({ trash:{ ...bins, recycling:{ ...bins.recycling, every:3 } } }), token('m1')));
await expect('extra pickup field rejected', 403, await req('PATCH', 'householdSettings/home', fields({ trash:{ ...bins, compost:{ day:2, every:1, anchor:'2026-11-24' } } }), token('m1')));
await expect('bump must be true/false', 403, await req('PATCH', 'householdSettings/home', fields({ trash:{ ...bins, bump:'yes' } }), token('m1')));
await expect('bad anchor rejected', 403, await req('PATCH', 'householdSettings/home', fields({ trash:{ ...bins, trash:{ ...bins.trash, anchor:'soon' } } }), token('m1')));
console.log('setup health', await req('PATCH', 'serviceHealth/huckleberry', fields({ service:'huckleberry', lastOk:'2026-11-22T12:00:00Z' }), 'owner'));
await expect('member reads service health', 200, await req('GET', 'serviceHealth/huckleberry', null, token('m1')));
await expect('stranger cannot read service health', 403, await req('GET', 'serviceHealth/huckleberry', null, token('x9')));
await expect('members cannot write service health', 403, await req('PATCH', 'serviceHealth/huckleberry', fields({ service:'huckleberry', problem:'unreachable' }), token('m1')));
await expect('members cannot delete service health', 403, await req('DELETE', 'serviceHealth/huckleberry', null, token('m1')));
console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
