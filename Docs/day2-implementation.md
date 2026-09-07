# 2026-09-08 MORI 2일차 구현

범위: 폴더 CRUD·이동 및 링크 자동완성, 모델 선택, 사용자 동작/단축키 매핑, 명령 팔레트, Codex CLI와 OpenAI API 직접 연결. iPhone·Ollama·임베딩은 후속 범위.

## 계약

- 기존 Note.folder 문자열과 파일 ID를 유지한다. folders 목록을 별도로 영속화하여 빈 폴더를 지원한다. 첫 버전 폴더는 단일 단계로 UI 제공하되 기존 경로 문자열을 보존한다.
- WikiAPI.handleListFolders(): Promise<string[]>; handleCreateFolder(name), handleRenameFolder(from,to), handleDeleteFolder(name): Promise<void>. 삭제는 미분류 이동. 이동은 기존 handleSaveNote를 사용한다. 이전 폴더/제목 alias 보존.
- AppSettings.provider에 'openai' 추가. 기존 필드 보존. shortcuts?: ShortcutBinding[], customCommands?: CustomCommand[], apiKeyConfigured?: boolean.
- ShortcutBinding: {id:string, accelerator:string, action:string, scope:'app'|'global'}. action은 capture,quick-note,new,search,ai,save,settings,palette,custom:<id>. CustomCommand: {id:string,name:string,instruction:string}.
- shortcuts 누락은 기존 capture/quickNoteShortcut 및 CmdN/K/S/, 기본값으로 마이그레이션. 명시적 []는 모두 해제. 중복 정규화/앱 메뉴 예약충돌 검사. 앱 메뉴와 렌더러 키 처리가 중복 실행하지 않도록 단일 진입점.
- WikiAPI.handleSetAPIKey(key): Promise<void> (빈 문자열 삭제), handleListModels(): Promise<{id:string,label:string}[]> (현재 provider 기준), handleCheckAI(): Promise<string>. API 키는 safeStorage 암호화·main process만 보관, renderer로 반환 금지.
- handleRunAI 기존 instruction 인자를 custom 작업의 단발 명령에도 허용. API 요청 취소·시간 제한·출력 제한·오류 안내. provider 자동 fallback 없음.

## 작업

1. Backend: Vault 폴더 영속화·안전한 일괄 이동, IPC, 모델/키 관리, API runner, shortcut 매핑 및 검증. 소유: electron/**, shared/**, Tests/**.
2. UI: 폴더 사이드바·이동, 링크 자동완성, 모델 select·키 설정, shortcut recorder·동작 매핑·명령 팔레트. 소유: src/**.
3. Integration: 실제 Electron 임시 보관함 회귀검증, 문서 갱신·패키징, 기존 데이터 경로 보존.

## 검증

폴더 CRUD 및 재시작·alias 링크·기존 문서 보존, 중복 단축키 거부/복구·여러 키 한 동작, API key 비노출·실패와 취소, 모델 선택, 키보드 포커스, Markdown 긴 문서 스크롤을 확인한다.

## 진행

- 사전 확인: 전부 untracked인 기존 codex/mac-v1 작업물을 보존하며 현재 체크아웃에서 작업한다. 추가 checkout/초기 커밋은 만들지 않는다.
- 인터페이스 공유: backend가 shared 계약을 생산하고 UI가 소비한다. 위 계약으로 합의한다.
- 폴더/shortcut/API는 서로 독립; renderer App과 hook 통합에서 저장 경합에 주의한다.

## 완료 및 검증 결과

- 폴더 생성·이름 변경·삭제·이동, 개수·필터, 빈 폴더 영속화 완료. 삭제 목적지는 미분류로 통일했다. 기존 중첩 폴더 문자열은 읽기·저장·이름 변경·삭제를 지원하고 신규 폴더만 단일 단계로 제한한다.
- `[[` 자동완성에 폴더/제목을 표시하고 키보드로 선택한다. 경로가 모호하면 ID 링크를 사용한다. 이름 변경 전 경로 alias로 기존 링크를 유지한다.
- 제공자·모델 select, OpenAI API 키 암호화 저장/삭제, 연결 확인, 단축키 recorder와 동작/범위 매핑, 사용자 AI 동작·명령 팔레트 완료.
- 리뷰에서 발견한 첫 실행 기본 단축키 누락, 기존 경로 거부, 복원 시 폴더 누락, API 키 해독 오류로 전체 메모를 읽지 못하는 문제를 수정했다. 독립 재리뷰 승인.
- `npm test`: 6개 파일, 39개 테스트 통과. `npm run build`: TypeScript·Vite·Electron 빌드 통과.
- `npm run package:mac`: arm64 앱 패키징 성공. 산출물은 `release/mac-arm64/MORI.app`이며 공개 배포용 서명·공증은 아직 적용하지 않았다.
- `node scripts/smoke.mjs`: 실제 Electron 임시 보관함에서 검색/포커스, AI 초안·적용·취소, 모델 select, 전역 단축키 등록, 중복 거부·Escape 취소·Delete 해제, 사용자 AI 동작, 명령 팔레트, 폴더 CRUD·링크 유지, 긴 Markdown 스크롤, 휴지통 복원·영구 삭제 통과. renderer 오류 없음.
- `node scripts/startup-smoke.mjs`: 기본 단축키, 재시작 후 문서/폴더/해제 설정 유지, 손상된 API 키에서도 정상 시작 및 키 삭제 통과.
- Playwright CDP 키 입력은 Electron before-input-event를 거치지 않아 앱 단축키 검증에는 webContents.sendInputEvent를 사용했다. recorder와 문서 편집은 실제 renderer 키 이벤트로 검증했다.
- 실제 사용자 보관함을 테스트에 사용하지 않았다. OpenAI는 모의 응답으로 요청·결과·실패·취소를 검증했으며 실제 API 사용은 사용자 키가 필요하다.

## 다음 범위

하위 폴더 트리, 계정별 모델 목록 자동 조회, iPhone 동기화, 검색 인덱스·그래프 고도화는 후속 작업이다. 현재 모델 선택은 앱 카탈로그이며 계정 권한 오류는 연결 확인/실행에서 안내한다. 공개 배포 서명·공증은 별도 배포 단계다.
