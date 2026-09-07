import type { Note, WikiLink } from './types';

/** 코드 예제를 제외한 위키 링크의 원문 위치를 보존합니다. */
export const handleParseLinks = (body: string): WikiLink[] => {
  const masked = body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, text => ' '.repeat(text.length))
    .replace(/(`+)[^\n]*?\1/g, text => ' '.repeat(text.length));
  return [...masked.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)].map(match => {
    const [destination, alias] = match[1].split('|');
    const [target, ...headings] = destination.split('#');
    return { target: target.trim(), label: alias?.trim() || destination.trim(), heading: headings.join('#'), index: match.index!, raw: body.slice(match.index!, match.index! + match[0].length) };
  });
};

const handleNormalize = (value: string) => value.normalize('NFC').trim().replace(/\.md$/i, '').toLocaleLowerCase();

/** 동명 문서는 임의 선택하지 않고 경로로 구분합니다. */
export const handleResolveLink = (target: string, notes: Note[]): Note | undefined => {
  const key = handleNormalize(target);
  const candidates = notes.filter(note => [note.id, note.title, `${note.folder}/${note.title}`, ...(note.aliases || [])].some(value => handleNormalize(value) === key));
  return candidates.length === 1 ? candidates[0] : undefined;
};

/** 실제 본문 링크를 역으로 찾아 참조하는 문서를 반환합니다. */
export const handleBacklinks = (target: Note, notes: Note[]) => notes.filter(note => note.id !== target.id && handleParseLinks(note.body).some(link => handleResolveLink(link.target, notes)?.id === target.id));

/** 기기 내 키워드 겹침으로 관련 메모 후보만 계산합니다. */
export const handleRelatedNotes = (source: Note, notes: Note[]) => {
  const tokens = new Set(`${source.title} ${source.body}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
  return notes.filter(note => note.id !== source.id).map(note => {
    const text = `${note.title} ${note.body}`.toLocaleLowerCase();
    const keywords = [...tokens].filter(token => text.includes(token));
    return { note, score: keywords.length, keywords: keywords.slice(0, 3) };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
};

/** 미리보기용 Markdown만 변환하며 저장된 원문은 바꾸지 않습니다. */
export const handlePreviewMarkdown = (body: string) => {
  let output = body;
  for (const link of handleParseLinks(body).reverse()) {
    const label = link.label.replace(/[\[\]]/g, '');
    output = output.slice(0, link.index) + `[${label}](wiki:${encodeURIComponent(link.target)}${link.heading ? '#' + encodeURIComponent(link.heading) : ''})` + output.slice(link.index + link.raw.length);
  }
  return output;
};
