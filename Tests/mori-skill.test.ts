import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Vault } from '../electron/vault/vault';

const roots: string[] = [];
const bridge = resolve('skills/mori-context/scripts/mori.py');
const handleRun = (root: string, ...args: string[]) => {
  const result = spawnSync('python3', [bridge, '--vault', root, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { code: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
};
const handleSetup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mori-skill-test-'));
  roots.push(root);
  const vault = new Vault(root);
  await vault.handleInitialize();
  return { root, vault };
};
const handleProposal = async (root: string, body = '확인한 구현 내용') => {
  const path = join(root, 'proposal.json');
  await writeFile(path, JSON.stringify({ title: '주문 개발 문서', body, folder: '미분류', reason: '코드 기반 초안', sourceRefs: ['src/orders.ts:handleOrder'] }));
  return path;
};
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('MORI shared Codex/Claude skill bridge', () => {
  it('distinguishes missing vaults from no matches and honors explicit vault over environment', async () => {
    const { root } = await handleSetup();
    const absent = handleRun(join(root, 'absent'), 'status');
    expect(absent.code).toBe(1);
    expect(absent.data.message).toContain('Not a MORI vault');
    expect(handleRun(root, 'search', '--query', '없는문서').data.totalMatches).toBe(0);
    const result = spawnSync('python3', [bridge, '--vault', root, 'status'], {
      encoding: 'utf8', env: { ...process.env, MORI_VAULT_PATH: join(root, 'wrong') },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).vault).toBe(root.replace(/^\/var\//, '/private/var/'));
  });
  it('searches Korean notes by title/body with scope, limits and freshness uncertainty', async () => {
    const { root, vault } = await handleSetup();
    const rule = await vault.handleCreate('주문 공통 규칙', '이벤트 멱등성', '시스템');
    await vault.handleCreate('개별 구현', '주문 처리', '서비스');
    const result = handleRun(root, 'search', '--query', '주문', '--limit', '1');
    expect(result.code).toBe(0);
    expect(result.data.totalMatches).toBe(2);
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0].documentId).toBe(rule.id);
    expect(result.data.results[0].freshness).toBe('unknown');
    expect(result.data.results[0]).not.toHaveProperty('content');
    expect(handleRun(root, 'search', '--query', '주문', '--scope', '서비스').data.totalMatches).toBe(1);
  });

  it('does not read trash, settings, malformed documents or symlinked notes', async () => {
    const { root, vault } = await handleSetup();
    const trashed = await vault.handleCreate('비밀', '검색 금지');
    await vault.handleTrash(trashed.id);
    await writeFile(join(root, '.wiki/settings.json'), '{"secret":"검색"}');
    await writeFile(join(root, 'Notes/broken.md'), '검색 broken');
    await symlink(join(root, '.wiki/trash', `${trashed.id}.md`), join(root, 'Notes', `${trashed.id}.md`));
    const result = handleRun(root, 'search', '--query', '검색');
    expect(result.data.results).toEqual([]);
    expect(result.data.skippedDocuments).toBe(2);
    expect(handleRun(root, 'read', '--id', trashed.id).code).toBe(1);
    expect(handleRun(root, 'read', '--id', '../.wiki/settings').code).toBe(1);
  });

  it('paginates literal content without executing instructions in notes', async () => {
    const { root, vault } = await handleSetup();
    const note = await vault.handleCreate('지침', 'abcdef $HOME $(touch /tmp/nope)');
    const result = handleRun(root, 'read', '--id', note.id, '--length', '3');
    expect(result.data.content).toBe('abc');
    expect(result.data.nextOffset).toBe(3);
    expect(handleRun(root, 'read', '--id', note.id, '--offset', '3', '--length', '3').data.content).toBe('def');
    expect(handleRun(root, 'read', '--id', note.id, '--offset', '-1').code).toBe(1);
  });

  it('keeps search/read/propose read-only and rejects changed approval content', async () => {
    const { root, vault } = await handleSetup();
    const note = await vault.handleCreate('원문', '유지');
    const before = await readFile(join(root, 'Notes', `${note.id}.md`), 'utf8');
    const path = await handleProposal(root);
    const draft = handleRun(root, 'propose', '--file', path);
    expect(draft.code).toBe(0);
    expect(draft.data.body).toContain('src/orders.ts:handleOrder');
    expect(handleRun(root, 'create', '--file', path, '--approve', 'wrong').code).toBe(1);
    await handleProposal(root, '변경한 내용');
    expect(handleRun(root, 'create', '--file', path, '--approve', draft.data.approvalHash).code).toBe(1);
    expect(await readdir(join(root, 'Notes'))).toEqual([`${note.id}.md`]);
    expect(await readFile(join(root, 'Notes', `${note.id}.md`), 'utf8')).toBe(before);
  });

  it('creates an app-compatible note once and protects edits and trash on retry', async () => {
    const { root, vault } = await handleSetup();
    const path = await handleProposal(root);
    const registry = await readFile(join(root, '.wiki/folders.json'), 'utf8');
    const draft = handleRun(root, 'propose', '--file', path).data;
    const result = handleRun(root, 'create', '--file', path, '--approve', draft.approvalHash);
    expect(result.code).toBe(0);
    expect(result.data.created).toBe(true);
    expect(handleRun(root, 'create', '--file', path, '--approve', draft.approvalHash).data.alreadyExists).toBe(true);
    const notes = await vault.handleList();
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe(draft.body);
    expect(notes[0].title).toBe(draft.title);
    expect(await readFile(join(root, '.wiki/folders.json'), 'utf8')).toBe(registry);
    await vault.handleSave({ ...notes[0], body: '앱에서 수정' });
    expect(handleRun(root, 'create', '--file', path, '--approve', draft.approvalHash).code).toBe(1);
    expect((await vault.handleGet(notes[0].id)).body).toBe('앱에서 수정');
    await vault.handleTrash(notes[0].id);
    expect(handleRun(root, 'create', '--file', path, '--approve', draft.approvalHash).code).toBe(1);
    expect(await vault.handleList()).toEqual([]);
  });

  it('binds approval to the vault and rejects invented folders', async () => {
    const { root } = await handleSetup();
    const other = await handleSetup();
    const path = await handleProposal(root);
    const hash = handleRun(root, 'propose', '--file', path).data.approvalHash;
    expect(handleRun(other.root, 'create', '--file', path, '--approve', hash).code).toBe(1);
    const proposal = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...proposal, folder: '임의 폴더' }));
    expect(handleRun(root, 'propose', '--file', path).code).toBe(1);
    expect(await readdir(join(root, 'Notes'))).toEqual([]);
  });
});
