import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Vault } from '../electron/vault/vault';
import { AppleImportService } from '../electron/apple-notes/import-service';
import type { AppleNote, AppleCatalog } from '../shared/apple-notes';

const roots: string[] = [];
const source: AppleNote = { id: 'apple-1', title: '회의', body: '원문', folderId: 'folder-1', folder: 'iCloud / 업무', warnings: [] };
const handleSetup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mori-apple-test-')); roots.push(root);
  const vault = new Vault(root); await vault.handleInitialize();
  const catalog: AppleCatalog = { folders: [{ id: 'folder-1', name: 'iCloud / 업무' }], notes: [{ ...source }], warnings: [] };
  const service = new AppleImportService(vault, async () => catalog);
  return { vault, catalog, service };
};
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('imports once, preserves ID/history, and synchronizes future notes in selected folders', async () => {
  const { vault, catalog, service } = await handleSetup();
  await service.handleScan();
  await service.handleSync({ mode: 'selected', folderIds: ['folder-1'], noteIds: [] });
  const first = (await vault.handleList())[0];
  expect(first.appleSource?.sourceId).toBe('apple-1');
  expect(first.folder).toBe('iCloud › 업무');
  expect(first.body).toBe('원문');
  catalog.notes[0].body = 'Apple 수정';
  catalog.notes.push({ ...source, id: 'apple-2', title: '신규' });
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect(await vault.handleList()).toHaveLength(2);
  expect((await vault.handleGet(first.id)).body).toBe('Apple 수정');
  expect((await vault.handleGet(first.id)).folder).toBe('iCloud › 업무');
  expect((await vault.handleHistory(first.id)).some(note => note.body === '원문')).toBe(true);
  await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect(await vault.handleList()).toHaveLength(2);
});

it('persists conflict review, protects local edits, and rejects stale resolution', async () => {
  const { vault, catalog, service } = await handleSetup();
  await service.handleScan(); await service.handleSync({ mode: 'selected', folderIds: [], noteIds: [source.id] });
  const first = (await vault.handleList())[0];
  await vault.handleSave({ ...first, body: 'MORI 수정' });
  catalog.notes[0].body = 'Apple 수정';
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  const reopened = new AppleImportService(vault, async () => catalog);
  const state = await reopened.handleState();
  expect(state.reviews).toHaveLength(1);
  expect((await vault.handleGet(first.id)).body).toBe('MORI 수정');
  await expect(reopened.handleResolve(source.id, 'apple', first.revision)).rejects.toThrow(/변경/);
  const current = await vault.handleGet(first.id);
  await reopened.handleResolve(source.id, 'apple', current.revision);
  expect((await vault.handleGet(first.id)).body).toBe('Apple 수정');
  expect((await reopened.handleState()).reviews).toHaveLength(0);
});

it('does not recreate trashed notes and marks absent sources without deleting MORI', async () => {
  const { vault, catalog, service } = await handleSetup();
  await service.handleScan(); await service.handleSync({ mode: 'selected', folderIds: [], noteIds: [source.id] });
  const first = (await vault.handleList())[0];
  catalog.notes = [];
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect(await vault.handleList()).toHaveLength(1);
  expect((await service.handleState()).results[0].status).toBe('missing');
  catalog.notes = [source];
  await vault.handleTrash(first.id);
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect(await vault.handleList()).toHaveLength(0);
  expect((await service.handleState()).results[0].status).toBe('trashed');
});

it('keeps failures isolated and rejects forged selection IDs', async () => {
  const { vault, catalog, service } = await handleSetup();
  catalog.notes.push({ ...source, id: 'locked', error: '잠긴 메모입니다.' });
  await service.handleScan();
  await expect(service.handleSync({ mode: 'selected', folderIds: [], noteIds: ['unknown'] })).rejects.toThrow();
  await service.handleSync({ mode: 'selected', folderIds: ['folder-1'], noteIds: [] });
  expect(await vault.handleList()).toHaveLength(1);
  expect((await service.handleState()).results.some(result => result.status === 'failed')).toBe(true);
});

it('preserves local-only edits and provenance through normal saves and merges', async () => {
  const { vault, catalog, service } = await handleSetup();
  await service.handleScan(); await service.handleSync({ mode: 'selected', folderIds: [], noteIds: [source.id] });
  const first = (await vault.handleList())[0];
  await vault.handleSave({ ...first, body: '로컬 내용', folder: '내 폴더', appleSource: undefined });
  await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect((await vault.handleGet(first.id)).body).toBe('로컬 내용');
  expect((await vault.handleGet(first.id)).appleSource?.sourceId).toBe(source.id);
  catalog.notes[0].body = '원본 새 내용';
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  const current = await vault.handleGet(first.id);
  await service.handleResolve(source.id, 'merge', current.revision, '로컬 내용\n원본 새 내용');
  expect((await vault.handleGet(first.id)).body).toBe('로컬 내용\n원본 새 내용');
  expect((await vault.handleGet(first.id)).folder).toBe('내 폴더');
  catalog.notes[0].body = '다음 변경';
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect((await service.handleState()).reviews).toHaveLength(1);
});

it('imports only selected notes and includes same-title originals without conflation', async () => {
  const { vault, catalog, service } = await handleSetup();
  catalog.notes.push({ ...source, id: 'apple-2' });
  await service.handleScan(); await service.handleSync({ mode: 'selected', folderIds: [], noteIds: [source.id] });
  expect(await vault.handleList()).toHaveLength(1);
  await service.handleSync({ mode: 'selected', folderIds: [], noteIds: ['apple-2'] });
  expect(await vault.handleList()).toHaveLength(2);
});

it('invalidates an old snapshot after a failed read and retains unresolved reviews after source failure', async () => {
  const { vault, catalog, service } = await handleSetup();
  await service.handleScan(); await service.handleSync({ mode: 'selected', folderIds: [], noteIds: [source.id] });
  const note = (await vault.handleList())[0]; await vault.handleSave({ ...note, body: '로컬' });
  catalog.notes[0].body = '원본 변경';
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  catalog.notes[0].error = '읽기 실패';
  await service.handleScan(); await service.handleSync({ mode: 'all', folderIds: [], noteIds: [] });
  expect((await service.handleState()).reviews).toHaveLength(1);
  let fail = false;
  const reader = new AppleImportService(vault, async () => { if (fail) throw new Error('권한'); return catalog; });
  await reader.handleScan(); fail = true;
  await expect(reader.handleScan()).rejects.toThrow('권한');
  await expect(reader.handleSync({ mode: 'all', folderIds: [], noteIds: [] })).rejects.toThrow('새로');
});
