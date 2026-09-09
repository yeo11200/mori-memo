import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-tasks-'));
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  const body = '# 진행 상황\n\n[[긴 문서 이름]]\n\n- [ ] 같은 할 일\n- [ ] 같은 할 일\n  - [x] 중첩 항목\n\n> 1. [ ] 인용 항목\n\n```md\n- [ ] 코드 예제\n```\n';
  const id = await page.evaluate(async body => {
    const note = await window.wiki.handleCreateNote('blank');
    await window.wiki.handleSaveNote({ ...note, title: '체크박스 확인', body });
    return note.id;
  }, body);
  await page.reload();
  const boxes = page.locator('.wiki__markdown input[type=checkbox]');
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0)).toBeEnabled();
  await boxes.nth(1).check();
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(boxes.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(boxes.nth(1)).not.toBeChecked();
  await boxes.nth(2).uncheck();
  await boxes.nth(3).check();
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  const expected = body.replace('  - [x]', '  - [ ]').replace('> 1. [ ]', '> 1. [x]');
  expect(await page.evaluate(async id => (await window.wiki.handleBootstrap()).notes.find(note => note.id === id).body, id)).toBe(expected);
  await page.reload();
  await expect(boxes.nth(2)).not.toBeChecked();
  await expect(boxes.nth(3)).toBeChecked();
  await page.getByRole('button', { name: '편집하기', exact: true }).click();
  await expect(page.getByLabel('메모 내용')).toHaveValue(expected);
  console.log(JSON.stringify({ passed: true, directory, checks: ['duplicate task targeting', 'nested and quoted tasks', 'code block excluded', 'keyboard and focus', 'autosave and reload', 'source preserved'] }));
} finally {
  await app.close();
}
