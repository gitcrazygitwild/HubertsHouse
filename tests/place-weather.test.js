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
  const offline = createPlaceWeather({ fetch:openMeteo({ fail:true }).fetch, storage:memory(), now:() => NOW });
  offline.lookup('Nags Head, NC', today); await offline.whenSettled(); assert.equal(placeWeatherText(offline.lookup('Nags Head, NC', today)), '');
});
