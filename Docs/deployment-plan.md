# MORI 배포 계획

작성일: 2026-09-08 · 현재 버전: 0.2.1

## 현재 상태

- Electron + React + TypeScript 기반 macOS 앱이다.
- Apple Silicon 앱 번들 생성과 패키징된 앱 UI 테스트를 완료했다.
- Developer ID 서명, Apple 공증, Mac App Store 제출은 아직 진행하지 않았다.
- 개인 메모·API 키·CLI 인증 정보는 Git 저장소와 배포 파일에 포함하지 않는다.

## 1. 소스 공개 및 협업

- 저장소: https://github.com/yeo11200/mori-memo
- 코드, 테스트, 로고 원본, 계획서, 구현 기록을 main 브랜치에서 관리한다.
- node_modules, dist, dist-electron, release, 개인 Vault/Secrets, 인증서를 제외한다.
- 후속 변경은 기능 브랜치와 PR로 검토한다. CI 자동화는 다음 단계에서 추가한다.

## 2. 로컬 검증 및 사전 배포

```sh
npm ci
npm test
npm run build
node scripts/smoke.mjs
node scripts/startup-smoke.mjs
node scripts/quick-note-smoke.mjs
node scripts/graph-smoke.mjs
npm run package:mac
node scripts/quick-note-smoke.mjs --packaged
node scripts/graph-smoke.mjs --packaged
```

화면 테스트는 macOS GUI 세션에서 임시 보관함으로 수행한다. 실제 사용자 데이터로 테스트하지 않는다. 업데이트 전 실행 중인 이전 앱을 정상 종료하고 프로세스 종료를 확인한다. 새 번들을 실행한 뒤 설정의 버전·모델 선택·API 입력과 빠른 메모를 확인한다.

별도 수동 확인: 다른 앱이 앞에 있을 때 전역 단축키, 화면 캡처 권한, 로그인 자동 실행, 실제 Codex 인증 및 OpenAI 연결. OS 키 입력 자동화는 접근성 권한에 따라 제한될 수 있다.

## 3. Mac용 직접 배포

1. Apple Developer Program 가입 및 배포용 식별자·인증서를 준비한다.
2. Developer ID 서명과 hardened runtime 설정을 검토하고 패키징한다.
3. Apple 공증과 티켓 첨부를 적용하고 다운로드한 앱의 실행을 확인한다.
4. DMG를 만들고 버전·변경 내역·설치 안내·체크섬과 함께 GitHub Releases에 게시한다.
5. 깨끗한 맥에서 설치·업데이트·기존 메모 보존·CLI/API 연결을 확인한다.

현재 `package:dmg`만 실행하는 것으로 서명·공증이 완료되지는 않는다. 인증 정보는 로컬 보안 저장소나 CI Secrets로 관리한다. 자동 업데이트는 아직 구현하지 않았다.

## 4. Mac App Store 검토

- App Sandbox 요구사항에 맞춰 외부 CLI 실행, 파일 접근, 화면 캡처, 전역 단축키, 로그인 실행을 검증한다.
- 현재 Codex CLI 연동을 그대로 제출할 수 있다고 가정하지 않는다. 필요하면 API 중심 스토어 버전과 CLI를 지원하는 직접 배포 버전을 분리하는 방안을 검토한다.
- App Store Connect 정보, 개인정보 처리방침, 지원 URL, 스크린샷, 심사용 사용 안내를 준비한다.
- 과금·구독을 추가할 경우 결제 및 AI 비용 정책을 별도로 설계한다.
- 내부 테스트 후 심사에 제출하고 실제 승인 결과에 따라 배포한다.

공식 기준: [Apple Developer Program](https://developer.apple.com/kr/programs/), [App Sandbox 배포 요구사항](https://help.apple.com/xcode/mac/current/en.lproj/dev91fe7130a.html), [Developer ID](https://developer.apple.com/developer-id/).

## 5. 후속 제품 계획

폴더 트리와 링크 경험 개선 → 동기화·충돌 정책 결정 → iPhone 앱 → 검색 인덱스·그래프 고도화 순서로 진행한다. 상세 요구사항은 [다음 로드맵](next-roadmap.md)을 따른다.
