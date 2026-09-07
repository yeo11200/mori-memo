# MORI 2일차 Backend 구현 보고서

## 구현 범위

- `shared/types.ts`: OpenAI provider, 폴더 API, 모델/키/연결 확인 API, shortcut recorder API, `ShortcutBinding`, `CustomCommand`, `AIModel` 계약을 추가했다.
- `electron/vault/vault.ts`: `.wiki/folders.json`으로 빈 폴더를 영속화한다. 기존 노트의 folder 문자열을 시작 시 합쳐 이전 데이터를 보존한다. create/rename/delete는 직렬화하며 rename/delete 중 실패하면 변경한 모든 노트와 폴더 목록을 원복한다. 이동된 노트는 ID를 유지하고 `이전폴더/제목` alias를 추가한다.
- `electron/shortcuts.ts`: legacy shortcut 마이그레이션, 명시적 빈 배열/빈 legacy 값 보존, accelerator 정규화, 중복·메뉴 예약 조합·custom command 참조 검증을 구현했다.
- `electron/main.ts`, `electron/preload.ts`: 폴더·설정·AI IPC를 연결했다. app shortcut은 `before-input-event`, global shortcut은 `globalShortcut`에서 모두 `wiki:command`로 보낸다. recorder 중에는 두 경로를 중단한다. 매핑 대상 menu item에는 accelerator를 두지 않았다.
- `electron/openai/api-key-store.ts`: Electron `safeStorage` 암호문만 `userData/Secrets/openai-api-key.bin`에 원자 저장한다. renderer에는 키 존재 여부만 보낸다. Secrets는 Vault 밖이므로 Vault export에 포함되지 않는다.
- `electron/openai/openai-runner.ts`: Responses API 요청, `store:false`, 4,096 출력 토큰 제한, 1MB 입력/2MB 응답 제한, 3분 timeout, 취소, 동시 요청 거부, HTTP 오류 안내, incomplete 결과 거부를 구현했다. raw REST envelope의 `output[].content[].text`만 결과로 사용한다.

OpenAI 구현 근거는 공식 문서의 [GPT-5 nano 모델 페이지](https://developers.openai.com/api/docs/models/gpt-5-nano)와 [API 오류 코드 안내](https://developers.openai.com/api/docs/guides/error-codes)를 확인했다. API 테스트는 모두 주입한 local fetch로 수행했고 실제 네트워크나 사용자 키를 사용하지 않았다.

## 검증

- `npm test`: 6 files, 35 tests passed.
- `npm run build`: TypeScript, Vite renderer build, Electron build passed.
- 새 테스트: 빈 폴더 재시작, 기존 note folder 복구, rename/delete alias와 ID 보존, 동시 폴더 생성, batch 실패 rollback, shortcut migration/정규화/충돌, safeStorage 추상화 암호문·삭제, OpenAI payload/REST parsing/auth error/cancel/timeout/incomplete.

## 계약 및 주의점

- `handleListModels(provider?)`는 네트워크 호출 없이 provider별 앱 카탈로그를 반환한다. Codex 기본은 `gpt-5.6-luna`, OpenAI API 기본은 `gpt-5-nano`다.
- `handleRunAI(id, 'custom', instruction)`은 저장된 custom command instruction을 단발 실행할 수 있다.
- 폴더 batch rollback은 활성 노트와 폴더 메타데이터를 복구한다. 실패 전에 작성된 history snapshot은 감사/복구 데이터로 남을 수 있지만 현재 노트 revision과 본문은 원래 값으로 돌아간다.
- 실제 OpenAI 연결, 실제 global shortcut 등록, macOS Keychain 동작은 자동 테스트에서 실행하지 않았다.
