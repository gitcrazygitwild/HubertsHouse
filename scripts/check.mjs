// Syntax-checks every script in the app, the Functions and the tooling (node --check),
// so a new file never needs to be added to a hand-kept list.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const list = async (dir, re) => (await readdir(dir, { withFileTypes:true })).filter(e => e.isFile() && re.test(e.name)).map(e => dir === '.' ? e.name : `${dir}/${e.name}`);
const files = [...await list('.', /\.(m?js)$/), ...await list('functions', /\.(m?js)$/), ...await list('scripts', /\.(m?js)$/)].sort();
const failed = files.filter(file => { const r = spawnSync(process.execPath, ['--check', file], { stdio:'inherit' }); return r.status !== 0; });
if (failed.length) { console.error(`Syntax problems in: ${failed.join(', ')}`); process.exit(1); }
console.log(`${files.length} files checked.`);
