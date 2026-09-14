import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { handleDailyDate, handleDailyTasks, handleLocalDate } from '../../shared/daily';
import type { DailyTransfer } from '../../shared/daily';
import type { Note } from '../../shared/types';

export const DailyDialog = ({ source, notes, carry, onAdd, onClose }: {
  source: Note; notes: Note[]; carry: boolean;
  onAdd: (input: DailyTransfer) => Promise<unknown>; onClose: () => void;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const today = handleLocalDate();
  const sources = carry ? notes.filter(note => { const date = handleDailyDate(note); return date && date < today; }) : [source];
  const candidates = sources.flatMap(note => handleDailyTasks(note.body).map(task => ({
    key: note.id + ':' + task.line, note, task,
  })));
  const visible = candidates.filter(item => (item.note.title + ' ' + item.task.text).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const handleSubmit = async () => {
    if (saving.current || (!selected.length && !text.trim())) return;
    saving.current = true; setBusy(true); setError('');
    try {
      await onAdd({
        tasks: candidates.filter(item => selected.includes(item.key)).map(item => ({
          noteId: item.note.id, revision: item.note.revision, line: item.task.line,
        })),
        custom: !carry && text.trim() ? { noteId: source.id, revision: source.revision, text: text.trim() } : undefined,
      });
      onClose();
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="wiki__modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={root} className="wiki__modal daily-dialog" role="dialog" aria-modal="true" aria-label={carry ? '미완료 할 일 가져오기' : '오늘 할 일로 보내기'} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === 'Tab') {
        const controls = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        const first = controls?.[0]; const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="wiki__modal__header"><h2>{carry ? '미완료 할 일 가져오기' : '오늘 할 일로 보내기'}</h2><button className="wiki__icon-button" aria-label="할 일 창 닫기" disabled={busy} onClick={onClose}><X size={17} /></button></div>
      <p>{today} 데일리에 선택한 항목을 추가합니다. 원본 메모와 완료 상태는 바꾸지 않습니다.</p>
      <label className="daily-dialog__field">할 일 검색<input aria-label="할 일 검색" disabled={busy} value={query} onChange={event => setQuery(event.target.value)} placeholder="할 일 또는 원본 메모 제목" /></label>
      <div className="daily-dialog__list">
        {visible.slice(0, 100).map(item => <label className="daily-dialog__task" key={item.key}>
          <input type="checkbox" disabled={busy || (!selected.includes(item.key) && selected.length >= 100)} checked={selected.includes(item.key)} onChange={event => setSelected(values => event.target.checked ? [...values, item.key] : values.filter(key => key !== item.key))} />
          <span><strong>{item.task.text}</strong><small>{item.note.title}</small></span>
        </label>)}
        {!visible.length && <p>{carry ? '가져올 미완료 할 일이 없습니다.' : '미완료 체크리스트가 없습니다. 아래에 할 일을 직접 입력해도 됩니다.'}</p>}
        {visible.length > 100 && <p>100개까지 표시합니다. 검색으로 범위를 좁혀 주세요.</p>}
      </div>
      {!carry && <label className="daily-dialog__field">직접 추가할 할 일<input aria-label="직접 추가할 할 일" disabled={busy} maxLength={500} value={text} onChange={event => setText(event.target.value)} placeholder="예: 이 회의의 결정 사항 검토하기" /></label>}
      <p className="daily-dialog__hint">원본 링크를 함께 남기고, 이미 가져온 항목은 건너뜁니다.</p>
      {error && <p role="alert">{error}</p>}
      <div className="wiki__modal__actions"><span>{selected.length + (!carry && text.trim() ? 1 : 0)}개 선택</span><button className="wiki__button wiki__button--primary" disabled={busy || (!selected.length && !text.trim())} onClick={() => void handleSubmit()}>{busy ? '추가 중…' : '오늘 데일리에 추가'}</button></div>
    </div>
  </div>;
};
