import { useEffect, useRef, useState } from 'react';
import type { CalendarState } from '../../shared/calendar';

export const CalendarSettings = ({ onSync }: { onSync: () => Promise<void> }) => {
  const [state, setState] = useState<CalendarState>();
  const [ids, setIds] = useState<string[]>([]);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const working = useRef(false);
  const login = useRef(false);
  const handleState = (next: CalendarState) => { setState(next); setIds(next.selectedIds); setAuto(next.autoSync); };
  useEffect(() => {
    let active = true;
    window.wiki.handleCalendarState().then(next => { if (active) handleState(next); }).catch(() => { if (active) setMessage('캘린더 설정을 읽지 못했습니다.'); });
    return () => { active = false; if (login.current) void window.wiki.handleCalendarCancel(); };
  }, []);
  const handleRun = async (work: () => Promise<CalendarState>, success: string | ((next: CalendarState) => string), isLogin = false) => {
    if (working.current) return;
    working.current = true; login.current = isLogin; setBusy(true); setConnecting(isLogin); setMessage(isLogin ? '브라우저에서 Google 로그인과 권한 허용을 완료해 주세요.' : '');
    try { const next = await work(); handleState(next); setMessage(typeof success === 'function' ? success(next) : success); }
    catch (cause) { setMessage(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { working.current = false; login.current = false; setBusy(false); setConnecting(false); }
  };
  return <section className="calendar-settings" aria-label="Google Calendar 연결">
    <h3>Google Calendar → 오늘 데일리</h3>
    <p>선택한 캘린더의 오늘 일정을 읽어옵니다. Google 원본 일정은 수정하지 않습니다.</p>
    <details><summary>처음 연결하는 방법</summary><ol><li>Google Cloud에서 Calendar API를 활성화합니다.</li><li>Google Auth Platform에서 동의 화면과 테스트 사용자를 설정합니다.</li><li>클라이언트 유형을 ‘데스크톱 앱’으로 만들고 JSON을 내려받습니다.</li><li>아래에서 파일을 선택한 뒤 Google 계정으로 연결하세요.</li></ol><p>로그인 정보는 이 Mac에 암호화해 저장합니다. JSON 파일과 토큰을 메모나 GitHub에 올리지 마세요.</p></details>
    <div className="calendar-settings__actions">
      <button className="wiki__button" disabled={busy} onClick={() => {
        if (state?.connected && !window.confirm('다른 클라이언트를 선택하면 현재 기기의 캘린더 연결을 교체합니다. 기존 데일리는 남습니다. 계속할까요?')) return;
        void handleRun(() => window.wiki.handleCalendarImportClient(), next => next.configured ? 'OAuth 설정이 등록되어 있습니다. Google 계정 연결을 눌러 주세요.' : 'OAuth 파일이 등록되지 않았습니다. 데스크톱 앱 JSON 파일을 선택해 주세요.');
      }}>{state?.configured ? 'OAuth JSON 다시 선택' : 'OAuth JSON 선택'}</button>
      <button className="wiki__button" disabled={busy || !state?.configured} onClick={() => void handleRun(() => window.wiki.handleCalendarConnect(), '연결했습니다. 가져올 캘린더를 선택해 주세요.', true)}>{state?.connected ? '다시 로그인 / 계정 변경' : 'Google 계정 연결'}</button>
      {connecting && <button className="wiki__button" onClick={() => void window.wiki.handleCalendarCancel()}>로그인 취소</button>}
    </div>
    {!state?.configured && <p>계정 연결을 활성화하려면 먼저 OAuth JSON을 등록해야 합니다. 현재 버전은 Google 로그인 버튼만으로 연결되는 방식이 아닙니다.</p>}
    {state?.connected && <>
      <fieldset disabled={busy}><legend>가져올 캘린더</legend>
        <div className="calendar-settings__calendars">{state.calendars.map(calendar => <label key={calendar.id}><input type="checkbox" checked={ids.includes(calendar.id)} onChange={event => setIds(values => event.target.checked ? [...values, calendar.id] : values.filter(id => id !== calendar.id))} /><span>{calendar.name}{calendar.primary ? ' · 기본' : ''}</span></label>)}</div>
        <label className="calendar-settings__auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} /><span>오늘 데일리를 열 때 일정 갱신</span></label>
      </fieldset>
      <p>Mac의 오늘 날짜 기준입니다. 자동 갱신은 ‘오늘 데일리 열기’와 데일리 생성 메뉴에서 실행하며, 앱을 닫은 동안에는 실행하지 않습니다.</p>
      <div className="calendar-settings__actions">
        <button className="wiki__button" disabled={busy} onClick={() => void handleRun(() => window.wiki.handleCalendarRefresh(), '목록을 새로고침했습니다.')}>캘린더 목록 새로고침</button>
        <button className="wiki__button" disabled={busy} onClick={() => void handleRun(() => window.wiki.handleCalendarSelect(ids, auto), '캘린더 선택을 저장했습니다.')}>선택 저장</button>
        <button className="wiki__button wiki__button--primary" disabled={busy || !ids.length} onClick={() => void handleRun(async () => {
          await window.wiki.handleCalendarSelect(ids, auto);
          await onSync();
          return window.wiki.handleCalendarState();
        }, '오늘 데일리에 일정을 반영했습니다.')}>선택 저장·오늘 일정 가져오기</button>
        <button className="wiki__button" disabled={busy} onClick={() => void handleRun(() => window.wiki.handleCalendarDisconnect(), '이 기기의 연결을 해제했습니다. 데일리 기록은 남아 있습니다.')}>이 기기에서 연결 해제</button>
      </div>
      <p>연결 해제는 이 Mac의 토큰을 삭제합니다. Google 계정의 접근 권한도 없애려면 Google 계정의 연결된 앱 관리에서 해제하세요.</p>
    </>}
    {state?.lastSync && <p>마지막 반영: {new Date(state.lastSync).toLocaleString('ko-KR')}</p>}
    <p>가져온 일정 구역 밖에 개인 기록을 적어 주세요. 구역 안의 내용을 직접 바꾸면 자동 덮어쓰기를 중단합니다.</p>
    {message && <p role="status">{message}</p>}
  </section>;
};
