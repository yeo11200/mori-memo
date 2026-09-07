import { useRef, useState } from 'react';
import type { Note } from '../../shared/types';
import { handleResolveLink } from '../../shared/links';

export const NoteEditor = ({ note, notes, disabled, onEdit }: { note: Note; notes: Note[]; disabled: boolean; onEdit: (body: string) => void }) => {
  const area = useRef<HTMLTextAreaElement>(null);
  const [completion, setCompletion] = useState<{ start: number; end: number; query: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const matches = completion ? notes.filter(item => `${item.folder}/${item.title}`.toLocaleLowerCase().includes(completion.query.toLocaleLowerCase())).slice(0, 8) : [];
  const handleCompletion = (body: string, cursor: number) => {
    const prefix = body.slice(0, cursor);
    const match = prefix.match(/(?<!!)\[\[([^\]\n|]*)$/);
    if (match) { setCompletion({ start: cursor - match[0].length, end: cursor, query: match[1] }); setSelected(0); }
    else setCompletion(null);
  };
  const handleInsert = (target: Note) => {
    if (!completion) return;
    const path = `${target.folder}/${target.title}`;
    const unique = handleResolveLink(path, notes)?.id === target.id && !/[\[\]|#\n]/.test(path);
    const link = unique ? `[[${path}]]` : `[[${target.id}|${target.title.replace(/[\[\]|\n]/g, '')}]]`;
    const end = note.body.slice(completion.end).startsWith(']]') ? completion.end + 2 : completion.end;
    onEdit(note.body.slice(0, completion.start) + link + note.body.slice(end));
    const cursor = completion.start + link.length;
    setCompletion(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(cursor, cursor); });
  };
  return <div className="wiki__editor-input-wrap">
    <textarea ref={area} aria-label="메모 내용" className="wiki__body-input" disabled={disabled} value={note.body} spellCheck={false}
      aria-controls={completion ? 'wiki-link-completions' : undefined} aria-autocomplete="list" aria-activedescendant={completion && matches.length ? `wiki-link-${selected}` : undefined}
      placeholder={'생각을 자유롭게 적어보세요…\n\n[[ 를 입력하면 문서를 연결할 수 있어요.'}
      onChange={event => { onEdit(event.target.value); handleCompletion(event.target.value, event.target.selectionStart); }}
      onClick={event => handleCompletion(note.body, event.currentTarget.selectionStart)}
      onKeyDown={event => {
        if (!completion || event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); setCompletion(null); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(matches.length, 1)) % Math.max(matches.length, 1)); }
        if ((event.key === 'Enter' || event.key === 'Tab') && matches[selected]) { event.preventDefault(); handleInsert(matches[selected]); }
      }} />
    {completion && <div className="wiki__link-completions" role="listbox" aria-label="연결할 문서" id="wiki-link-completions">
      <small>문서 연결 · ↑↓ 선택 · Enter 삽입</small>
      {matches.map((item, index) => <button id={`wiki-link-${index}`} key={item.id} role="option" aria-selected={index === selected} onMouseDown={event => event.preventDefault()} onClick={() => handleInsert(item)}><strong>{item.title}</strong><span>{item.folder}/{item.title}</span></button>)}
      {!matches.length && <p>일치하는 문서가 없습니다.</p>}
    </div>}
  </div>;
};
