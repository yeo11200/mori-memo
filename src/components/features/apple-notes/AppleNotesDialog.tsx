import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useAppleNotes } from './hooks/useAppleNotes';
import type { Note } from '../../../../shared/types';
import type { AppleReview, AppleStatus } from '../../../../shared/apple-notes';

const LABELS: Record<AppleStatus, string> = { created: '새 메모', updated: '업데이트', unchanged: '변경 없음', review: '검토 필요', failed: '실패', missing: '원본 확인 필요', trashed: '휴지통에 있음' };

export const AppleNotesDialog = ({ notes, onOperation, onClose }: { notes: Note[]; onOperation: <T>(work: () => Promise<T>) => Promise<T>; onClose: () => void }) => {
  const apple = useAppleNotes(onOperation);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; root.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => { if (!apple.busy && !root.current?.contains(document.activeElement)) root.current?.focus(); }, [apple.busy]);
  const handleToggle = (key: 'folderIds' | 'noteIds', id: string) => apple.setSelection(current => ({ ...current, [key]: current[key].includes(id) ? current[key].filter(value => value !== id) : [...current[key], id] }));
  const linked = apple.state.folderIds.length + apple.state.noteIds.length;
  const selectedIds = new Set(apple.selected.map(note => note.id));
  const preview = apple.scan?.preview.filter(item => selectedIds.has(item.sourceId)) || [];
  return <div className="wiki__modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !apple.busy) onClose(); }}>
    <div ref={root} tabIndex={-1} className="wiki__modal apple-import" role="dialog" aria-modal="true" aria-label="Apple 메모 연동" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!apple.busy) onClose(); }
      if (event.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || [])];
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="apple-import__header"><div><small>APPLE NOTES → MORI</small><h2>Apple 메모 연동</h2></div><button className="wiki__icon-button" aria-label="연동 창 닫기" disabled={apple.busy} onClick={onClose}><X size={18} /></button></header>
      <p>Apple 메모를 MORI에 가져와 연결하고 정리하세요. 원본은 변경하지 않습니다.</p>
      <div className="apple-import__modes"><label><input type="radio" name="apple-mode" checked={apple.selection.mode === 'all'} disabled={apple.busy} onChange={() => apple.setSelection(current => ({ ...current, mode: 'all' }))} />연동한 모든 항목</label><label><input type="radio" name="apple-mode" checked={apple.selection.mode === 'selected'} disabled={apple.busy} onChange={() => apple.setSelection(current => ({ ...current, mode: 'selected' }))} />폴더·메모 직접 선택</label></div>
      <p className="apple-import__help">{apple.state.lastSyncAt ? '마지막 가져오기: ' + new Date(apple.state.lastSyncAt).toLocaleString('ko-KR') : '첫 연동은 목록을 읽고 가져올 항목을 선택해 주세요.'} · 연동 폴더 {apple.state.folderIds.length}개 / 메모 {apple.state.noteIds.length}개</p>
      <button className="wiki__button" disabled={apple.busy} onClick={() => void apple.handleScan()}><RefreshCw size={15} />{apple.busy ? '처리 중…' : 'Apple 메모 목록 읽기'}</button>
      <p className="apple-import__help">처음 읽을 때 macOS의 메모 접근 허용 창이 나타날 수 있습니다. 본문은 일반 텍스트로 가져오며 사진·PDF·표·체크 상태·서식은 보존하지 않습니다.</p>
      {apple.error && <p role="alert" className="apple-import__error">{apple.error}</p>}
      {apple.scan && <>
        {!apple.scan.catalog.notes.length && <p>가져올 메모가 없습니다. Apple 메모 앱의 계정과 메모를 확인하세요.</p>}
        {apple.selection.mode === 'all' && !linked && <p>연동한 항목이 없습니다. 직접 선택으로 처음 가져올 메모를 골라 주세요.</p>}
        {apple.selection.mode === 'selected' && <><input aria-label="Apple 메모 검색" className="apple-import__search" placeholder="폴더·메모 이름 검색" value={query} disabled={apple.busy} onChange={event => setQuery(event.target.value)} />
          <div className="apple-import__folders" aria-label="Apple 폴더 선택">{apple.scan.catalog.folders.filter(folder => folder.name.toLowerCase().includes(query.toLowerCase())).map(folder => <label key={folder.id}><input type="checkbox" disabled={apple.busy} checked={apple.selection.folderIds.includes(folder.id)} onChange={() => handleToggle('folderIds', folder.id)} />{folder.name}</label>)}</div>
          <p className="apple-import__help">폴더를 선택하면 그 폴더에 새로 생기는 메모도 다음 전체 동기화에 포함됩니다. 개별 메모는 아래에서 선택하세요.</p>
          <div className="apple-import__notes" aria-label="Apple 메모 선택">{apple.scan.catalog.notes.filter(note => (note.title + ' ' + note.folder).toLowerCase().includes(query.toLowerCase())).map(note => <label key={note.id}><input type="checkbox" disabled={apple.busy || apple.selection.folderIds.includes(note.folderId)} checked={selectedIds.has(note.id)} onChange={() => handleToggle('noteIds', note.id)} /><span><strong>{note.title}</strong><small>{note.folder}</small>{note.error && <small className="apple-import__error">{note.error}</small>}{note.warnings.map(warning => <small key={warning}>{warning}</small>)}</span></label>)}</div>
        </>}
        <div className="apple-import__summary">{(['created', 'updated', 'unchanged', 'review', 'failed'] as const).map(status => <span key={status}>{LABELS[status]} <strong>{preview.filter(item => item.status === status).length}</strong></span>)}</div>
        <button className="wiki__button wiki__button--primary" disabled={apple.busy || (!apple.selected.length && !(apple.selection.mode === 'all' ? linked : apple.selection.folderIds.length))} onClick={() => void apple.handleSync()}><Download size={16} />{apple.selected.length ? `선택한 ${apple.selected.length}개 가져오기` : apple.selection.mode === 'all' ? '연동 항목 확인' : '선택한 빈 폴더 연동'}</button>
      </>}
      {!!apple.state.reviews.length && <section className="apple-import__reviews"><h3>검토 보관함 · {apple.state.reviews.length}</h3><p>MORI에서 수정한 내용이 있어 자동으로 덮어쓰지 않았습니다.</p>{apple.state.reviews.map(review => <Review key={review.source.id} review={review} note={notes.find(note => note.id === review.noteId)} busy={apple.busy} onResolve={apple.handleResolve} />)}</section>}
      {!!apple.state.results.length && <section className="apple-import__results"><h3>최근 가져오기 결과</h3>{apple.state.results.map(result => <div key={result.sourceId}><strong>{result.title}</strong><span>{LABELS[result.status]}</span>{result.message && <small>{result.message}</small>}</div>)}</section>}
    </div>
  </div>;
};

const Review = ({ review, note, busy, onResolve }: { review: AppleReview; note?: Note; busy: boolean; onResolve: (id: string, choice: 'keep' | 'apple' | 'merge', revision: string, body?: string) => Promise<void> }) => {
  const [body, setBody] = useState<string>();
  return <article className="apple-import__review"><h4>{review.source.title}</h4>{note ? <><div className="apple-import__comparison"><div><strong>MORI · {note.title}</strong><pre>{note.body}</pre></div><div><strong>Apple 메모 · {review.source.folder}</strong><pre>{review.source.body}</pre></div></div><textarea aria-label={'병합 내용 ' + review.source.title} disabled={busy} value={body ?? note.body} onChange={event => setBody(event.target.value)} /><div className="apple-import__actions"><button className="wiki__button" disabled={busy} onClick={() => void onResolve(review.source.id, 'keep', note.revision)}>MORI 내용 유지</button><button className="wiki__button" disabled={busy} onClick={() => void onResolve(review.source.id, 'apple', note.revision)}>Apple 내용 반영</button><button className="wiki__button" disabled={busy} onClick={() => void onResolve(review.source.id, 'merge', note.revision, body ?? note.body)}>편집한 내용 저장</button></div></> : <p>MORI 메모를 찾을 수 없습니다. 휴지통을 확인하세요.</p>}</article>;
};
