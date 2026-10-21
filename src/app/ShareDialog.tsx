import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ShareInfo, SharePreview, ShareSource } from '../../shared/sharing';
import type { BillingState } from '../../shared/billing';
import { AccountSettings } from './AccountSettings';

const message = (cause: unknown) => String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '');
export const ShareDialog = ({ source, onClose }: { source: ShareSource; onClose: () => void }) => {
  const root = useRef<HTMLDivElement>(null); const lock = useRef(false); const mounted = useRef(true);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [info, setInfo] = useState<ShareInfo | null>(null); const [account, setAccount] = useState<BillingState | null>(null);
  const [consent, setConsent] = useState(false); const [showAccount, setShowAccount] = useState(false);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const refresh = async () => {
    const nextAccount = await window.wiki.handleBillingState(); setAccount(nextAccount);
    setStatusRefresh(value => value + 1);
  };
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null; root.current?.focus();
    void (async () => {
      try {
        const [next, nextAccount] = await Promise.all([window.wiki.handlePrepareShare(source), window.wiki.handleBillingState()]);
        if (!mounted.current) return;
        setPreview(next); setAccount(nextAccount);

      } catch (cause) { if (mounted.current) setError(message(cause)); }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setInfo(null); setConsent(false);
    if (preview && account?.signedIn) void window.wiki.handleShareStatus(preview.id).then(value => { if (active) setInfo(value); }).catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [preview?.id, account?.signedIn, account?.email, statusRefresh]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(message(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const mutate = (operation: 'create' | 'update' | 'revoke') => void run(async () => {
    if (!preview) return;
    const next = await window.wiki.handleShareMutate(preview.id, operation, info?.revision || 0, operation === 'revoke' || consent);
    setInfo(next); setConsent(false);
    setNotice(operation === 'revoke' ? '공유를 중단했습니다. 이미 받은 파일이나 복사본은 회수되지 않습니다.' : next?.digest === preview.digest ? '확인한 내용으로 공유본을 저장했습니다.' : '기존 공유 링크를 확인했습니다. 현재 미리보기로 바꾸려면 공유본 업데이트를 눌러 주세요.');
  });
  useEffect(() => { if (!busy && !loading && root.current && !root.current.contains(document.activeElement)) root.current.focus(); }, [busy, loading, info?.revision]);
  const active = !!info && !info.revoked;
  return <div className="wiki__modal-backdrop share-dialog__backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy && !loading) onClose(); }}>
    <div ref={root} tabIndex={-1} className="wiki__modal share-dialog" role="dialog" aria-modal="true" aria-label="문서 공유" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !busy && !loading) onClose();
      if (event.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary') || [])].filter(element => element.getClientRects().length > 0);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="wiki__modal__header"><h2>문서 공유</h2><button aria-label="공유 창 닫기" className="wiki__icon-button" disabled={busy || loading} onClick={onClose}><X size={17} /></button></div>
      <p>받는 사람은 MORI 설치 없이 읽을 수 있습니다. 아래에 보이는 문서 한 장만 공유합니다.</p>
      <p className="share-dialog__hint">연결된 메모·이미지·첨부파일은 포함하지 않고 링크는 글자로 표시합니다. 코드 블록과 보고서에 이미 인용된 원문 등 본문에 직접 들어 있는 정보는 포함됩니다.</p>
      {loading && <p role="status">공유 미리보기 준비 중…</p>}
      {preview && <><iframe title="공개될 문서 미리보기" sandbox="" srcDoc={preview.html} tabIndex={-1} /><div className="share-dialog__actions">
        <button className="wiki__button" disabled={busy || loading} onClick={() => void run(async () => { const path = await window.wiki.handleShareExport(preview.id, 'pdf'); if (path) setNotice('PDF 파일을 저장했습니다.'); })}>PDF로 내보내기</button>
        <button className="wiki__button" disabled={busy || loading} onClick={() => void run(async () => { const path = await window.wiki.handleShareExport(preview.id, 'html'); if (path) setNotice('HTML 파일을 저장했습니다.'); })}>HTML로 내보내기</button>
      </div>
      <section className="share-dialog__web"><h3>웹 링크 공유 · Pro</h3>
        <p>링크를 가진 누구나 로그인 없이 읽을 수 있습니다. 문서 수정은 자동 반영되지 않으며, 이 미리보기로 업데이트해야 합니다. 계정당 최대 20개를 공유할 수 있습니다.</p>
        {account?.mode === 'beta' ? <p>현재 무료 베타에서는 파일 내보내기를 사용할 수 있습니다. 웹 공유는 계정 서버가 연결된 상용 버전에서 제공합니다.</p> : <>
          <button className="wiki__button" disabled={busy} onClick={() => setShowAccount(value => !value)}>계정 및 Pro</button>
          {showAccount && <fieldset disabled={busy} className="share-dialog__account"><AccountSettings onChange={setAccount} /></fieldset>}
          <button className="wiki__button" disabled={busy || !account?.signedIn} onClick={() => void run(refresh)}>공유 상태 확인</button>
          {active && <><label>공유 링크<input aria-label="공유 링크" readOnly value={info.url} /></label><p>공유본: {info.title} · {new Date(info.updatedAt).toLocaleString('ko-KR')}</p>{info.digest !== preview.digest && <p>현재 미리보기와 공유 중인 내용이 다릅니다.</p>}</>}
          {info?.revoked && <p>공유가 중단된 문서입니다. 다시 공유하면 새 링크를 만듭니다.</p>}
          <label className="share-dialog__consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />위 미리보기의 제목·본문 복사본을 서버에 업로드해 링크를 가진 사람에게 공개합니다.</label>
          <div className="share-dialog__actions"><button className="wiki__button wiki__button--primary" disabled={busy || !consent || !account?.signedIn} onClick={() => mutate(active ? 'update' : 'create')}>{active ? '공유본 업데이트' : '공유 링크 만들기'}</button>
          {active && <><button className="wiki__button" disabled={busy} onClick={() => void run(async () => { await window.wiki.handleCopyShare(preview.id); setNotice('공유 링크를 복사했습니다.'); })}>링크 복사</button><button className="wiki__button" disabled={busy} onClick={() => mutate('revoke')}>공유 중단</button></>}</div>
        </>}
      </section></>}
      {busy && <p role="status">처리 중…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>
  </div>;
};
