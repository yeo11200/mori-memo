import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-work-smoke-'));
const fixture = join(directory, 'fixture.cjs');
await build({ stdin: { contents: "export { WorkService } from './electron/work/work-service'; export { Vault } from './electron/vault/vault'; export { CalendarSecureStore } from './electron/calendar/secure-store';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: fixture });
const app = await electron.launch({ ...(process.argv.includes('--packaged') ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.getByTitle('설정', { exact: true }).click();
  for (const name of ['Jira', 'GitHub', 'GitLab']) await expect(page.locator('.work-settings summary').filter({ hasText: name })).toBeVisible();
  await page.locator('.work-settings summary').filter({ hasText: 'Jira' }).click();
  await expect(page.getByLabel('Jira 사이트', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '설정 닫기' }).click();

  // UI에서는 실제 서비스와 임시 Vault를 사용하되 외부 HTTP 응답만 고정합니다.
  await app.evaluate(async ({ ipcMain, safeStorage }, { fixture, directory }) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const { join } = process.getBuiltinModule('node:path');
    const { WorkService, Vault, CalendarSecureStore } = createRequire(fixture)(fixture);
    const vault = new Vault(join(directory, 'Vault')); await vault.handleInitialize();
    const service = new WorkService(new CalendarSecureStore(join(directory, 'Secrets', 'work-connections.bin'), safeStorage), async target => {
      const url = new URL(String(target));
      if (url.pathname.endsWith('/user') || url.pathname.endsWith('/myself')) return Response.json({ id: 1, accountId: '712020:test', login: 'demo', username: 'demo', displayName: '데모 계정' });
      if (url.hostname === 'api.github.com') return Response.json([{ id: 1, title: '배포 검증', state: 'open', html_url: 'https://github.com/demo/app/issues/1', repository: { id: 10, full_name: 'demo/app' } }]);
      if (url.hostname === 'gitlab.com') return Response.json([{ id: 2, title: '릴리스 확인', state: 'opened', web_url: 'https://gitlab.com/demo/app/-/issues/2', project_id: 20 }]);
      return Response.json({ issues: [{ id: '3', key: 'APP-3', fields: { summary: '요구사항 확인', project: { id: '30', name: '앱' }, status: { name: '진행 중' }, duedate: '2026-09-14' } }], isLast: true });
    });
    for (const channel of ['work-state', 'work-connect', 'work-select', 'work-refresh', 'work-sync', 'work-disconnect']) ipcMain.removeHandler('wiki:' + channel);
    ipcMain.removeHandler('wiki:save');
    ipcMain.removeHandler('wiki:create');
    ipcMain.handle('wiki:save', (_event, note) => vault.handleSave(note));
    ipcMain.handle('wiki:create', (_event, template) => template === 'daily' ? vault.handleTodayDaily() : vault.handleCreate('제목 없는 메모'));
    ipcMain.handle('wiki:work-state', (_event, provider) => service.handleState(provider));
    ipcMain.handle('wiki:work-connect', (_event, input) => service.handleConnect(input));
    ipcMain.handle('wiki:work-select', (_event, provider, selection) => service.handleSelect(provider, selection));
    ipcMain.handle('wiki:work-refresh', (_event, provider) => service.handleRefresh(provider));
    ipcMain.handle('wiki:work-sync', (_event, provider, automatic) => service.handleSync(provider, batch => vault.handleWorkApply(batch), automatic));
    ipcMain.handle('wiki:work-disconnect', (_event, provider) => service.handleDisconnect(provider));
  }, { fixture, directory });
  await page.getByTitle('설정', { exact: true }).click();
  for (const name of ['Jira', 'GitHub', 'GitLab']) {
    await page.locator('.work-settings summary').filter({ hasText: name }).click();
    const region = page.getByRole('region', { name: name + ' 업무 연결', exact: true });
    if (name === 'Jira') {
      await region.getByLabel('Jira 사이트', { exact: true }).fill('https://demo.atlassian.net');
      await region.getByLabel('Jira 계정 이메일', { exact: true }).fill('demo@example.com');
    }
    await region.locator('input[type="password"]').fill('fixture-token');
    await region.getByRole('button', { name: name + ' 연결', exact: true }).click();
    await expect(region.getByRole('status')).toContainText('연결했습니다');
    await region.getByLabel('모든 프로젝트에서 가져오기').uncheck();
    await region.locator('.work-settings__projects input').check();
    await region.getByLabel('오늘 데일리 열 때 자동 갱신').check();
    await region.getByRole('button', { name: '필터 저장·오늘 업무 가져오기', exact: true }).click();
    await expect(region.getByRole('status')).toContainText('담당 업무를 반영했습니다');
    await page.locator('.work-settings summary').filter({ hasText: name }).click();
  }
  await page.getByRole('button', { name: '설정 닫기' }).click();
  await expect(page.locator('.wiki__markdown input[type="checkbox"]')).toHaveCount(3);
  await expect(page.locator('.wiki__markdown')).not.toContainText('mori-work');
  await expect(page.locator('.wiki__markdown').getByRole('button', { name: '배포 검증 ↗' })).toBeVisible();
  await page.locator('.wiki__markdown input[type="checkbox"]').first().check();
  await page.waitForFunction(async () => (await window.wiki.handleBootstrap()).notes.find(note => note.dailyDate)?.body.includes('- [x]'));
  const before = await page.evaluate(async () => (await window.wiki.handleBootstrap()).notes.find(note => note.dailyDate).revision);
  await page.getByRole('button', { name: '오늘 데일리 열기', exact: true }).click();
  await page.waitForFunction(async previous => (await window.wiki.handleBootstrap()).notes.find(note => note.dailyDate)?.revision !== previous, before);
  await page.waitForFunction(async () => (await window.wiki.handleWorkState('gitlab')).lastSync !== undefined);
  await expect(page.locator('.wiki__toast--error')).toHaveCount(0);
  await expect(page.locator('.wiki__markdown input[type="checkbox"]').first()).toBeChecked();
  await expect(page.locator('.wiki__markdown input[type="checkbox"]')).toHaveCount(3);
  await page.getByTitle('설정', { exact: true }).click();
  await page.locator('.work-settings summary').filter({ hasText: 'GitHub' }).click();
  await page.screenshot({ path: join(directory, 'work-settings.png') });
  const github = page.getByRole('region', { name: 'GitHub 업무 연결', exact: true });
  await github.getByRole('button', { name: '연결 해제', exact: true }).click();
  await expect(github.getByRole('status')).toContainText('연결을 해제했습니다');
  const result = await page.evaluate(async () => (await window.wiki.handleBootstrap()).notes);
  expect(result.filter(note => note.dailyDate)).toHaveLength(1);
  expect(result.find(note => note.dailyDate).workSnapshots).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain('fixture-token');
  await expect(page.locator('.wiki__toast--error')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('PASS: three provider forms, real service/Vault with mocked HTTP, encrypted token store, project selection, sync, automatic refresh, checkbox preservation, disconnect keeps notes. Screenshot: ' + join(directory, 'work-settings.png'));
} finally { await app.close(); }
