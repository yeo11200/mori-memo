import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { handleLocalDate } from '../../shared/daily';
import { REPORT_MAX_CHARS, REPORT_MAX_SOURCES, REPORT_TEMPLATES, handleReportDate, handleReportRange } from '../../shared/reports';
import type { ReportDraft, ReportTemplate } from '../../shared/reports';
import type { AppSettings, Note } from '../../shared/types';

const errorText = (cause: unknown) => String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '');
const weekStart = () => { const date = new Date(); date.setDate(date.getDate() - (date.getDay() + 6) % 7); return handleLocalDate(date); };
export const ReportDialog = ({ notes, settings, onSaved, onClose }: {
  notes: Note[]; settings: AppSettings | null; onSaved: (note: Note) => Promise<void>;
  onClose: () => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const [snapshot, setSnapshot] = useState(notes);
  const [start, setStart] = useState(weekStart);
  const [end, setEnd] = useState(() => handleLocalDate());
  const [allDates, setAllDates] = useState(false);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>(REPORT_TEMPLATES);
  const [templateId, setTemplateId] = useState('weekly');
  const [templateEdit, setTemplateEdit] = useState<ReportTemplate | null>(null);
  const [headings, setHeadings] = useState('');
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourceId, setSourceId] = useState('');
  const inspected = notes.find(note => note.id === sourceId);
  const template = templates.find(item => item.id === templateId) || templates[0];
  const picked = snapshot.filter(note => selected.includes(note.id));
  const chars = picked.reduce((sum, note) => sum + note.body.length + note.title.length, 0);
  const candidates = snapshot.filter(note => (allDates || (handleReportDate(note) >= start && handleReportDate(note) <= end)) && (!folder || note.folder === folder) && (note.title + ' ' + note.body).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const validSelection = !!picked.length && picked.length <= REPORT_MAX_SOURCES && chars <= REPORT_MAX_CHARS && picked.some(note => note.body.trim());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    void window.wiki.handleReportTemplates().then(setTemplates).catch(cause => setError(errorText(cause)));
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(draft ? 'textarea:not(:disabled)' : 'input');
    (target || root.current)?.focus();
  }, [draft?.id, saved]);
  const perform = async (kind: string, work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(''); }
  };
  const generate = (ai: boolean) => perform(ai ? 'ai' : 'outline', async () => {
    handleReportRange(start, end);
    const next = await window.wiki.handleGenerateReport({ start, end, templateId: template.id, sources: picked.map(note => ({ id: note.id, revision: note.revision })) }, ai);
    setDraft(next); setBody(next.body); setSaved(false);
  });
  const editTemplate = (existing: boolean) => {
    setTemplateEdit({ ...template, id: existing ? template.id : '', name: existing ? template.name : template.name + ' 맞춤' });
    setHeadings(template.headings.join('\n'));
  };
  const refreshSources = () => { setSnapshot(notes); setSelected([]); setNotice('최신 기록으로 갱신했습니다. 자료를 다시 선택해 주세요.'); };
  const sourceStatus = (source: ReportDraft['sources'][number]) => {
    const current = notes.find(note => note.id === source.id);
    return !current ? '현재 접근 불가' : current.revision !== source.revision ? '생성 후 변경됨' : '';
  };
  return <div className="wiki__modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={root} tabIndex={-1} className="wiki__modal report-dialog" role="dialog" aria-modal="true" aria-label="주간보고 만들기" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]') || [])].filter(element => element.getClientRects().length > 0);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="wiki__modal__header"><h2>주간보고 만들기</h2><button className="wiki__icon-button" aria-label="보고서 창 닫기" disabled={!!busy} onClick={onClose}><X size={17} /></button></div>
      <p>데일리와 업무 기록을 모아 나만의 양식으로 정리하세요. 현재 무료 체험 기능입니다.</p>
      {!draft ? <>
        <div className="report-dialog__row">
          <label>시작일<input type="date" aria-label="보고서 시작일" value={start} disabled={!!busy} onChange={event => { setStart(event.target.value); setSelected([]); }} /></label>
          <label>종료일<input type="date" aria-label="보고서 종료일" value={end} disabled={!!busy} onChange={event => { setEnd(event.target.value); setSelected([]); }} /></label>
          <label>폴더<select aria-label="보고서 자료 폴더" value={folder} disabled={!!busy} onChange={event => setFolder(event.target.value)}><option value="">모든 폴더</option>{[...new Set(snapshot.map(note => note.folder))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <p className="report-dialog__hint">데일리는 기록 날짜, 일반 메모는 마지막 수정일로 찾습니다. 선택한 메모의 현재 본문 전체를 사용하며, 과거 상태를 복원하지 않습니다.</p>
        <label className="report-dialog__check"><input type="checkbox" checked={allDates} disabled={!!busy} onChange={event => { setAllDates(event.target.checked); setSelected([]); }} />기간 밖 기록도 직접 선택하기</label>
        <label className="report-dialog__field">자료 검색<input aria-label="보고서 자료 검색" placeholder="메모 제목 또는 내용" value={query} disabled={!!busy} onChange={event => setQuery(event.target.value)} /></label>
        <div className="report-dialog__row"><button className="wiki__button" disabled={!!busy || !candidates.length || candidates.length > REPORT_MAX_SOURCES} onClick={() => setSelected(candidates.map(note => note.id))}>검색 결과 모두 선택</button><button className="wiki__button" disabled={!!busy} onClick={() => setSelected([])}>선택 해제</button><button className="wiki__button" disabled={!!busy} onClick={refreshSources}>자료 새로 선택</button><span>{candidates.length}개 검색됨</span></div>
        <div className="report-dialog__sources">
          {candidates.map(note => <div className="report-dialog__source" key={note.id}><label><input type="checkbox" aria-label={`자료 선택: ${note.title}`} disabled={!!busy || (!selected.includes(note.id) && selected.length >= REPORT_MAX_SOURCES)} checked={selected.includes(note.id)} onChange={event => setSelected(values => event.target.checked ? [...values, note.id] : values.filter(id => id !== note.id))} /><span><strong>{note.title}</strong><small>{note.folder} · {handleReportDate(note) || '날짜 미확인'} · {note.body.length.toLocaleString()}자</small></span></label><details><summary>전달할 본문 확인</summary><pre>{note.body || '(빈 본문)'}</pre></details></div>)}
          {!candidates.length && <p>해당하는 기록이 없습니다. 기간을 바꾸거나 기간 밖 기록을 선택하세요.</p>}
        </div>
        <p aria-live="polite">{picked.length}/{REPORT_MAX_SOURCES}개 선택 · 제목·본문 {chars.toLocaleString()}/{REPORT_MAX_CHARS.toLocaleString()}자{chars > REPORT_MAX_CHARS ? ' · 자료를 줄여 주세요.' : ''}</p>
        {!!picked.length && <details><summary>선택한 전체 자료 확인</summary><ul>{picked.map(note => <li key={note.id}>{note.title} · {note.folder}</li>)}</ul></details>}
        <div className="report-dialog__row"><label>보고서 양식<select aria-label="보고서 양식" value={templateId} disabled={!!busy} onChange={event => setTemplateId(event.target.value)}>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="wiki__button" disabled={!!busy} onClick={() => editTemplate(false)}>맞춤 템플릿 만들기</button>{templateId.startsWith('custom-') && <><button className="wiki__button" disabled={!!busy} onClick={() => editTemplate(true)}>템플릿 수정</button><button className="wiki__button" disabled={!!busy} onClick={() => void perform('template', async () => { setTemplates(await window.wiki.handleDeleteReportTemplate(templateId)); setTemplateId('weekly'); setTemplateEdit(null); })}>템플릿 삭제</button></>}</div>
        <p className="report-dialog__hint">{template.headings.join(' → ')}<br />말투: {template.instruction || '기본 업무 보고체'}</p>
        {templateEdit && <fieldset className="report-dialog__template" disabled={!!busy}><legend>맞춤 템플릿</legend>
          <label>템플릿 이름<input aria-label="템플릿 이름" maxLength={60} value={templateEdit.name} onChange={event => setTemplateEdit({ ...templateEdit, name: event.target.value })} /></label>
          <label>항목 · 한 줄에 하나, 최대 8개<textarea aria-label="템플릿 항목" maxLength={650} value={headings} onChange={event => setHeadings(event.target.value)} /></label>
          <label>말투와 작성 방식<textarea aria-label="템플릿 말투" maxLength={1000} value={templateEdit.instruction} onChange={event => setTemplateEdit({ ...templateEdit, instruction: event.target.value })} /></label>
          <div className="report-dialog__row"><button className="wiki__button" onClick={() => void perform('template', async () => { const next = await window.wiki.handleSaveReportTemplate({ ...templateEdit, headings: headings.split('\n').map(value => value.trim()).filter(Boolean) }); setTemplates(next); setTemplateId(templateEdit.id || next.at(-1)!.id); setTemplateEdit(null); })}>템플릿 저장</button><button className="wiki__button" onClick={() => setTemplateEdit(null)}>편집 취소</button></div>
        </fieldset>}
        <p className="report-dialog__consent">AI로 생성하면 선택한 기록의 제목·본문 전체와 양식을 설정된 <strong>{settings?.provider === 'openai' ? 'OpenAI API' : settings?.provider === 'claude' ? 'Claude CLI' : 'Codex CLI'}</strong>에 전달합니다. 외부 제공자의 이용료가 발생할 수 있습니다. 원문 모음은 AI를 호출하지 않습니다.</p>
        <div className="wiki__modal__actions"><button className="wiki__button" disabled={!!busy || !validSelection || !!templateEdit} onClick={() => void generate(false)}>원문 모음 만들기</button><button className="wiki__button wiki__button--primary" disabled={!!busy || !validSelection || !!templateEdit} onClick={() => void generate(true)}>AI로 보고서 생성</button></div>
      </> : <>
        <p>초안을 수정하고 출처를 확인하세요. 저장하면 새 메모가 생깁니다.</p>
        <label className="report-dialog__field">보고서 초안<textarea className="report-dialog__body" aria-label="보고서 초안" value={body} maxLength={200000} disabled={!!busy || saved} onChange={event => setBody(event.target.value)} /></label>
        <div className="report-dialog__references"><strong>근거 기록</strong>{draft.sources.map(source => <div key={source.id}><button className="wiki__button" disabled={!!busy || sourceStatus(source) === '현재 접근 불가'} onClick={() => setSourceId(source.id)}>{source.title}</button><span>{source.date} {sourceStatus(source)}</span></div>)}</div>
        {sourceId && <section className="report-dialog__inspection" aria-label="근거 원문"><div className="report-dialog__row"><strong>{inspected?.title || '현재 접근 불가'}</strong><button className="wiki__button" onClick={() => setSourceId('')}>원문 닫기</button></div><pre>{inspected?.body || '현재 본문을 읽을 수 없습니다.'}</pre></section>}
        <p className="report-dialog__hint">근거 기록은 현재 본문을 읽기 전용으로 표시합니다. AI의 출처 연결이 문장 내용의 정확성을 보장하지는 않습니다.</p>
        <div className="wiki__modal__actions"><button className="wiki__button" disabled={!!busy} onClick={() => { setDraft(null); setSelected([]); setSnapshot(notes); setError(''); setNotice(''); }}>자료 다시 선택</button><button className="wiki__button" disabled={!!busy || !body.trim()} onClick={() => void perform('copy', async () => { await window.wiki.handleCopyReport(draft.id, body); setNotice('보고서를 복사했습니다.'); })}>보고서 복사</button><button className="wiki__button" disabled={!!busy || !body.trim()} onClick={() => void perform('export', async () => { const path = await window.wiki.handleExportReport(draft.id, body); if (path) setNotice('Markdown 파일을 저장했습니다.'); })}>Markdown 내보내기</button><button className="wiki__button wiki__button--primary" disabled={!!busy || saved || !body.trim()} onClick={() => void perform('save', async () => { const note = await window.wiki.handleSaveReport(draft.id, body); setSaved(true); await onSaved(note); setNotice('업무보고 폴더에 새 메모로 저장했습니다.'); })}>{saved ? '저장됨' : '새 메모로 저장'}</button></div>
      </>}
      {busy && <p role="status">{busy === 'ai' ? '보고서 생성 중…' : '처리 중…'}{busy === 'ai' && <button className="wiki__button" onClick={() => void window.wiki.handleCancelAI().catch(cause => setError(errorText(cause)))}>생성 취소</button>}</p>}
      {error && <p role="alert" className="report-dialog__error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>
  </div>;
};
