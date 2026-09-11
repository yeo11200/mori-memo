import { useEffect, useRef, useState } from 'react';
import { Link2, Search, X } from 'lucide-react';
import { handleParseLinks, handleResolveLink } from '../../shared/links';
import { handleNotePreview } from '../../shared/note-preview';
import type { Note } from '../../shared/types';

export const LinkDialog = ({ source, notes, initialTargetId = '', onAdd, onClose }: {
  source: Note; notes: Note[]; initialTargetId?: string; onAdd: (targetId: string, reason: string) => Promise<void>; onClose: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState(initialTargetId);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const existing = new Set(handleParseLinks(source.body).map(link => handleResolveLink(link.target, notes)?.id));
  const candidates = notes.filter(note => note.id !== source.id && !existing.has(note.id) && (note.folder + '/' + note.title + ' ' + handleNotePreview(note.body)).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = notes.find(note => note.id === targetId);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const handleSave = async () => {
    if (!selected || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { await onAdd(selected.id, reason); onClose(); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="wiki__modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={root} className="wiki__modal link-dialog" role="dialog" aria-modal="true" aria-label="메모 연결" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === 'Tab') {
        const controls = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)');
        const first = controls?.[0]; const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><div><small>{source.folder}</small><h2>메모 연결</h2></div><button className="wiki__icon-button" aria-label="연결 창 닫기" disabled={busy} onClick={onClose}><X size={17} /></button></header>
      <p><strong>{source.title}</strong> 본문 끝에 연결과 이유를 추가합니다.</p>
      <label className="link-dialog__search"><Search size={16} /><input autoFocus aria-label="연결할 메모 검색" disabled={busy} placeholder="제목·폴더·내용으로 찾기" value={query} onChange={event => { setQuery(event.target.value); setTargetId(''); }} /></label>
      <div className="link-dialog__results" aria-label="연결 후보">
        {candidates.slice(0, 50).map(note => <button disabled={busy} key={note.id} aria-pressed={note.id === targetId} onClick={() => setTargetId(note.id)}><span><strong>{note.title}</strong><small>{note.folder}</small></span><p>{handleNotePreview(note.body, 100) || '내용 없는 메모'}</p></button>)}
        {!candidates.length && <p>연결할 메모가 없습니다. 이미 연결된 메모는 목록에서 제외됩니다.</p>}
        {candidates.length > 50 && <p>50개까지 표시합니다. 검색어를 입력해 범위를 좁혀 주세요.</p>}
      </div>
      <label className="link-dialog__reason">연결 이유 (선택)<textarea aria-label="연결 이유" disabled={busy} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="예: 이 회의에서 정한 실행 계획" /></label>
      {error && <p role="alert">{error}</p>}
      <footer><span>{selected ? selected.folder + ' / ' + selected.title : '대상 메모를 선택하세요'}</span><button className="wiki__button wiki__button--primary" disabled={!selected || busy} onClick={() => void handleSave()}><Link2 size={15} />{busy ? '저장 중…' : '연결 추가'}</button></footer>
    </div>
  </div>;
};
