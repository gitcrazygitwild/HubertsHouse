import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = ['index.html', 'app.js', 'styles.css', 'home.css', 'calendar.css', 'calendar-view.js', 'household.js',
  'household-model.js', 'cloud-calendar.js', 'config.js', 'demo.js', 'icon.svg', 'manifest.webmanifest', 'weather.js', 'week-brief.js', 'home-upgrades.css', 'flapurr-icon.svg', 'calendar-model.js', 'dom.js', 'daily-content.js', 'dashboard.js', 'event-templates.js', 'compact.css', 'home-calendar.js', 'home-calendar.css', 'weather-shared.js', 'event-planning.js', 'cat-crew.js', 'connected-home.css', 'family.css', 'baby.css', 'baby.js', 'baby-logs.js', 'baby-model.js', 'holidays.js', 'event-editor.js', 'planning.css', 'checklists.js', 'frankie.css', 'frankie.js', 'baby-history.js', 'baby-sample.js', 'prediction-log.js', 'jokes.js', 'quick-add.js', 'smart-home.js', 'upgrades.js', 'upgrades.css', 'awards.js', 'free-nights.js', 'sky.js', 'newsletter-settings.js', 'siri-settings.js', 'world-briefing.js', 'world-view.js', 'briefing-format.js', 'install-app.js', 'mobile.css', 'devices.css', 'devices.js', 'devices-view.js', 'birthdays.js', 'birthdays-model.js', 'mia-v1.js', 'litter.js', 'litter-view.js', 'feeders.js', 'feeders-view.js'];
// Binary files are copied byte for byte (app icons for phones and computers).
const binary = ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const sources = await Promise.all(files.map(file => readFile(file, 'utf8')));
const revision = createHash('sha256').update(sources.join('\0')).digest('hex').slice(0, 12);
for (const [index, file] of files.entries()) {
  let source = sources[index];
  // A release shares one module revision so browsers cannot mix old and new
  // stateful modules. Only local module imports are changed; Firebase stays pinned.
  if (file.endsWith('.js')) source = source.replace(/(from\s+['"])(\.\/[^'"]+\.js)(?:\?[^'"]*)?(['"])/g, `$1$2?v=${revision}$3`);
  if (file === 'index.html') source = source.replace(/(\.\/(?:app\.js|[^"?]+\.css))\?v=[^"']+/g, `$1?v=${revision}`);
  await writeFile(`dist/${file}`, source);
}
for (const file of binary) await copyFile(file, `dist/${file}`);
console.log(`Built ${files.length + binary.length} public files. Server source and secrets are excluded.`);
