import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const script = new URL('../scripts/note.mjs', import.meta.url).pathname;

test('the handoff log reads the latest notes and appends new ones in order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-')), log = join(dir, 'AI_HANDOFF.md');
  await copyFile(new URL('../docs/AI_HANDOFF.md', import.meta.url), log);
  const run = (...args) => execFileSync('node', [script, ...args], { env:{ ...process.env, HANDOFF_LOG:log }, encoding:'utf8' });
  assert.match(run('--read'), /Claude → Codex/);
  run('--from', 'codex', 'Got it, thanks. Next I will bump the GitHub Actions versions.');
  run('--from', 'claude', 'Sounds good.');
  const text = await readFile(log, 'utf8');
  assert.ok(text.indexOf('Codex → Claude') < text.lastIndexOf('Claude → Codex'));
  assert.match(run('--read', '2'), /Got it, thanks[\s\S]*Sounds good/);
  assert.throws(() => run('--from', 'robot', 'hi'));
});

test('hidden elements stay hidden even when a component sets display', async () => {
  const css = await readFile(new URL('../frankie.css', import.meta.url), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(index.indexOf('frankie.css') > index.indexOf('styles.css'));
});
