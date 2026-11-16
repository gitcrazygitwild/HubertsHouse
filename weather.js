import { escapeHTML as esc } from './household-model.js';
import { richmondDay, forecastCondition, weatherIcon } from './weather-shared.js';
export { richmondDay, forecastCondition, weatherIcon } from './weather-shared.js';

const WEATHER_SITE = 'https://gitcrazygitwild.github.io/Miateorology/';
const CACHE_KEY = 'hh_forecast_v1';
const REFRESH_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const $ = id => document.getElementById(id);
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
    window.hhForecast = forecast; window.dispatchEvent(new CustomEvent('hh:forecast', { detail:forecast }));
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
}
