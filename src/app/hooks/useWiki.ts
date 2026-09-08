import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIAction, AIResult, AppSettings, Note } from '../../../shared/types';

const handleErrorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '');

export const useWiki = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [isMutating, setMutating] = useState(false);
  const mutatingRef = useRef(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vaultPath, setVaultPath] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('저장됨');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [aiResult, setAIResult] = useState<AIResult | null>(null);
  const [aiAction, setAIAction] = useState<AIAction | null>(null);
  const [appliedResult, setAppliedResult] = useState('');
  const draftRef = useRef<Note | null>(null);
  const notesRef = useRef<Note[]>([]);
  const dirtyRef = useRef(false);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const busyRef = useRef(false);
  const applyingRef = useRef(false);

  const handleSetNotes = useCallback((next: Note[]) => { notesRef.current = next; setNotes(next); }, []);
  const handleSetDraft = useCallback((next: Note | null) => { draftRef.current = next; setDraft(next); }, []);
  const handleReportError = useCallback((cause: unknown) => setError(handleErrorText(cause)), []);

  useEffect(() => {
    let active = true;
    if (!window.wiki) { setError('맥 앱으로 실행해 주세요. 터미널에서 npm run dev를 실행하면 앱이 열립니다.'); setLoading(false); return; }
    window.wiki.handleBootstrap().then(data => {
      if (!active) return;
      handleSetNotes(data.notes); setSettings(data.settings); setVaultPath(data.vaultPath);
      handleSetDraft(data.notes[0] || null);
      void window.wiki.handleListFolders().then(setFolders).catch(handleReportError);
      if (data.warnings.length) setError(data.warnings.join('\n'));
    }).catch(handleReportError).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [handleSetNotes, handleSetDraft, handleReportError]);

  const handleFlush = useCallback(async () => {
    const task = saveQueue.current.catch(() => undefined).then(async () => {
      const current = draftRef.current;
      if (!current || !dirtyRef.current) return current;
      const snapshot = { ...current };
      setSaveStatus('저장 중…');
      try {
        const saved = await window.wiki.handleSaveNote(snapshot);
        handleSetNotes(notesRef.current.map(note => note.id === saved.id ? saved : note));
        if (draftRef.current?.id === saved.id) {
          const unchanged = draftRef.current === current;
          handleSetDraft(unchanged ? saved : { ...draftRef.current, revision: saved.revision, updatedAt: saved.updatedAt, aliases: saved.aliases });
          dirtyRef.current = !unchanged;
          setSaveStatus(unchanged ? '저장됨' : '저장 대기');
        }
        return saved;
      } catch (cause) { setSaveStatus('저장 실패'); handleReportError(cause); throw cause; }
    });
    saveQueue.current = task;
    return task;
  }, [handleSetDraft, handleSetNotes, handleReportError]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => { void handleFlush().catch(() => undefined); }, 550);
    return () => clearTimeout(timer);
  }, [draft, handleFlush]);

  const handleEdit = (patch: Partial<Note>) => {
    if (!draftRef.current || mutatingRef.current) return;
    dirtyRef.current = true;
    handleSetDraft({ ...draftRef.current, ...patch });
    setSaveStatus('저장 대기');
  };

  const handleSelect = async (id: string) => {
    if (mutatingRef.current) return;
    try {
      await handleFlush();
      // 저장 도중 입력된 내용도 이동 전에 디스크에 반영합니다.
      while (dirtyRef.current) await handleFlush();
      handleSetDraft(notesRef.current.find(note => note.id === id) || null);
      setSaveStatus('저장됨');
    } catch { /* 저장에 실패하면 현재 편집 화면을 유지합니다. */ }
  };

  const handleCreate = async (template = 'blank', folder?: string) => {
    if (mutatingRef.current) return;
    try {
      await handleFlush();
      while (dirtyRef.current) await handleFlush();
      let note = await window.wiki.handleCreateNote(template);
      if (folder && folder !== note.folder) note = await window.wiki.handleSaveNote({ ...note, folder });
      handleSetNotes([note, ...notesRef.current]); handleSetDraft(note); setSaveStatus('저장됨');
      setFolders(await window.wiki.handleListFolders());
    } catch (cause) { handleReportError(cause); }
  };

  const handleDelete = async () => {
    if (mutatingRef.current) return;
    if (!draftRef.current) return;
    try {
      await handleFlush();
      const id = draftRef.current!.id;
      await window.wiki.handleTrashNote(id);
      const remaining = notesRef.current.filter(note => note.id !== id);
      handleSetNotes(remaining); handleSetDraft(remaining[0] || null); dirtyRef.current = false;
      setNotice('휴지통으로 이동했습니다. 왼쪽 휴지통에서 복원하거나 영구 삭제할 수 있어요.');
    } catch (cause) { handleReportError(cause); }
  };

  const handleAI = async (action: AIAction, instruction?: string) => {
    if (mutatingRef.current) return;
    if (busyRef.current) return;
    if (action === 'generate' && !instruction?.trim()) { setError('AI에게 작성할 내용을 알려 주세요.'); return; }
    if (action !== 'generate' && !draftRef.current?.body.trim()) { setError('요약하거나 풀어 쓸 메모를 먼저 입력해 주세요. 빈 메모에서는 AI 초안 작성을 이용하세요.'); return; }
    busyRef.current = true; setAIAction(action); setAIResult(null); setError('');
    try {
      if (!draftRef.current) await handleCreate();
      if (!draftRef.current) throw new Error('메모를 만들지 못했습니다. 다시 시도해 주세요.');
      await handleFlush();
      while (dirtyRef.current) await handleFlush();
      const result = await window.wiki.handleRunAI(draftRef.current!.id, action, instruction);
      setAIResult(result); setAppliedResult('');
      const current = draftRef.current;
      // 생성 중 사용자가 입력하거나 다른 메모로 이동했다면 결과만 보관합니다.
      if (action === 'generate' && current?.id === result.noteId && current.revision === result.revision && !dirtyRef.current && !current.body.trim()) {
        handleEdit({ body: result.text });
        await handleFlush();
        setAppliedResult(result.id); setNotice('AI 초안을 메모에 작성했습니다.');
      }
    } catch (cause) { handleReportError(cause); }
    finally { busyRef.current = false; setAIAction(null); }
  };

  const handleApplyResult = async () => {
    if (applyingRef.current || !aiResult || appliedResult === aiResult.id) return false;
    const current = draftRef.current;
    if (!current || current.id !== aiResult.noteId || current.revision !== aiResult.revision || dirtyRef.current) { setError('메모가 바뀌었습니다. 결과를 복사하거나 현재 내용으로 다시 실행해 주세요.'); return false; }
    applyingRef.current = true;
    try {
      handleEdit({ body: `${current.body.trimEnd()}\n\n## ${aiResult.action === 'connections' ? '관련 문서' : 'AI 정리'}\n\n${aiResult.text}\n` });
      await handleFlush(); setAppliedResult(aiResult.id); setNotice('원문 아래에 결과를 추가했습니다.');
      return true;
    } catch (cause) { handleReportError(cause); return false; }
    finally { applyingRef.current = false; }
  };

  const handleCapture = async () => {
    if (mutatingRef.current) return;
    try {
      if (!draftRef.current) await handleCreate();
      const capturedId = draftRef.current?.id;
      if (!capturedId) return;
      const path = await window.wiki.handleCapture();
      if (!path) return;
      if (draftRef.current?.id !== capturedId) { setNotice(`캡처는 보관함에 저장되었습니다: ${path}`); return; }
      handleEdit({ body: `${draftRef.current.body}\n\n![화면 캡처](${path})\n` });
      await handleFlush(); setNotice('캡처를 메모에 첨부했습니다.');
    } catch (cause) { handleReportError(cause); }
  };

  const handleImport = async () => {
    if (mutatingRef.current) return;
    try {
      await handleFlush();
      const imported = await window.wiki.handleImport();
      handleSetNotes([...imported, ...notesRef.current]);
      if (imported[0]) handleSetDraft(imported[0]);
      setFolders(await window.wiki.handleListFolders());
    } catch (cause) { handleReportError(cause); }
  };

  const handleReloadNotes = async (next: Note[]) => {
    handleSetNotes(next);
    setFolders(await window.wiki.handleListFolders());
  };

  const handleAddLink = async (sourceId: string, targetId: string, reason: string) => {
    if (mutatingRef.current || busyRef.current) throw new Error('진행 중인 작업을 마친 뒤 연결해 주세요.');
    mutatingRef.current = true; setMutating(true);
    try {
      await handleFlush();
      while (dirtyRef.current) await handleFlush();
      const source = notesRef.current.find(note => note.id === sourceId);
      if (!source) throw new Error('연결할 원문을 찾을 수 없습니다.');
      const saved = await window.wiki.handleAddLink(source.id, targetId, source.revision, reason);
      handleSetNotes(notesRef.current.map(note => note.id === saved.id ? saved : note));
      if (draftRef.current?.id === saved.id) { handleSetDraft(saved); setSaveStatus('저장됨'); }
      setNotice('메모에 연결을 추가했습니다.');
    } finally { mutatingRef.current = false; setMutating(false); }
  };

  const handleFolderChange = async (action: 'create' | 'rename' | 'delete', from: string, to?: string) => {
    if (mutatingRef.current || busyRef.current) { setError('진행 중인 작업을 마친 뒤 폴더를 변경해 주세요.'); return false; }
    mutatingRef.current = true; setMutating(true);
    try {
      await handleFlush();
      while (dirtyRef.current) await handleFlush();
      const id = draftRef.current?.id;
      if (action === 'create') await window.wiki.handleCreateFolder(from);
      if (action === 'rename') await window.wiki.handleRenameFolder(from, to!);
      if (action === 'delete') await window.wiki.handleDeleteFolder(from);
      const data = await window.wiki.handleBootstrap();
      handleSetNotes(data.notes);
      if (id) handleSetDraft(data.notes.find(note => note.id === id) || null);
      setFolders(await window.wiki.handleListFolders());
      setNotice(action === 'delete' ? '폴더를 삭제하고 메모를 미분류로 옮겼습니다.' : '폴더를 저장했습니다.');
      return true;
    } catch (cause) { handleReportError(cause); return false; }
    finally { mutatingRef.current = false; setMutating(false); }
  };

  const handleRestore = async (id: string) => {
    try { const note = await window.wiki.handleRestoreNote(id); handleSetNotes([note, ...notesRef.current]); setNotice('메모를 복원했습니다.'); }
    catch (cause) { handleReportError(cause); }
  };

  const handleExample = async () => {
    if (mutatingRef.current) return;
    try {
      await handleFlush();
      const examples = [
        ['생각이 지식이 되는 곳', '# 작은 기록에서 시작해요\n\n메모를 쓰고, 서로 연결하면서 **나만의 위키**를 만들어 보세요. 이 문서는 사용법을 보여주는 예제입니다.\n\n## 연결하며 생각하기\n\n문서 이름을 두 겹의 대괄호로 감싸면 연결할 수 있어요. [[프로젝트 회의]]와 [[아이디어 수집함]]을 눌러 보세요.\n\n## AI는 필요할 때만\n\n위의 **요약하기** 버튼을 누르면 설정한 Claude 또는 Codex가 메모를 정리해 줍니다. 원문은 그대로 남아요.\n\n- 생각을 자유롭게 적기\n- 중요한 메모는 상단에 고정하기\n- 캡처를 넣고 맥락 남기기\n- 관련 문서와 연결하기\n\n> 완벽하게 정리할 필요 없어요. 오늘의 작은 생각부터 남겨 보세요.\n'],
        ['프로젝트 회의', '# 회의 메모 예제\n\n로그인 화면은 목 데이터로 먼저 개발한다. API는 다음 주에 제공될 예정이다. 금요일에 일정을 다시 확인한다.\n\n## 관련 메모\n\n[[아이디어 수집함]]에서 처음 기록한 아이디어를 논의했다.\n[[생각이 지식이 되는 곳]]으로 돌아가기.\n'],
        ['아이디어 수집함', '# 떠오르는 생각\n\n프로젝트에서 로그인 오류 메시지를 더 쉽게 설명하면 좋겠다.\n\n- 로그인 상태를 한눈에 보기\n- 오류를 해결할 수 있는 다음 행동 안내\n\n[[프로젝트 회의]]에서 검토해 볼 내용.\n']
      ];
      const added: Note[] = [];
      for (const [title, body] of examples) {
        const empty = await window.wiki.handleCreateNote('blank');
        added.push(await window.wiki.handleSaveNote({ ...empty, title, body, folder: '시작하기', pinned: added.length === 0 }));
      }
      handleSetNotes([...added, ...notesRef.current]); handleSetDraft(added[0]);
      setFolders(await window.wiki.handleListFolders());
    } catch (cause) { handleReportError(cause); }
  };

  const handleClose = async () => {
    if (mutatingRef.current) { setNotice('폴더 변경이 끝난 뒤 닫아 주세요.'); return; }
    try {
      await handleFlush();
      while (dirtyRef.current) await handleFlush();
      await window.wiki.handleCloseReady();
    } catch (cause) { handleReportError(cause); }
  };

  return { notes, folders, isMutating, handleFolderChange, handleAddLink, draft, settings, vaultPath, isLoading, saveStatus, error, notice, aiResult, aiAction, appliedResult, handleClose,
    handleEdit, handleFlush, handleSelect, handleCreate, handleDelete, handleAI, handleApplyResult, handleCapture, handleImport, handleRestore, handleExample,
    handleReportError, handleReloadNotes, handleClearError: () => setError(''), handleClearNotice: () => setNotice(''), handleSetSettings: setSettings,
    handleCancelAI: () => window.wiki.handleCancelAI(),
    handleExport: async () => { try { await handleFlush(); const path = await window.wiki.handleExport(); if (path) setNotice(`백업을 저장했습니다: ${path}`); } catch (cause) { handleReportError(cause); } }
  };
};
