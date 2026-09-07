import { useMemo } from 'react';
import { handleParseLinks, handleResolveLink } from '../../../../shared/links';
import type { Note } from '../../../../shared/types';

export const GraphView = ({ notes, selectedId, onSelect, compact = false }: { notes: Note[]; selectedId?: string; onSelect: (id: string) => void; compact?: boolean }) => {
  const graph = useMemo(() => {
    const edges = notes.flatMap(note => handleParseLinks(note.body).map(link => ({ source: note.id, target: handleResolveLink(link.target, notes)?.id })).filter(edge => edge.target && edge.target !== edge.source));
    const nearby = new Set([selectedId, ...edges.filter(edge => edge.source === selectedId || edge.target === selectedId).flatMap(edge => [edge.source, edge.target])]);
    const visible = (compact ? notes.filter(note => nearby.has(note.id)) : notes).slice(0, compact ? 15 : 80);
    const positions = new Map(visible.map((note, index) => {
      const center = note.id === selectedId;
      const angle = index * 2.399963229728653;
      const radius = compact ? 110 : 80 + Math.sqrt(index) * 30;
      return [note.id, { note, x: center ? 300 : 300 + Math.cos(angle) * radius, y: center ? 230 : 230 + Math.sin(angle) * radius * .78 }];
    }));
    return { positions, edges: [...new Map(edges.map(edge => [`${edge.source}:${edge.target}`, edge])).values()] };
  }, [notes, selectedId, compact]);
  return <div className={`wiki__graph${compact ? ' wiki__graph--compact' : ''}`}>
    <svg viewBox="0 0 600 460" role="img" aria-label="문서 연결 그래프">
      {graph.edges.map(edge => { const source = graph.positions.get(edge.source); const target = graph.positions.get(edge.target!); return source && target ? <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null; })}
      {[...graph.positions.values()].map(({ note, x, y }) => <g key={note.id} transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={note.title} onClick={() => onSelect(note.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onSelect(note.id); }}>
        <circle r={note.id === selectedId ? 10 : 6} className={note.id === selectedId ? 'wiki__graph__node--active' : ''} />
        <text y="25" textAnchor="middle">{note.title.length > 16 ? note.title.slice(0, 16) + '…' : note.title}</text>
      </g>)}
    </svg>
    {!compact && <div className="wiki__graph__list">{[...graph.positions.values()].map(({ note }) => <button key={note.id} onClick={() => onSelect(note.id)}>{note.title}</button>)}</div>}
  </div>;
};
