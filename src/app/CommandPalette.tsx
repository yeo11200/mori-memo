import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { AppSettings, Note } from '../../shared/types';
import { commandLabels, handleFormatShortcut } from './SettingsPanel';

export const CommandPalette = ({ settings, notes, onCommand, onNote, onClose }: {
  settings: AppSettings; notes: Note[]; onCommand: (id: string) => void; onNote: (id: string) => void; onClose: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const choices = [
    ...Object.entries(commandLabels).filter(([id]) => id !== 'palette').map(([id, title]) => ({ id, title, kind: 'command', hint: handleFormatShortcut(settings.shortcuts?.find(binding => binding.action === id)?.accelerator || '') })),
    ...(settings.customCommands || []).map(command => ({ id: `custom:${command.id}`, title: command.name, kind: 'command', hint: '사용자 AI' })),
    ...notes.map(note => ({ id: note.id, title: note.title, kind: 'note', hint: note.folder })),
  ].filter(item => `${item.title} ${item.hint}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 30);
  const handleSelect = (item: typeof choices[number]) => { onClose(); if (item.kind === 'note') onNote(item.id); else onCommand(item.id); };
  return <div className="wiki__modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label="명령 팔레트" className="wiki__modal wiki__palette">
      <div className="wiki__palette-search"><Search size={18} /><input autoFocus aria-label="명령 또는 메모 검색" placeholder="명령이나 메모 이름을 입력하세요" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') onClose();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(choices.length, 1)) % Math.max(choices.length, 1)); }
        if (event.key === 'Enter' && choices[index]) { event.preventDefault(); handleSelect(choices[index]); }
      }} /><button className="wiki__icon-button" aria-label="팔레트 닫기" onClick={onClose}><X size={15} /></button></div>
      <div className="wiki__palette-list">{choices.map((item, position) => <button className={index === position ? 'wiki__palette--active' : ''} key={`${item.kind}-${item.id}`} onClick={() => handleSelect(item)}><span>{item.title}</span><small>{item.hint}</small></button>)}{!choices.length && <p>일치하는 명령이나 메모가 없습니다.</p>}</div>
    </div>
  </div>;
};
