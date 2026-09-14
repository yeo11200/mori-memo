import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-daily-smoke-'));
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.evaluate(async () => {
    const source = await window.wiki.handleCreateNote('blank');
    await window.wiki.handleSaveNote({ ...source, title: '데일리 기능 검증', body: '- [ ] 배포 확인\n- [ ] 문서 정리\n- [x] 완료 항목' });
    const yesterday = await window.wiki.handleCreateNote('blank');
    await window.wiki.handleSaveNote({ ...yesterday, title: '2026-01-01 데일리 노트', folder: '데일리', body: '- [ ] 남은 업무\n- [x] 지난 완료' });
  });
  await page.reload();
  await page.locator('.wiki__note-row').filter({ hasText: '데일리 기능 검증' }).click();
  await page.getByRole('button', { name: '오늘 할 일로 보내기', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '오늘 할 일로 보내기' });
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(2);
  await dialog.locator('input[type="checkbox"]').first().check();
  await dialog.getByRole('button', { name: '오늘 데일리에 추가' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '미완료 할 일 가져오기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '오늘 데일리 열기', exact: true }).click();
  await page.getByRole('button', { name: '오늘 데일리 열기', exact: true }).click();
  const notes = await page.evaluate(async () => (await window.wiki.handleBootstrap()).notes);
  expect(notes.filter(note => note.dailyDate)).toHaveLength(1);
  expect(notes.find(note => note.dailyDate).body).toContain('배포 확인');
  expect(notes.find(note => note.title === '데일리 기능 검증').body).toContain('- [ ] 배포 확인');
  await page.getByRole('button', { name: '미완료 할 일 가져오기', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '미완료 할 일 가져오기' });
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(1);
  await dialog.locator('input[type="checkbox"]').check();
  await dialog.getByRole('button', { name: '오늘 데일리에 추가' }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await page.evaluate(async () => (await window.wiki.handleBootstrap()).notes.find(note => note.dailyDate));
  expect(saved.body).toContain('남은 업무');
  await expect(page.locator('.wiki__markdown')).not.toContainText('mori-task:');
  await page.locator('.wiki__markdown input[type="checkbox"]').first().check();
  await page.waitForFunction(async () => (await window.wiki.handleBootstrap()).notes.find(note => note.dailyDate)?.body.includes('- [x] 배포 확인'));
  await page.screenshot({ path: join(directory, 'daily.png') });
  console.log('PASS: selection, transfer, reuse, carryover, original preservation. Screenshot: ' + join(directory, 'daily.png'));
} finally { await app.close(); }
