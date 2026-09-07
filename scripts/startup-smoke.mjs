import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-startup-'));
const handleLaunch = () => electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory } });
let app = await handleLaunch();
try {
  let page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  const initial = await page.evaluate(() => window.wiki.handleBootstrap());
  expect(initial.settings.shortcuts.map(item => item.action)).toContain('search');
  await expect(page.getByLabel('메모 검색')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['meta'] });
  });
  await expect(page.getByLabel('메모 검색')).toBeFocused();
  await page.evaluate(async () => {
    const state = await window.wiki.handleBootstrap();
    await window.wiki.handleSaveSettings({ ...state.settings, shortcuts: [] });
    await window.wiki.handleCreateFolder('재시작 폴더');
    const note = await window.wiki.handleCreateNote('blank');
    await window.wiki.handleSaveNote({ ...note, title: '보존 확인', body: '재시작 후에도 보존', folder: '재시작 폴더' });
  });
  await app.close();
  await mkdir(join(directory, 'Secrets'), { recursive: true });
  await writeFile(join(directory, 'Secrets', 'openai-api-key.bin'), 'corrupt-test-ciphertext');
  app = await handleLaunch();
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  const restored = await page.evaluate(() => window.wiki.handleBootstrap());
  expect(restored.notes.some(note => note.title === '보존 확인')).toBe(true);
  expect(restored.settings.shortcuts).toEqual([]);
  expect(restored.settings.apiKeyConfigured).toBe(true);
  expect(restored.warnings.join(' ')).toContain('API 키');
  expect(await page.evaluate(() => window.wiki.handleListFolders())).toContain('재시작 폴더');
  await page.getByTitle('설정', { exact: true }).click();
  await page.getByLabel('AI 연결 방식').selectOption('openai');
  await page.getByRole('button', { name: '저장된 API 키 삭제' }).click();
  await expect(page.getByRole('button', { name: '저장된 API 키 삭제' })).toHaveCount(0);
  expect((await page.evaluate(() => window.wiki.handleBootstrap())).settings.apiKeyConfigured).toBe(false);
  console.log(JSON.stringify({ passed: true, checks: ['fresh default native shortcuts', 'restart preserves notes/folders', 'explicit disabled shortcuts persist', 'corrupt API key recovery and deletion'] }));
} finally { await app.close(); }
