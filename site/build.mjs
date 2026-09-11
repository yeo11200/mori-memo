import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicFiles = ['index.html', 'styles.css', 'config.js', 'site.js', 'assets/mori.svg', 'assets/memo-connections.png'];
const html = await readFile(join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (value.startsWith('#')) {
    if (!ids.has(value.slice(1))) throw new Error('Missing anchor: ' + value);
  } else if (!value.startsWith('https://')) {
    if (!publicFiles.includes(value)) throw new Error('Unknown public resource: ' + value);
  }
}
for (const name of ['config.js', 'site.js']) new vm.Script(await readFile(join(root, name), 'utf8'), { filename: name });
await mkdir(join(root, 'dist/assets'), { recursive: true });
for (const name of publicFiles) await copyFile(join(root, name), join(root, 'dist', name));
console.log('PASS: anchors, local asset references, JavaScript syntax; static site built to site/dist');
