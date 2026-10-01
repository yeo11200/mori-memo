window.MORI_SITE_CONFIG = Object.freeze({
  // 버전별 DMG를 올려 두는 Google Drive 폴더입니다.
  downloadUrl: 'https://drive.google.com/drive/u/0/folders/1ozX102rtszaW6BrALCH8UrEFrJ5U9XPH',
  downloadMode: 'folder',
  currentVersion: '0.9.0',
  releases: [
    {
      version: '0.9.0', date: '2026-10-01', title: '외부 메모 즉시 반영',
      summary: 'Codex·Claude가 저장한 메모가 앱을 다시 열지 않아도 바로 보여요.',
      highlights: ['연결 스킬이 저장한 메모를 목록에 자동 반영', '보관함 폴더 변화 감지', '앱을 끄고 켤 필요 없음'],
      url: 'https://drive.google.com/file/d/14pdIvyX3q-_lcnXQuNHBV4TN-33jXKwS/view?usp=drive_link',
    },
    {
      version: '0.8.0', date: '2026-09-15', title: '데일리 업무 허브',
      summary: '오늘 데일리에 일정과 담당 업무를 한곳에 모아요.',
      highlights: ['Google Calendar 일정 연동', 'Jira·GitHub·GitLab 담당 업무 연동', '프로젝트·상태 필터와 자동 갱신', '외부 원본은 읽기 전용으로 보존'],
      url: 'https://drive.google.com/file/d/1yom4762unBShnHOMNYWQLkXaaOTvcVbd/view?usp=drive_link',
    },
  ],
});
