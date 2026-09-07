import { useState } from 'react';
import { Folder, Plus, Pencil, Trash2 } from 'lucide-react';
import type { Note } from '../../shared/types';

export const FolderPanel = ({ folders, notes, selected, onSelect, onChange, busy }: {
  folders: string[]; notes: Note[]; selected: string; busy: boolean; onSelect: (name: string) => void;
  onChange: (action: 'create' | 'rename' | 'delete', from: string, to?: string) => Promise<boolean>;
}) => {
  const [edit, setEdit] = useState<{ action: 'create' | 'rename' | 'delete'; from: string } | null>(null);
  const [name, setName] = useState('');
  return <section className="wiki__folders">
    <div className="wiki__quick"><span>폴더</span><button aria-label="폴더 추가" onClick={() => { setName(''); setEdit({ action: 'create', from: '' }); }}><Plus size={15} /></button></div>
    {folders.map(folder => <div className={`wiki__folder-row${selected === folder ? ' wiki__folder-row--active' : ''}`} key={folder}>
      <button className="wiki__folder-select" onClick={() => onSelect(folder)}><Folder size={14} /><span>{folder}</span><small>{notes.filter(note => note.folder === folder).length}</small></button>
      <button aria-label={`${folder} 폴더 이름 변경`} onClick={() => { setName(folder); setEdit({ action: 'rename', from: folder }); }} disabled={busy || folder === '미분류'}><Pencil size={12} /></button>
      <button aria-label={`${folder} 폴더 삭제`} onClick={() => setEdit({ action: 'delete', from: folder })} disabled={busy || folder === '미분류'}><Trash2 size={12} /></button>
    </div>)}
    {edit && <form className="wiki__folder-form" onSubmit={async event => {
      event.preventDefault();
      if (await onChange(edit.action, edit.action === 'create' ? name : edit.from, name)) setEdit(null);
    }}>
      {edit.action === 'delete' ? <p>‘{edit.from}’ 폴더를 삭제하면 메모는 미분류로 이동합니다.</p> : <label>{edit.action === 'create' ? '새 폴더 이름' : '변경할 폴더 이름'}<input autoFocus aria-label="폴더 이름" value={name} maxLength={80} onChange={event => setName(event.target.value)} required /></label>}
      <div><button type="button" className="wiki__button" onClick={() => setEdit(null)} disabled={busy}>취소</button><button className="wiki__button wiki__button--primary" disabled={busy || (edit.action !== 'delete' && !name.trim())}>{edit.action === 'delete' ? '폴더 삭제 확인' : '폴더 저장'}</button></div>
    </form>}
  </section>;
};
