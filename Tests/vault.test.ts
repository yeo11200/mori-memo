import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../electron/vault/vault';

const roots: string[] = [];
const handleSetup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-test-'));
  roots.push(root);
  const vault = new Vault(root);
  await vault.handleInitialize();
  return { root, vault };
};
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('Markdown vault', () => {
  it('adds a link with history and rejects stale revisions or a queued deletion', async () => {
    const { vault } = await handleSetup();
    const source = await vault.handleCreate('원문', '보존할 본문');
    const target = await vault.handleCreate('대상', '대상 본문');
    const saved = await vault.handleAddLink(source.id, target.id, source.revision, '계획의 근거');
    expect(saved.body).toContain('보존할 본문');
    expect(saved.body).toContain('[[' + target.id + '|대상]]');
    expect((await vault.handleHistory(source.id)).some(note => note.body === source.body)).toBe(true);
    await expect(vault.handleAddLink(source.id, target.id, source.revision, '')).rejects.toThrow(/변경/);
    const other = await vault.handleCreate('다른 원문', '그대로');
    const deletion = vault.handleTrash(target.id);
    await expect(vault.handleAddLink(other.id, target.id, other.revision, '')).rejects.toThrow();
    await deletion;
    expect((await vault.handleGet(other.id)).body).toBe('그대로');
  });
  it('permanently removes only a trashed note and its history and AI results', async () => {
    const { root, vault } = await handleSetup();
    const note = await vault.handleCreate('삭제 대상', '초안');
    const other = await vault.handleCreate('유지', '남길 내용');
    await vault.handleSave({ ...note, body: '수정본' });
    const resultId = '11111111-1111-1111-1111-111111111111';
    await writeFile(join(root, '.wiki/results', `${resultId}.json`), JSON.stringify({ noteId: note.id }));
    await expect(vault.handleDeletePermanently(note.id)).rejects.toThrow();
    await vault.handleTrash(note.id);
    await vault.handleDeletePermanently(note.id);
    expect(await vault.handleListTrash()).toEqual([]);
    expect(await vault.handleHistory(note.id)).toEqual([]);
    await expect(readFile(join(root, '.wiki/results', `${resultId}.json`))).rejects.toThrow();
    await expect(vault.handleRestore(note.id)).rejects.toThrow();
    expect((await vault.handleGet(other.id)).body).toBe('남길 내용');
    await expect(vault.handleDeletePermanently('../../outside')).rejects.toThrow();
  });
  it('preserves note identity and literal body on restart', async () => {
    const { root, vault } = await handleSetup();
    const note = await vault.handleCreate('회의 메모', '원문\n---\n[[로그인 정책]]\n`$HOME`');
    const reopened = new Vault(root);
    await reopened.handleInitialize();
    expect(await reopened.handleList()).toEqual([note]);
    expect(await readFile(join(root, 'Notes', `${note.id}.md`), 'utf8')).toContain('[[로그인 정책]]');
  });
  it('rejects a stale save without overwriting newer text', async () => {
    const { vault } = await handleSetup();
    const note = await vault.handleCreate('초안', '첫 문장');
    const saved = await vault.handleSave({ ...note, body: '새 문장' });
    await expect(vault.handleSave({ ...note, body: '오래된 편집' })).rejects.toThrow(/변경/);
    expect((await vault.handleList())[0].body).toBe('새 문장');
    expect((await vault.handleHistory(note.id))[0].body).toBe('첫 문장');
    expect(saved.revision).not.toBe(note.revision);
  });
  it('moves deleted notes to recoverable trash and rejects invalid identifiers', async () => {
    const { vault } = await handleSetup();
    const note = await vault.handleCreate('보존', '삭제해도 복구');
    await vault.handleTrash(note.id);
    expect(await vault.handleList()).toHaveLength(0);
    expect((await vault.handleListTrash())[0].body).toBe('삭제해도 복구');
    await vault.handleRestore(note.id);
    expect((await vault.handleList())[0].id).toBe(note.id);
    await expect(vault.handleTrash('../../outside')).rejects.toThrow();
  });
  it('keeps the last on-disk text when an external editor changed it', async () => {
    const { root, vault } = await handleSetup();
    const note = await vault.handleCreate('원문', '이전 내용');
    const path = join(root, 'Notes', `${note.id}.md`);
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace('이전 내용', '외부 편집'));
    await expect(vault.handleSave({ ...note, body: '앱 편집' })).rejects.toThrow(/변경/);
    expect(await readFile(path, 'utf8')).toContain('외부 편집');
  });
  it('exports readable Markdown names and preserves linked documents', async () => {
    const { root, vault } = await handleSetup();
    await vault.handleCreate('정책', '내용');
    await vault.handleCreate('회의', '[[정책]] 참조');
    const output = join(root, 'export');
    await vault.handleExport(output);
    expect(await readFile(join(output, '정책.md'), 'utf8')).toContain('내용');
    expect(await readFile(join(output, '회의.md'), 'utf8')).toContain('[[정책]]');
  });
  it('persists empty folders and migrates folders found in existing notes', async () => {
    const { root, vault } = await handleSetup();
    await vault.handleCreateFolder('프로젝트');
    await vault.handleCreate('회의', '', '업무');
    const reopened = new Vault(root);
    await reopened.handleInitialize();
    expect(await reopened.handleListFolders()).toEqual(['미분류', '업무', '프로젝트']);
  });
  it('renames and deletes folders while preserving note identity and old link aliases', async () => {
    const { vault } = await handleSetup();
    const note = await vault.handleCreate('계획', '본문', '업무');
    await vault.handleRenameFolder('업무', '프로젝트');
    const moved = await vault.handleGet(note.id);
    expect(moved.id).toBe(note.id);
    expect(moved.folder).toBe('프로젝트');
    expect(moved.aliases).toContain('업무/계획');
    await vault.handleDeleteFolder('프로젝트');
    const uncategorized = await vault.handleGet(note.id);
    expect(uncategorized.folder).toBe('미분류');
    expect(uncategorized.aliases).toContain('프로젝트/계획');
  });
  it('serializes concurrent folder mutations without losing entries', async () => {
    const { vault } = await handleSetup();
    await Promise.all(['A', 'B', 'C'].map(name => vault.handleCreateFolder(name)));
    expect(await vault.handleListFolders()).toEqual(['미분류', 'A', 'B', 'C']);
  });
  it('rolls back every moved note if the folder metadata commit fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'personal-wiki-test-')); roots.push(root);
    const initial = new Vault(root); await initial.handleInitialize();
    const first = await initial.handleCreate('첫째', 'A', '업무');
    const second = await initial.handleCreate('둘째', 'B', '업무');
    const failing = new Vault(root, { beforeFolderCommit: () => { throw new Error('injected failure'); } });
    await failing.handleInitialize();
    await expect(failing.handleRenameFolder('업무', '프로젝트')).rejects.toThrow('injected failure');
    expect((await failing.handleGet(first.id)).folder).toBe('업무');
    expect((await failing.handleGet(second.id)).folder).toBe('업무');
    expect(await failing.handleListFolders()).toContain('업무');
  });
  it('preserves legacy nested folder strings while using 미분류 as the default', async () => {
    const { root, vault } = await handleSetup();
    const legacy = await vault.handleCreate('Legacy', '본문', '업무');
    const path = join(root, 'Notes', `${legacy.id}.md`);
    await writeFile(path, (await readFile(path, 'utf8')).replace('"folder": "업무"', '"folder": "Projects/Work"'));
    await writeFile(join(root, '.wiki/folders.json'), JSON.stringify(['Projects/Work', '메모']));
    const reopened = new Vault(root); await reopened.handleInitialize();
    expect(await reopened.handleListFolders()).toEqual(expect.arrayContaining(['Projects/Work', '메모', '미분류']));
    await expect(reopened.handleCreateFolder('New/Folder')).rejects.toThrow(/폴더 이름/);
    expect((await reopened.handleCreate('새 메모')).folder).toBe('미분류');
    const edited = await reopened.handleSave({ ...await reopened.handleGet(legacy.id), body: '수정된 본문' });
    expect(edited.folder).toBe('Projects/Work');
    await reopened.handleRenameFolder('Projects/Work', '업무 정리');
    expect((await reopened.handleGet(legacy.id)).aliases).toContain('Projects/Work/Legacy');
  });
  it('restores the note folder to the folder catalog', async () => {
    const { vault } = await handleSetup();
    const note = await vault.handleCreate('복원', '', '옛 폴더');
    await vault.handleTrash(note.id);
    await vault.handleDeleteFolder('옛 폴더');
    await vault.handleRestore(note.id);
    expect(await vault.handleListFolders()).toContain('옛 폴더');
  });
});
