import { describe, expect, it } from 'vitest';
import { handleAppendLink } from '../shared/link-edit';
import { handleParseLinks, handleResolveLink } from '../shared/links';
import type { Note } from '../shared/types';

const handleNote = (id: string, title: string, body = ''): Note => ({ id, title, body, folder: '업무', pinned: false, createdAt: '', updatedAt: '', revision: '1' });
describe('explicit note connection', () => {
  it('preserves original text and resolves same-title targets by ID', () => {
    const source = handleNote('a', '원문', '작성 중인 원문\n');
    const target = handleNote('b', '동명 메모');
    const notes = [source, target, handleNote('c', '동명 메모')];
    const body = handleAppendLink(source, target, notes, '회의에서 나온 계획');
    expect(body.startsWith(source.body)).toBe(true);
    expect(body).toContain('회의에서 나온 계획');
    expect(handleResolveLink(handleParseLinks(body)[0].target, notes)?.id).toBe('b');
    expect(source.body).toBe('작성 중인 원문\n');
  });
  it('rejects self, duplicates, missing targets, and excessive reasons', () => {
    const source = handleNote('a', '원문', '[[업무/대상]]'); const target = handleNote('b', '대상');
    expect(() => handleAppendLink(source, source, [source], '')).toThrow(/자기/);
    expect(() => handleAppendLink(source, target, [source, target], '')).toThrow(/이미/);
    expect(() => handleAppendLink(source, target, [source], '')).toThrow(/찾을/);
    expect(() => handleAppendLink(source, target, [source, target], 'a'.repeat(501))).toThrow(/500/);
  });
  it('does not treat an example in code as an existing connection', () => {
    const source = handleNote('a', '원문', '`[[대상]]`'); const target = handleNote('b', '대상');
    expect(handleParseLinks(handleAppendLink(source, target, [source, target], ''))).toHaveLength(1);
  });
});
