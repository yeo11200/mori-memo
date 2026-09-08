import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowUpRight, FilePlus2, FolderOpen, Link2, Menu, MoreHorizontal, Pin, Plus, Search, Settings2, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { SettingsPanel, handleFormatShortcut } from './SettingsPanel';
import { FolderPanel } from './FolderPanel';
import { NoteEditor } from './NoteEditor';
import { CommandPalette } from './CommandPalette';
import { useWiki } from './hooks/useWiki';
import { MarkdownView } from '../components/features/markdown-view';
import { GraphView } from '../components/features/graph-view';
import { handleBacklinks, handleParseLinks, handleRelatedNotes, handleResolveLink } from '../../shared/links';
import type { AIAction, AppSettings } from '../../shared/types';

const actionLabels: Record<AIAction, string> = { generate: '초안 작성', summary: '요약하기', expand: '풀어 쓰기', meeting: '회의록 정리', custom: '내 명령', connections: '연결 찾기' };

export const App = () => {
  const wiki = useWiki();
  const [query, setQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [preview, setPreview] = useState(false);
  const editOnSelect = useRef<string | null>(null);
  const [panel, setPanel] = useState<'links' | 'graph' | 'settings' | null>('links');
  const [showCreate, setShowCreate] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<typeof wiki.notes>([]);
  const filteredNotes = useMemo(() => wiki.notes.filter(note => (!selectedFolder || note.folder === selectedFolder) && (!pinnedOnly || note.pinned) && `${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase())), [wiki.notes, query, pinnedOnly, selectedFolder]);
  const activeNote = wiki.draft;
  const handleShortcutLabel = (action: string) => handleFormatShortcut(wiki.settings?.shortcuts?.find(binding => binding.action === action)?.accelerator || '');
  useEffect(() => {
    setPreview(editOnSelect.current === wiki.draft?.id ? false : Boolean(wiki.draft?.body.trim()));
    editOnSelect.current = null;
  }, [wiki.draft?.id]);
  const backlinks = activeNote ? handleBacklinks(activeNote, wiki.notes) : [];
  const related = activeNote ? handleRelatedNotes(activeNote, wiki.notes).filter(item => !backlinks.some(note => note.id === item.note.id)) : [];

  const handleFocusSearch = useCallback(() => {
    setShowAI(false); setShowCreate(false); setShowTrash(false); setShowPalette(false); setPinnedOnly(false); setSelectedFolder('');
    requestAnimationFrame(() => {
      const input = document.getElementById('wiki-search') as HTMLInputElement | null;
      input?.focus(); input?.select();
    });
  }, []);

  const handleCommand = (command: string) => {
    if (command === 'notes-changed') void window.wiki.handleBootstrap().then(data => wiki.handleReloadNotes(data.notes)).catch(wiki.handleReportError);
    if (command === 'capture') void wiki.handleCapture();
    if (command === 'new' || command === 'quick-note') { setPreview(false); void wiki.handleCreate('blank', selectedFolder || undefined); }
    if (command === 'search') handleFocusSearch();
    if (command === 'settings') setPanel('settings');
    if (command === 'save') void wiki.handleFlush().catch(() => undefined);
    if (command === 'close') void wiki.handleClose();
    if (command === 'ai') { setShowCreate(false); setShowTrash(false); setShowAI(true); }
    if (command === 'palette') { setShowCreate(false); setShowTrash(false); setShowAI(false); setShowPalette(true); }
    if (command.startsWith('custom:')) {
      const custom = wiki.settings?.customCommands?.find(item => item.id === command.slice(7));
      if (custom) { setShowAI(true); void wiki.handleAI('custom', custom.instruction); }
    }
  };
  const commandRef = useRef(handleCommand);
  commandRef.current = handleCommand;
  useEffect(() => window.wiki?.handleOnCommand(command => commandRef.current(command)), []);

  const handleOpenTrash = async () => { try { setTrash(await window.wiki.handleListTrash()); setShowTrash(true); } catch (error) { wiki.handleReportError(error); } };
  const handleOpenLink = (target: string) => {
    const note = handleResolveLink(target, wiki.notes);
    if (note) void wiki.handleSelect(note.id); else wiki.handleReportError(`연결된 메모를 찾을 수 없습니다: ${target}`);
  };
  const handleSaveSettings = async (next: AppSettings) => { wiki.handleSetSettings(await window.wiki.handleSaveSettings(next)); setPanel('links'); };

  if (wiki.isLoading) return <div className="wiki__loading"><MoriLogo /> 나만의 지식정원을 준비하는 중…</div>;
  return <div className="wiki">
    <header className="wiki__topbar"><div className="wiki__brand"><MoriLogo /><div className="wiki__brand__wordmark"><strong>MORI</strong><span>나의 지식정원</span></div><span className="wiki__brand__beta">local</span></div><div className="wiki__topbar__tools"><button className="wiki__icon-button" title="Markdown 가져오기" onClick={() => void wiki.handleImport()}><FolderOpen size={16} /></button><button className="wiki__icon-button" title="백업 내보내기" onClick={() => void wiki.handleExport()}><Archive size={16} /></button><button className="wiki__icon-button" title="설정" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Settings2 size={16} /></button></div></header>
    <main className="wiki__workspace">
      <aside className="wiki__sidebar">
        <button className="wiki__new-note" onClick={() => setShowCreate(true)}><Plus size={18} />새 메모 <kbd>{handleShortcutLabel('new')}</kbd></button>
        <div className="wiki__search"><Search size={15} /><input id="wiki-search" aria-label="메모 검색" placeholder="제목·내용 검색" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
  if (event.nativeEvent.isComposing) return;
  if (event.key === 'Escape') { setQuery(''); document.querySelector<HTMLTextAreaElement>('.wiki__body-input')?.focus(); }
  if (event.key === 'Enter' && filteredNotes[0]) { event.preventDefault(); editOnSelect.current = filteredNotes[0].id; setPreview(false); void wiki.handleSelect(filteredNotes[0].id).then(() => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.wiki__body-input')?.focus())); }
}} />{query && <button aria-label="검색 지우기" onClick={() => setQuery('')}><X size={14} /></button>}</div>
        <div className="wiki__quick"><span>내 보관함</span><button onClick={() => setPanel('graph')}><Link2 size={14} />그래프</button></div>
        <nav className="wiki__nav"><button className={`wiki__nav__item${!pinnedOnly ? ' wiki__nav__item--active' : ''}`} onClick={() => { setPinnedOnly(false); setQuery(''); setSelectedFolder(''); }}><Menu size={15} />모든 메모 <span>{wiki.notes.length}</span></button><button className={`wiki__nav__item${pinnedOnly ? ' wiki__nav__item--active' : ''}`} onClick={() => setPinnedOnly(true)}><Pin size={15} />고정한 메모 <span>{wiki.notes.filter(note => note.pinned).length}</span></button><button className="wiki__nav__item" onClick={() => void handleOpenTrash()}><Trash2 size={15} />휴지통</button></nav>
        <FolderPanel folders={wiki.folders} notes={wiki.notes} selected={selectedFolder} busy={wiki.isMutating} onSelect={folder => { setSelectedFolder(folder); setQuery(''); setPinnedOnly(false); }} onChange={async (action, from, to) => { const ok = await wiki.handleFolderChange(action, from, to); if (ok && selectedFolder === from) setSelectedFolder(action === 'delete' ? '미분류' : to || from); return ok; }} />
        <button className="wiki__button wiki__palette-launch" onClick={() => handleCommand('palette')}>명령 팔레트</button>
        <label className="wiki__section-title">{selectedFolder || '최근 메모'} <span>{handleShortcutLabel('search')} 검색</span></label>
        <div className="wiki__notes-list">{filteredNotes.map(note => <button key={note.id} className={`wiki__note-row${wiki.draft?.id === note.id ? ' wiki__note-row--active' : ''}`} onClick={() => void wiki.handleSelect(note.id)}><span className="wiki__note-row__dot" /><span className="wiki__note-row__text"><strong>{note.title}</strong><small>{note.body.replace(/[#*\[\]`]/g, '').trim().slice(0, 48) || '아직 내용이 없어요'}</small></span>{note.pinned && <Pin size={12} className="wiki__note-row__pin" />}</button>)}{!filteredNotes.length && <div className="wiki__empty-list">검색 결과가 없어요</div>}</div>
        <button className="wiki__example" onClick={() => void wiki.handleExample()}><Sparkles size={14} />예제 보관함 추가</button>
      </aside>
      <section className="wiki__editor">
        {wiki.draft ? <><div className="wiki__editor__toolbar"><span className="wiki__crumb">{wiki.draft.folder} <span>/</span> {wiki.draft.title}</span><div className="wiki__editor__actions"><span className="wiki__save-state">{wiki.saveStatus}</span><button className="wiki__icon-button" title="화면 캡처" onClick={() => void wiki.handleCapture()}><ArrowUpRight size={16} /></button><button className="wiki__icon-button wiki__danger" title="휴지통으로 이동" onClick={() => void wiki.handleDelete()}><Trash2 size={16} /></button><button className="wiki__icon-button" title={wiki.draft.pinned ? '고정 해제' : '메모 고정'} onClick={() => wiki.handleEdit({ pinned: !wiki.draft!.pinned })}><Pin size={17} /></button></div></div><div className="wiki__writing-tools"><select aria-label="메모 폴더" disabled={wiki.isMutating} value={wiki.draft.folder} onChange={event => wiki.handleEdit({ folder: event.target.value })}>{[...new Set([...wiki.folders, wiki.draft.folder])].map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><button className="wiki__button wiki__button--primary" onClick={() => { setShowAI(true); void wiki.handleAI('summary'); }} disabled={!!wiki.aiAction}><Sparkles size={15} />요약하기</button><button className="wiki__button" onClick={() => setShowAI(true)}><Wand2 size={15} />AI로 작성·정리</button><button className="wiki__button" onClick={() => setPreview(!preview)}>{preview ? '편집하기' : '미리보기'}</button></div><input disabled={wiki.isMutating} aria-label="메모 제목" className="wiki__title-input" value={wiki.draft.title} onChange={event => wiki.handleEdit({ title: event.target.value })} placeholder="제목 없는 메모" />{preview ? <MarkdownView body={wiki.draft.body} onLink={handleOpenLink} /> : <NoteEditor key={wiki.draft.id} note={wiki.draft} notes={wiki.notes} disabled={wiki.isMutating} onEdit={body => wiki.handleEdit({ body })} />}<div className="wiki__editor__footer"><span>Markdown 지원 · [[문서]]로 연결</span><span><kbd>⌘ S</kbd> 저장</span></div></> : <div className="wiki__empty-editor"><Sparkles size={26} /><h2>첫 메모를 시작해 보세요</h2><p>당신의 생각이 연결된 지식이 됩니다.</p><button onClick={() => setShowCreate(true)}><Plus size={16} /> 새 메모 만들기</button><button onClick={() => setShowAI(true)}><Wand2 size={16} />AI로 초안 작성</button></div>}
      </section>
      <aside className="wiki__right-panel">
        {panel === 'settings' && wiki.settings ? <SettingsPanel settings={wiki.settings} onSave={handleSaveSettings} onClose={() => setPanel('links')} /> : panel === 'graph' ? <><PanelHeader title="지식 그래프" onClose={() => setPanel('links')} /><GraphView notes={wiki.notes} folders={wiki.folders} selectedId={wiki.draft?.id} onSelect={id => void wiki.handleSelect(id)} /></> : activeNote ? <LinksPanel draft={activeNote} notes={wiki.notes} backlinks={backlinks} related={related} onOpen={handleOpenLink} onGraph={() => setPanel('graph')} onAI={() => setShowAI(true)} /> : <div className="wiki__panel__hint">메모를 선택하면 연결된 생각을 보여드려요.</div>}
      </aside>
    </main>
    {showPalette && wiki.settings && <CommandPalette settings={wiki.settings} notes={wiki.notes} onClose={() => setShowPalette(false)} onCommand={handleCommand} onNote={id => void wiki.handleSelect(id)} />}
    {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={template => { setShowCreate(false); void wiki.handleCreate(template, selectedFolder || undefined); }} />}
    {showAI && <AIModal action={wiki.aiAction} result={wiki.aiResult} applied={wiki.appliedResult} onRun={(action, instruction) => void wiki.handleAI(action, instruction)} onApply={async () => { if (await wiki.handleApplyResult()) { setShowAI(false); setPreview(false); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.wiki__body-input')?.focus()); } }} onCancel={() => { setShowAI(false); wiki.handleCancelAI(); }} />}
    {showTrash && <TrashModal notes={trash} onClose={() => setShowTrash(false)} onRestore={async id => { await window.wiki.handleRestoreNote(id); const data = await window.wiki.handleBootstrap(); await wiki.handleReloadNotes(data.notes); setTrash(await window.wiki.handleListTrash()); }} onDelete={async id => { await window.wiki.handleDeletePermanently(id); setTrash(await window.wiki.handleListTrash()); }} />}
    {(wiki.error || wiki.notice) && <div className={`wiki__toast${wiki.error ? ' wiki__toast--error' : ''}`}><span role="status">{wiki.error || wiki.notice}</span><button onClick={wiki.error ? wiki.handleClearError : wiki.handleClearNotice}><X size={15} /></button></div>}
  </div>;
};

const PanelHeader = ({ title, onClose }: { title: string; onClose: () => void }) => <div className="wiki__panel__header"><div><span className="wiki__eyebrow">EXPLORE</span><h2>{title}</h2></div><button className="wiki__icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button></div>;

const MoriLogo = () => <div className="mori-logo" aria-label="MORI 로고"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 25V10M16 16c-5-1-8-4-8-8 5 0 8 3 8 8Zm0 4c5-1 8-4 8-8-5 0-8 3-8 8Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="8" r="2.2" fill="currentColor"/></svg></div>;

const LinksPanel = ({ draft, notes, backlinks, related, onOpen, onGraph, onAI }: { draft: NonNullable<ReturnType<typeof useWiki>['draft']>; notes: ReturnType<typeof useWiki>['notes']; backlinks: ReturnType<typeof handleBacklinks>; related: ReturnType<typeof handleRelatedNotes>; onOpen: (target: string) => void; onGraph: () => void; onAI: () => void }) => <div className="wiki__links-panel"><div className="wiki__panel__header"><div><span className="wiki__eyebrow">MEMO CONTEXT</span><h2>연결된 생각</h2></div><button className="wiki__icon-button" onClick={onGraph}><Link2 size={16} /></button></div><div className="wiki__ai-card"><div className="wiki__ai-card__icon"><Wand2 size={16} /></div><div><strong>이 메모를 다듬어 볼까요?</strong><p>요약, 회의록, 풀어 쓰기를 원하는 순간에만 실행해요.</p></div><button aria-label="AI 편집 열기" onClick={onAI}><ArrowUpRight size={15} /></button></div><LinkSection icon={<Link2 size={15} />} title="백링크" count={backlinks.length}>{backlinks.map(note => <NoteLink key={note.id} note={note} onOpen={onOpen} />)}</LinkSection><LinkSection icon={<Sparkles size={15} />} title="관련 메모" count={related.length}>{related.map(item => <NoteLink key={item.note.id} note={item.note} onOpen={onOpen} meta={item.keywords.join(' · ')} />)}</LinkSection><LinkSection icon={<FilePlus2 size={15} />} title="이 메모의 링크" count={handleParseLinks(draft.body).length}>{handleParseLinks(draft.body).map((link, index) => <button className="wiki__context-link" key={`${link.target}-${index}`} onClick={() => onOpen(link.target)}><span>[[</span>{link.label}<span>]]</span></button>)}</LinkSection><div className="wiki__panel__hint"><strong>{notes.length}개</strong>의 메모가 이 보관함에 있어요.<br />내용을 연결할수록 검색이 쉬워집니다.</div></div>;
const LinkSection = ({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) => <section className="wiki__link-section"><div className="wiki__link-section__title">{icon}<span>{title}</span><em>{count}</em></div>{count ? children : <p className="wiki__link-section__empty">아직 연결된 메모가 없어요.</p>}</section>;
const NoteLink = ({ note, onOpen, meta }: { note: { id: string; title: string; body: string }; onOpen: (id: string) => void; meta?: string }) => <button className="wiki__context-link" onClick={() => onOpen(note.id)}><span className="wiki__context-link__bullet" /> <span><strong>{note.title}</strong><small>{meta || note.body.replace(/[#*\[\]`]/g, '').trim().slice(0, 54)}</small></span><ArrowUpRight size={13} /></button>;

const CreateModal = ({ onClose, onCreate }: { onClose: () => void; onCreate: (template: string) => void }) => <Modal title="새 메모" onClose={onClose}><p className="wiki__modal__description">어떤 방식으로 시작할까요?</p><div className="wiki__template-grid">{[['blank', '빈 메모', '자유롭게 기록'], ['daily', '데일리 노트', '오늘을 정리'], ['meeting', '회의록', '결정과 할 일']].map(([id, title, description]) => <button key={id} onClick={() => onCreate(id)}><span className="wiki__template-grid__icon"><FilePlus2 size={18} /></span><strong>{title}</strong><small>{description}</small></button>)}</div></Modal>;
const AIModal = ({ action, result, applied, onRun, onApply, onCancel }: {
  action: AIAction | null; result: ReturnType<typeof useWiki>['aiResult']; applied: string;
  onRun: (action: AIAction, instruction?: string) => void; onApply: () => void; onCancel: () => void;
}) => {
  const [instruction, setInstruction] = useState('');
  return <Modal title="AI 작성·편집" onClose={onCancel}>
    <p className="wiki__modal__description">무엇을 써 드릴까요? 빈 메모에는 초안이 자동으로 채워집니다. 기존 내용이 있으면 결과를 확인한 뒤 추가할 수 있어요.</p>
    <form className="wiki__ai-prompt" onSubmit={event => { event.preventDefault(); if (instruction.trim() && !action) onRun('generate', instruction); }}>
      <label htmlFor="ai-instruction">AI에게 작성 요청</label>
      <textarea autoFocus id="ai-instruction" value={instruction} maxLength={4000} disabled={!!action} onChange={event => setInstruction(event.target.value)} placeholder="예: 개인 위키를 꾸준히 활용하는 방법을 체크리스트로 작성해 줘" />
      <button className="wiki__button wiki__button--primary" disabled={!!action || !instruction.trim()} type="submit"><Sparkles size={15} />초안 작성</button>
    </form>
    <p className="wiki__modal__description">이미 쓴 메모 다듬기</p>
    <div className="wiki__ai-tabs">{(['summary', 'expand', 'meeting', 'connections', 'custom'] as AIAction[]).map(item => <button className={action === item ? 'wiki__ai-tabs--active' : ''} key={item} disabled={!!action} onClick={() => onRun(item)}>{actionLabels[item]}</button>)}</div>
    {action && <div className="wiki__ai-loading" role="status"><Sparkles size={18} />{actionLabels[action]} 중…</div>}
    {!action && result && <><div className="wiki__ai-result__meta"><span>{actionLabels[result.action]}</span><span>{applied ? '메모에 반영됨' : '결과 미리보기'}</span></div><pre className="wiki__ai-result">{result.text}</pre><div className="wiki__modal__actions"><button className="wiki__button wiki__button--quiet" onClick={() => void navigator.clipboard?.writeText(result.text)}>복사</button><button className="wiki__button wiki__button--primary" disabled={!!applied} onClick={onApply}>{applied ? '본문에 추가됨' : '본문 아래에 추가'}</button></div></>}
  </Modal>;
};
const TrashModal = ({ notes, onClose, onRestore, onDelete }: {
  notes: { id: string; title: string; body: string }[]; onClose: () => void;
  onRestore: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) => {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handleAction = async (id: string, remove: boolean) => {
    setBusy(true); setError('');
    try { await (remove ? onDelete(id) : onRestore(id)); setPending(null); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setBusy(false); }
  };
  return <Modal title="휴지통" onClose={() => { if (!busy) onClose(); }}>
    <p className="wiki__modal__description">삭제한 메모 {notes.length}개 · 복원하거나 영구 삭제할 수 있어요.</p>
    {!notes.length ? <div className="wiki__trash-empty"><Trash2 size={32} /><strong>휴지통이 비어 있어요</strong><span>삭제한 메모가 여기에 표시됩니다.</span></div> :
      <div className="wiki__trash-cards">{notes.map(note => <article className="wiki__trash-card" key={note.id}>
        <div className="wiki__trash-heading"><FilePlus2 size={19} /><strong>{note.title}</strong></div>
        <p>{note.body.replace(/[#*\[\]`]/g, '').trim().slice(0, 160) || '내용이 없는 메모'}</p>
        {pending === note.id ? <div className="wiki__delete-confirm" role="alert">
          <strong>이 메모를 영구 삭제할까요?</strong>
          <p>본문·버전 기록·AI 결과가 삭제되며 복원할 수 없습니다. 첨부 파일과 외부 백업은 남습니다.</p>
          <div className="wiki__trash-actions"><button className="wiki__button" disabled={busy} onClick={() => setPending(null)}>취소</button><button className="wiki__button wiki__button--destructive" disabled={busy} onClick={() => void handleAction(note.id, true)}>{busy ? '삭제 중…' : '영구 삭제 확인'}</button></div>
        </div> : <div className="wiki__trash-actions"><button className="wiki__button" disabled={busy} onClick={() => void handleAction(note.id, false)}>복원</button><button className="wiki__button wiki__button--destructive" disabled={busy} onClick={() => setPending(note.id)}><Trash2 size={14} />영구 삭제</button></div>}
      </article>)}</div>}
    {error && <p role="alert" className="wiki__trash-error">{error}</p>}
  </Modal>;
};
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => <div className="wiki__modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="wiki__modal" role="dialog" aria-label={title} aria-modal="true"><div className="wiki__modal__header"><h2>{title}</h2><button className="wiki__icon-button" aria-label="닫기" onClick={onClose}><X size={17} /></button></div>{children}</div></div>;
