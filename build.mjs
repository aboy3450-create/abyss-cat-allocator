import { mkdir, copyFile } from 'node:fs/promises';
const output = new URL('./public/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'core.js', 'db.js', 'favicon.svg']) {
  await copyFile(new URL(file, import.meta.url), new URL(file, output));
}
console.log('Built public/ (6 static files, no dependencies).');
