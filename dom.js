const rendered = new WeakMap();
// Reuse existing controls when their content is unchanged. This retains keyboard
// focus, selection, and hover state through snapshots and clock updates.
export function renderHTML(element, markup) {
  if (!element || rendered.get(element) === markup) return false;
  element.innerHTML = markup;
  rendered.set(element, markup);
  return true;
}
