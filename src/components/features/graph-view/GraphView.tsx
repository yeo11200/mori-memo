import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Folder, Maximize2, Minus, Plus, Search, X } from 'lucide-react';
import { handleNotePreview } from '../../../../shared/note-preview';
import { handleBuildGraph, handleLayoutNoteGroups } from '../../../../shared/graph';
import type { Note } from '../../../../shared/types';

const COLORS = ['#0284c7', '#6366f1', '#b7791f', '#9470bd', '#c46685', '#319795'];
const handleLabel = (name: string, length: number) => name.length > length ? name.slice(0, length) + '…' : name;

export const GraphView = ({ notes, folders = [], selectedId, onSelect, onAddLink }: {
  notes: Note[]; folders?: string[]; selectedId?: string; onSelect: (id: string) => void; onAddLink: (id: string) => void;
}) => {
  const graph = useMemo(() => handleBuildGraph(notes, folders), [notes, folders]);
  const colors = useMemo(() => new Map(graph.folders.map((item, index) => [item.name, COLORS[index % COLORS.length]])), [graph]);
  const handleColor = (name: string) => colors.get(name) || COLORS[0];
  const [view, setView] = useState<'notes' | 'folders'>('notes');
  const [onlyConnected, setOnlyConnected] = useState(false);
  const noteView = view === 'notes';
  const [folderName, setFolderName] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(selectedId || null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const map = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const markerId = useId().replace(/:/g, '');
  const folder = graph.folders.find(item => item.name === folderName);
  const inspected = notes.find(note => note.id === noteId);
  const keyword = query.trim().toLocaleLowerCase();
  const filteredFolders = graph.folders.filter(item => (item.name + ' ' + item.notes.map(note => note.title).join(' ')).toLocaleLowerCase().includes(keyword));
  const nearby = new Set([noteId, ...graph.edges.filter(edge => edge.source === noteId || edge.target === noteId).flatMap(edge => [edge.source, edge.target])]);
  const filteredNotes = (folder?.notes || notes).filter(note => (note.title + ' ' + note.folder + ' ' + handleNotePreview(note.body)).toLocaleLowerCase().includes(keyword) && (!onlyConnected || !noteId || nearby.has(note.id)));
  const items = noteView ? filteredNotes.map(note => ({ id: note.id, name: note.title, count: graph.edges.filter(edge => edge.source === note.id || edge.target === note.id).length, color: handleColor(note.folder) })) : filteredFolders.map(item => ({ id: item.name, name: item.name, count: item.notes.length, color: handleColor(item.name) }));
  const shown = items.slice(0, limit);
  const width = expanded ? 720 : 360;
  const columns = expanded ? 3 : 2;
  const layout = handleLayoutNoteGroups(filteredNotes.slice(0, limit), width);
  const positions = new Map(shown.map((item, index) => [item.id, { ...item, ...(noteView ? layout.positions.get(item.id)! : { x: (index % columns + .5) * width / columns, y: 60 + Math.floor(index / columns) * 116 }) }]));
  const height = noteView ? layout.height : Math.max(245, Math.ceil(shown.length / columns) * 116 + 32);
  const edges = noteView ? graph.edges.map(edge => ({ ...edge, count: 1 })) : graph.folderEdges;
  const incoming = inspected ? graph.edges.filter(edge => edge.target === inspected.id).map(edge => notes.find(note => note.id === edge.source)!) : [];
  const outgoing = inspected ? graph.edges.filter(edge => edge.source === inspected.id).map(edge => notes.find(note => note.id === edge.target)!) : [];
  const broken = inspected ? graph.unresolved.filter(link => link.source === inspected.id) : [];
  const crossLinks = folder ? graph.edges.filter(edge => {
    const source = notes.find(note => note.id === edge.source);
    const target = notes.find(note => note.id === edge.target);
    return source?.folder !== target?.folder && (source?.folder === folder.name || target?.folder === folder.name);
  }) : [];
  const handleFolder = (name: string | null) => { setView('notes'); setFolderName(name); setOnlyConnected(false); setNoteId(null); setQuery(''); setLimit(12); setZoom(1); };
  const handleInspect = (id: string) => { setNoteId(id); setLimit(current => Math.max(current, items.findIndex(item => item.id === id) + 1)); };
  const handleView = (next: 'notes' | 'folders') => { setView(next); setFolderName(null); setNoteId(null); setOnlyConnected(false); setQuery(''); setLimit(12); setZoom(1); };
  const handleCollapse = () => { setExpanded(false); requestAnimationFrame(() => expandButton.current?.focus()); };
  useEffect(() => { if (expanded) search.current?.focus(); }, [expanded]);
  useEffect(() => { map.current?.scrollTo(0, 0); }, [folderName, query, expanded, view, onlyConnected]);
  const handleReferences = (label: string, references: Note[]) => <div className="folder-graph__references">
    <h4>{label}<span>{references.length}</span></h4>
    {references.map(note => <button key={note.id} onClick={() => { handleFolder(note.folder); handleInspect(note.id); }}><span><strong>{note.title}</strong><small>{note.folder}</small></span><ArrowUpRight size={14} /></button>)}
    {!references.length && <p>아직 연결이 없습니다.</p>}
  </div>;

  return <section ref={root} className={'folder-graph' + (expanded ? ' folder-graph--expanded' : '')} role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label="지식 그래프 탐색" onKeyDown={event => {
    if (event.key === 'Escape' && expanded) { event.stopPropagation(); handleCollapse(); }
    if (event.key === 'Tab' && expanded) {
      const controls = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]');
      const first = controls?.[0]; const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="folder-graph__heading"><div><small>{noteView ? '메모 간 연결' : '폴더별 연결 요약'}</small><h3>{noteView ? (folder ? folder.name + '의 메모' : '메모로 이어진 생각') : '폴더로 보는 지식'}</h3></div><button ref={expandButton} className="wiki__icon-button" aria-label={expanded ? '그래프 축소' : '그래프 확대'} onClick={() => expanded ? handleCollapse() : setExpanded(true)}>{expanded ? <X size={18} /> : <Maximize2 size={17} />}</button></div>
    <div className="folder-graph__view" role="group" aria-label="그래프 보기"><button aria-pressed={noteView} onClick={() => handleView('notes')}>메모 연결</button><button aria-pressed={!noteView} onClick={() => handleView('folders')}>폴더 요약</button></div>
    <div className="folder-graph__stats"><span><strong>{graph.folders.length}</strong> 폴더</span><span><strong>{notes.length}</strong> 메모</span><span><strong>{graph.edges.length}</strong> 문서 링크</span></div>
    <div className="folder-graph__toolbar">{folder && <button aria-label="전체 폴더로 돌아가기" onClick={() => handleFolder(null)}><ArrowLeft size={15} />전체 폴더</button>}<label><Search size={14} /><input ref={search} aria-label="그래프 검색" placeholder={folder ? '이 폴더의 메모 검색' : '폴더·메모 이름 검색'} value={query} onChange={event => { setQuery(event.target.value); setLimit(12); }} /></label></div>
    <div className="folder-graph__filters">{noteView && <><select aria-label="그래프 폴더 필터" value={folder?.name || ''} onChange={event => handleFolder(event.target.value || null)}><option value="">전체 폴더</option>{graph.folders.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><label><input type="checkbox" disabled={!noteId} checked={onlyConnected} onChange={event => { setOnlyConnected(event.target.checked); setLimit(12); }} />연결된 메모만</label></>}</div>
    <div className="folder-graph__layout"><div className="folder-graph__map-section">
      <div ref={map} className="folder-graph__map" aria-label="그래프 지도">
        {!items.length ? <div className="folder-graph__empty"><Folder size={30} /><strong>{keyword ? '검색 결과가 없습니다' : folder ? '아직 빈 폴더예요' : '폴더를 추가해 보세요'}</strong><p>{folder ? '메모를 이 폴더로 옮기면 여기에 나타납니다.' : '메모를 폴더로 묶어 생각을 탐색하세요.'}</p></div> : <svg viewBox={'0 0 ' + width + ' ' + height} style={{ width: zoom * 100 + '%', minWidth: zoom * 100 + '%' }} role="group" aria-label={noteView ? '메모 연결 지도' : '폴더 사이 연결 지도'}>
          <defs><marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#64748b" /></marker></defs>
          {noteView && layout.regions.map(region => <g key={region.name} className="folder-graph__region" data-folder={region.name}><rect x={region.x} y={region.y} width={region.width} height={region.height} rx="16" fill={handleColor(region.name) + '0c'} stroke={handleColor(region.name) + '50'} /><text x={region.x + 14} y={region.y + 24} fill={handleColor(region.name)}>{handleLabel(region.name, 18)} · {region.count}</text></g>)}
          {edges.map(edge => {
            const source = positions.get(edge.source); const target = positions.get(edge.target);
            if (!source || !target) return null;
            const distance = Math.hypot(target.x - source.x, target.y - source.y);
            const radius = noteView ? 16 : 36;
            const dx = (target.x - source.x) / distance; const dy = (target.y - source.y) / distance;
            const active = !noteId || edge.source === noteId || edge.target === noteId;
            return <g key={JSON.stringify([edge.source, edge.target])} className={'folder-graph__edge' + (active ? ' folder-graph__edge--active' : '')}><title>{source.name} → {target.name}{noteView ? '' : ' · 문서 링크 ' + edge.count + '개 (양방향 합계)'}</title><line x1={source.x + dx * radius} y1={source.y + dy * radius} x2={target.x - dx * radius} y2={target.y - dy * radius} markerEnd={noteView ? 'url(#' + markerId + ')' : undefined} />{!noteView && <><rect x={(source.x + target.x) / 2 - 12} y={(source.y + target.y) / 2 - 10} width="24" height="20" rx="10" /><text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 + 4} textAnchor="middle">{edge.count}</text></>}</g>;
          })}
          {[...positions.values()].map(item => <g key={item.id} transform={'translate(' + item.x + ',' + item.y + ')'} role="button" tabIndex={0} aria-label={noteView ? '메모 ' + item.name + ' 연결 상세' : '폴더 ' + item.name + ', 메모 ' + item.count + '개'} onClick={() => noteView ? handleInspect(item.id) : handleFolder(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); noteView ? handleInspect(item.id) : handleFolder(item.id); } }} className={'folder-graph__node' + (item.id === noteId ? ' folder-graph__node--selected' : '') + (noteView && noteId && !nearby.has(item.id) ? ' folder-graph__node--dim' : '')}>
            <title>{item.name} · {item.count}{noteView ? '개 연결' : '개 메모'}</title><circle r={noteView ? 13 : 34} fill={item.color + '18'} stroke={item.color} />
            {!noteView && <text className="folder-graph__count" textAnchor="middle" y="6" fill={item.color}>{item.count}</text>}
            <text className="folder-graph__name" y={noteView ? 33 : 55} textAnchor="middle">{handleLabel(item.name, noteView ? 9 : 14)}</text>
          </g>)}
        </svg>}
      </div>
      <div className="folder-graph__legend"><span>{noteView ? '색 영역: 폴더 · 화살표: 문서 참조' : '선의 숫자: 폴더 간 문서 링크 수'}</span><div><button aria-label="그래프 배율 줄이기" disabled={zoom <= .75} onClick={() => setZoom(value => Math.max(.75, value - .25))}><Minus size={13} /></button><button aria-label="그래프 배율 초기화" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="그래프 배율 늘리기" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}><Plus size={13} /></button></div></div>
      <p className="folder-graph__help">{noteView ? '점은 메모, 배경 영역은 폴더입니다. 메모를 눌러 내용과 연결을 확인하세요.' : '폴더를 눌러 메모를 탐색하세요. 같은 폴더의 메모라도 실제 링크가 없으면 선으로 연결하지 않습니다.'}</p>
      <div className="folder-graph__items" aria-label={noteView ? '그래프 메모 목록' : '그래프 폴더 목록'}>{shown.map(item => <button key={item.id} aria-pressed={noteView ? item.id === noteId : undefined} onClick={() => noteView ? handleInspect(item.id) : handleFolder(item.id)}><span className="folder-graph__dot" style={{ background: item.color }} /><span><strong>{item.name}</strong>{noteView && <small className="folder-graph__excerpt">{handleNotePreview(notes.find(note => note.id === item.id)?.body || '', 75) || '내용 없는 메모'}</small>}</span><small>{item.count}{noteView ? ' 연결' : ' 메모'}</small></button>)}</div>
      {items.length > shown.length && <button className="wiki__button folder-graph__more" onClick={() => setLimit(value => value + 12)}>12개 더 보기 · {shown.length}/{items.length}</button>}
      {noteView && folder && <div className="folder-graph__cross"><h4>다른 폴더와 연결 <span>{crossLinks.length}</span></h4>{crossLinks.map(edge => {
        const source = notes.find(note => note.id === edge.source)!; const target = notes.find(note => note.id === edge.target)!;
        const destination = source.folder === folder.name ? target : source;
        return <button key={JSON.stringify([edge.source, edge.target])} onClick={() => { handleFolder(destination.folder); handleInspect(destination.id); }}><strong>{source.title} → {target.title}</strong><small>{source.folder} → {target.folder}</small></button>;
      })}{!crossLinks.length && <p>다른 폴더를 참조한 문서가 없습니다.</p>}</div>}
    </div><aside className="folder-graph__details" aria-label="메모 연결 상세">
      {inspected ? <><small style={{ color: handleColor(inspected.folder) }}>{inspected.folder}</small><h3>{inspected.title}</h3><p className="folder-graph__preview">{handleNotePreview(inspected.body) || '아직 작성된 내용이 없습니다.'}</p><p className="folder-graph__modified">수정: {Number.isNaN(Date.parse(inspected.updatedAt)) ? '기록 없음' : new Date(inspected.updatedAt).toLocaleString('ko-KR')}</p><button className="wiki__button wiki__button--primary" onClick={() => { onSelect(inspected.id); if (expanded) handleCollapse(); }}>이 메모 열기 <ArrowUpRight size={14} /></button><button className="wiki__button" onClick={() => onAddLink(inspected.id)}><Plus size={14} />연결 추가</button>{handleReferences('들어오는 링크', incoming)}{handleReferences('나가는 링크', outgoing)}{broken.length > 0 && <div className="folder-graph__broken"><h4>찾을 수 없는 연결 {broken.length}</h4>{broken.map(link => <p key={link.target}>{'[[' + link.target + ']]'}</p>)}<small>대상이 없거나 같은 이름의 문서가 여럿일 수 있어요.</small></div>}</> : <><Folder size={24} /><h3>{noteView ? '메모의 연결을 살펴보세요' : '폴더 사이 연결을 살펴보세요'}</h3><p>{noteView ? '메모를 선택하면 내용 미리보기와 들어오는·나가는 링크를 보여드립니다.' : '폴더별 메모 수를 확인하고, 폴더 사이에 어떤 문서가 연결되어 있는지 탐색하세요.'}</p>{graph.unresolved.length > 0 && <small>전체 미해결 링크 {graph.unresolved.length}개 · 문서 상세에서 확인</small>}</>}
    </aside></div>
  </section>;
};
