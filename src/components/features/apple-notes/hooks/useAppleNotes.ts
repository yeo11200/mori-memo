import { useEffect, useRef, useState } from 'react';
import type { AppleImportState, AppleScan, AppleSelection } from '../../../../../shared/apple-notes';

export const useAppleNotes = (onOperation: <T>(work: () => Promise<T>) => Promise<T>) => {
  const [state, setState] = useState<AppleImportState>({ folderIds: [], noteIds: [], reviews: [], results: [] });
  const [scan, setScan] = useState<AppleScan>();
  const [selection, setSelection] = useState<AppleSelection>({ mode: 'all', folderIds: [], noteIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  useEffect(() => { void window.wiki.handleAppleState().then(setState).catch(cause => setError(String(cause))); }, []);
  const handleWork = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { running.current = false; setBusy(false); }
  };
  const handleScan = () => handleWork(async () => {
    setScan(undefined);
    const data = await window.wiki.handleAppleScan(); setScan(data); setState(data.state);
    if (!data.state.folderIds.length && !data.state.noteIds.length) setSelection({ mode: 'selected', folderIds: [], noteIds: [] });
  });
  const handleSync = () => handleWork(async () => {
    setState(await onOperation(() => window.wiki.handleAppleSync(selection)));
    setScan(undefined);
  });
  const handleResolve = (id: string, choice: 'keep' | 'apple' | 'merge', revision: string, body?: string) => handleWork(async () => {
    setState(await onOperation(() => window.wiki.handleAppleResolve(id, choice, revision, body)));
    setScan(undefined);
  });
  const selected = scan?.catalog.notes.filter(note => selection.mode === 'all' ? state.noteIds.includes(note.id) || state.folderIds.includes(note.folderId) : selection.noteIds.includes(note.id) || selection.folderIds.includes(note.folderId)) || [];
  return { state, scan, selection, setSelection, busy, error, handleScan, handleSync, handleResolve, selected };
};
