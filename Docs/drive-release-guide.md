# Google Drive 버전별 MORI 배포

MORI DMG는 홈페이지에 직접 넣지 않고, 공개 Google Drive 폴더에서 버전별로 관리한다.

## 폴더

- 배포 폴더: https://drive.google.com/drive/u/0/folders/1ozX102rtszaW6BrALCH8UrEFrJ5U9XPH
- 폴더와 파일의 공유 권한은 링크가 있는 사용자가 볼 수 있도록 설정한다.
- 폴더 안에는 DMG와 선택적으로 SHA-256 체크섬 파일만 둔다.

## 릴리스 순서

1. `package.json`의 버전을 올린다. 예: `0.8.0` → `0.9.0`.
2. `npm run package:dmg`를 실행한다.
3. `release/MORI-<버전>-arm64.dmg`가 생성됐는지 확인한다. 예: `release/MORI-0.8.0-arm64.dmg`.
4. 생성된 DMG와 `.blockmap`을 Drive 배포 폴더에 업로드한다.
5. 이전 버전은 삭제하지 않고 유지한다. 최신 버전과 파일명은 홈페이지 문구의 `currentVersion`과 맞춘다.
6. `site/config.js`의 `currentVersion`만 새 버전으로 바꾸고 사이트를 빌드·푸시한다.

## 파일명 규칙

`MORI-<semver>-arm64.dmg`

예:

~~~text
MORI-0.8.0-arm64.dmg
MORI-0.8.0-arm64.dmg.blockmap
MORI-0.9.0-arm64.dmg
MORI-0.9.0-arm64.dmg.blockmap
~~~

Apple Silicon용 빌드만 현재 공개 대상이다. DMG는 Developer ID 서명·공증을 하지 않으므로 설치 시 macOS의 개발자 확인 안내가 나타날 수 있다.

## 확인 목록

- Drive 폴더를 로그아웃 상태에서 열 수 있는가
- 각 DMG의 이름에 버전과 `arm64`가 들어 있는가
- 홈페이지의 버전 안내가 최신 파일과 일치하는가
- `node site/build.mjs`가 통과하는가
- 이전 버전 파일이 그대로 남아 있어 되돌릴 수 있는가
