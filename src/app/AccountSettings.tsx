import { useEffect, useRef, useState } from 'react';
import type { BillingState } from '../../shared/billing';

const date = (value?: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' KST' : '';
const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '');
export const AccountSettings = ({ onChange }: { onChange?: (state: BillingState) => void }) => {
  const [state, setState] = useState<BillingState | null>(null);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [waiting, setWaiting] = useState(false); const lock = useRef(false); const mounted = useRef(true);
  const update = (next: BillingState) => { if (!mounted.current) return; setState(next); onChange?.(next); };
  useEffect(() => { mounted.current = true; void window.wiki.handleBillingState().then(update).catch(error => setError(message(error))); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!waiting) return;
    let active = true; let count = 0;
    const timer = setInterval(() => {
      if (++count > 30) { setWaiting(false); return; }
      void window.wiki.handleBillingState(true).then(next => { if (active) { update(next); if (next.account?.status === 'active') setWaiting(false); } }).catch(() => undefined);
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [waiting]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { if (mounted.current) { setError(message(cause)); await window.wiki.handleBillingState().then(update).catch(() => undefined); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const action = (value: 'trial' | 'restore' | 'cancel' | 'resume') => void run(async () => { update(await window.wiki.handleBillingAction(value)); if (value === 'cancel') setNotice('다음 갱신을 중단했습니다. 진행 중인 결제는 상태 확인이 필요할 수 있습니다.'); });
  const account = state?.account;
  return <section className="account-settings" aria-label="계정 및 Pro"><h3>계정 및 Pro</h3>
    {!state ? <p>계정 상태 확인 중…</p> : state.mode === 'beta' ? <p>현재 버전은 가입 없이 사용하는 무료 베타입니다. 보고서와 템플릿을 무료로 사용할 수 있습니다. 월 2,900원 Pro는 상용 버전에서 제공할 예정입니다.</p> : <>
      <p><strong>MORI Pro · 월 2,900원</strong><br />여러 기록의 AI 보고서와 맞춤 템플릿. AI 제공자 이용료는 별도입니다.</p>
      {!state.signedIn ? <>
        <label>이메일<input aria-label="MORI 계정 이메일" type="email" maxLength={254} value={email} disabled={busy} onChange={event => { setEmail(event.target.value); setSent(false); setCode(''); }} /></label>
        <button className="wiki__button" disabled={busy || !email.trim()} onClick={() => void run(async () => { await window.wiki.handleBillingSendCode(email); setSent(true); setNotice('이메일의 인증 코드를 입력해 주세요.'); })}>이메일 인증 코드 받기</button>
        {sent && <><label>인증 코드<input aria-label="MORI 이메일 인증 코드" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label><button className="wiki__button" disabled={busy || !code} onClick={() => void run(async () => { update(await window.wiki.handleBillingVerify(email, code)); setCode(''); setSent(false); })}>이메일로 로그인</button></>}
      </> : <>
        <p>{state.email}<br />{account?.status === 'active' ? account.cancelAtEnd ? '해지 예약 · 이용 종료: ' + date(account.paidUntil) : 'Pro 이용 중 · 다음 결제: ' + date(account.nextChargeAt) : account?.status === 'trial' ? 'Pro 무료 체험 · 종료: ' + date(account.trialEnd) : account?.status === 'past_due' ? '갱신 결제를 확인해 주세요. 실패 시 24시간·72시간 뒤 최대 두 번 재시도합니다.' : account?.status === 'unknown' ? '결제 결과 확인 중입니다. 재결제 대신 구매 복원을 눌러 주세요.' : '무료로 사용 중'}</p>
        {account?.card && <p>{account.card}</p>}
        <label className="account-settings__consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />체험은 14일 후 자동 종료하며 결제하지 않습니다. 구독은 월 2,900원 자동 갱신이고 언제든 다음 결제를 중단할 수 있습니다. 갱신 실패 시 24시간·72시간 뒤 최대 두 번 재시도합니다.</label>
        <div className="account-settings__actions">
          {!account?.trialEnd && !account?.paidUntil && <button className="wiki__button" disabled={busy || !consent} onClick={() => action('trial')}>14일 무료 체험 시작</button>}
          {account?.status !== 'active' && <button className="wiki__button wiki__button--primary" disabled={busy || !consent || waiting || account?.status === 'unknown'} onClick={() => void run(async () => { await window.wiki.handleBillingCheckout('purchase'); setWaiting(true); setNotice('브라우저에서 결제를 진행한 뒤 구매를 확인해 주세요.'); })}>월 2,900원 Pro 구독</button>}
          <button className="wiki__button" disabled={busy} onClick={() => action('restore')}>구매 복원·상태 확인</button>
          {account?.paidUntil && <><button className="wiki__button" disabled={busy || !consent} onClick={() => void run(async () => { await window.wiki.handleBillingCheckout('update_method'); setWaiting(true); })}>결제수단 변경</button>{account.cancelAtEnd ? <button className="wiki__button" disabled={busy || account.status !== 'active'} onClick={() => action('resume')}>해지 예약 취소</button> : <button className="wiki__button" disabled={busy} onClick={() => action('cancel')}>다음 결제 해지</button>}</>}
          <button className="wiki__button" disabled={busy} onClick={() => void run(async () => { update(await window.wiki.handleBillingLogout()); setWaiting(false); setConsent(false); })}>로그아웃</button>
        </div>
        <p>등록된 Mac {account?.devices.length || 0}/2 · 계정 로그인으로 메모가 동기화되지는 않습니다.</p>
        {account?.devices.map(device => <div key={device.id} className="account-settings__actions"><span>{device.name}{device.id === state.deviceId ? ' (이 Mac)' : ''} · {date(device.lastSeenAt)}</span><button className="wiki__button" disabled={busy} onClick={() => void run(async () => update(await window.wiki.handleBillingRevoke(device.id)))}>기기 해제</button></div>)}
        {!!state.payments?.length && <details><summary>결제 내역과 환불 요청</summary>{state.payments.map(payment => <div className="account-settings__actions" key={payment.id}><span>{date(payment.createdAt)} · {payment.amount.toLocaleString()}원 · {({ done: '결제 완료', failed: '결제 실패', refunded: '환불 완료', pending: '확인 중', unknown: '확인 중' })[payment.state]}</span>{payment.state === 'done' && <button className="wiki__button" disabled={busy || payment.refundRequested} onClick={() => void run(async () => { update(await window.wiki.handleBillingRefund(payment.id)); setNotice('환불 요청을 접수했습니다. 판매 조건 확인 후 처리됩니다.'); })}>{payment.refundRequested ? '환불 요청 접수됨' : '환불 요청'}</button>}</div>)}</details>}
      </>}
      {waiting && <p role="status">결제 상태를 확인하고 있습니다. 잠시 후에도 바뀌지 않으면 구매 복원을 눌러 주세요.</p>}
      {state.offline && <p>오프라인 권한으로 사용 중입니다. 마지막 확인 후 최대 7일, 이용 종료 시각까지 가능합니다.</p>}
      {state.warning && <p role="status">{state.warning}</p>}
    </>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
};
