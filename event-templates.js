export function eventTemplate(name, now = new Date()) {
  const start = new Date(now);
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const base = { mode: 'create', title: '', start, allDay: false, owner: 'both', ownerCustom: '', type: 'general', repeat: 'none', repeatUntil: '', notes: '', checklist: [] };
  if (name === 'date-night') {
    start.setHours(19, 0, 0, 0);
    if (start <= now) start.setDate(start.getDate() + 1);
    return { ...base, title: 'Date night', end: new Date(start.getTime() + 7200000) };
  }
  if (name === 'appointment') return { ...base, title: 'Appointment', type: 'appointment', end: new Date(start.getTime() + 3600000), checklist: [{text:'Confirm time and location',done:false},{text:'Bring what you need',done:false}] };
  if (name === 'day-off') {
    const day = new Date(now); day.setHours(0,0,0,0);
    return { ...base, title: 'Day off', start: day, end: new Date(day), allDay: true };
  }
  throw new Error('Unknown event template.');
}
