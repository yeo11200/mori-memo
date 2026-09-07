import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, Leaf, X } from 'lucide-react';

export const QuickNote = () => {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);
  useEffect(() => window.wiki.handleOnCommand(command => { if (command === 'quick-focus') area.current?.focus(); }), []);
  const handleSave = async () => {
    if (saving.current || !body.trim()) return;
    saving.current = true; setBusy(true); setError('');
    try { await window.wiki.handleSaveQuickNote(body); setBody(''); await window.wiki.handleHideQuickNote(); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { saving.current = false; setBusy(false); }
  };
  return <main className="quick-note" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && !busy) { event.preventDefault(); void window.wiki.handleHideQuickNote(); }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void handleSave(); }
  }}>
    <header className="quick-note__header"><Leaf size={21} /><strong>MORI</strong><span>빠른 메모</span><button aria-label="빠른 메모 닫기" disabled={busy} onClick={() => void window.wiki.handleHideQuickNote()}><X size={18} /></button></header>
    <textarea ref={area} autoFocus aria-label="빠른 메모 내용" disabled={busy} value={body} maxLength={2_000_000} onChange={event => setBody(event.target.value)} placeholder="지금 떠오른 생각을 적어보세요…" />
    {error && <p role="alert">{error}</p>}
    <footer><span>미분류에 저장 · Esc로 잠시 닫기</span><button disabled={busy || !body.trim()} onClick={() => void handleSave()}>{busy ? '저장 중…' : '메모 저장'} <kbd>⌘ ↵</kbd><ArrowDownLeft size={15} /></button></footer>
  </main>;
};
