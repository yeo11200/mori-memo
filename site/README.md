# MORI 홍보 사이트

실제 앱 화면과 사용 장면을 중심으로 구성한 정적 랜딩 페이지입니다. 메시지와 전환 설계는 [MARKETING.md](MARKETING.md)에 정리했습니다.

`config.js`의 `downloadUrl`에 공개된 HTTPS 다운로드 URL을 입력하세요. 빈 값이거나 유효하지 않으면 준비 중 상태를 유지합니다. Google Drive는 로그아웃 상태에서도 파일에 접근할 수 있는지 확인한 뒤 연결하세요.

빌드와 링크 검증: `node site/build.mjs`. 공개 파일만 `site/dist`에 복사하며 문서와 호스팅 설정은 공개 파일에 포함하지 않습니다.

Sites 프로젝트 식별자는 `.openai/hosting.json`에 보관합니다. 현재 공개 범위와 배포 성공 여부는 Sites에서 별도로 확인해야 합니다. 소스를 수정하는 것만으로 재배포되지는 않습니다.

로컬 확인:

```sh
python3 -m http.server 4173 --directory site
```
