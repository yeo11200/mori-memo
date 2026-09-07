import { describe, expect, it } from 'vitest';
import { handleParseLinks, handleResolveLink, handleBacklinks, handleRelatedNotes } from '../shared/links';
import type { Note } from '../shared/types';

const handleNote = (id: string, title: string, body = '', folder = '메모'): Note => ({
  id, title, body, folder, pinned: false, createdAt: '', updatedAt: '', revision: '1'
});
describe('wiki relationships', () => {
  it('parses aliases and headings but ignores code and image embeds', () => {
    const text = '[[정책#결정|인증]] `[[코드]]`\n```md\n[[예제]]\n```\n![[이미지]]\n[[회의]]';
    expect(handleParseLinks(text).map(link => [link.target, link.label, link.heading])).toEqual([
      ['정책', '인증', '결정'], ['회의', '회의', '']
    ]);
  });
  it('refuses ambiguous names and resolves folder-specific links', () => {
    const notes = [handleNote('a', '정책', '', '개발'), handleNote('b', '정책', '', '운영')];
    expect(handleResolveLink('정책', notes)).toBeUndefined();
    expect(handleResolveLink('개발/정책', notes)?.id).toBe('a');
  });
  it('derives backlinks from actual references, not keywords', () => {
    const notes = [handleNote('a', '정책'), handleNote('b', '회의', '[[정책]]을 결정'), handleNote('c', '아이디어', '정책 검토')];
    expect(handleBacklinks(notes[0], notes).map(note => note.id)).toEqual(['b']);
  });
  it('finds related content without requiring an AI process', () => {
    const source = handleNote('a', '로그인 회의', '인증 오류 해결');
    const notes = [source, handleNote('b', '인증 정책', '로그인 오류 기록'), handleNote('c', '점심', '메뉴 추천')];
    expect(handleRelatedNotes(source, notes).map(item => item.note.id)).toEqual(['b']);
  });
});
