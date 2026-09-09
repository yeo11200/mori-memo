import { createHash } from 'node:crypto';
import type { Note } from '../../shared/types';
import type { AppleNote, AppleStatus } from '../../shared/apple-notes';

export const handleContentHash = (note: { title: string; body: string }) => createHash('sha256').update(JSON.stringify([note.title.trim().slice(0, 160) || '제목 없는 메모', note.body])).digest('hex');
/** 제목·본문의 변경을 비교하며 MORI에서 이동한 폴더는 유지합니다. */
export const handleImportStatus = (source: AppleNote, note?: Note): AppleStatus => {
  if (source.error) return 'failed';
  if (!note) return 'created';
  const previous = note.appleSource!;
  if (previous.sourceHash === handleContentHash(source)) return 'unchanged';
  return previous.importedHash !== handleContentHash(note) ? 'review' : 'updated';
};
