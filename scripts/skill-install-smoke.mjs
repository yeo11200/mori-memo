import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mori-install-'));
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  await app.evaluate(({ app }, path) => app.setPath('home', path), directory);
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.wiki));
  await page.getByTitle('설정', { exact: true }).click();
  const button = page.getByRole('button', { name: 'Codex·Claude 스킬 설치', exact: true });
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: '스킬을 처음 설치했습니다' })).toBeInViewport();
  for (const client of ['.agents', '.claude']) {
    const target = join(directory, client, 'skills/mori-context');
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(await readFile('skills/mori-context/SKILL.md', 'utf8'));
    expect(await readFile(join(target, 'scripts/mori.py'), 'utf8')).toBe(await readFile('skills/mori-context/scripts/mori.py', 'utf8'));
  }
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: '기존 설치본 백업' })).toBeInViewport();
  expect((await readdir(join(directory, '.mori-skill-backups'))).length).toBe(1);
  const target = join(directory, '.agents/skills/mori-context');
  await rm(target, { recursive: true });
  await symlink(resolve('skills/mori-context'), target);
  await button.click();
  await expect(page.getByRole('alert')).toContainText('심볼릭 링크');
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(button).toBeEnabled();
  console.log('PASS: isolated install, file contents, backup, inline success and error');
} finally { await app.close(); }
