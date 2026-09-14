import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { AppSettings, ShortcutBinding } from '../../shared/types';
import { CalendarSettings } from './CalendarSettings';

export const commandLabels: Record<string, string> = {
  capture: '화면 캡처', 'quick-note': '빠른 메모', new: '새 메모', search: '검색창',
  ai: 'AI 초안 작성', save: '저장', settings: '설정', palette: '명령 팔레트',
};

export const handleFormatShortcut = (value: string) => value.replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘').replace(/Control|Ctrl/g, '⌃').replace(/Alt|Option/g, '⌥').replace(/Shift/g, '⇧').replace(/Space/g, 'Space').replace(/\+/g, ' ');

const ShortcutRecorder = ({ value, onChange, label }: { value: string; onChange: (next: string) => void; label: string }) => {
  const [recording, setRecording] = useState(false);
  const original = useRef(value);
  useEffect(() => () => { void window.wiki.handleSetShortcutRecording(false); }, []);
  return <input aria-label={label} readOnly value={recording ? '키 조합을 누르세요…' : handleFormatShortcut(value)} placeholder="클릭해 지정"
    onFocus={() => { original.current = value; setRecording(true); void window.wiki.handleSetShortcutRecording(true); }}
    onBlur={() => { setRecording(false); void window.wiki.handleSetShortcutRecording(false); }}
    onKeyDown={event => {
      if (event.key === 'Tab' && !(event.metaKey || event.ctrlKey || event.altKey)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { onChange(original.current); event.currentTarget.blur(); return; }
      if (['Backspace', 'Delete'].includes(event.key)) { onChange(''); event.currentTarget.blur(); return; }
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key) || !(event.metaKey || event.ctrlKey || event.altKey)) return;
      const key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : event.key === ' ' ? 'Space' : event.key.replace(/^Arrow/, '');
      onChange([event.metaKey && 'Command', event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+'));
      event.currentTarget.blur();
    }} />;
};

export const SettingsPanel = ({ settings, onSave, onClose, onCalendarSync }: {
  settings: AppSettings; onSave: (next: AppSettings) => Promise<void>; onClose: () => void; onCalendarSync: () => Promise<void>;
}) => {
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [modelReload, setModelReload] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState('');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(Boolean(settings.apiKeyConfigured));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [skillResult, setSkillResult] = useState<{ message: string; error?: boolean; backup?: string }>();
  const skillFeedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (skillResult) skillFeedback.current?.scrollIntoView({ block: 'nearest' });
  }, [skillResult]);
  const handleInstallSkill = async () => {
    setBusy(true); setInstalling(true); setSkillResult(undefined);
    try {
      const result = await window.wiki.handleInstallMoriSkill();
      setSkillResult({ message: result.backup ? 'Codex·Claude 스킬을 설치했습니다. 기존 설치본은 백업했습니다.' : 'Codex·Claude 스킬을 처음 설치했습니다. 기존 설치본은 없어 백업하지 않았습니다.', backup: result.backup });
    } catch (cause) {
      const message = String(cause instanceof Error ? cause.message : cause).replace(/^(?:Error: )?Error invoking remote method '[^']+': Error: /, '');
      setSkillResult({ message, error: true });
    } finally { setBusy(false); setInstalling(false); }
  };
  useEffect(() => {
    let active = true;
    setModelsLoading(true); setModels([]); setModelStatus('');
    window.wiki.handleListModels(draft.provider).then(next => {
      if (active) { setModels(next); setModelStatus(`${next.length}개 모델 선택지를 불러왔습니다.`); }
    }).catch(cause => { if (active) setModelStatus(`목록을 불러오지 못했습니다: ${String(cause)}`); }).finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [draft.provider, modelReload]);
  const handleChangeProvider = (provider: AppSettings['provider']) => {
    setDraft(current => ({ ...current, provider, model: provider === 'codex' ? 'gpt-5.6-luna' : provider === 'openai' ? 'gpt-5-nano' : 'haiku' }));
    setStatus('');
  };
  const handleSave = async () => {
    setBusy(true); setStatus('');
    try {
      if (key.trim()) { await window.wiki.handleSetAPIKey(key.trim()); setKey(''); setHasKey(true); }
      await onSave(draft);
    } catch (cause) { setStatus(String(cause instanceof Error ? cause.message : cause)); }
    finally { setBusy(false); }
  };
  const handlePick = async (field: 'codexPath' | 'claudePath') => {
    try { const path = await window.wiki.handlePickExecutable(); if (path) setDraft(current => ({ ...current, [field]: path })); }
    catch (cause) { setStatus(String(cause)); }
  };
  const handleBinding = (id: string, patch: Partial<ShortcutBinding>) => setDraft(current => ({ ...current, shortcuts: current.shortcuts?.map(item => item.id === id ? { ...item, ...patch } : item) }));
  return <div className="wiki__settings">
    <div className="wiki__panel__header"><h2>설정</h2><button aria-label="설정 닫기" className="wiki__icon-button" onClick={onClose}><X size={16} /></button></div>
    <p className="wiki__settings__help">MORI 0.7.0 · Google Calendar 데일리 연동</p>
    <CalendarSettings onSync={onCalendarSync} />
    <label>AI 연결 방식<select aria-label="AI 연결 방식" value={draft.provider} onChange={event => handleChangeProvider(event.target.value as AppSettings['provider'])}>
      <option value="codex">로컬 기반 · Codex CLI</option><option value="claude">로컬 기반 · Claude CLI</option><option value="openai">원격 API · OpenAI</option>
    </select></label>
    {draft.provider !== 'openai' && <button className="wiki__button" onClick={() => handleChangeProvider('openai')}>원격 OpenAI API 키 설정</button>}
    {draft.provider !== 'openai' ? <label>{draft.provider === 'codex' ? 'Codex' : 'Claude'} 실행 파일<div className="wiki__path-field"><input value={draft.provider === 'codex' ? draft.codexPath : draft.claudePath} onChange={event => setDraft({ ...draft, [draft.provider === 'codex' ? 'codexPath' : 'claudePath']: event.target.value })} /><button onClick={() => void handlePick(draft.provider === 'codex' ? 'codexPath' : 'claudePath')}>찾기</button></div></label> : <>
      <label>OpenAI API 키<input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder={hasKey ? '저장된 키 있음 · 변경할 때 입력' : 'API 키 입력'} /></label>
      <p className="wiki__settings__help">키는 이 맥에 암호화해 저장합니다. AI 실행 시 선택한 메모를 OpenAI에 전송합니다.</p>
      {hasKey && <button className="wiki__button" disabled={busy} onClick={async () => { try { await window.wiki.handleSetAPIKey(''); setHasKey(false); setStatus('API 키를 삭제했습니다.'); } catch (cause) { setStatus(String(cause)); } }}>저장된 API 키 삭제</button>}
    </>}
    <label>모델<select aria-label="모델" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}>
      {!models.some(item => item.id === draft.model) && <option value={draft.model}>{draft.model || '기본 모델'} · 현재 설정</option>}
      {models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <button className="wiki__button" disabled={modelsLoading} onClick={() => setModelReload(value => value + 1)}>{modelsLoading ? '목록 불러오는 중…' : '모델 목록 새로고침'}</button>
    <p role="status" className="wiki__settings__help">{modelStatus}</p>
    <p className="wiki__settings__help">{draft.provider === 'codex' ? 'Codex가 저장한 모델 목록을 읽습니다. 새 모델이 없으면 Codex CLI를 실행한 뒤 새로고침하세요. 캐시가 없으면 기본 목록을 표시합니다.' : draft.provider === 'claude' ? 'Haiku·Sonnet·Opus·Fable은 CLI가 제공자별 권장 버전으로 연결하는 별칭입니다. 모델 접근 권한은 계정과 CLI 버전에 따라 다릅니다. Fable은 추가 크레딧이 사용될 수 있습니다.' : 'OpenAI API 모델 선택지입니다.'} 모델 변경 후 설정을 저장하세요. 연결 확인은 저장된 설정을 사용합니다.</p>
    <button className="wiki__button" disabled={busy} onClick={async () => { setBusy(true); try { setStatus(await window.wiki.handleCheckAI()); } catch (cause) { setStatus(String(cause)); } finally { setBusy(false); } }}>저장된 AI 연결 확인</button>
    <h3>MORI 연결 스킬</h3>
    <p className="wiki__settings__help">Codex·Claude가 작업 전에 MORI 문서를 검색하고 읽도록 연결합니다. 기존 설치본은 백업 후 교체합니다.</p>
    <button className="wiki__button" disabled={busy} aria-busy={installing} onClick={() => void handleInstallSkill()}>{installing ? '스킬 설치 중…' : 'Codex·Claude 스킬 설치'}</button>
    {skillResult && <div ref={skillFeedback} role={skillResult.error ? 'alert' : 'status'} className="wiki__settings__help" style={{ overflowWrap: 'anywhere' }}>
      <p>{skillResult.message}</p>
      {!skillResult.error && <p>Codex·Claude에서 새 세션을 열고 “mori-context로 MORI 문서를 찾아줘”라고 요청하세요.</p>}
      {skillResult.backup && <p>기존 설치본 백업: {skillResult.backup}</p>}
    </div>}
    <label>나만의 기본 AI 명령<textarea value={draft.customInstruction} onChange={event => setDraft({ ...draft, customInstruction: event.target.value })} /></label>
    <h3>백그라운드 빠른 메모</h3>
    <p className="wiki__settings__help">기본 ⌘⇧Space로 작은 메모 창을 열고 ⌘Enter로 저장합니다. 앱 창을 닫아도 메뉴 막대의 M에서 대기합니다. MORI를 완전히 종료하면 단축키도 종료됩니다.</p>
    <label className="wiki__login-option"><input type="checkbox" checked={draft.launchAtLogin === true} onChange={event => setDraft({ ...draft, launchAtLogin: event.target.checked })} />로그인 시 MORI 자동 실행</label>
    <h3>단축키와 동작</h3><p className="wiki__settings__help">키 칸을 누르고 조합을 입력하세요. Escape 취소 · Delete 해제. 전역은 다른 앱에서도 작동합니다. ⌘Space 등 시스템 단축키는 충돌할 수 있습니다.</p>
    <div className="wiki__bindings">{(draft.shortcuts || []).map((binding, index) => <div className="wiki__binding" key={binding.id}>
      <select aria-label={`동작 ${index + 1}`} value={binding.action} onChange={event => handleBinding(binding.id, { action: event.target.value })}>
        {Object.entries(commandLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        {(draft.customCommands || []).map(command => <option value={`custom:${command.id}`} key={command.id}>{command.name || '사용자 AI 명령'}</option>)}
      </select>
      <ShortcutRecorder label={`단축키 ${index + 1}`} value={binding.accelerator} onChange={accelerator => handleBinding(binding.id, { accelerator })} />
      <select aria-label={`실행 범위 ${index + 1}`} value={binding.scope} onChange={event => handleBinding(binding.id, { scope: event.target.value as ShortcutBinding['scope'] })}><option value="app">앱 안에서</option><option value="global">전역</option></select>
      <button className="wiki__icon-button" aria-label={`단축키 ${index + 1} 삭제`} onClick={() => setDraft({ ...draft, shortcuts: draft.shortcuts?.filter(item => item.id !== binding.id) })}><Trash2 size={14} /></button>
    </div>)}</div>
    <button className="wiki__button" onClick={() => setDraft({ ...draft, shortcuts: [...(draft.shortcuts || []), { id: crypto.randomUUID(), accelerator: '', action: 'search', scope: 'app' }] })}><Plus size={14} />단축키 추가</button>
    <h3>사용자 AI 동작</h3>
    {(draft.customCommands || []).map((command, index) => <div className="wiki__custom-command" key={command.id}>
      <input aria-label={`사용자 동작 이름 ${index + 1}`} value={command.name} placeholder="예: 할 일 추출" onChange={event => setDraft({ ...draft, customCommands: draft.customCommands?.map(item => item.id === command.id ? { ...item, name: event.target.value } : item) })} />
      <textarea aria-label={`사용자 동작 요청 ${index + 1}`} value={command.instruction} placeholder="메모에서 할 일을 체크리스트로 추출해 줘" onChange={event => setDraft({ ...draft, customCommands: draft.customCommands?.map(item => item.id === command.id ? { ...item, instruction: event.target.value } : item) })} />
      <button className="wiki__button" onClick={() => setDraft({ ...draft, customCommands: draft.customCommands?.filter(item => item.id !== command.id), shortcuts: draft.shortcuts?.filter(item => item.action !== `custom:${command.id}`) })}>동작 삭제</button>
    </div>)}
    <button className="wiki__button" onClick={() => setDraft({ ...draft, customCommands: [...(draft.customCommands || []), { id: crypto.randomUUID(), name: '', instruction: '' }] })}>사용자 동작 추가</button>
    {status && <p role="status" className="wiki__settings__help">{status.replace(/^(?:Error: )?Error invoking remote method '[^']+': Error: /, '')}</p>}
    <div className="wiki__settings__footer"><button className="wiki__button wiki__button--primary" disabled={busy} onClick={() => void handleSave()}>{busy ? '처리 중…' : '설정 저장'}</button></div>
  </div>;
};
