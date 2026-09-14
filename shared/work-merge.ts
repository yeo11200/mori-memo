import { WORK_LABELS, type WorkBatch, type WorkSnapshot } from './work';
import { handleAppendDailyTasks } from './daily';
import { handleWorkLink } from './work-link';

const handleLabel = (text: string) => text.replace(/[\r\n\t<>\[\]|\\\x60*_#]/g, ' ').trim().slice(0, 500);
const handleNormalize = (text: string) => text.replace(/^- \[[ xX]\]/gm, '- [ ]');

/** 원본 갱신과 사용자 체크를 분리하고 다른 직접 편집은 덮어쓰지 않습니다. */
export const handleWorkMerge = (body: string, previous: WorkSnapshot[], incoming: WorkBatch) => {
  const old = previous.find(value => value.key === incoming.key);
  const start = '<!-- mori-work:' + incoming.key + ':start -->';
  const end = '<!-- mori-work:' + incoming.key + ':end -->';
  let existing = '';
  const checked = new Set<string>();
  if (old) {
    if (body.split(start).length !== 2 || body.split(end).length !== 2 || body.indexOf(end) < body.indexOf(start)) throw new Error('업무 구역이 삭제되거나 중복되었습니다. 기록을 유지합니다.');
    existing = body.slice(body.indexOf(start), body.indexOf(end) + end.length);
    if (handleNormalize(existing) !== handleNormalize(old.rendered)) throw new Error('가져온 업무 구역이 직접 수정되어 갱신을 멈췄습니다. 버전 기록으로 구역을 복원하고 개인 기록은 구역 밖에 적어 주세요.');
    for (const line of existing.split('\n')) {
      const match = line.match(/^- \[[xX]\].*<!-- mori-work-item:([a-zA-Z0-9-]+) -->$/);
      if (match) checked.add(match[1]);
    }
  } else if (body.includes(start) || body.includes(end)) throw new Error('업무 구역의 출처를 확인하지 못했습니다.');
  const ids = new Set(incoming.items.map(item => item.id));
  const items = [...incoming.items, ...(old?.items || []).filter(item => !ids.has(item.id)).map(item => ({ ...item, missing: true }))];
  const lines = items.map(item => {
    const title = handleLabel(item.title) || '제목 없는 업무';
    const link = handleWorkLink(item.url) ? '[' + title + '](' + item.url + ')' : title;
    return '- [' + (checked.has(item.id) ? 'x' : ' ') + '] ' + link + ' · ' + handleLabel(item.projectName) +
      ' · 원본: ' + handleLabel(item.status) + (item.dueDate ? ' · 기한 ' + item.dueDate : '') +
      (item.missing ? ' · 조회 대상에서 제외됨' : '') + ' <!-- mori-work-item:' + item.id + ' -->';
  });
  const rendered = start + '\n### ' + WORK_LABELS[incoming.provider] + ' · ' + handleLabel(incoming.account) + '\n\n' +
    (lines.length ? lines.join('\n') : '조건에 맞는 담당 업무가 없습니다.') +
    '\n\n마지막 확인: ' + new Date(incoming.syncedAt).toLocaleString('ko-KR') + '\n' + end;
  const nextBody = old ? body.replace(existing, () => rendered) : handleAppendDailyTasks(body, [rendered]);
  const snapshot: WorkSnapshot = { ...incoming, items, rendered };
  return { body: nextBody, snapshots: [...previous.filter(value => value.key !== incoming.key), snapshot] };
};
