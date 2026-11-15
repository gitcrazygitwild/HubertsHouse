import { mkdir, copyFile, rm } from 'node:fs/promises';
const files = ['index.html', 'app.js', 'styles.css', 'home.css', 'household.js',
  'household-model.js', 'cloud-calendar.js', 'config.js', 'demo.js', 'icon.svg', 'manifest.webmanifest'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of files) await copyFile(file, `dist/${file}`);
console.log(`Built ${files.length} public files. Server source and secrets are excluded.`);
