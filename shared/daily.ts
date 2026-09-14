import type { Note } from './types';

/** 기존 할 일 구역 끝에 추가하며 다른 구역의 사용자 기록은 그대로 둡니다. */
export const handleAppendDailyTasks = (body: string, additions: string[]): string => {
  let fence = '';
  let section = false;
  let offset = 0;
  for (const line of body.split('\n')) {
    const delimiter = line.match(/^ {0,3}(\x60{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !line.slice(delimiter[0].length).trim()) fence = '';
    } else if (!fence) {
      if (section && /^#{1,2}\s/.test(line)) return body.slice(0, offset) + additions.join('\n') + '\n\n' + body.slice(offset);
      if (/^## (오늘 할 일|할 일|가져온 할 일)\s*$/.test(line)) section = true;
    }
    offset += line.length + 1;
  }
  if (fence) throw new Error('데일리의 코드 블록을 닫은 뒤 다시 추가해 주세요.');
  return body + (section ? '\n' : '\n\n## 가져온 할 일\n\n') + additions.join('\n') + '\n';
};

export interface DailyTask {
  line: number;
  text: string;
  originKey?: string;
}
export interface DailyTaskSelection { noteId: string; revision: string; line: number }
export interface DailyTransfer {
  tasks: DailyTaskSelection[];
  custom?: { noteId: string; revision: string; text: string };
}
export interface DailyResult { note: Note; added: number; skipped: number }

export const handleLocalDate = (now = new Date()) =>
  [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');

export const handleDailyDate = (note: Note): string | undefined =>
  note.dailyDate || (note.folder === '데일리' ? note.title.match(/^(\d{4}-\d{2}-\d{2}) 데일리 노트$/)?.[1] : undefined);

/** 코드 예제 안의 체크박스를 제외하고 아직 완료하지 않은 할 일을 찾습니다. */
export const handleDailyTasks = (body: string, includeCompleted = false): DailyTask[] => {
  let fence = '';
  const tasks: DailyTask[] = [];
  body.split('\n').forEach((line, index) => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !line.slice(delimiter[0].length).trim()) fence = '';
      return;
    }
    if (fence) return;
    const match = line.match(/^ {0,3}(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!match) return;
    if (!includeCompleted && match[1] !== ' ') return;
    const marker = match[2].match(/ <!-- mori-task:([a-f0-9]{64}) -->$/);
    const text = marker ? match[2].slice(0, marker.index).replace(/ — \[\[[^\n]+\]\]$/, '') : match[2];
    if (text.trim()) tasks.push({ line: index + 1, text: text.trim(), originKey: marker?.[1] });
  });
  return tasks;
};
