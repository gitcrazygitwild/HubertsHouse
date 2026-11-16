#!/usr/bin/env node
// The AI handoff log: a running conversation between the AIs (Claude and
// Codex) working on this repository, kept in docs/AI_HANDOFF.md.
//
//   npm run note -- --read            show the latest 5 entries
//   npm run note -- --read 12         show the latest 12 entries
//   npm run note -- --from codex "Did X. Watch out for Y. Claude: can you Z?"
//   echo "multi-line note" | npm run note -- --from claude
//
// Entries are appended (never edited) so the log reads top-to-bottom like a chat.
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// HANDOFF_LOG lets tests point at a scratch copy.
const LOG = process.env.HANDOFF_LOG ? pathToFileURL(process.env.HANDOFF_LOG) : new URL('../docs/AI_HANDOFF.md', import.meta.url);
const AUTHORS = { claude:'Claude', codex:'Codex', hanry:'hanry', karena:'Karena' };
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] ?? '' : null; };

async function entries() {
  const text = await readFile(LOG, 'utf8');
  return text.split(/\n(?=### )/).filter(part => part.startsWith('### '));
}
const readCount = args.includes('--read') ? Number(args[args.indexOf('--read') + 1]) || 5 : null;
if (readCount !== null) {
  const all = await entries();
  console.log(all.slice(-readCount).join('\n').trim() || 'No entries yet.');
  console.log(`\n(${all.length} entries in docs/AI_HANDOFF.md)`);
  process.exit(0);
}
const from = (flag('--from') || '').toLowerCase();
if (!AUTHORS[from]) { console.error(`Use --from ${Object.keys(AUTHORS).join('|')}`); process.exit(1); }
let body = args.join(' ').trim();
if (!body && !process.stdin.isTTY) { let input = ''; for await (const chunk of process.stdin) input += chunk; body = input.trim(); }
if (!body) { console.error('Write a note: npm run note -- --from codex "what you did and what the other AI should know"'); process.exit(1); }
const to = from === 'claude' ? 'Codex' : from === 'codex' ? 'Claude' : 'both AIs';
const stamp = new Date().toLocaleString('en-US', { timeZone:'America/New_York', year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
await appendFile(LOG, `\n### ${stamp} ET · ${AUTHORS[from]} → ${to}\n\n${body}\n`);
console.log(`Added a note from ${AUTHORS[from]} to docs/AI_HANDOFF.md. Commit it with your change.`);
