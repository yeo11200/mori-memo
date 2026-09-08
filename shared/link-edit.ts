import { handleParseLinks, handleResolveLink } from './links';
import type { Note } from './types';

export const handleAppendLink = (source: Note, target: Note, notes: Note[], reason: string): string => {
  if (source.id === target.id) throw new Error('자기 자신에게 연결할 수 없습니다.');
  if (typeof reason !== 'string' || reason.length > 500) throw new Error('연결 이유는 500자 이내로 작성해 주세요.');
  if (!notes.some(note => note.id === target.id)) throw new Error('연결할 메모를 찾을 수 없습니다.');
  if (handleParseLinks(source.body).some(link => handleResolveLink(link.target, notes)?.id === target.id)) throw new Error('이미 연결된 메모입니다.');
  const label = target.title.replace(/[\[\]|\r\n]/g, '').trim() || '메모';
  const explanation = reason.trim().replace(/\s+/g, ' ');
  return source.body + '\n\n연결: [[' + target.id + '|' + label + ']]' + (explanation ? ' — ' + explanation : '') + '\n';
};
