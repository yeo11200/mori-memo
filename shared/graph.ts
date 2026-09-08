import { handleParseLinks, handleResolveLink } from './links';
import type { Note } from './types';

export const handleBuildGraph = (notes: Note[], folderNames: string[] = []) => {
  const groups = new Map<string, Note[]>(folderNames.map(name => [name, []]));
  for (const note of notes) groups.set(note.folder, [...(groups.get(note.folder) || []), note]);
  const edges = new Map<string, { source: string; target: string }>();
  const unresolved = new Map<string, { source: string; target: string }>();
  const folderEdges = new Map<string, { source: string; target: string; count: number }>();
  for (const note of notes) for (const link of handleParseLinks(note.body)) {
    const target = handleResolveLink(link.target, notes);
    if (!target) { unresolved.set(JSON.stringify([note.id, link.target]), { source: note.id, target: link.target }); continue; }
    if (target.id === note.id) continue;
    const key = JSON.stringify([note.id, target.id]);
    if (edges.has(key)) continue;
    edges.set(key, { source: note.id, target: target.id });
    if (note.folder !== target.folder) {
      const [source, destination] = [note.folder, target.folder].sort();
      const folderKey = JSON.stringify([source, destination]);
      const previous = folderEdges.get(folderKey);
      folderEdges.set(folderKey, { source, target: destination, count: (previous?.count || 0) + 1 });
    }
  }
  return { folders: [...groups].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([name, members]) => ({ name, notes: members })), edges: [...edges.values()], folderEdges: [...folderEdges.values()], unresolved: [...unresolved.values()] };
};

export const handleLayoutNoteGroups = (notes: Note[], width: number) => {
  const groups = new Map<string, Note[]>();
  for (const note of notes) { const members = groups.get(note.folder) || []; members.push(note); groups.set(note.folder, members); }
  const folders = [...groups].sort(([a], [b]) => a.localeCompare(b, 'ko'));
  const columns = width >= 600 ? 2 : 1;
  const boxWidth = (width - 24 - 16 * (columns - 1)) / columns;
  const positions = new Map<string, { x: number; y: number }>();
  const regions: { name: string; x: number; y: number; width: number; height: number; count: number }[] = [];
  let y = 12;
  for (let start = 0; start < folders.length; start += columns) {
    let rowHeight = 0;
    for (const [index, [name, members]] of folders.slice(start, start + columns).entries()) {
      const height = 52 + Math.ceil(members.length / 3) * 80;
      const x = 12 + index * (boxWidth + 16);
      regions.push({ name, x, y, width: boxWidth, height, count: members.length });
      members.forEach((note, position) => positions.set(note.id, { x: x + (position % 3 + .5) * boxWidth / 3, y: y + 60 + Math.floor(position / 3) * 80 }));
      rowHeight = Math.max(rowHeight, height);
    }
    y += rowHeight + 16;
  }
  return { positions, regions, height: Math.max(260, y) };
};
