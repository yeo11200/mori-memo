import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const directory = await mkdtemp(join(tmpdir(), 'mori-quick-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await expect(page.getByTitle('설정', { exact: true })).toBeVisible();
  await page.getByTitle('설정', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '모델', exact: true })).toBeVisible();
  await page.getByLabel('AI 연결 방식').selectOption('openai');
  await expect(page.getByLabel('OpenAI API 키')).toBeVisible();
  await page.screenshot({ path: join(directory, 'api-settings.png') });
  await page.getByLabel('설정 닫기').click();
  const state = await page.evaluate(() => window.wiki.handleBootstrap());
  expect(state.settings.shortcuts.find(binding => binding.action === 'quick-note')?.accelerator).toBe('CommandOrControl+Shift+Space');
  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Space'))).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  // Invoke the menu's shared quick-note dispatcher; registration is checked above.
  if (process.argv.includes('--native-key')) {
    await promisify(execFile)('/usr/bin/osascript', ['-e', 'tell application "Finder" to activate', '-e', 'tell application "System Events" to key code 49 using {command down, shift down}']);
  } else await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === '빠른 메모').click());
  await expect.poll(() => app.windows().length).toBe(2);
  const quick = app.windows().find(window => window !== page);
  await expect(quick.getByLabel('빠른 메모 내용')).toBeFocused();
  await quick.getByLabel('빠른 메모 내용').fill('백그라운드 메모\n\n다른 앱에서 떠오른 생각');
  await quick.screenshot({ path: join(directory, 'quick-note.png') });
  await quick.keyboard.press('Escape');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === '빠른 메모').click());
  await expect(quick.getByLabel('빠른 메모 내용')).toHaveValue(/백그라운드 메모/);
  await quick.keyboard.press('Meta+Enter');
  await expect.poll(async () => (await page.evaluate(() => window.wiki.handleBootstrap())).notes.length).toBe(1);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('#quick-note')).isVisible())).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await expect(page.locator('.wiki__note-row')).toContainText('백그라운드 메모');
  const stored = await page.evaluate(() => window.wiki.handleBootstrap());
  expect(stored.notes[0].body).toBe('백그라운드 메모\n\n다른 앱에서 떠오른 생각');
  console.log(JSON.stringify({ passed: true, packaged, directory, checks: ['model select', 'API input', 'global quick shortcut registered', 'close keeps background running', 'quick window focus', 'Escape preserves draft', 'Cmd Enter saves once', 'main notes refreshed'] }));
} finally { await app.close(); }
