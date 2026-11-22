// The names a module exports, read from its source. The jsdom UI tests load app modules
// by hand (no bundler), so this lets them expose every export without a hand-kept list.
export function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) for (const part of m[1].split(',')) { const name = part.trim().split(/\s+as\s+/).pop(); if (name) names.add(name); }
  return [...names];
}
