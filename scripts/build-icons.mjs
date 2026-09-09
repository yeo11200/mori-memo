import { chromium } from '@playwright/test';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = await readFile(resolve('build/mori-icon.svg'), 'utf8');
const destination = resolve('build/icons/mori.iconset');
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.MORI_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await page.setViewportSize({ width: size * scale, height: size * scale });
      await page.screenshot({ path: `${destination}/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`, omitBackground: true });
    }
  }
} finally {
  await browser.close();
}
execFileSync('iconutil', ['-c', 'icns', destination, '-o', resolve('build/icons/mori.icns')]);
await copyFile(`${destination}/icon_512x512@2x.png`, resolve('build/icons/mori-1024.png'));
console.log('Generated MORI iconset and macOS ICNS from build/mori-icon.svg');
