# Google Drive 공개 배포 안내

## 업로드할 파일

`release/MORI-0.5.2-arm64.dmg`를 Google Drive에 업로드하고 링크 공유 권한을 “링크가 있는 모든 사용자 · 뷰어”로 설정한다. Apple Silicon(M1 이상)용 빌드다.

DMG 안에는 MORI 앱과 `mori-context` 스킬 원본이 함께 들어 있다. Codex·Claude 실행 프로그램이나 계정은 포함하지 않는다. 설치 후 설정에서 스킬 설치를 한 번 실행한다.

## 사용자 안내

1. DMG를 다운로드한다.
2. MORI.app을 응용 프로그램 폴더로 드래그한다.
3. 최초 실행 시 macOS 경고가 나오면 시스템 설정의 개인정보 보호 및 보안에서 실행을 허용한다.
4. 설정에서 Apple 메모 연동, AI 연결, Codex·Claude 스킬 설치를 선택한다.

현재 앱은 Developer ID 서명·공증 없이 무료 배포한다. Google Drive 업로드는 계정 권한 때문에 수동으로 처리한다.
