import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// 연결 스킬이 보관함에 직접 쓴 메모가 앱을 다시 열지 않아도 목록에 나타나는지 확인합니다.
const directory = await mkdtemp(join(tmpdir(), 'mori-external-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/mac-arm64/MORI.app/Contents/MacOS/MORI'), args: [] } : { args: [resolve('.')] }), env: { ...process.env, WIKI_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await expect(page.getByTitle('설정', { exact: true })).toBeVisible();
  const bridge = resolve('skills/mori-context/scripts/mori.py');
  const vault = join(directory, 'Vault');
  const proposal = join(directory, 'proposal.json');
  await writeFile(proposal, JSON.stringify({ title: '외부에서 추가한 메모', body: '스킬이 저장한 본문', folder: '미분류', reason: '검증', sourceRefs: ['scripts/external-note-smoke.mjs'] }));
  const run = async (...args) => JSON.parse((await promisify(execFile)('python3', [bridge, '--vault', vault, ...args])).stdout);
  const { approvalHash } = await run('propose', '--file', proposal);
  const created = await run('create', '--file', proposal, '--approve', approvalHash);
  expect(created.created).toBe(true);
  await expect(page.getByText('외부에서 추가한 메모')).toBeVisible({ timeout: 5000 });
  console.log('PASS: external note appeared without restart');
} finally { await app.close(); }
