import { useEffect, useRef, useState } from 'react';
import { WORK_PROVIDERS, WORK_LABELS, type WorkProvider, type WorkState, type WorkSelection } from '../../shared/work';

const PROVIDER_HELP = {
  jira: 'Jira Cloud 계정의 이메일과 일반 API 토큰을 사용합니다. 범위 지정 토큰과 사내 설치형 Jira는 아직 지원하지 않습니다.',
  github: 'GitHub.com의 Personal access token을 사용합니다. Fine-grained 토큰은 대상 저장소 접근을 허용하세요. Classic 토큰으로 비공개 저장소를 읽으려면 repo 권한이 필요합니다. 조직 승인·SSO 정책이 적용될 수 있으며 Pull Request는 제외합니다.',
  gitlab: 'GitLab.com의 read_api 권한 Personal access token을 사용합니다. 사내 설치형 GitLab은 아직 지원하지 않습니다.',
};

const WorkConnection = ({ provider, onSync }: { provider: WorkProvider; onSync: (provider: WorkProvider) => Promise<void> }) => {
  const [state, setState] = useState<WorkState>();
  const [selection, setSelection] = useState<WorkSelection>({ allProjects: true, projectIds: [], state: 'open', autoSync: false });
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [site, setSite] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const handleState = (next: WorkState) => { setState(next); setSelection({ allProjects: next.allProjects, projectIds: next.projectIds, state: next.state, autoSync: next.autoSync }); };
  useEffect(() => {
    let active = true;
    window.wiki.handleWorkState(provider).then(next => { if (active) handleState(next); }).catch(() => { if (active) setMessage('연결 설정을 읽지 못했습니다.'); });
    return () => { active = false; };
  }, [provider]);
  const handleRun = async (work: () => Promise<WorkState>, success: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setMessage('');
    try { handleState(await work()); setMessage(success); }
    catch (cause) { setMessage(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { working.current = false; setBusy(false); }
  };
  return <details className="work-settings__connection">
    <summary><strong>{WORK_LABELS[provider]}</strong><span>{state?.connected ? '연결됨' : '연결하기'}</span></summary>
    <div className="work-settings__content" role="region" aria-label={WORK_LABELS[provider] + ' 업무 연결'}>
      {state?.connected ? <>
        <p className="work-settings__account">{state.account}{state.site ? ' · ' + state.site : ''}</p>
        <fieldset disabled={busy}>
          <legend>가져올 담당 업무</legend>
          <label>원본 상태<select value={selection.state} onChange={event => setSelection(value => ({ ...value, state: event.target.value as 'open' | 'all' }))}><option value="open">미완료 업무</option><option value="all">완료 포함 전체</option></select></label>
          <label className="work-settings__check"><input type="checkbox" checked={selection.allProjects} onChange={event => setSelection(value => ({ ...value, allProjects: event.target.checked }))} /><span>모든 프로젝트에서 가져오기</span></label>
          {!selection.allProjects && <div className="work-settings__projects">
            {state.projects.map(project => <label className="work-settings__check" key={project.id}><input type="checkbox" checked={selection.projectIds.includes(project.id)} onChange={event => setSelection(value => ({ ...value, projectIds: event.target.checked ? [...value.projectIds, project.id] : value.projectIds.filter(id => id !== project.id) }))} /><span>{project.name}</span></label>)}
            {!state.projects.length && <p>담당 업무가 있는 프로젝트가 없습니다.</p>}
            {!selection.projectIds.length && <p>선택한 프로젝트가 없어 새 업무를 가져오지 않습니다.</p>}
          </div>}
          <label className="work-settings__check"><input type="checkbox" checked={selection.autoSync} onChange={event => setSelection(value => ({ ...value, autoSync: event.target.checked }))} /><span>오늘 데일리 열 때 자동 갱신</span></label>
        </fieldset>
        <p>프로젝트 목록은 조회된 담당 업무를 기준으로 표시합니다. 상태를 바꿨다면 ‘필터 저장·목록 새로고침’을 눌러 주세요.</p>
        <div className="work-settings__actions">
          <button className="wiki__button" disabled={busy} onClick={() => void handleRun(async () => { await window.wiki.handleWorkSelect(provider, selection); return window.wiki.handleWorkRefresh(provider); }, '필터를 저장하고 프로젝트 목록을 갱신했습니다.')}>필터 저장·목록 새로고침</button>
          <button className="wiki__button wiki__button--primary" disabled={busy} onClick={() => void handleRun(async () => {
            await window.wiki.handleWorkSelect(provider, selection);
            await onSync(provider);
            return window.wiki.handleWorkState(provider);
          }, '오늘 데일리에 담당 업무를 반영했습니다.')}>{busy ? '처리 중…' : '필터 저장·오늘 업무 가져오기'}</button>
          <button className="wiki__button" disabled={busy} onClick={() => void handleRun(() => window.wiki.handleWorkDisconnect(provider), '이 Mac의 연결을 해제했습니다. 데일리 기록은 남아 있습니다.')}>연결 해제</button>
        </div>
        {state.lastSync && <p>마지막 반영: {new Date(state.lastSync).toLocaleString('ko-KR')}</p>}
      </> : <form onSubmit={event => {
        event.preventDefault();
        void handleRun(async () => {
          const next = await window.wiki.handleWorkConnect({ provider, token, email, site });
          setToken(''); return next;
        }, '연결했습니다. 필터를 확인하고 오늘 업무를 가져오세요.');
      }}>
        <p>{PROVIDER_HELP[provider]}</p>
        <fieldset disabled={busy || !state}>
          <legend className="work-settings__legend">계정 인증</legend>
          {provider === 'jira' && <>
            <label>Jira 사이트<input type="url" placeholder="https://team.atlassian.net" required value={site} onChange={event => setSite(event.target.value)} /></label>
            <label>Jira 계정 이메일<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          </>}
          <label>{provider === 'jira' ? 'API 토큰' : 'Personal access token'}<input type="password" autoComplete="off" spellCheck={false} required value={token} onChange={event => setToken(event.target.value)} /></label>
          <button type="submit" className="wiki__button" disabled={!token.trim()}>{busy ? '인증 확인 중…' : WORK_LABELS[provider] + ' 연결'}</button>
        </fieldset>
      </form>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
};

/** 서비스별 연결과 읽기 필터를 모아 보여줍니다. */
export const WorkSettings = ({ onSync }: { onSync: (provider: WorkProvider) => Promise<void> }) => <section className="work-settings" aria-label="담당 업무 연동">
  <h3>담당 업무 → 오늘 데일리</h3>
  <p>내게 배정된 이슈를 모아 봅니다. 체크는 MORI 안에서만 반영되며 원본 상태를 변경하지 않습니다.</p>
  {WORK_PROVIDERS.map(provider => <WorkConnection key={provider} provider={provider} onSync={onSync} />)}
  <p>가져온 구역에서는 체크만 바꿔 주세요. 개인 기록은 구역 밖에 적으면 안전하게 유지됩니다. 이전 날짜의 기록은 갱신하지 않습니다.</p>
  <p>자동 갱신은 ‘오늘 데일리 열기’에서 실행합니다. 토큰은 이 Mac에 암호화하여 저장하며, 연결 해제 시 삭제합니다.</p>
</section>;
