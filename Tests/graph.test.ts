import { describe, expect, it } from 'vitest';
import { handleBuildGraph } from '../shared/graph';
import type { Note } from '../shared/types';

const handleNote = (id: string, folder: string, title: string, body = ''): Note => ({ id, folder, title, body, pinned: false, createdAt: '', updatedAt: '', revision: '1' });

describe('folder graph', () => {
  it('includes empty folders without inventing links between their notes', () => {
    const graph = handleBuildGraph([handleNote('a', '업무', '회의'), handleNote('b', '업무', '기획')], ['빈 폴더']);
    expect(graph.folders.map(folder => [folder.name, folder.notes.length])).toEqual([['빈 폴더', 0], ['업무', 2]]);
    expect(graph.edges).toEqual([]);
    expect(graph.folderEdges).toEqual([]);
  });
  it('deduplicates document references and aggregates cross-folder links', () => {
    const notes = [handleNote('a', '업무', '회의', '[[독서/책]] [[독서/책]] `[[유령]]`'), handleNote('b', '독서', '책', '[[업무/회의]]')];
    const graph = handleBuildGraph(notes);
    expect(graph.edges).toHaveLength(2);
    expect(graph.folderEdges).toHaveLength(1);
    expect(graph.folderEdges[0].count).toBe(2);
    expect(graph.unresolved).toHaveLength(0);
  });
  it('keeps alias links after folder rename and reports unresolved/ambiguous links', () => {
    const notes = [{ ...handleNote('a', '새 폴더', '회의'), aliases: ['옛 폴더/회의'] }, handleNote('b', '다른 폴더', '회의'), handleNote('c', '독서', '책', '[[옛 폴더/회의]] [[회의]] [[없는 문서]]')];
    const graph = handleBuildGraph(notes);
    expect(graph.edges).toEqual([{ source: 'c', target: 'a' }]);
    expect(graph.unresolved.map(link => link.target)).toEqual(['회의', '없는 문서']);
  });
});
