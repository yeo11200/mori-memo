import type { CalendarBatch, CalendarSnapshot, CalendarEvent } from './calendar';

const handleInsertCalendarBlock = (body: string, block: string) => {
  let fence = '';
  let section = false;
  let insertAt: number | undefined;
  let offset = 0;
  for (const line of body.split('\n')) {
    const delimiter = line.match(/^ {0,3}(\x60{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !line.slice(delimiter[0].length).trim()) fence = '';
    } else if (!fence) {
      if (section && insertAt === undefined && /^#{1,2}\s/.test(line)) insertAt = offset;
      if (!section && /^## (오늘 일정|Google Calendar 일정)\s*$/.test(line)) section = true;
    }
    offset += line.length + 1;
  }
  if (fence) throw new Error('데일리의 코드 블록을 닫은 뒤 다시 일정을 가져와 주세요.');
  if (insertAt !== undefined) return body.slice(0, insertAt) + block + '\n\n' + body.slice(insertAt);
  return body + (section ? '\n\n' : '\n\n## Google Calendar 일정\n\n') + block + '\n';
};

const handleLabel = (text: string) => text.replace(/[\r\n\t]/g, ' ').replace(/[<>\[\]|\\\x60*_#]/g, '').trim().slice(0, 500);
const handleTime = (event: CalendarEvent) => event.allDay ? '종일' :
  new Date(event.start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) + '–' +
  new Date(event.end).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
export const handleCalendarMerge = (body: string, previous: CalendarSnapshot[], batch: CalendarBatch) => {
  let nextBody = body;
  const snapshots = [...previous];
  for (const incoming of batch.snapshots) {
    const old = snapshots.find(snapshot => snapshot.key === incoming.key);
    const start = '<!-- mori-calendar:' + incoming.key + ':start -->';
    const end = '<!-- mori-calendar:' + incoming.key + ':end -->';
    if (old && (nextBody.split(start).length !== 2 || nextBody.split(end).length !== 2 || !nextBody.includes(old.rendered))) {
      throw new Error('Google 일정 구역이 직접 수정되었거나 삭제되어 덮어쓰지 않았습니다. 버전 기록에서 원래 구역을 복원하고 개인 기록은 구역 밖에 적어 주세요.');
    }
    if (!old && (nextBody.includes(start) || nextBody.includes(end))) throw new Error('일정 구역의 출처 정보를 확인하지 못했습니다. 기존 기록을 유지합니다.');
    const ids = new Set(incoming.events.map(event => event.id));
    const missing = (old?.events || []).filter(event => !ids.has(event.id)).map(event => ({ ...event, missing: true }));
    const events = [...incoming.events, ...missing];
    const lines = events.map(event => {
      const title = handleLabel(event.title) || '제목 없는 일정';
      const linked = event.url ? '[' + title.replace(/[()]/g, '') + '](' + event.url + ')' : title;
      return '- ' + handleTime(event) + ' · ' + linked + (event.missing ? ' — 오늘 일정에서 제외됨 (삭제·이동·취소 등)' : '');
    });
    const rendered = start + '\n### ' + handleLabel(incoming.calendarName) + '\n\n' +
      (lines.length ? lines.join('\n') : '오늘 일정이 없습니다.') + '\n\n' +
      '마지막 확인: ' + new Date(incoming.syncedAt).toLocaleString('ko-KR') + '\n' + end;
    nextBody = old ? nextBody.replace(old.rendered, () => rendered) : handleInsertCalendarBlock(nextBody, rendered);
    const snapshot: CalendarSnapshot = { ...incoming, events, rendered };
    const index = snapshots.findIndex(item => item.key === snapshot.key);
    if (index < 0) snapshots.push(snapshot); else snapshots[index] = snapshot;
  }
  return { body: nextBody, snapshots };
};
