import { dailyContent } from './daily-content.js';

const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

export function initDashboard({ onAppearanceChange = () => {} } = {}) {
  function theme(value) {
    const selected = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    for (const id of ['themeToggle', 'settingsThemeToggle']) {
      const button = $(id); if (!button) continue;
      button.setAttribute('aria-pressed', String(selected === 'dark'));
      const text = selected === 'dark' ? 'Light mode' : 'Dark mode', label = button.querySelector('.btn-label'); // the header button keeps its icons
      if (label) { label.textContent = text; button.title = text; } else button.textContent = `${selected === 'dark' ? '☀' : '☾'} ${text}`;
    }
    write('hh_theme', selected);
  }
  const savedTheme = read('hh_theme');
  theme(savedTheme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  for (const id of ['themeToggle', 'settingsThemeToggle']) $(id)?.addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  const palettes = ['sage', 'coast', 'clay'];
  function palette(value) {
    const selected = palettes.includes(value) ? value : 'sage';
    document.documentElement.dataset.palette = selected;
    document.querySelectorAll('[data-palette-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paletteChoice === selected)));
    write('hh_palette', selected);
  }
  function density(value) {
    const selected = value === 'comfortable' ? value : 'compact';
    document.documentElement.dataset.density = selected;
    document.querySelectorAll('[data-density-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.densityChoice === selected)));
    write('hh_density', selected); onAppearanceChange();
  }
  document.querySelectorAll('[data-palette-choice]').forEach(button => button.addEventListener('click', () => palette(button.dataset.paletteChoice)));
  document.querySelectorAll('[data-density-choice]').forEach(button => button.addEventListener('click', () => density(button.dataset.densityChoice)));
  palette(read('hh_palette')); density(read('hh_density'));
  $('keyboardShortcuts').checked = read('hh_shortcuts') !== '0';
  $('keyboardShortcuts').addEventListener('change', event => write('hh_shortcuts', event.target.checked ? '1' : '0'));
  const afterDark = on => { $('afterDarkJoke').hidden = !on; $('afterDarkSetting').checked = on; write('hh_after_dark', on ? '1' : '0'); };
  afterDark(read('hh_after_dark') !== '0');
  $('afterDarkSetting').addEventListener('change', event => afterDark(event.target.checked));
  let currentDay;
  function missionState(key) {
    const done = read('hh_mission_done') === key;
    $('missionDone').setAttribute('aria-pressed', String(done));
    $('missionDone').textContent = done ? '✓ Nicely done' : 'Done';
    $('tinyMission').classList.toggle('is-done', done);
    $('missionStatus').textContent = done ? 'A small win for today.' : 'A two-minute idea, just for you.';
  }
  function refresh() {
    const content = dailyContent();
    if (content.key === currentDay) return;
    currentDay = content.key;
    $('dailyQuote').textContent = `“${content.quote}”`;
    $('dailyQuoteAuthor').textContent = content.attribution;
    $('dailyFact').textContent = content.fact;
    $('dailyWord').textContent = content.word.word;
    $('dailyWordPart').textContent = content.word.part;
    $('dailyWordSay').textContent = content.word.say ? `/${content.word.say}/` : '';
    $('dailyWordSay').setAttribute('aria-label', `Pronounced ${content.word.say || content.word.word}`);
    $('dailyDefinition').textContent = content.word.definition;
    $('dailyExample').textContent = `“${content.word.example}”`;
    $('dailyJokeSetup').textContent = content.joke.setup;
    $('dailyJokeAnswer').textContent = content.joke.punchline;
    $('dailyJoke').open = false;
    $('afterDarkSetup').textContent = content.afterDark.setup;
    $('afterDarkAnswer').textContent = content.afterDark.punchline;
    $('afterDarkJoke').open = false; $('afterDarkPunch').open = false;
    $('missionText').textContent = content.mission;
    $('dailyDate').textContent = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
    missionState(currentDay);
  }
  $('missionDone').addEventListener('click', () => {
    refresh();
    write('hh_mission_done', read('hh_mission_done') === currentDay ? '' : currentDay);
    missionState(currentDay);
  });
  // 🔊 says the word with the device's own voice, where the browser offers speech.
  const speak = $('dailyWordSpeak'), synth = globalThis.speechSynthesis;
  if (speak && synth && typeof globalThis.SpeechSynthesisUtterance === 'function') {
    speak.hidden = false;
    speak.addEventListener('click', () => {
      const word = $('dailyWord').textContent.trim(); if (!word) return;
      // Only cancel something already playing: on iPhone, cancel() right before speak() can swallow the speech.
      if (synth.speaking || synth.pending) synth.cancel();
      synth.resume?.(); // Chrome can be left paused
      const line = new SpeechSynthesisUtterance(word); line.lang = 'en-US'; line.rate = 0.85; line.volume = 1;
      const voice = synth.getVoices?.().find(v => /^en[-_]US/i.test(v.lang) && v.localService) || synth.getVoices?.().find(v => /^en/i.test(v.lang));
      if (voice) line.voice = voice;
      speak.classList.add('is-speaking'); line.onend = line.onerror = () => speak.classList.remove('is-speaking');
      synth.speak(line);
    });
  }
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}
