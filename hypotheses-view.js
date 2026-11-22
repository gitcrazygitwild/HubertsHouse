// "Got a hunch?" (Frankie page, under What Mia has noticed): type or build a hypothesis,
// see right away what Frankie's logs say, and keep a shared list of hunches. Ones the app
// can't test are saved with a "Copy for Claude" button (the words plus her last month).
// `store` is { subscribe(callback), add(hunch), remove(id) }; the preview keeps one in memory.
import { escapeHTML as esc } from './household-model.js';
import { renderHTML } from './dom.js';
import { showNotice } from './household.js';
import { FACTORS, OUTCOMES, fits, describeHypothesis, parseHypothesis, hypothesisData, testHypothesis, claudeDigest } from './hypotheses.js';
import { bathDays } from './bath-days.js';

const $ = id => document.getElementById(id);
const ICON = { true:'✅', maybe:'🤔', none:'🤷', opposite:'🔄', thin:'⏳', invalid:'⚠️' };
let store = null, saved = [], latest = null, memo = { key:'', data:null };

function currentData() {
  const snap = latest?.snapshot; if (!snap) return null;
  const sleeps = snap.sleeps || [], bottles = snap.bottles || [];
  const key = JSON.stringify([latest.timezone, sleeps.length, sleeps.at(-1)?.end, bottles.length, bottles.at(-1)?.start, bathDays()]);
  if (memo.key !== key) memo = { key, data:hypothesisData({ sleeps, bottles, timezone:latest.timezone, bathDays:bathDays() }) };
  return memo.data;
}
const chosen = () => ({ factor:$('hunchFactor').value, outcome:$('hunchOutcome').value, direction:$('hunchDirection').value || 'more' });
function fillFactors() {
  const group = (level, label) => `<optgroup label="${label}">${Object.entries(FACTORS).filter(([, f]) => f.level === level).map(([key, f]) => `<option value="${key}">${esc(f.label)}</option>`).join('')}</optgroup>`;
  renderHTML($('hunchFactor'), `<option value="">pick something…</option>${group('night', 'Days and nights')}${group('nap', 'Naps')}`);
}
function fillOutcomes(keep = $('hunchOutcome').value) {
  const factor = $('hunchFactor').value, options = Object.entries(OUTCOMES).filter(([key]) => !factor || fits(factor, key));
  renderHTML($('hunchOutcome'), `<option value="">…what changes?</option>${options.map(([key, o]) => `<option value="${key}">${esc(o.label)}</option>`).join('')}`);
  $('hunchOutcome').value = options.some(([key]) => key === keep) ? keep : (options.length === 1 ? options[0][0] : '');
  fillDirections();
}
function fillDirections(keep = $('hunchDirection').value || 'more') {
  const o = OUTCOMES[$('hunchOutcome').value];
  renderHTML($('hunchDirection'), o ? `<option value="more">${esc(o.more)}</option><option value="less">${esc(o.less)}</option>` : '<option value="more">more</option><option value="less">less</option>');
  $('hunchDirection').value = keep === 'less' ? 'less' : 'more';
}
function showReading() {
  const h = chosen(), text = $('hunchText').value.trim();
  $('hunchRead').textContent = fits(h.factor, h.outcome) ? `Testing: ${describeHypothesis(h)}` : text ? 'Hubert’s House can’t place that one yet. Pick from the menus, or save it as is and hand it to Claude.' : '';
  $('hunchSubmit').textContent = fits(h.factor, h.outcome) ? 'Test it' : text ? 'Save it for Claude' : 'Test it';
}
// Typing: read the words and set the menus to match.
function readText() {
  const parsed = parseHypothesis($('hunchText').value);
  $('hunchFactor').value = parsed.factor || ''; fillOutcomes(parsed.outcome || ''); fillDirections(parsed.direction);
  showReading();
}
function verdictHTML(result) {
  return `<div class="hunch-verdict is-${result.status}"><strong>${ICON[result.status] || ''} ${esc(result.headline)}</strong><span>${esc(result.detail)}</span></div>`;
}
function drawList() {
  const list = $('hunchList'); if (!list) return;
  const data = currentData();
  if (!saved.length) { renderHTML(list, ''); return; }
  renderHTML(list, `<h4>Your hunches</h4><ul class="hunch-list">${saved.map(h => {
    const testable = fits(h.factor, h.outcome), result = testable && data ? testHypothesis(h, data) : null;
    return `<li><div><b>“${esc(h.text)}”</b>${testable ? `<small>${esc(describeHypothesis(h))}</small>` : ''}${result ? verdictHTML(result) : testable ? '' : '<span class="hunch-claude">💬 Saved for Claude: Hubert’s House can’t test this one by itself.</span>'}</div>
      <div class="hunch-actions">${testable ? '' : `<button type="button" class="btn" data-hunch-copy="${esc(h.id)}">Copy for Claude</button>`}<button type="button" class="btn hunch-delete" data-hunch-delete="${esc(h.id)}" aria-label="Delete this hunch">✕</button></div></li>`;
  }).join('')}</ul><p class="tiny muted">Verdicts update as more days are logged. “Copy for Claude” copies the hunch with Frankie’s last month of sleep and bottles, ready to paste into a chat with Claude.</p>`);
}
async function copyForClaude(id) {
  const hunch = saved.find(h => h.id === id), data = currentData();
  if (!hunch) return;
  if (!data) { showNotice('Frankie’s logs aren’t loaded yet. Try again in a moment.'); return; }
  const text = claudeDigest(hunch.text, data, { timezone:latest.timezone, bathDays:bathDays() });
  try { await navigator.clipboard.writeText(text); showNotice('Copied. Paste it into a chat with Claude.'); }
  catch {
    // No clipboard access: show the text to copy by hand.
    renderHTML($('hunchResult'), `<label class="field"><span>Copy this and paste it into a chat with Claude</span><textarea class="hunch-copy" rows="6" readonly>${esc(text)}</textarea></label>`);
    $('hunchResult').querySelector('textarea')?.select();
  }
}
async function submit(event) {
  event.preventDefault();
  const h = chosen(), text = $('hunchText').value.trim().slice(0, 300), testable = fits(h.factor, h.outcome);
  if (!testable && !text) { $('hunchRead').textContent = 'Type a hunch, or pick both menus.'; return; }
  const data = currentData();
  if (testable) renderHTML($('hunchResult'), data ? verdictHTML(testHypothesis(h, data)) : '<p class="tiny muted">Frankie’s logs aren’t loaded yet; the hunch is saved and will be tested once they are.</p>');
  else renderHTML($('hunchResult'), '<div class="hunch-verdict is-claude"><strong>💬 Saved for Claude</strong><span>Hubert’s House can’t test that one by itself. It’s in your list below: tap “Copy for Claude” and paste it into a chat with Claude to have it checked against her logs.</span></div>');
  const hunch = { text:text || describeHypothesis(h), ...(testable ? { factor:h.factor, outcome:h.outcome, direction:h.direction } : {}) };
  try { await store?.add(hunch); $('hunchText').value = ''; showReading(); }
  catch { showNotice('That hunch couldn’t be saved. Check your connection and try again.'); }
}
export function memoryHypotheses(initial = []) {
  let items = initial.map((h, i) => ({ id:`sample-${i}`, ...h })), listener;
  return {
    subscribe(cb) { listener = cb; cb(items); },
    async add(h) { items = [{ id:`h${Date.now()}`, ...h }, ...items]; listener?.(items); },
    async remove(id) { items = items.filter(h => h.id !== id); listener?.(items); }
  };
}
export function initHypotheses({ store:given } = {}) {
  if (!$('hunchForm')) return;
  store = given || null;
  fillFactors(); fillOutcomes(''); showReading();
  $('hunchText').addEventListener('input', readText);
  $('hunchFactor').addEventListener('change', () => { fillOutcomes(); showReading(); });
  $('hunchOutcome').addEventListener('change', () => { fillDirections(); showReading(); });
  $('hunchDirection').addEventListener('change', showReading);
  $('hunchForm').addEventListener('submit', submit);
  $('hunchList').addEventListener('click', event => {
    const copy = event.target.closest('[data-hunch-copy]'), remove = event.target.closest('[data-hunch-delete]');
    if (copy) copyForClaude(copy.dataset.hunchCopy);
    if (remove) store?.remove(remove.dataset.hunchDelete).catch(() => showNotice('That hunch couldn’t be deleted. Try again.'));
  });
  store?.subscribe(items => { saved = (items || []).filter(h => h && typeof h.text === 'string'); drawList(); });
  window.addEventListener('hh:frankie', event => { latest = event.detail; drawList(); });
}
