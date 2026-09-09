import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-apple-ui-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  // 테스트 프로세스에서만 OS 읽기 응답을 대체합니다. 앱에는 fixture 진입점을 넣지 않습니다.
  await app.evaluate(async () => {
    const cp = process.getBuiltinModule('child_process');
    const util = process.getBuiltinModule('util');
    const original = cp.execFile;
    globalThis.appleFixture = { folders: [{ id: 'work', name: 'iCloud / 업무' }], notes: [{ id: 'a1', title: 'Apple 회의', body: 'Apple 원문', folderId: 'work', folder: 'iCloud / 업무', warnings: [] }], warnings: [] };
    const wrapped = (...args) => original(...args);
    wrapped[util.promisify.custom] = async (...args) => {
      if (args[0] === '/usr/bin/osascript' && args[1].includes('JavaScript')) {
        if (globalThis.appleFailure) throw new Error('Not authorized -1743');
        return { stdout: JSON.stringify(globalThis.appleFixture), stderr: '' };
      }
      return util.promisify(original)(...args);
    };
    cp.execFile = wrapped;
  });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: 'Apple 메모 가져오기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apple 메모 가져오기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Apple 메모 연동' });
  await app.evaluate(() => { globalThis.appleSavedNotes = globalThis.appleFixture.notes; globalThis.appleFixture.notes = []; });
  await dialog.getByRole('button', { name: 'Apple 메모 목록 읽기' }).click();
  await dialog.getByLabel('Apple 폴더 선택').getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '선택한 빈 폴더 연동' }).click();
  await expect(dialog.locator('.apple-import__help').first()).toContainText('연동 폴더 1개');
  await app.evaluate(() => { globalThis.appleFixture.notes = globalThis.appleSavedNotes; });
  await dialog.getByRole('button', { name: 'Apple 메모 목록 읽기' }).click();
  await dialog.getByLabel('Apple 폴더 선택').getByRole('checkbox').check();
  await page.screenshot({ path: join(directory, 'import-selection.png') });
  await dialog.getByRole('button', { name: '선택한 1개 가져오기' }).click();
  await expect(dialog.locator('.apple-import__results')).toContainText('새 메모');
  await dialog.getByRole('button', { name: '연동 창 닫기' }).click();
  await expect(page.getByLabel('메모 제목')).toHaveValue('Apple 회의');
  await expect(page.getByLabel('Apple 메모 출처')).toContainText('iCloud / 업무');
  const edit = page.getByRole('button', { name: '편집하기', exact: true }); if (await edit.isVisible()) await edit.click();
  await page.getByLabel('메모 내용').fill('MORI에서 쓴 미저장 내용');
  await page.getByRole('button', { name: 'Apple 메모 연동', exact: true }).click();
  await app.evaluate(() => { globalThis.appleFixture.notes[0].body = 'Apple에서 변경한 내용'; });
  await dialog.getByRole('button', { name: 'Apple 메모 목록 읽기' }).click();
  await dialog.getByRole('button', { name: '선택한 1개 가져오기' }).click();
  await expect(dialog.locator('.apple-import__reviews')).toContainText('MORI에서 쓴 미저장 내용');
  await expect(dialog.locator('.apple-import__reviews')).toContainText('Apple에서 변경한 내용');
  await page.screenshot({ path: join(directory, 'import-review.png') });
  await dialog.getByRole('button', { name: 'MORI 내용 유지', exact: true }).click();
  await expect(dialog.locator('.apple-import__reviews')).toHaveCount(0);
  await dialog.getByRole('button', { name: '연동 창 닫기' }).click();
  if (await edit.isVisible()) await edit.click();
  await expect(page.getByLabel('메모 내용')).toHaveValue('MORI에서 쓴 미저장 내용');
  const data = await page.evaluate(() => window.wiki.handleBootstrap());
  expect(data.notes).toHaveLength(1);
  const history = await page.evaluate(id => window.wiki.handleHistory(id), data.notes[0].id);
  expect(history.some(note => note.body === 'Apple 원문')).toBe(true);
  await page.getByRole('button', { name: 'Apple 메모 연동', exact: true }).click();
  await app.evaluate(() => { globalThis.appleFailure = true; });
  await dialog.getByRole('button', { name: 'Apple 메모 목록 읽기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('자동화');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apple 메모 연동', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, packaged, directory, checks: ['folder selection', 'real IPC and Vault persistence', 'provenance', 'unsaved edit protection', 'conflict review', 'keep local version', 'history', 'permission error', 'Escape and focus'] }));
} catch (error) {
  console.error(error);
  const pages = app.windows();
  if (pages[0]) await pages[0].screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined);
  throw error;
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); }
