import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLocal, placeQueries, distanceKm, describeCode, createPlaceWeather, placeWeatherText } from '../place-weather.js';

test('Richmond-area places need no lookup; other states and towns do', () => {
  for (const here of ['Carytown', 'Short Pump Town Center', '3535 Ellwood Ave, Richmond, VA 23221', 'Glen Allen', 'Maymont', '2401 W Main St 23220']) assert.equal(looksLocal(here), true, here);
  for (const away of ['Richmond, CA', 'Chester, PA', 'Nags Head, NC', 'Williamsburg, VA 23185', 'Charlottesville, VA', 'Paris, France', 'Outer Banks']) assert.equal(looksLocal(away), false, away);
});

test('addresses become place names Open-Meteo can find', () => {
  const names = text => placeQueries(text).map(q => q.state ? `${q.name}/${q.state}` : q.name);
  assert.deepEqual(names('123 Main St, Charlottesville, VA 22902'), ['Charlottesville/Virginia']);
  assert.deepEqual(names('Disney World, Orlando, FL'), ['Orlando/Florida', 'Disney World/Florida']);
  assert.deepEqual(names('Kill Devil Hills NC 27948'), ['Kill Devil Hills/North Carolina']);
  assert.deepEqual(names('Paris, France'), ['Paris', 'France'], 'without a state, the last part is likely a country');
  // Apple Maps style: the venue on its own line, a country at the end, sometimes no commas.
  assert.deepEqual(names('The Shelburne Inn\n4415 Pacific Hwy, Seaview, WA  98644, United States'), ['Seaview/Washington', 'The Shelburne Inn/Washington']);
  assert.deepEqual(names('Wintergreen Resort\nWintergreen VA 22967 United States'), ['Wintergreen/Virginia', 'Wintergreen Resort/Virginia']);
  assert.deepEqual(names('1600 Pennsylvania Ave NW, Washington, DC 20500, United States'), ['Washington/District of Columbia'], 'Washington is the city here, DC the state');
  assert.deepEqual(names('Hotel X, 12 Main St Suite 4, Asheville, NC 28801'), ['Asheville/North Carolina', 'Hotel X/North Carolina']);
  for (const none of ['Zoom', 'home', 'https://meet.example.com/abc', '']) assert.deepEqual(placeQueries(none), [], none);
  assert.ok(Math.abs(distanceKm({ lat:37.5407, lon:-77.436 }, { lat:38.0293, lon:-78.4767 }) - 105) < 5, 'Richmond → Charlottesville ≈ 105 km');
  assert.deepEqual(describeCode(61), ['Rain', '🌧️']); assert.deepEqual(describeCode(0), ['Clear', '☀️']);
});

const memory = () => { const m = new Map(); return { getItem:k => m.get(k) ?? null, setItem:(k, v) => m.set(k, v), m }; };
const today = '2026-11-22', NOW = Date.parse('2026-11-22T12:00:00');
function openMeteo({ place = { name:'Charlottesville', latitude:38.03, longitude:-78.48, country_code:'US', admin1:'Virginia' }, fail = false } = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(url); if (fail) throw new Error('offline');
    const u = new URL(url);
    if (u.hostname === 'geocoding-api.open-meteo.com') return { ok:true, json:async () => ({ results:place ? [{ name:'Charlottesville', latitude:0, longitude:0, country_code:'US', admin1:'Ohio' }, place] : [] }) };
    assert.equal(u.hostname, 'api.open-meteo.com'); assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
    return { ok:true, json:async () => ({ daily:{ time:['2026-11-22', '2026-11-23'], weather_code:[2, 61], temperature_2m_max:[58.4, 50], temperature_2m_min:[40.6, 44], precipitation_probability_max:[10, 80] } }) };
  };
  return { fetch, calls };
}

test('a faraway event gets that town’s forecast for its day, cached on the device', async () => {
  const api = openMeteo(), storage = memory(); let updates = 0;
  const weather = createPlaceWeather({ fetch:api.fetch, storage, now:() => NOW, onUpdate:() => updates++ });
  assert.equal(weather.lookup('123 Main St, Charlottesville, VA', '2026-11-23').status, 'loading');
  await weather.whenSettled();
  const result = weather.lookup('123 Main St, Charlottesville, VA', '2026-11-23');
  assert.equal(result.status, 'ready'); assert.equal(result.place.name, 'Charlottesville, Virginia', 'the Virginia one, not Ohio');
  assert.equal(placeWeatherText(result), '🌧️ 50°/44° in Charlottesville, Virginia · 80% rain · rain');
  assert.equal(updates, 1); assert.equal(api.calls.length, 2);
  // A fresh page reuses the saved place and forecast: no new calls.
  const again = createPlaceWeather({ fetch:api.fetch, storage, now:() => NOW + 3600000 });
  again.lookup('123 Main St, Charlottesville, VA', today); await again.whenSettled();
  assert.equal(again.lookup('123 Main St, Charlottesville, VA', today).day.high, 58.4); assert.equal(api.calls.length, 2);
});

test('local, too far ahead, unknown or offline: no weather line (or a gentle note)', async () => {
  const api = openMeteo(), weather = createPlaceWeather({ fetch:api.fetch, storage:memory(), now:() => NOW });
  assert.equal(weather.lookup('Carytown', today).status, 'local'); assert.equal(api.calls.length, 0, 'no lookup for Richmond places');
  assert.equal(weather.lookup('Nags Head, NC', '2026-12-20').status, 'far-off');
  assert.match(placeWeatherText({ status:'far-off' }, 'Nags Head, NC'), /about two weeks before/);
  // A place that geocodes near Richmond counts as local.
  const near = createPlaceWeather({ fetch:openMeteo({ place:{ name:'Ashland', latitude:37.76, longitude:-77.48, country_code:'US', admin1:'Virginia' } }).fetch, storage:memory(), now:() => NOW });
  near.lookup('Ashland, VA', today); await near.whenSettled(); assert.equal(near.lookup('Ashland, VA', today).status, 'local');
  const nowhere = createPlaceWeather({ fetch:openMeteo({ place:null }).fetch, storage:memory(), now:() => NOW });
  nowhere.lookup('Somewhere Made Up, ZZ', today); await nowhere.whenSettled(); assert.equal(nowhere.lookup('Somewhere Made Up, ZZ', today).status, 'unknown');
  // A miss is retried after a day (a found place is kept for 60 days).
  let clock = NOW; const kept = memory(), misses = openMeteo({ place:null });
  const retry = () => createPlaceWeather({ fetch:misses.fetch, storage:kept, now:() => clock });
  let w = retry(); w.lookup('Nags Head, NC', today); await w.whenSettled(); const first = misses.calls.length;
  w = retry(); w.lookup('Nags Head, NC', today); await w.whenSettled(); assert.equal(misses.calls.length, first, 'same day: not asked again');
  clock += 25 * 3600000; w = retry(); w.lookup('Nags Head, NC', '2026-11-23'); await w.whenSettled(); assert.ok(misses.calls.length > first, 'next day: asked again');
  const offline = createPlaceWeather({ fetch:openMeteo({ fail:true }).fetch, storage:memory(), now:() => NOW });
  offline.lookup('Nags Head, NC', today); await offline.whenSettled(); assert.equal(placeWeatherText(offline.lookup('Nags Head, NC', today)), '');
});

test('Where suggestions: places used before, then towns (U.S. first), never a street sent to the town search', async () => {
  const { placeSuggestions } = await import('../place-weather.js');
  const { pastMatches, townQuery } = await import('../place-suggest.js');
  const towns = placeSuggestions([
    { name:'Paris', latitude:48.85, longitude:2.35, country_code:'FR', admin1:'Île-de-France', country:'France' },
    { name:'Paris', latitude:36.3, longitude:-88.33, country_code:'US', admin1:'Tennessee', country:'United States' },
    { name:'Ashland', latitude:37.76, longitude:-77.48, country_code:'US', admin1:'Virginia', country:'United States' }]);
  assert.deepEqual(towns.map(t => t.value), ['Paris, TN', 'Ashland, VA', 'Paris, Île-de-France, France']);
  assert.match(towns[1].detail, /Richmond area/); assert.match(towns[0].detail, /Tennessee · \d+ mi away/);
  const known = ['Lemaire\n101 W Franklin St, Richmond, VA', 'Nags Head, NC', 'Nags Head, NC', 'The Shelburne Inn, Seaview, WA'];
  assert.deepEqual(pastMatches(known, 'nag').map(p => p.value), ['Nags Head, NC'], 'duplicates folded');
  assert.deepEqual(pastMatches(known, 'lem')[0], { label:'Lemaire', detail:'101 W Franklin St, Richmond, VA', value:known[0], past:true });
  assert.deepEqual(pastMatches(known, 'seav').map(p => p.label), ['The Shelburne Inn, Seaview, WA'], 'a later word can match');
  assert.equal(pastMatches(known, '').length, 3, 'empty box: the most recent places');
  assert.equal(townQuery('Charlottesville, VA'), 'Charlottesville'); assert.equal(townQuery('101 W Franklin St'), ''); assert.equal(townQuery('N'), '');
});
