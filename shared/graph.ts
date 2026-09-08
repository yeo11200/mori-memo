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
