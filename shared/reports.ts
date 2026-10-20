import { handleDailyDate, handleLocalDate } from './daily';
import type { Note } from './types';

export interface ReportTemplate { id: string; name: string; headings: string[]; instruction: string }
export interface ReportInput { start: string; end: string; templateId: string; sources: { id: string; revision: string }[] }
export interface ReportSource { id: string; revision: string; title: string; date: string }
export interface ReportDraft { id: string; title: string; body: string; sources: ReportSource[] }
export const REPORT_MAX_CHARS = 80_000;
export const REPORT_MAX_SOURCES = 30;
export const REPORT_TEMPLATES: ReportTemplate[] = [
  { id: 'weekly', name: '주간보고', headings: ['주요 성과', '진행 중인 업무', '장애물과 지원 요청', '다음 계획'], instruction: '간결한 업무 보고체로 작성하세요.' },
  { id: 'standup', name: '스탠드업', headings: ['완료한 일', '다음 할 일', '막힌 점'], instruction: '짧은 항목으로 작성하세요.' },
  { id: 'review', name: '회고', headings: ['잘된 점', '아쉬운 점', '다음에 시도할 것'], instruction: '기록에 근거해 차분한 말투로 작성하세요.' },
];
export const handleReportDate = (note: Note) => {
  const daily = handleDailyDate(note);
  if (daily) return daily;
  const date = new Date(note.updatedAt);
  return Number.isNaN(date.getTime()) ? '' : handleLocalDate(date);
};
export const handleReportRange = (start: string, end: string) => {
  const valid = (value: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end) throw new Error('시작일과 종료일을 확인해 주세요.');
};
export const handleValidateReportTemplate = (value: ReportTemplate): ReportTemplate => {
  const line = (text: unknown, max: number): text is string => typeof text === 'string' && !!text.trim() && text.length <= max && !/[\r\n\[\]<>#]/.test(text);
  if (!value || !line(value.name, 60) || !Array.isArray(value.headings) || !value.headings.length || value.headings.length > 8 || !value.headings.every(text => line(text, 80)) || new Set(value.headings.map(text => text.trim())).size !== value.headings.length || typeof value.instruction !== 'string' || value.instruction.length > 1000) throw new Error('템플릿 이름·항목(1~8개)·말투(1,000자 이내)를 확인해 주세요.');
  return { id: value.id, name: value.name.trim(), headings: value.headings.map(text => text.trim()), instruction: value.instruction.trim() };
};
const label = (text: string) => text.replace(/[\[\]|\r\n]/g, ' ').trim();
export const handleReportSourceLink = (source: ReportSource) => '[[' + source.id + '|' + label(source.title) + ']]';
export const handleReportSources = (sources: ReportSource[]) => '\n\n## 참고 기록\n\n' + sources.map(source => '- ' + handleReportSourceLink(source) + ` (${source.date || '날짜 미확인'})`).join('\n') + '\n';
export const handleReportOutline = (template: ReportTemplate, notes: Note[]) => template.headings.map(heading => `## ${heading}\n\n- 직접 작성해 주세요.`).join('\n\n') + '\n\n## 선택한 원문\n\n' + notes.map(note => `### ${label(note.title)}\n\n${note.body}`).join('\n\n');

/** AI는 문장과 출처 ID만 제안합니다. 실제 링크는 검증된 자료에서 만듭니다. */
export const handleRenderReport = (output: string, template: ReportTemplate, sources: ReportSource[]) => {
  let parsed: unknown;
  try { parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')); }
  catch { throw new Error('AI 보고서 형식을 읽지 못했습니다. 다시 생성해 주세요.'); }
  const sections = (parsed as { sections?: unknown })?.sections;
  if (!Array.isArray(sections) || sections.length !== template.headings.length) throw new Error('보고서 항목이 템플릿과 다릅니다. 다시 생성해 주세요.');
  const allowed = new Map(sources.map(source => [source.id, source]));
  return sections.map((section, index) => {
    if (!section || section.heading !== template.headings[index] || !Array.isArray(section.items) || section.items.length > 40) throw new Error('보고서 항목이 템플릿과 다릅니다.');
    const items = section.items.map((item: { text: unknown; sourceIds: unknown }) => {
      if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 || /[\r\n]|\[\[|\]\]|\]\(|https?:|<|>/.test(item.text) || !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some(id => typeof id !== 'string' || !allowed.has(id))) throw new Error('AI가 근거 없는 항목이나 잘못된 출처를 반환했습니다. 다시 생성해 주세요.');
      return '- ' + item.text.trim() + ' — ' + [...new Set(item.sourceIds as string[])].map(id => handleReportSourceLink(allowed.get(id)!)).join(', ');
    });
    return `## ${template.headings[index]}\n\n` + (items.join('\n') || '- 기록에서 확인되지 않음');
  }).join('\n\n');
};
