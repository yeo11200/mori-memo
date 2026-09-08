import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-graph-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.evaluate(async () => {
    await window.wiki.handleCreateFolder('빈 폴더');
    const samples = [
      ['회의', '업무', '[[업무/계획]] [[독서/책]] [[없는 문서]]'],
      ['계획', '업무', '[[업무/회의]]'],
      ['연결 없는 메모', '업무', '아직 연결하지 않은 생각'],
      ['책', '독서', '독서 기록'],
      ['발췌', '독서', '[[업무/회의]]'],
      ...Array.from({ length: 14 }, (_, i) => ['기록 ' + i, '많은 메모', ''])
    ];
    for (const [title, folder, body] of samples) {
      const note = await window.wiki.handleCreateNote('blank');
      await window.wiki.handleSaveNote({ ...note, title, folder, body });
    }
  });
  await page.reload();
  await page.getByRole('button', { name: '그래프', exact: true }).click();
  const graph = page.getByLabel('폴더 중심 지식 그래프', { exact: true });
  await expect(graph.getByRole('button', { name: '폴더 업무, 메모 3개' })).toBeVisible();
  await expect(graph.getByRole('button', { name: '폴더 빈 폴더, 메모 0개' })).toBeVisible();
  await expect(graph.locator('.folder-graph__edge line')).toHaveCount(1);
  await expect(graph.locator('.folder-graph__edge text')).toHaveText('2');
  await graph.getByRole('button', { name: '그래프 확대', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '폴더 중심 지식 그래프' })).toBeVisible();
  await expect(graph.getByLabel('그래프 검색')).toBeFocused();
  await page.screenshot({ path: join(directory, 'folder-overview.png') });
  await graph.getByRole('button', { name: '폴더 업무, 메모 3개' }).click();
  await expect(graph.locator('.folder-graph__edge line')).toHaveCount(2);
  await graph.getByRole('button', { name: '메모 회의 연결 상세', exact: true }).click();
  const detail = graph.getByLabel('메모 연결 상세', { exact: true });
  await expect(detail.getByRole('heading', { name: '회의', exact: true })).toBeVisible();
  await expect(detail.getByText('[[없는 문서]]', { exact: true })).toBeVisible();
  await expect(detail.locator('.folder-graph__references').nth(0).getByRole('button')).toHaveCount(2);
  await expect(detail.locator('.folder-graph__references').nth(1).getByRole('button')).toHaveCount(2);
  await graph.getByRole('button', { name: '그래프 배율 늘리기' }).click();
  await expect(graph.getByRole('button', { name: '그래프 배율 초기화' })).toHaveText('125%');
  await graph.getByRole('button', { name: '그래프 배율 초기화' }).click();
  await page.screenshot({ path: join(directory, 'note-detail.png') });
  await detail.getByRole('button', { name: '이 메모 열기' }).click();
  await expect(page.getByLabel('메모 제목')).toHaveValue('회의');
  await expect(page.getByRole('dialog', { name: '폴더 중심 지식 그래프' })).toHaveCount(0);
  await graph.getByRole('button', { name: '전체 폴더로 돌아가기' }).click();
  await graph.getByLabel('그래프 검색').fill('발췌');
  await expect(graph.locator('.folder-graph__node')).toHaveCount(1);
  await graph.getByLabel('그래프 검색').fill('');
  await graph.getByRole('button', { name: '폴더 빈 폴더, 메모 0개' }).click();
  await expect(graph.getByText('아직 빈 폴더예요')).toBeVisible();
  await graph.getByRole('button', { name: '전체 폴더로 돌아가기' }).click();
  await graph.getByRole('button', { name: '폴더 많은 메모, 메모 14개' }).click();
  await expect(graph.locator('.folder-graph__node')).toHaveCount(12);
  await graph.getByRole('button', { name: /12개 더 보기/ }).click();
  await expect(graph.locator('.folder-graph__node')).toHaveCount(14);
  await graph.getByRole('button', { name: '그래프 확대', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(graph.getByRole('button', { name: '그래프 확대', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, packaged, directory, checks: ['folder aggregation', 'real edges only', 'empty folders', 'note incoming/outgoing/broken links', 'open memo', 'search', 'zoom', 'expand/Escape focus', 'pagination'] }));
} finally { await app.close(); }
