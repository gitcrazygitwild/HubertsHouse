import { escapeHTML as esc } from './household-model.js';

const WEATHER_SITE = 'https://gitcrazygitwild.github.io/Miateorology/';
const CACHE_KEY = 'hh_forecast_v1';
const REFRESH_MS = 15 * 60 * 1000;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const $ = id => document.getElementById(id);
export function richmondDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function forecastCondition(day = {}) {
  const c = day.consensus || {};
  const signal = key => ['strong', 'medium', 'weak'].includes(c[key]);
  if (signal('thunderSignal')) return { kind: 'storm', label: 'Thunderstorms possible' };
  if (signal('snowSignal')) return { kind: 'snow', label: 'Snow in the forecast' };
  if (signal('rainSignal')) return { kind: 'rain', label: c.rainSignal === 'weak' ? 'A chance of showers' : 'Rain in the forecast' };
  const summaries = Object.values(day.sources || {}).map(source => String(source?.summary || '').toLowerCase()).filter(Boolean);
  const types = summaries.map(summary => /thunder/.test(summary) ? 'storm' : /snow|sleet/.test(summary) ? 'snow'
    : /rain|shower|drizzle/.test(summary) ? 'rain' : /fog|mist/.test(summary) ? 'fog'
    : /partly|mostly sunny/.test(summary) ? 'partly' : /cloud|overcast/.test(summary) ? 'cloud'
    : /sunny|clear/.test(summary) ? 'sun' : 'unknown');
  if (types.includes('storm')) return { kind: 'storm', label: 'A chance of storms' };
  if (types.includes('snow')) return { kind: 'snow', label: 'A chance of snow' };
  if (types.includes('rain')) return { kind: 'rain', label: 'A chance of showers' };
  if (types.includes('fog')) return { kind: 'fog', label: 'Fog possible' };
  if (types.includes('partly') || (types.includes('sun') && types.includes('cloud'))) return { kind: 'partly', label: 'Sun & clouds' };
  if (types.includes('cloud')) return { kind: 'cloud', label: 'Cloudy skies' };
  if (types.includes('sun')) return { kind: 'sun', label: 'Mostly clear' };
  return { kind: 'unknown', label: 'Conditions unavailable' };
}

// All geometry is fixed; forecast text never becomes SVG markup.
export function weatherIcon(kind = 'unknown') {
  const sun = '<g stroke="#d49b30" stroke-width="2.4" stroke-linecap="round"><path d="M21 4v4m0 26v4M4 21h4m26 0h4M9 9l3 3m18 18 3 3M9 33l3-3m18-18 3-3"/><circle cx="21" cy="21" r="8" fill="#f5cc6a"/></g>';
  const cloud = '<path d="M12 34a8 8 0 0 1 0-16 11 11 0 0 1 21-2 9 9 0 0 1 2 18Z" fill="#f9fcfa" stroke="#7896a2" stroke-width="2.2" stroke-linejoin="round"/>';
  let shape = '<path d="M18 9h12v22a9 9 0 1 1-12 0Z" fill="#f5f4eb" stroke="#8a9b8b" stroke-width="2.4"/><path d="M24 15v20" stroke="#b1bfa4" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="38" r="4" fill="#b1bfa4"/>';
  if (kind === 'sun') shape = `<g transform="translate(3 3)">${sun}</g>`;
  if (kind === 'partly') shape = `<g transform="translate(0 -1) scale(.85)">${sun}</g><g transform="translate(4 8) scale(.9)">${cloud}</g>`;
  if (kind === 'cloud') shape = `<g transform="translate(2 4)">${cloud}</g>`;
  if (['rain', 'snow', 'storm', 'fog'].includes(kind)) {
    shape = `<g transform="translate(2 -2)">${cloud}</g>`;
    if (kind === 'rain') shape += '<path d="m15 37-2 5m12-5-2 5m12-5-2 5" stroke="#6b9bbb" stroke-width="2.8" stroke-linecap="round"/>';
    if (kind === 'snow') shape += '<g fill="#86adbd"><circle cx="13" cy="39" r="2"/><circle cx="24" cy="42" r="2"/><circle cx="35" cy="39" r="2"/></g>';
    if (kind === 'storm') shape += '<path d="m25 31-7 9h7l-3 7 12-12h-8l4-4" fill="#e8b54d" stroke="#bb8b2c" stroke-width="1.2" stroke-linejoin="round"/>';
    if (kind === 'fog') shape += '<path d="M10 37h28M14 43h21" stroke="#9bada9" stroke-width="2.5" stroke-linecap="round"/>';
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-weather-kind="${['sun','partly','cloud','rain','snow','storm','fog'].includes(kind) ? kind : 'unknown'}">${shape}</svg>`;
}

export function selectForecast(blend, conditions, now = new Date()) {
  const today = richmondDay(now), generated = new Date(blend?.generatedAt), conditionTime = new Date(conditions?.generatedAt);
  if (!Number.isFinite(+generated) || !Number.isFinite(+conditionTime) || now - generated > MAX_AGE_MS || now - conditionTime > MAX_AGE_MS || generated - now > 300000 || conditionTime - now > 300000) return null;
  const byDate = new Map((Array.isArray(conditions?.days) ? conditions.days : []).map(day => [day.date, day]));
  const number = value => Number.isFinite(value) ? value : null;
  const days = (Array.isArray(blend?.days) ? blend.days : []).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && day.date >= today)
    .sort((a,b) => a.date.localeCompare(b.date)).slice(0, 4).map(day => ({
      date: day.date, high: number(day.blendedHighF), low: number(day.blendedLowF), rain: number(day.blendedPrecipProbability), wind: number(day.blendedWindMph),
      ...forecastCondition(byDate.get(day.date)), detail: byDate.get(day.date)?.writeup || ''
    }));
  if (days[0]?.date !== today || (days[0].high === null && days[0].low === null)) return null;
  return { days, generatedAt: generated.toISOString(), location: 'Richmond, VA', older: now - Math.min(+generated, +conditionTime) > 36 * 3600000 };
}

export function initWeather({ demo = false } = {}) {
  let forecast = null, busy = false, lastAttempt = 0, units = 'F', statusNote = '';
  try { units = localStorage.getItem('hh_weather_units') === 'C' ? 'C' : 'F'; } catch {}
  const degree = value => value === null ? '—' : `${Math.round(units === 'C' ? (value - 32) * 5 / 9 : value)}°`;
  function render(note = '') {
    statusNote = note;
    const today = forecast?.days[0];
    document.querySelectorAll('[data-weather-icon]').forEach(el => { el.innerHTML = weatherIcon(today?.kind); });
    const link = $('weatherAppLink');
    if (link) {
      link.title = today ? `Miateorology · Richmond today: ${today.label}, high ${degree(today.high)}${units}${forecast.older ? ' · older forecast' : ''}` : 'Open Miateorology · forecast unavailable';
      link.setAttribute('aria-label', link.title);
    }
    if (!$('weatherContent')) return;
    $('weatherUnits').textContent = `°${units}`;
    $('weatherUnits').setAttribute('aria-label', `Show temperatures in ${units === 'F' ? 'Celsius' : 'Fahrenheit'}`);
    $('weatherRefresh').disabled = busy;
    if (!today) {
      $('weatherContent').innerHTML = '<div class="weather-unavailable"><strong>A little weather pause.</strong><p>The Richmond forecast is unavailable right now. Try again, or open Miateorology.</p></div>';
      $('weatherStatus').textContent = note || 'Waiting for a current forecast'; return;
    }
    const precip = today.rain === null ? 'Rain chance unavailable' : `${Math.round(today.rain)}% rain chance`;
    const wind = today.wind === null ? '' : `${Math.round(today.wind * (units === 'C' ? 1.609344 : 1))} ${units === 'C' ? 'km/h' : 'mph'} wind`;
    $('weatherContent').innerHTML = `<div class="weather-now"><div class="weather-main-icon">${weatherIcon(today.kind)}</div><div><div class="weather-temperatures"><strong>${degree(today.high)}</strong><span>/ ${degree(today.low)}</span></div><div class="weather-condition">${esc(today.label)}</div><small>Today’s high / low · °${units}</small></div></div><div class="weather-facts"><span>${esc(precip)}</span>${wind ? `<span>${esc(wind)}</span>` : ''}</div><div class="weather-outlook">${forecast.days.slice(1).map(day => `<div><span>${esc(new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' }))}</span>${weatherIcon(day.kind)}<strong>${degree(day.high)} <small>${degree(day.low)}</small></strong><span class="sr-only">${esc(day.label)}</span></div>`).join('')}</div>`;
    const stamp = new Date(forecast.generatedAt).toLocaleString([], { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('weatherStatus').textContent = demo ? 'Sample forecast · Richmond' : `${note ? `${note} · ` : ''}${forecast.older ? 'Older forecast' : 'Forecast'} from ${stamp} ET`;
  }
  function demoForecast() {
    const today = richmondDay(), date = new Date(`${today}T12:00:00Z`);
    const days = Array.from({ length: 4 }, (_, i) => {
      const d = new Date(date); d.setUTCDate(d.getUTCDate() + i);
      return { date: richmondDay(d), high: 64 - i * 2, low: 44 - i, rain: i === 2 ? 65 : 10, wind: 7, ...[{kind:'partly',label:'Sun & clouds'},{kind:'sun',label:'Mostly clear'},{kind:'rain',label:'A chance of showers'},{kind:'cloud',label:'Cloudy skies'}][i] };
    });
    return { days, generatedAt: new Date().toISOString(), location: 'Richmond, VA' };
  }
  async function refresh(force = false) {
    if (demo) { forecast = demoForecast(); render(); return; }
    if (busy || (!force && Date.now() - lastAttempt < REFRESH_MS)) return;
    lastAttempt = Date.now(); busy = true;
    let cached;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch {}
    const cachedForecast = selectForecast(cached?.blend, cached?.conditions);
    forecast = cachedForecast;
    render(cachedForecast ? 'Saved forecast' : 'Checking the forecast…');
    if (!force && cachedForecast && Date.now() - cached.fetchedAt >= 0 && Date.now() - cached.fetchedAt < REFRESH_MS) { busy = false; render(); return; }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const [blend, conditions] = await Promise.all(['blend_daily.json','conditions_daily.json'].map(async file => {
        const response = await fetch(`${WEATHER_SITE}data/${file}`, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('Forecast unavailable');
        return response.json();
      }));
      const next = selectForecast(blend, conditions);
      if (!next) throw new Error('The forecast needs a refresh');
      forecast = next;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ blend, conditions, fetchedAt: Date.now() })); } catch {}
      busy = false; render();
    } catch { busy = false; render(forecast ? 'Saved forecast · refresh unavailable' : 'Forecast unavailable'); }
    finally { clearTimeout(timeout); }
  }
  $('weatherRefresh')?.addEventListener('click', () => refresh(true));
  $('weatherUnits')?.addEventListener('click', () => { units = units === 'F' ? 'C' : 'F'; try { localStorage.setItem('hh_weather_units', units); } catch {} render(statusNote); });
  refresh();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
}
