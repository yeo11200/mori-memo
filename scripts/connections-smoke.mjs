import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-connections-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.wiki));
  const ids = await page.evaluate(async () => {
    const ids = [];
    for (const [title, folder, body] of [['회의', '업무', '회의 원문'], ['실행 계획', '프로젝트', '실행할 내용'], ['무관한 기록', '독서', '독서 내용']]) {
      const note = await window.wiki.handleCreateNote('blank');
      ids.push((await window.wiki.handleSaveNote({ ...note, title, folder, body })).id);
    }
    return ids;
  });
  await page.reload();
  await page.getByRole('button', { name: '그래프', exact: true }).click();
  const graph = page.getByLabel('지식 그래프 탐색', { exact: true });
  await expect(graph.getByRole('button', { name: '메모 연결', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(graph.locator('.folder-graph__region')).toHaveCount(3);
  await expect(graph.locator('.folder-graph__edge line')).toHaveCount(0);
  await graph.getByRole('button', { name: '메모 회의 연결 상세', exact: true }).click();
  const detail = graph.getByLabel('메모 연결 상세', { exact: true });
  await expect(detail.locator('.folder-graph__preview')).toHaveText('회의 원문');
  await detail.getByRole('button', { name: '연결 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '메모 연결', exact: true });
  await expect(dialog.getByLabel('연결할 메모 검색')).toBeFocused();
  await dialog.getByLabel('연결할 메모 검색').fill('실행');
  await dialog.getByLabel('연결 후보').getByRole('button').click();
  await dialog.getByLabel('연결 이유').fill('회의에서 정한 후속 작업');
  await page.screenshot({ path: join(directory, 'connection-dialog.png') });
  await dialog.getByRole('button', { name: '연결 추가', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(graph.locator('.folder-graph__edge line')).toHaveCount(1);
  await graph.getByLabel('연결된 메모만', { exact: true }).check();
  await expect(graph.locator('.folder-graph__node')).toHaveCount(2);
  await graph.getByRole('button', { name: '그래프 확대', exact: true }).click();
  await page.screenshot({ path: join(directory, 'memo-graph.png') });
  await detail.getByRole('button', { name: '이 메모 열기' }).click();
  await expect(page.getByLabel('메모 제목')).toHaveValue('회의');
  const edit = page.getByRole('button', { name: '편집하기', exact: true });
  if (await edit.isVisible()) await edit.click();
  const body = page.getByLabel('메모 내용', { exact: true });
  const saved = await body.inputValue();
  expect(saved).toContain('회의 원문');
  expect(saved).toContain('[[' + ids[1] + '|실행 계획]]');
  expect(saved).toContain('회의에서 정한 후속 작업');
  await body.fill(saved + '\n방금 작성한 미저장 내용');
  await page.locator('.wiki__writing-tools').getByRole('button', { name: '연결 추가', exact: true }).click();
  await expect(dialog.getByLabel('연결 후보').getByRole('button')).toHaveCount(1);
  await dialog.getByLabel('연결 후보').getByRole('button').click();
  await dialog.getByRole('button', { name: '연결 추가', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const latest = await body.inputValue();
  expect(latest).toContain('방금 작성한 미저장 내용');
  expect(latest).toContain('[[' + ids[2] + '|무관한 기록]]');
  await page.reload();
  const notes = await page.evaluate(() => window.wiki.handleBootstrap().then(data => data.notes));
  expect(notes.find(note => note.id === ids[0]).body).toBe(latest);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, packaged, directory, checks: ['folder areas', 'real memo edges', 'preview', 'link dialog search/reason', 'connected neighborhood', 'unsaved text preservation', 'duplicate exclusion', 'persistent save'] }));
} finally { await app.close(); }
