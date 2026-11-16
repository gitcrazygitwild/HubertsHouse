// The living sky: the welcome banner follows the real time of day and weather.
const PHASES = [
  { until:5, name:'night' }, { until:7, name:'dawn' }, { until:11, name:'morning' }, { until:16, name:'afternoon' },
  { until:18.5, name:'golden' }, { until:20, name:'dusk' }, { until:24, name:'night' }
];
export function skyState(now = new Date(), kind = 'unknown') {
  const hour = now.getHours() + now.getMinutes() / 60;
  const phase = PHASES.find(p => hour < p.until).name;
  const weather = ['rain', 'storm'].includes(kind) ? 'rain' : kind === 'snow' ? 'snow' : ['cloud', 'fog'].includes(kind) ? 'cloud' : kind === 'partly' ? 'partly' : 'clear';
  const greeting = phase === 'night' ? (hour < 5 ? 'Up late' : 'Good night') : phase === 'dawn' || phase === 'morning' ? 'Good morning' : phase === 'afternoon' ? 'Good afternoon' : 'Good evening';
  return { phase, weather, greeting, stars:phase === 'night' && weather === 'clear', sun:['morning', 'afternoon', 'golden'].includes(phase) && ['clear', 'partly'].includes(weather) };
}
// Decorative SVG layer (stars, sun/moon, clouds, rain). Purely visual.
export function skyArt(state) {
  const stars = state.stars ? Array.from({ length:18 }, (_, i) => `<circle cx="${(i * 53) % 600 + 10}" cy="${(i * 29) % 70 + 6}" r="${i % 3 ? 0.9 : 1.5}" class="sky-star" style="animation-delay:${(i % 6) * .7}s"/>`).join('') : '';
  // Sky details sit in the open middle band, clear of the heading and the plan buttons.
  const body = state.phase === 'night' ? '<circle cx="330" cy="26" r="11" class="sky-moon"/><circle cx="335" cy="22" r="9.5" class="sky-moon-cut"/>' : state.sun ? `<circle cx="${state.phase === 'morning' ? 300 : 340}" cy="${state.phase === 'golden' ? 84 : 26}" r="13" class="sky-sun"/>` : '';
  const cloud = (x, y, s) => `<g class="sky-cloud" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="8" rx="26" ry="10"/><ellipse cx="14" cy="0" rx="16" ry="12"/><ellipse cx="-12" cy="3" rx="12" ry="9"/></g>`;
  const clouds = ['cloud', 'rain', 'snow'].includes(state.weather) ? cloud(300, 24, .9) + cloud(370, 44, .7) + cloud(250, 52, .55) : state.weather === 'partly' ? cloud(370, 40, .7) : '';
  const drops = state.weather === 'rain' ? Array.from({ length:20 }, (_, i) => `<line x1="${240 + (i * 23) % 170}" y1="${48 + (i * 17) % 40}" x2="${236 + (i * 23) % 170}" y2="${58 + (i * 17) % 40}" class="sky-drop" style="animation-delay:${(i % 5) * .25}s"/>`).join('')
    : state.weather === 'snow' ? Array.from({ length:16 }, (_, i) => `<circle cx="${240 + (i * 29) % 170}" cy="${48 + (i * 13) % 40}" r="1.6" class="sky-flake" style="animation-delay:${(i % 5) * .4}s"/>`).join('') : '';
  return `<svg class="sky-art" viewBox="0 0 600 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${stars}${body}${clouds}${drops}</svg>`;
}
