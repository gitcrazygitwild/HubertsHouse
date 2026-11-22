// Weather where an event actually is. Richmond-area plans already have Miateorology's
// forecast on Today; for anywhere else, this looks the place up and asks Open-Meteo
// (free, no key, worldwide) for that day. Results are cached on the device.
const RICHMOND = { lat:37.5407, lon:-77.4360 }, LOCAL_KM = 45, FORECAST_DAYS = 16;
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search', FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEO_DAYS = 60, FORECAST_HOURS = 3;
// Names that mean "here", so no lookup is needed: the city, nearby counties and towns, neighborhoods.
// Unambiguous names only: anything else is looked up and measured from Richmond.
const LOCAL = /\b(richmond|rva|henrico|chesterfield county|goochland|powhatan|glen allen|short pump|midlothian|mechanicsville|bon air|tuckahoe|highland springs|sandston|varina|carytown|scott'?s addition|the fan|museum district|church hill|shockoe|jackson ward|westover hills|innsbrook|willow lawn|libbie|vcu|university of richmond|maymont|byrd park|brown'?s island)\b/i;
// Richmond, Henrico, Chesterfield and Hanover ZIP codes (not Williamsburg's 231xx).
const LOCAL_ZIP = /\b(23005|2305[89]|23060|2310[23]|2311[1-6]|23120|232\d\d|2383[1-8])\b/;
const US_STATES = { AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming' };

// Mentions a U.S. state other than Virginia ("Richmond, CA", "Chester, PA")?
const otherState = text => { for (const [abbr, name] of Object.entries(US_STATES)) { if (abbr === 'VA') continue; if (new RegExp(`(,|\\s)${abbr}(\\s+\\d{5})?\\s*$|\\b${name}\\b`, 'i').test(text) && !(abbr === 'IN' && !/,\\s*IN\\b/.test(text)) && !(abbr === 'OR' && !/,\\s*OR\\b/.test(text)) && !(abbr === 'ME' && !/,\\s*ME\\b/.test(text))) return true; } return false; };
export const looksLocal = (location = '') => !otherState(location) && (LOCAL.test(location) || LOCAL_ZIP.test(location));
export function distanceKm(a, b) {
  const rad = d => d * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// What to search for. Open-Meteo matches place names, not street addresses, so
// "Main St, Charlottesville, VA 22902" tries "Charlottesville" (in Virginia) and so on.
export function placeQueries(location = '') {
  const raw = String(location).trim(), text = raw.replace(/\s+/g, ' ');
  if (!text || text.length > 300 || /^(zoom|teams|google meet|facetime|online|virtual|phone|tbd|home|our house)$/i.test(text) || /^https?:\/\//i.test(text)) return [];
  const stateName = token => US_STATES[token] || Object.values(US_STATES).find(s => s.toLowerCase() === token.toLowerCase()) || null;
  const COUNTRY = /\s*\b(usa|u\.s\.a?\.?|united states( of america)?)$/i;
  // Apple Maps puts the venue on its own line ("Lemaire\n101 W Franklin St, Richmond, VA 23220, United States"),
  // so split on line breaks as well as commas, then tidy each part.
  const pieces = raw.split(/[,\n]+/).map(p => p.replace(/\s+/g, ' ').replace(COUNTRY, '').replace(/\b\d{5}(-\d{4})?\b/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // The state is the LAST state-looking part, so "Washington, DC" keeps Washington as the city.
  let state = null, stateAt = -1;
  pieces.forEach((part, i) => { const whole = stateName(part), tail = part.match(/^(.*\S)\s+([A-Z]{2})$/); if (whole || (tail && US_STATES[tail[2]])) stateAt = i; });
  const parts = [];
  pieces.forEach((part, i) => {
    if (i === stateAt) { const whole = stateName(part); if (whole) { state = whole; return; } const tail = part.match(/^(.*\S)\s+([A-Z]{2})$/); state = US_STATES[tail[2]]; part = tail[1]; } // "Orlando FL"
    part = part.replace(/\s+(#\s*\S+|(suite|ste|unit|apt|floor|fl)\.?\s+\S+)$/i, '');
    if (/^\d+[a-z]?\s+.+\s(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|pl|place|cir|circle|ter|terrace|tpke|turnpike|sq|square|trl|trail)\b\.?(\s+(n|s|e|w|ne|nw|se|sw)\.?)?$/i.test(part)) return; // street line
    part = part.replace(/^\d+\s+/, '').trim();
    if (part.length >= 2 && !/^(usa|us|united states|united states of america)$/i.test(part) && !parts.includes(part)) parts.push(part);
  });
  // With a state, the city sits just before it; without one, the last part is often a country.
  const order = state ? [...parts].reverse() : parts.length >= 2 ? [parts.at(-2), parts.at(-1), ...parts.slice(0, -2).reverse()] : parts;
  return order.slice(0, 4).map(name => ({ name, state }));
}
// Geocoder results → Where-box suggestions, U.S. towns first: { label, detail, value }.
const ABBR = Object.fromEntries(Object.entries(US_STATES).map(([abbr, name]) => [name, abbr]));
export function placeSuggestions(results = []) {
  const out = [], seen = new Set();
  for (const r of (Array.isArray(results) ? results : []).filter(r => r?.name && Number.isFinite(r.latitude)).sort((a, b) => (b.country_code === 'US') - (a.country_code === 'US'))) {
    const us = r.country_code === 'US', value = us && ABBR[r.admin1] ? `${r.name}, ${ABBR[r.admin1]}` : [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : '', r.country].filter(Boolean).join(', ');
    if (seen.has(value)) continue; seen.add(value);
    const km = distanceKm({ lat:r.latitude, lon:r.longitude }, RICHMOND);
    out.push({ label:r.name, detail:[us ? r.admin1 : [r.admin1, r.country].filter(Boolean).join(', '), km < LOCAL_KM ? 'Richmond area' : `${Math.round(km * 0.621)} mi away`].filter(Boolean).join(' · '), value });
  }
  return out.slice(0, 6);
}
// Weather codes → a word and an icon (WMO codes, as Open-Meteo reports them).
export function describeCode(code) {
  if (code === 0) return ['Clear', '☀️']; if (code <= 2) return ['Partly cloudy', '⛅']; if (code === 3) return ['Cloudy', '☁️'];
  if (code <= 48) return ['Fog', '🌫️']; if (code <= 57) return ['Drizzle', '🌦️']; if (code <= 67) return ['Rain', '🌧️'];
  if (code <= 77) return ['Snow', '🌨️']; if (code <= 82) return ['Showers', '🌦️']; if (code <= 86) return ['Snow showers', '🌨️']; return ['Thunderstorms', '⛈️'];
}
const read = (storage, key) => { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; } };
const write = (storage, key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch {} };

export function createPlaceWeather({ fetch = globalThis.fetch?.bind(globalThis), storage = globalThis.localStorage, now = () => Date.now(), onUpdate = () => {} } = {}) {
  const memory = new Map(), pending = new Map();
  async function getJSON(url) { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
  async function geocode(location) {
    // hh_geo2: the address reader changed, so places the old one missed are looked up again.
    const key = `hh_geo2:${location.toLowerCase()}`, cached = read(storage, key);
    if (cached && now() - cached.at < (cached.place ? GEO_DAYS : 1) * 86400000) return cached.place; // a miss is retried after a day
    let place = null;
    for (const { name, state } of placeQueries(location)) {
      const json = await getJSON(`${GEO_URL}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
      const results = Array.isArray(json?.results) ? json.results : [];
      const pick = state ? results.find(r => r.admin1 === state) : results.find(r => r.country_code === 'US') || results[0]; // a known state must match
      if (pick && Number.isFinite(pick.latitude) && Number.isFinite(pick.longitude)) { place = { name:[pick.name, pick.admin1 && pick.country_code === 'US' ? pick.admin1 : pick.country].filter(Boolean).join(', '), lat:pick.latitude, lon:pick.longitude }; break; }
    }
    write(storage, key, { at:now(), place });
    return place;
  }
  async function forecast(place) {
    const key = `hh_wx:${place.lat.toFixed(2)},${place.lon.toFixed(2)}`, cached = read(storage, key);
    if (cached && now() - cached.at < FORECAST_HOURS * 3600000) return cached.days;
    const json = await getJSON(`${FORECAST_URL}?latitude=${place.lat}&longitude=${place.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=${FORECAST_DAYS}`);
    const d = json?.daily || {}, days = {};
    (d.time || []).forEach((date, i) => { days[date] = { code:d.weather_code?.[i], high:d.temperature_2m_max?.[i], low:d.temperature_2m_min?.[i], rain:d.precipitation_probability_max?.[i] }; });
    write(storage, key, { at:now(), days });
    return days;
  }
  // { status:'local' | 'far-off' | 'unknown' | 'ready' | 'loading', place, day } for a location on a date (YYYY-MM-DD).
  function lookup(location, date) {
    const where = String(location || '').trim();
    if (!where || looksLocal(where)) return { status:'local' };
    const days = Math.round((Date.parse(`${date}T12:00:00`) - now()) / 86400000);
    if (days > FORECAST_DAYS - 1) return { status:'far-off' };
    if (days < -1) return { status:'past' };
    const key = `${where.toLowerCase()}|${date}`;
    if (memory.has(key)) return memory.get(key);
    if (!pending.has(key)) pending.set(key, (async () => {
      try {
        const place = await geocode(where);
        if (!place) return { status:'unknown' };
        if (distanceKm(place, RICHMOND) < LOCAL_KM) return { status:'local', place };
        const all = await forecast(place), day = all[date];
        return day && Number.isFinite(day.high) ? { status:'ready', place, day } : { status:'far-off', place };
      } catch { return { status:'unavailable' }; }
    })().then(result => { memory.set(key, result); pending.delete(key); onUpdate(); return result; }));
    return { status:'loading' };
  }
  // Towns matching what's typed in the Where box (Open-Meteo knows places, not venues).
  const searches = new Map();
  async function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return [];
    if (!searches.has(q)) searches.set(q, getJSON(`${GEO_URL}?name=${encodeURIComponent(q)}&count=8&language=en&format=json`).then(json => placeSuggestions(json?.results)).catch(() => { searches.delete(q); return []; }));
    return searches.get(q);
  }
  return { lookup, search, whenSettled:() => Promise.all(pending.values()) };
}
// One short line for a card: "📍 Charlottesville, Virginia · ⛅ 58°/41° · 20% rain".
// "Washington D.C., District of Columbia" → "Washington, DC"; "Nags Head, North Carolina" → "Nags Head, NC".
// Applied when shown, so places already saved on the device get the short name too.
export function shortPlace(name = '') {
  const parts = String(name).split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return String(name);
  const state = parts.at(-1), abbr = ABBR[state] || (US_STATES[state] ? state : null);
  if (!abbr) return parts.join(', ');
  const city = parts.slice(0, -1).join(', ').replace(abbr === 'DC' ? /\s*,?\s*D\.?\s?C\.?$/i : /$^/, '');
  return `${city}, ${abbr}`;
}
export function placeWeatherText(result, location = '') {
  if (!result || ['local', 'past'].includes(result.status)) return '';
  const where = result.place?.name ? shortPlace(result.place.name) : String(location).split('\n')[0].trim(); // Apple puts the venue on the first line
  if (result.status === 'ready') { const [word, icon] = describeCode(result.day.code); return `${icon} ${Math.round(result.day.high)}°/${Math.round(result.day.low)}° in ${where}${Number.isFinite(result.day.rain) && result.day.rain >= 20 ? ` · ${Math.round(result.day.rain)}% rain` : ''} · ${word.toLowerCase()}`; }
  if (result.status === 'far-off') return `Weather in ${where} shows up about two weeks before`;
  if (result.status === 'loading') return `Checking the weather in ${where}…`;
  return '';
}
// One shared instance for the app (set in app.js), so any view can ask for an event's line.
let shared = null;
export const usePlaceWeather = instance => { shared = instance; };
export const searchPlaces = query => shared?.search ? shared.search(query) : Promise.resolve([]);
const pad = n => String(n).padStart(2, '0');
const dayOf = value => { if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !value.includes('T')) return value.slice(0, 10); const d = new Date(value); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function eventWeatherLine(event, day = null) {
  const where = event?.extendedProps?.location ?? event?.location ?? '';
  if (!shared || !String(where).trim()) return '';
  return placeWeatherText(shared.lookup(where, dayOf(day ?? event.start)), where);
}
// The editor's line under Where, for a place and a start time as typed.
export function whereBoxText(location, start) {
  const where = String(location || '').trim();
  if (!where || !shared) return '';
  const day = start && Number.isFinite(Date.parse(start)) ? dayOf(start) : dayOf(new Date());
  const result = shared.lookup(where, day);
  if (result.status === 'local') return '🏡 Richmond area: Today’s weather card has it covered';
  if (result.status === 'unknown') return 'No weather found for that place. Try a town, like “Nags Head, NC”.';
  return placeWeatherText(result, where);
}
// Preview mode: believable weather for anywhere, without calling Open-Meteo.
export function sampleWeatherFetch() {
  return async url => {
    const u = new URL(url);
    if (u.hostname.startsWith('geocoding')) {
      const typed = u.searchParams.get('name') || '', name = typed.charAt(0).toUpperCase() + typed.slice(1);
      const results = u.searchParams.get('count') === '8' && !/[,\d]/.test(typed)
        ? [['Nags Head', 'North Carolina', 35.96, -75.62], ['Naples', 'Florida', 26.14, -81.79], ['Nashville', 'Tennessee', 36.17, -86.78], ['Charlottesville', 'Virginia', 38.03, -78.48], ['Charleston', 'South Carolina', 32.78, -79.93]].filter(([n]) => n.toLowerCase().startsWith(typed.toLowerCase())).map(([n, admin1, latitude, longitude]) => ({ name:n, admin1, latitude, longitude, country_code:'US', country:'United States' }))
        : [{ name, latitude:35.96, longitude:-75.62, country_code:'US', admin1:'North Carolina', country:'United States' }];
      return { ok:true, json:async () => ({ results }) };
    }
    const time = Array.from({ length:16 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return dayOf(d); });
    return { ok:true, json:async () => ({ daily:{ time, weather_code:time.map((_, i) => [1, 2, 61, 3, 0][i % 5]), temperature_2m_max:time.map((_, i) => 62 + (i % 4)), temperature_2m_min:time.map((_, i) => 48 + (i % 3)), precipitation_probability_max:time.map((_, i) => [10, 20, 70, 30, 0][i % 5]) } }) };
  };
}
