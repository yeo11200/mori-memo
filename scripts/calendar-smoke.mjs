import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-calendar-smoke-'));
const app = await electron.launch({ ...(process.argv.includes('--packaged') ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.getByTitle('설정', { exact: true }).click();
  const settings = page.getByRole('region', { name: 'Google Calendar 연결' });
  await expect(settings.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeDisabled();
  await expect(settings.getByRole('button', { name: 'OAuth JSON 선택', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '설정 닫기' }).click();
  const note = await page.evaluate(async () => {
    const daily = await window.wiki.handleCreateNote('daily');
    return window.wiki.handleSaveNote({ ...daily, body: daily.body + '\n## Google Calendar 일정\n\n<!-- mori-calendar:' + 'a'.repeat(64) + ':start -->\n### 테스트 캘린더\n\n- 15:00 · [배포 회의](https://www.google.com/calendar/event?eid=demo)\n\n<!-- mori-calendar:' + 'a'.repeat(64) + ':end -->\n\n개인 기록 보존\n' });
  });
  // 실제 계정에 접근하지 않고 설정 UI의 저장·갱신 연결을 검증합니다.
  await app.evaluate(({ ipcMain }, savedNote) => {
    let state = { configured: true, connected: true, calendars: [{ id: 'demo', name: '테스트 캘린더', primary: true }], selectedIds: [], autoSync: false };
    for (const channel of ['calendar-state', 'calendar-select', 'calendar-sync', 'calendar-disconnect']) ipcMain.removeHandler('wiki:' + channel);
    ipcMain.handle('wiki:calendar-state', () => state);
    ipcMain.handle('wiki:calendar-select', (_event, ids, auto) => { state = { ...state, selectedIds: ids, autoSync: auto }; return state; });
    ipcMain.handle('wiki:calendar-sync', () => savedNote);
    ipcMain.handle('wiki:calendar-disconnect', () => { state = { ...state, connected: false, selectedIds: [] }; return state; });
  }, note);
  await page.getByTitle('설정', { exact: true }).click();
  await settings.getByLabel('테스트 캘린더 · 기본').check();
  await settings.getByLabel('오늘 데일리를 열 때 일정 갱신').check();
  await settings.getByRole('button', { name: '선택 저장·오늘 일정 가져오기' }).click();
  await expect(settings.getByRole('status')).toContainText('오늘 데일리에 일정을 반영했습니다.');
  await expect(page.locator('.wiki__markdown')).toContainText('개인 기록 보존');
  await expect(page.locator('.wiki__markdown')).not.toContainText('mori-calendar:');
  await expect(page.locator('.wiki__markdown').getByRole('button', { name: '배포 회의 ↗' })).toBeVisible();
  await page.screenshot({ path: join(directory, 'calendar.png') });
  await settings.getByRole('button', { name: '이 기기에서 연결 해제' }).click();
  await expect(settings.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeEnabled();
  await expect(page.locator('.wiki__markdown')).toContainText('개인 기록 보존');
  console.log('PASS: disconnected setup, mocked connected settings, calendar selection, sync, links, marker hiding, local disconnect. Screenshot: ' + join(directory, 'calendar.png'));
} finally { await app.close(); }
