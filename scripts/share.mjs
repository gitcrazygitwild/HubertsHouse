// Copies the app modules the server needs (newsletter digest) into
// functions/shared/, so Cloud Functions use exactly the same logic as the app.
// Runs before tests, builds and deploys; functions/shared/ is not committed.
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('..', import.meta.url), target = new URL('functions/shared/', root);
export const SHARED = ['household-model.js', 'jokes.js', 'quick-add.js', 'daily-content.js', 'baby-model.js', 'baby-history.js', 'prediction-log.js', 'smart-home.js', 'awards.js', 'free-nights.js', 'weather-shared.js', 'weather.js', 'briefing-format.js', 'birthdays-model.js', 'mia-v1.js', 'cat-challenges.js', 'bath-days.js'];
await rm(target, { recursive:true, force:true });
await mkdir(target, { recursive:true });
for (const file of SHARED) await copyFile(new URL(file, root), new URL(file, target));
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Shared ${SHARED.length} app modules with functions/shared/.`);
