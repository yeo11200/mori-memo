# Google Calendar → MORI 데일리 (0.7.0)

## 사용 순서
1. MORI 설정의 **Google Calendar → 오늘 데일리**를 연다.
2. **OAuth JSON 선택**에서 Google OAuth 데스크톱 앱 클라이언트 파일을 선택한다.
3. **Google 계정 연결**을 눌러 시스템 브라우저에서 로그인하고 캘린더 목록·일정 읽기를 허용한다.
4. 가져올 캘린더를 선택한다. **선택 저장·오늘 일정 가져오기**를 누르면 오늘 데일리에 반영한다.
5. **오늘 데일리를 열 때 일정 갱신**을 선택해 저장하면, 왼쪽 **오늘 데일리 열기** 또는 새 메모의 데일리 메뉴에서 갱신한다.

AI API 키는 필요하지 않다. Google Calendar 원본 생성·수정·삭제 권한을 요청하지 않는다.

## 최초 Google Cloud 준비
- Google Cloud 프로젝트에서 Google Calendar API를 활성화한다.
- Google Auth Platform의 Branding / Audience 등 동의 화면 설정을 완료한다.
- 테스트 상태라면 로그인할 Google 계정을 테스트 사용자로 등록한다.
- Clients에서 **Desktop app / 데스크톱 앱** 유형의 OAuth 클라이언트를 생성하고 JSON을 다운로드한다.
- 웹 애플리케이션용 JSON, 서비스 계정 키는 사용할 수 없다.
- JSON과 토큰을 GitHub·MORI 메모·채팅에 올리지 않는다. 앱 파일 선택 창에서 읽는다.

현재는 사용자가 준비한 OAuth 클라이언트를 사용하는 베타 구현이다. 일반 사용자에게 JSON 준비 없이 로그인만 제공하려면 배포자 소유 Google Cloud 클라이언트와 필요한 동의 화면/검증 절차를 별도로 준비해야 한다. 이 문서 작성 시 실제 계정 로그인 검증은 수행하지 않았다.

공식 참고:
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
- https://developers.google.com/calendar/api/v3/reference/events/list

## 갱신과 기록 보존
- 오늘은 Mac의 로컬 날짜다. 날짜 경계는 현지 자정부터 다음 날 자정까지 계산한다.
- 선택한 캘린더를 최대 20개 조회하고, 모든 페이지 조회 성공 후 한 번에 데일리에 저장한다.
- 종일·여러 날 일정, 반복 일정의 오늘 발생분을 조회한다. 시간 지정 일정은 Mac 시간으로 표시한다.
- 동일 계정·캘린더는 같은 관리 구역을 갱신한다. 이벤트 ID로 중복을 구분한다.
- 이전에 가져왔으나 현재 조회에서 빠진 항목은 “오늘 일정에서 제외됨”으로 남긴다. 삭제인지 날짜 이동인지 임의로 단정하지 않는다.
- 일정 링크는 Google Calendar에서 열 수 있다.
- 개인 기록은 관리 구역 밖에 작성한다. 구역 안을 직접 고치거나 표식을 삭제하면 덮어쓰기를 거부한다. 기존 스냅샷과 버전 이력은 남는다.
- 캘린더 선택을 해제하거나 계정을 바꿔도 이전 데일리 내용은 자동으로 삭제하지 않는다. 이전 구역은 마지막 확인 시점의 기록이다.
- 과거 데일리는 자동 갱신하지 않는다. 체크리스트의 MORI 완료 상태를 Google에 전달하지 않는다.
- 앱이 완전히 종료된 동안에는 동작하지 않는다. 오늘 노트 일반 목록 클릭만으로는 갱신하지 않는다.
- API 오류·인증 만료·네트워크 실패 시 기존 내용을 보존하고 오류를 표시한다.

## 인증과 저장
OAuth authorization code + PKCE(S256) + state를 사용한다. 응답 서버는 127.0.0.1의 임의 포트에서 열고 로그인 완료·취소·시간 초과 시 닫는다. JSON 안의 인증 서버 URL은 신뢰하지 않고 Google 공식 endpoint만 사용한다.
클라이언트와 access/refresh token은 userData/Secrets/google-calendar.bin에 Electron safeStorage로 암호화한다. Vault 백업에 포함되지 않는다. renderer에는 토큰·client secret을 반환하지 않는다.
**이 기기에서 연결 해제**는 로컬 토큰과 선택 정보를 제거한다. Google의 앱 접근 권한까지 철회하려면 Google 계정에서 별도로 연결을 해제한다.

## 검증 범위
모의 API로 인증 거부·취소, PKCE/state, 토큰 갱신, 페이지 조회, API 실패 원자성, 중복·누락 일정 처리, 보관함 재시작·이력·수동 수정 충돌을 검증한다.
실제 OAuth 사용자 동의 및 계정 접근은 사용자의 Google Cloud 설정으로 별도 검증해야 한다.
