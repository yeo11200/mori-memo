# MORI 0.4.1 · Sky & White

2026-09-10: 기존 로고 형태와 레이아웃을 유지하고 앱 전체를 하늘색·화이트 팔레트로 변경했다.

- 배경 `#F8FAFC`, 편집기·팝업 `#FFFFFF`
- 본문 `#0F172A`, 보조 본문 `#334155`, 설명 `#64748B`
- 선택 영역 `#E0F2FE`, 포인트 `#0284C7`, 경계선 `#E2E8F0`
- 흰 글자가 있는 주요 버튼은 가독성을 위해 `#0369A1`, 호버는 `#075985`
- 오류·삭제는 붉은색, 그래프 폴더는 블루·인디고·골드·보라·핑크·청록으로 구분

`src/styles/global.css`의 `--mori-*` 변수로 공통 색상을 관리한다. 편집기, 검색, 설정, AI 창, 휴지통, Apple 메모 가져오기, 그래프, 빠른 메모와 네이티브 창 배경에 적용한다.

로고 원본은 `build/mori-icon.svg`다. `node scripts/build-icons.mjs`로 PNG iconset·1024px PNG·ICNS를 함께 재생성한다. Playwright Chromium이 필요하며 별도 설치본은 `MORI_CHROMIUM_PATH`로 지정할 수 있다.

`node scripts/theme-smoke.mjs`는 임시 보관함을 만들어 편집기·그래프·설정 화면을 캡처한다. 실사용 보관함은 수정하지 않는다. `npm run package:dmg`로 0.4.1 Apple Silicon DMG를 만든다. 이전 설치 앱은 새 앱으로 교체해야 새 아이콘이 반영된다.
