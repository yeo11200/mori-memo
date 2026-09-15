# MORI 홍보 사이트

실제 앱 화면과 사용 장면을 중심으로 구성한 정적 랜딩 페이지입니다. 메시지와 전환 설계는 [MARKETING.md](MARKETING.md)에 정리했습니다.

`config.js`의 `downloadUrl`에 공개된 HTTPS 다운로드 URL 또는 버전별 파일을 모아 둔 Google Drive 폴더 URL을 입력하세요. 폴더를 사용할 때는 `downloadMode: 'folder'`, `currentVersion: '0.8.0'`을 함께 설정합니다. Google Drive는 로그아웃 상태에서도 폴더와 파일에 접근할 수 있는지 확인한 뒤 연결하세요.

빌드와 링크 검증: `node site/build.mjs`. 공개 파일만 `site/dist`에 복사하며 문서와 호스팅 설정은 공개 파일에 포함하지 않습니다.

GitHub Pages 배포 주소: https://yeo11200.github.io/mori-memo/

`main`의 `site/` 변경을 푸시하면 `.github/workflows/site-pages.yml`에서 검증·빌드 후 `site/dist`만 자동 배포합니다. GitHub Actions에서 수동 실행도 가능합니다. 배포 결과는 저장소의 Actions에서 확인하세요. DMG는 사이트에 포함하지 않고 Google Drive의 버전 폴더로 연결합니다. 버전별 업로드 순서는 [Drive 릴리스 운영 안내](../Docs/drive-release-guide.md)를 참고하세요.

`.openai/hosting.json`은 이전 Sites 미리보기 프로젝트 정보이며 GitHub Pages 배포에는 사용하지 않습니다.

로컬 확인:

```sh
python3 -m http.server 4173 --directory site
```
