import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'mori-ui-'));
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.evaluate(() => window.wiki.handleCreateNote('blank'));
  await page.reload();
  const panel = page.locator('.wiki__links-panel');
  await expect(panel.getByRole('button', { name: '지식 그래프' })).toBeVisible();
  await expect(panel.getByText('공통 키워드로 추천합니다. 아직 연결된 것은 아닙니다.')).toBeVisible();
  await page.getByRole('button', { name: '화면 캡처', exact: true }).isVisible().then(value => expect(value).toBe(true));
  await panel.getByRole('button', { name: '지식 그래프' }).click();
  await expect(page.getByRole('region', { name: '지식 그래프 탐색' })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '메모 연결', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '메모 연결' })).toBeVisible();
  await page.getByRole('button', { name: '연결 창 닫기' }).click();
  await page.screenshot({ path: join(directory, 'ui.png') });
  console.log('PASS: graph and link entry points, recommendation explanation; screenshot: ' + join(directory, 'ui.png'));
} finally { await app.close(); }
