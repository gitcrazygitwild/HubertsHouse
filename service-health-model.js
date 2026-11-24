// Turns the server's serviceHealth records into plain warnings for Today, Settings and the
// morning email ("Huckleberry hasn't answered since 2:05 PM"). No imports, so the
// newsletter can share it.
export const SERVICES = {
  huckleberry:{ name:'Huckleberry', what:'Frankie’s sleep, bottles and the cats’ predictions' },
  publix:{ name:'Publix', what:'the weekly BOGOs on the Meals tab' },
  email:{ name:'The morning email', what:'the 6:30 AM newsletter' }
};
// A problem is shown once it has lasted a while (or happened twice), so one blip stays quiet.
const QUIET_MS = 10 * 60000;
const clock = (iso, timezone) => new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', ...(timezone ? { timeZone:timezone } : {}) });
const when = (iso, now, timezone) => {
  const t = Date.parse(iso), days = Math.floor((+now - t) / 86400000);
  const sameDay = new Date(t).toLocaleDateString('en-CA', timezone ? { timeZone:timezone } : {}) === new Date(+now).toLocaleDateString('en-CA', timezone ? { timeZone:timezone } : {});
  return sameDay ? clock(iso, timezone) : days < 6 ? `${new Date(t).toLocaleDateString('en-US', { weekday:'long', ...(timezone ? { timeZone:timezone } : {}) })} ${clock(iso, timezone)}` : new Date(t).toLocaleDateString('en-US', { month:'short', day:'numeric', ...(timezone ? { timeZone:timezone } : {}) });
};
export function describeProblem(record, now = Date.now(), timezone) {
  const info = SERVICES[record.service] || { name:record.service, what:'' }, since = when(record.failingSince || record.lastError, now, timezone);
  if (record.problem === 'signed-out') return `${info.name} stopped accepting the saved sign-in (since ${since}). Reconnect it in Settings.`;
  if (record.problem === 'denied') return `${info.name} is refusing access (since ${since}). Check sharing in the ${info.name} app.`;
  if (record.problem === 'changed') return `${info.name} is sending something unexpected (since ${since}); it may have changed. ${info.what ? `${info.what.charAt(0).toUpperCase()}${info.what.slice(1)} may be out of date.` : ''}`.trim();
  if (record.problem === 'failed') return `${info.name} didn’t send (${since}).`;
  return `${info.name} hasn’t answered since ${since}.`;
}
// The records that deserve a warning now, worst first: [{ service, name, problem, text, since }].
export function healthAlerts(records = [], now = Date.now(), { timezone } = {}) {
  return records.filter(r => r && r.problem && SERVICES[r.service] && (r.failures >= 2 || +now - Date.parse(r.failingSince || r.lastError) >= QUIET_MS))
    .sort((a, b) => Date.parse(a.failingSince || a.lastError) - Date.parse(b.failingSince || b.lastError))
    .map(r => ({ service:r.service, name:SERVICES[r.service].name, problem:r.problem, since:r.failingSince || r.lastError, text:describeProblem(r, now, timezone) }));
}
// One line per service for Settings: working, a warning, or not checked yet.
export function healthRows(records = [], now = Date.now(), { timezone } = {}) {
  const alerts = new Map(healthAlerts(records, now, { timezone }).map(a => [a.service, a]));
  return Object.entries(SERVICES).map(([service, info]) => {
    const r = records.find(x => x?.service === service);
    if (alerts.has(service)) return { service, name:info.name, state:'warning', text:alerts.get(service).text };
    if (r?.lastOk) return { service, name:info.name, state:'ok', text:`Working · last checked ${when(r.lastOk, now, timezone)}` };
    if (r?.problem) return { service, name:info.name, state:'ok', text:'A brief hiccup; watching it' };
    return { service, name:info.name, state:'unknown', text:'Not checked yet' };
  });
}
