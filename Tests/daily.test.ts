import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../electron/vault/vault';
import { handleDailyTasks, handleLocalDate } from '../shared/daily';

const roots: string[] = [];
const handleSetup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mori-daily-test-'));
  roots.push(root);
  const vault = new Vault(root);
  await vault.handleInitialize();
  return { root, vault };
};
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('daily task hub', () => {
  it('reuses a daily across concurrent requests, rename, folder move, and restart', async () => {
    const { vault, root } = await handleSetup();
    const daily = await Promise.all(Array.from({ length: 5 }, () => vault.handleTodayDaily()));
    expect(new Set(daily.map(note => note.id)).size).toBe(1);
    await vault.handleSave({ ...daily[0], title: '내 하루', folder: '업무', body: '내 기록 그대로' });
    const reopened = new Vault(root);
    await reopened.handleInitialize();
    const same = await reopened.handleTodayDaily();
    expect(same.id).toBe(daily[0].id);
    expect(same.body).toBe('내 기록 그대로');
    expect(same.folder).toBe('업무');
    expect((await reopened.handleList()).length).toBe(1);
  });
  it('adopts legacy daily without overwriting text and refuses ambiguity or a trashed daily', async () => {
    const { vault } = await handleSetup();
    const title = handleLocalDate() + ' 데일리 노트';
    const legacy = await vault.handleCreate(title, '원문 보존', '데일리');
    const adopted = await vault.handleTodayDaily();
    expect(adopted.id).toBe(legacy.id);
    expect(adopted.body).toBe(legacy.body);
    expect(adopted.dailyDate).toBe(handleLocalDate());
    const duplicate = await vault.handleCreate(title, '다른 원문', '데일리');
    await expect(vault.handleTodayDaily()).rejects.toThrow('여러 개');
    await vault.handleTrash(duplicate.id);
    await vault.handleTrash(adopted.id);
    await expect(vault.handleTodayDaily()).rejects.toThrow('휴지통');
  });
  it('copies selected tasks with real source links and deduplicates even after local completion', async () => {
    const { vault } = await handleSetup();
    const source = await vault.handleCreate('회의록', '- [ ] 배포 확인\n- [x] 완료 항목\n- [ ] 문서 정리');
    const input = { tasks: [{ noteId: source.id, revision: source.revision, line: 1 }] };
    const results = await Promise.all([vault.handleDailyTransfer(input), vault.handleDailyTransfer(input)]);
    expect(results.map(result => result.added)).toEqual([1, 0]);
    const daily = results[0].note;
    expect(daily.body).toContain('[[' + source.id + '|회의록]]');
    expect(daily.body).not.toContain('완료 항목');
    await vault.handleSave({ ...daily, body: daily.body.replace('- [ ] 배포 확인', '- [x] 내가 수정한 할 일') + '\n직접 쓴 기록' });
    const repeated = await vault.handleDailyTransfer(input);
    expect(repeated.added).toBe(0);
    expect(repeated.note.body).toContain('직접 쓴 기록');
    expect((await vault.handleGet(source.id)).body).toBe(source.body);
    expect((await vault.handleHistory(daily.id)).length).toBeGreaterThan(0);
  });
  it('rejects stale source selections and does not touch the daily on failure', async () => {
    const { vault } = await handleSetup();
    const source = await vault.handleCreate('회의', '- [ ] 최초 작업');
    const daily = await vault.handleTodayDaily();
    await vault.handleSave({ ...source, body: '- [x] 최초 작업' });
    await expect(vault.handleDailyTransfer({ tasks: [{ noteId: source.id, revision: source.revision, line: 1 }] })).rejects.toThrow('변경');
    expect((await vault.handleGet(daily.id)).body).toBe(daily.body);
  });
  it('preserves external changes instead of overwriting a daily', async () => {
    const { vault, root } = await handleSetup();
    const source = await vault.handleCreate('회의', '- [ ] 작업');
    const daily = await vault.handleTodayDaily();
    const path = join(root, 'Notes', daily.id + '.md');
    await writeFile(path, (await readFile(path, 'utf8')) + '\n외부 편집');
    await expect(vault.handleDailyTransfer({ tasks: [{ noteId: source.id, revision: source.revision, line: 1 }] })).rejects.toThrow('변경');
    expect((await readFile(path, 'utf8')).endsWith('외부 편집')).toBe(true);
  });
  it('carries unfinished items without nesting source decorations or altering yesterday', async () => {
    const { vault } = await handleSetup();
    const key = 'a'.repeat(64);
    const yesterday = await vault.handleCreate('2026-01-01 데일리 노트', '- [ ] 할 일 — [[11111111-1111-1111-1111-111111111111|회의]] <!-- mori-task:' + key + ' -->\n- [x] 완료', '데일리');
    const result = await vault.handleDailyTransfer({ tasks: [{ noteId: yesterday.id, revision: yesterday.revision, line: 1 }] });
    expect(result.note.body).toContain('- [ ] 할 일 — [[' + yesterday.id);
    expect(result.note.dailyTaskKeys).toContain(key);
    expect((await vault.handleGet(yesterday.id)).body).toBe(yesterday.body);
    await expect(vault.handleDailyTransfer({ tasks: [{ noteId: result.note.id, revision: result.note.revision, line: handleDailyTasks(result.note.body)[0].line }] })).rejects.toThrow('이미 오늘');
  });
  it('distinguishes identical tasks and keeps identity when a sibling is completed', async () => {
    const { vault } = await handleSetup();
    const source = await vault.handleCreate('회의', '- [ ] 확인\n- [ ] 확인');
    await vault.handleDailyTransfer({ tasks: [{ noteId: source.id, revision: source.revision, line: 2 }] });
    const changed = await vault.handleSave({ ...source, body: '- [x] 확인\n- [ ] 확인' });
    const again = await vault.handleDailyTransfer({ tasks: [{ noteId: source.id, revision: changed.revision, line: 2 }] });
    expect(again.added).toBe(0);
  });
  it('does not extract completed tasks, blank tasks, or fenced code examples', () => {
    const body = '- [ ] 실제\n- [x] 완료\n- [ ] \n' + '~~~md\n- [ ] 코드\n~~~\n' + '1. [ ] 번호 항목';
    expect(handleDailyTasks(body).map(task => task.text)).toEqual(['실제', '번호 항목']);
  });
  it('supports a custom task and enforces length and one-line input', async () => {
    const { vault } = await handleSetup();
    const source = await vault.handleCreate('아이디어', '그대로');
    const input = { tasks: [], custom: { noteId: source.id, revision: source.revision, text: '검토하기' } };
    expect((await vault.handleDailyTransfer(input)).added).toBe(1);
    expect((await vault.handleDailyTransfer(input)).added).toBe(0);
    await expect(vault.handleDailyTransfer({ ...input, custom: { ...input.custom, text: '첫줄\n둘째줄' } })).rejects.toThrow('한 줄');
  });
});
