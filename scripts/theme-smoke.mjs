import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-sky-theme-'));
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.evaluate(async () => {
    for (const [title, folder, body] of [
      ['나의 지식정원', '메모', '생각을 모으고, 지식을 연결합니다.\n\n## 오늘의 아이디어\n\n- 하늘색과 흰색으로 더 가벼운 기록 공간\n- 필요한 문서를 연결해 다시 찾기\n\n[[프로젝트 계획]]'],
      ['프로젝트 계획', '업무', '작은 메모에서 시작하는 새로운 프로젝트.'],
      ['읽고 싶은 글', '독서', '오늘 읽은 글의 핵심을 기록합니다.'],
    ]) {
      const note = await window.wiki.handleCreateNote('blank');
      await window.wiki.handleSaveNote({ ...note, title, folder, body });
    }
  });
  await page.reload();
  await page.locator('.wiki__note-row').filter({ hasText: '나의 지식정원' }).click();
  await expect(page.locator('.wiki__editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.wiki__new-note')).toHaveCSS('background-color', 'rgb(3, 105, 161)');
  await page.screenshot({ path: join(directory, 'editor.png') });
  await page.getByRole('button', { name: '그래프', exact: true }).click();
  await page.screenshot({ path: join(directory, 'graph.png') });
  await page.getByTitle('설정', { exact: true }).click();
  await page.screenshot({ path: join(directory, 'settings.png') });
  console.log(JSON.stringify({ passed: true, directory }));
} finally {
  await app.close();
}
