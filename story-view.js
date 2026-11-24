// The story viewer for "Frankie's week" (week-story.js): full screen, one card at a time,
// progress bars across the top. Tap the right side (or →) for the next card, the left side
// (or ←) to go back; swipe works too; hold to pause; Esc or ✕ closes. Cards move on by
// themselves every few seconds (not with reduced motion). The last card offers Share.
import { renderHTML } from './dom.js';
import { escapeHTML as esc } from './household-model.js';
import { weekStoryText } from './week-story.js';

const SLIDE_MS = 5500;
const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function slideHTML(slide) {
  const max = slide.bars ? Math.max(1, ...slide.bars.map(b => b.value)) : 1;
  const bars = slide.bars ? `<div class="story-bars" role="img" aria-label="${esc(slide.bars.map(b => `${b.label} ${b.value}${slide.barUnit || ''}`).join(', '))}">${slide.bars.map(b => `<span class="${b.highlight ? 'is-top' : ''}"><i style="height:${Math.max(4, Math.round(b.value / max * 100))}%"></i><small>${esc(b.label)}</small></span>`).join('')}</div>` : '';
  return `<div class="story-card tone-${esc(slide.tone || 'dawn')} kind-${esc(slide.kind)}">
    ${slide.icon ? `<span class="story-icon" aria-hidden="true">${esc(slide.icon)}</span>` : ''}
    <span class="story-eyebrow">${esc(slide.eyebrow)}</span>
    <strong class="story-big">${esc(slide.big)}${slide.unit ? `<small>${esc(slide.unit)}</small>` : ''}</strong>
    <p class="story-line">${esc(slide.line)}</p>
    ${slide.sub ? `<p class="story-sub">${esc(slide.sub)}</p>` : ''}
    ${bars}
    ${slide.note ? `<p class="story-note">${esc(slide.note)}</p>` : ''}
    ${slide.kind === 'outro' ? '<button type="button" class="btn story-share" data-story-share>↗ Share her week</button><p class="story-shared" aria-live="polite"></p>' : ''}
  </div>`;
}

export function openStory(story, { doc = document } = {}) {
  if (!story?.available) return null;
  let dialog = doc.getElementById('storyDialog');
  if (!dialog) {
    dialog = doc.createElement('dialog'); dialog.id = 'storyDialog'; dialog.className = 'story-dialog'; dialog.setAttribute('aria-label', `${story.name}’s week`);
    doc.body.append(dialog);
  }
  let index = 0, timer = null, paused = false, startX = null, downAt = 0, swiped = false;
  renderHTML(dialog, `<div class="story-progress">${story.slides.map(() => '<span><i></i></span>').join('')}</div>
    <button type="button" class="story-close" data-story-close aria-label="Close">✕</button>
    <div class="story-stage" aria-live="polite"></div>
    <button type="button" class="story-nav prev" data-story-prev aria-label="Previous card"></button><button type="button" class="story-nav next" data-story-next aria-label="Next card"></button>`);
  const stage = dialog.querySelector('.story-stage'), segments = [...dialog.querySelectorAll('.story-progress span')];
  const stop = () => { clearTimeout(timer); timer = null; };
  const schedule = () => { stop(); if (!paused && !reduced() && index < story.slides.length - 1) timer = setTimeout(() => go(index + 1), SLIDE_MS); };
  function go(next) {
    index = Math.max(0, Math.min(story.slides.length - 1, next));
    renderHTML(stage, slideHTML(story.slides[index]));
    segments.forEach((seg, i) => { seg.className = i < index ? 'is-done' : i === index ? (reduced() ? 'is-done' : 'is-now') : ''; seg.style.setProperty('--story-ms', `${SLIDE_MS}ms`); });
    dialog.classList.toggle('is-paused', paused);
    schedule();
  }
  const close = () => { stop(); dialog.close?.(); dialog.removeAttribute('open'); doc.removeEventListener('keydown', onKey); };
  const onKey = event => { if (!dialog.open) return; if (event.key === 'ArrowRight') go(index + 1); else if (event.key === 'ArrowLeft') go(index - 1); else if (event.key === 'Escape') close(); };
  doc.addEventListener('keydown', onKey);
  dialog.onclick = async event => {
    if (swiped) { swiped = false; return; } // the click that ends a swipe
    if (event.target.closest('[data-story-close]')) return close();
    if (event.target.closest('[data-story-share]')) {
      const text = weekStoryText(story), note = dialog.querySelector('.story-shared');
      try { if (navigator.share) await navigator.share({ title:`${story.name}’s week`, text }); else { await navigator.clipboard.writeText(text); if (note) note.textContent = 'Copied. Paste it into a message.'; } }
      catch (error) { if (error?.name !== 'AbortError' && note) note.textContent = text; }
      return;
    }
    if (event.target.closest('[data-story-prev]')) go(index - 1);
    else if (event.target.closest('[data-story-next]')) { if (index === story.slides.length - 1) close(); else go(index + 1); }
  };
  // Hold to pause; swipe to move.
  dialog.onpointerdown = event => { startX = event.clientX; downAt = Date.now(); paused = true; stop(); dialog.classList.add('is-paused'); };
  dialog.onpointerup = event => {
    const dx = startX == null ? 0 : event.clientX - startX; startX = null; paused = false; dialog.classList.remove('is-paused');
    if (Math.abs(dx) > 50) { swiped = true; setTimeout(() => { swiped = false; }, 400); go(index + (dx < 0 ? 1 : -1)); } else if (Date.now() - downAt > 400) schedule(); // a long hold resumes
  };
  dialog.onpointercancel = () => { startX = null; paused = false; dialog.classList.remove('is-paused'); schedule(); };
  dialog.addEventListener('close', () => { stop(); doc.removeEventListener('keydown', onKey); }, { once:true });
  if (dialog.showModal && !dialog.open) dialog.showModal(); else dialog.setAttribute('open', '');
  go(0);
  return { go, close, get index() { return index; } };
}
