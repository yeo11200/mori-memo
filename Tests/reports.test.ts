import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../electron/vault/vault';
import { ReportService } from '../electron/reports/report-service';
import { REPORT_MAX_CHARS, REPORT_TEMPLATES, handleReportDate, handleReportRange, handleRenderReport } from '../shared/reports';
import { handleLocalDate } from '../shared/daily';
import type { CLIRequest } from '../electron/cli/cli-runner';
import type { Note } from '../shared/types';
import type { ReportSource } from '../shared/reports';

const roots: string[] = [];
const setup = async (run: (request: CLIRequest) => Promise<string> = async () => { throw new Error('AI must not be called'); }) => {
  const root = await mkdtemp(join(tmpdir(), 'mori-report-test-')); roots.push(root);
  const vault = new Vault(root); await vault.handleInitialize();
  const service = new ReportService(vault, run);
  const source = await vault.handleCreate('로그인 개선', '로그인 오류 메시지를 수정했다.\n- [ ] 운영 배포 확인', '업무');
  const input = { start: '2026-10-19', end: '2026-10-25', templateId: 'weekly', sources: [{ id: source.id, revision: source.revision }] };
  return { root, vault, service, source, input };
};
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const response = (id: string) => JSON.stringify({ sections: REPORT_TEMPLATES[0].headings.map((heading, index) => ({ heading, items: index === 0 ? [{ text: '로그인 오류 메시지를 개선했다.', sourceIds: [id] }] : [] })) });

describe('report records and dates', () => {
  it('uses local modified date, and prefers a daily date even after rename', () => {
    const note = { updatedAt: '2026-10-19T23:30:00Z', title: '바뀐 제목', folder: '업무' } as Note;
    expect(handleReportDate(note)).toBe(handleLocalDate(new Date(note.updatedAt)));
    expect(handleReportDate({ ...note, dailyDate: '2026-10-01' })).toBe('2026-10-01');
    expect(handleReportDate({ ...note, updatedAt: 'invalid' })).toBe('');
    handleReportRange('2026-10-20', '2026-10-20');
    expect(() => handleReportRange('2026-10-21', '2026-10-20')).toThrow();
    expect(() => handleReportRange('2026-02-30', '2026-03-01')).toThrow();
    expect(() => handleReportRange('', '2026-03-01')).toThrow();
  });
  it('makes a local outline, saves edited output once, and leaves sources untouched', async () => {
    const { service, vault, source, input } = await setup();
    const draft = await service.handleGenerate(input, false);
    expect(draft.body).toContain(source.body);
    expect(draft.body).toContain('[[' + source.id + '|로그인 개선]]');
    expect((await vault.handleList())).toHaveLength(1);
    const saved = await Promise.all([service.handleSave(draft.id, draft.body + '\n직접 수정'), service.handleSave(draft.id, draft.body)]);
    expect(saved[0].id).toBe(saved[1].id);
    expect(saved[0].body).toContain('직접 수정');
    expect(saved[0].folder).toBe('업무보고');
    expect(await vault.handleGet(source.id)).toEqual(source);
    expect(await vault.handleList()).toHaveLength(2);
    await expect(service.handleSave('unknown', '본문')).rejects.toThrow('만료');
    await expect(service.handleSave(draft.id, '')).rejects.toThrow('본문');
  });
  it('rejects changed, deleted, duplicated, empty and oversized sources without invoking AI', async () => {
    const { service, vault, source, input } = await setup();
    await expect(service.handleGenerate({ ...input, sources: [] }, true)).rejects.toThrow('선택');
    await expect(service.handleGenerate({ ...input, sources: [...input.sources, ...input.sources] }, true)).rejects.toThrow('서로 다른');
    const empty = await vault.handleCreate('빈 기록', '');
    await expect(service.handleGenerate({ ...input, sources: [{ id: empty.id, revision: empty.revision }] }, true)).rejects.toThrow('본문');
    const big = await vault.handleCreate('큰 기록', '가'.repeat(REPORT_MAX_CHARS));
    await expect(service.handleGenerate({ ...input, sources: [{ id: big.id, revision: big.revision }] }, true)).rejects.toThrow('80,000');
    await vault.handleSave({ ...source, body: '수정한 원문' });
    await expect(service.handleGenerate(input, true)).rejects.toThrow('변경');
    await vault.handleTrash(source.id);
    await expect(service.handleGenerate(input, true)).rejects.toThrow('삭제');
  });
  it('sends only explicitly selected records and renders validated sources', async () => {
    const calls: CLIRequest[] = [];
    const { service, vault, source, input } = await setup(async request => {
      calls.push(request);
      const records = JSON.parse(request.content).records;
      return response(records[0].id);
    });
    await vault.handleCreate('선택 안 한 비공개 문서', '전달 금지');
    const draft = await service.handleGenerate(input, true);
    expect(calls).toHaveLength(1);
    expect(calls[0].content).not.toContain('전달 금지');
    expect(JSON.parse(calls[0].content).records[0].body).toBe(source.body);
    expect(draft.body).toContain('로그인 오류 메시지를 개선했다. — [[' + source.id);
    expect(draft.body).toContain('기록에서 확인되지 않음');
    expect(await vault.handleList()).toHaveLength(2);
  });
  it('does not save failed or cancelled AI drafts, and permits explicit retry', async () => {
    let calls = 0;
    const { service, input, vault } = await setup(async request => {
      calls++;
      if (calls === 1) throw new Error('AI 요청을 취소했습니다.');
      if (calls === 2) return '잘못된 응답';
      return response(JSON.parse(request.content).records[0].id);
    });
    await expect(service.handleGenerate(input, true)).rejects.toThrow('취소');
    await expect(service.handleGenerate(input, true)).rejects.toThrow('형식');
    expect(await vault.handleList()).toHaveLength(1);
    await service.handleGenerate(input, true);
    expect(calls).toBe(3);
  });
});

describe('report source contract', () => {
  const sources: ReportSource[] = [{ id: 'record-a', revision: 'v1', title: '동명 메모', date: '2026-10-20' }];
  it('rejects invented ids, uncited claims, raw wiki links and altered headings', () => {
    const good = JSON.parse(response('record-a'));
    expect(handleRenderReport(JSON.stringify(good), REPORT_TEMPLATES[0], sources)).toContain('[[record-a|동명 메모]]');
    for (const item of [null, { text: '완료', sourceIds: ['invented'] }, { text: '완료', sourceIds: [] }, { text: '[[invented]]', sourceIds: ['record-a'] }, { text: '[가짜](https://example.com)', sourceIds: ['record-a'] }]) {
      const bad = structuredClone(good); bad.sections[0].items = [item];
      expect(() => handleRenderReport(JSON.stringify(bad), REPORT_TEMPLATES[0], sources)).toThrow();
    }
    good.sections[0].heading = '없는 항목';
    expect(() => handleRenderReport(JSON.stringify(good), REPORT_TEMPLATES[0], sources)).toThrow('템플릿');
  });
});

describe('custom report templates', () => {
  it('persists create/edit/delete across service restarts, and keeps built-ins intact', async () => {
    const { root, vault, service } = await setup();
    const input = { id: '', name: '우리 팀 보고', headings: ['진행', '요청'], instruction: '정중하게 작성' };
    const templates = await service.handleSaveTemplate(input);
    const custom = templates.at(-1)!;
    const reopened = new ReportService(vault, async () => '');
    expect((await reopened.handleListTemplates()).at(-1)).toEqual(custom);
    await reopened.handleSaveTemplate({ ...custom, name: '수정한 보고' });
    expect((await reopened.handleListTemplates()).at(-1)?.name).toBe('수정한 보고');
    await expect(service.handleDeleteTemplate('weekly')).rejects.toThrow();
    await expect(service.handleSaveTemplate({ ...input, headings: [] })).rejects.toThrow('항목');
    await expect(service.handleSaveTemplate({ ...input, headings: ['중복', '중복'] })).rejects.toThrow('항목');
    await reopened.handleDeleteTemplate(custom.id);
    expect(await reopened.handleListTemplates()).toEqual(REPORT_TEMPLATES);
    await writeFile(join(root, '.wiki/report-templates.json'), '{broken');
    await expect(service.handleListTemplates()).rejects.toThrow('읽지 못');
  });
});
