// A clock face for picking a time by dragging: the filled dot is when it starts, the hollow
// dot when it ends, and the shaded arc between them is how long it lasts. Dragging the
// start keeps the length; dragging the end changes it. Snaps to 5 minutes. The AM/PM
// buttons (and dragging past 12) switch halves of the day. Keyboard: arrow keys move a
// dot 5 minutes (Shift: 30). It edits the event editor's own fields through `setStart` and
// `setEnd`, so the date and time boxes stay the source of truth.
const NS = 'http://www.w3.org/2000/svg', SIZE = 232, C = SIZE / 2, R = 92, MIN = 60000;
const pad = n => String(n).padStart(2, '0');
const label = date => { const h = date.getHours(); return `${h % 12 || 12}:${pad(date.getMinutes())}`; };
const half = date => date.getHours() < 12 ? 'AM' : 'PM';
const length = minutes => { const h = Math.floor(minutes / 60), m = minutes % 60; return `${h ? `${h}h` : ''}${h && m ? ' ' : ''}${m ? `${m}m` : ''}` || '0m'; };
// Minutes past 12 on the dial (0–715) ↔ angle, 0 at the top, clockwise.
const angleOf = minutes => (minutes / 720) * 2 * Math.PI;
const point = (minutes, radius = R) => [C + radius * Math.sin(angleOf(minutes)), C - radius * Math.cos(angleOf(minutes))];
const dialMinutes = date => (date.getHours() % 12) * 60 + date.getMinutes();
export function minutesAt(x, y) {
  const a = Math.atan2(x - C, C - y), turn = ((a / (2 * Math.PI)) + 1) % 1;
  return (Math.round(turn * 720 / 5) * 5) % 720;
}
// A new start from a dial position, keeping AM/PM unless the drag crossed 12 (11:55 → 12:05).
export function startFrom(current, minutes, previous = dialMinutes(current)) {
  let pm = current.getHours() >= 12;
  if (previous >= 540 && minutes < 180) pm = !pm; else if (previous < 180 && minutes >= 540) pm = !pm;
  const next = new Date(current); next.setHours((pm ? 12 : 0) + Math.floor(minutes / 60), minutes % 60, 0, 0);
  return next;
}
// A new end from a dial position: the first time at that position after the start (up to 12 hours).
export function endFrom(start, minutes) {
  const gap = ((minutes - dialMinutes(start)) % 720 + 720) % 720 || 720;
  return new Date(+start + gap * MIN);
}
function el(name, attrs = {}) { const node = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; }

export function initTimeDial(root, { getRange, setStart, setEnd, isDisabled = () => false }) {
  if (!root) return { draw() {} };
  root.innerHTML = '';
  const svg = el('svg', { viewBox:`0 0 ${SIZE} ${SIZE}`, class:'dial-face', role:'group', 'aria-label':'Drag the dots to set the start and end time' });
  svg.append(el('circle', { cx:C, cy:C, r:R + 18, class:'dial-plate' }));
  for (let i = 0; i < 60; i++) { const big = i % 5 === 0, [x1, y1] = point(i * 12, R + (big ? 9 : 11)), [x2, y2] = point(i * 12, R + 15); svg.append(el('line', { x1, y1, x2, y2, class:big ? 'dial-tick big' : 'dial-tick' })); }
  for (let h = 0; h < 12; h++) { const [x, y] = point(h * 60, R - 24), t = el('text', { x, y, class:'dial-hour', 'text-anchor':'middle', 'dominant-baseline':'central' }); t.textContent = h === 0 ? '12' : String(h); svg.append(t); }
  const arc = el('path', { class:'dial-arc' }), track = el('circle', { cx:C, cy:C, r:R, class:'dial-track' });
  const endDot = el('circle', { r:13, class:'dial-dot end', tabindex:'0', role:'slider', 'aria-label':'End time' });
  const startDot = el('circle', { r:14, class:'dial-dot start', tabindex:'0', role:'slider', 'aria-label':'Start time' });
  svg.append(track, arc, endDot, startDot); // no hand: the time reads in the middle
  const readout = document.createElement('div'); readout.className = 'dial-readout';
  const halves = document.createElement('div'); halves.className = 'dial-halves'; halves.setAttribute('role', 'group'); halves.setAttribute('aria-label', 'Morning or afternoon');
  halves.innerHTML = '<button type="button" data-half="AM">AM</button><button type="button" data-half="PM">PM</button>';
  const face = document.createElement('div'); face.className = 'dial-wrap'; face.append(svg, readout);
  root.append(face, halves);

  function draw() {
    const { start, end, allDay } = getRange();
    root.hidden = !!allDay; if (allDay || !start || isNaN(start)) return;
    const off = isDisabled(); root.classList.toggle('is-disabled', off);
    const s = dialMinutes(start), minutes = Math.max(5, Math.round((end - start) / MIN)), e = (s + Math.min(minutes, 720)) % 720;
    const [sx, sy] = point(s), [ex, ey] = point(e), span = Math.min(minutes, 719.9);
    arc.setAttribute('d', `M ${sx} ${sy} A ${R} ${R} 0 ${span > 360 ? 1 : 0} 1 ${ex} ${ey}`);
    startDot.setAttribute('cx', sx); startDot.setAttribute('cy', sy); endDot.setAttribute('cx', ex); endDot.setAttribute('cy', ey);
    startDot.setAttribute('aria-valuetext', `${label(start)} ${half(start)}`); endDot.setAttribute('aria-valuetext', `${label(end)} ${half(end)}, ${length(minutes)}`);
    readout.innerHTML = `<strong>${label(start)}<small>${half(start)}</small></strong><span>to ${label(end)} ${half(end)}</span><em>${length(minutes)}${minutes > 720 ? ' · use the times below' : ''}</em>`;
    halves.querySelectorAll('[data-half]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.half === half(start))); b.disabled = off; });
  }
  // Dragging: whichever dot is closer to where the drag started.
  let dragging = null, last = 0;
  const local = event => { const box = svg.getBoundingClientRect(); return [(event.clientX - box.left) * SIZE / box.width, (event.clientY - box.top) * SIZE / box.height]; };
  function move(event) {
    if (!dragging) return;
    event.preventDefault();
    const [x, y] = local(event), m = minutesAt(x, y), { start } = getRange();
    if (dragging === 'start') { if (m !== last) { setStart(startFrom(start, m, last)); last = m; } }
    else setEnd(endFrom(start, m));
    draw();
  }
  svg.addEventListener('pointerdown', event => {
    if (isDisabled()) return;
    const [x, y] = local(event), { start, end } = getRange(), d = (a, b) => Math.hypot(a[0] - x, a[1] - y);
    const toStart = d(point(dialMinutes(start)), 0), toEnd = d(point((dialMinutes(start) + Math.round((end - start) / MIN)) % 720), 0);
    if (Math.hypot(x - C, y - C) < 30) return; // the middle shows the time; dragging starts on the ring
    dragging = event.target === endDot ? 'end' : event.target === startDot ? 'start' : toEnd < toStart ? 'end' : 'start';
    last = dialMinutes(start); svg.setPointerCapture?.(event.pointerId); root.classList.add('is-dragging'); move(event);
  });
  svg.addEventListener('pointermove', move);
  const stop = () => { dragging = null; root.classList.remove('is-dragging'); };
  svg.addEventListener('pointerup', stop); svg.addEventListener('pointercancel', stop);
  // Keyboard.
  for (const [dot, which] of [[startDot, 'start'], [endDot, 'end']]) dot.addEventListener('keydown', event => {
    const step = { ArrowUp:5, ArrowRight:5, ArrowDown:-5, ArrowLeft:-5 }[event.key]; if (!step || isDisabled()) return;
    event.preventDefault();
    const { start, end } = getRange(), by = step * (event.shiftKey ? 6 : 1) * MIN;
    if (which === 'start') setStart(new Date(+start + by)); else if (+end + by > +start) setEnd(new Date(+end + by));
    draw();
  });
  halves.addEventListener('click', event => {
    const button = event.target.closest('[data-half]'); if (!button || isDisabled()) return;
    const { start } = getRange(); if (half(start) === button.dataset.half) return;
    setStart(new Date(+start + (button.dataset.half === 'PM' ? 12 : -12) * 3600000)); draw();
  });
  draw();
  return { draw };
}
