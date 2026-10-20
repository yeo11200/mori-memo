# 월 2,900원 Pro 구현과 운영 연결

2026-10-20 구현. 계정·체험·결제 서버 및 앱 연결 코드를 추가했다. **운영 서비스는 배포하지 않았고 실제 이메일 발송·PG 테스트 상점·실결제는 연결하지 않았다.** 기본 빌드는 기존과 같은 무료 베타다.

## 구현 범위

- 이메일 OTP 요청·검증·세션 갱신·로그아웃. Supabase Auth 서버에서 토큰과 이메일 인증 상태를 검증한다.
- 계정당 한 번 14일 체험, Mac 2대 등록·해제, 구매 복원.
- 월 2,900원 KRW 단일 상품의 카드 등록·첫 승인·월 갱신·카드 교체·다음 결제 해지·해지 예약 취소.
- 최근 결제 내역과 환불 요청. 환불 실행은 판매 조건을 확인한 운영자의 승인으로 처리한다.
- 서명된 기기별 권한, 최대 7일 오프라인 사용, 명시적 로그아웃 때 권한 해제.
- Electron main에서 AI 보고서와 템플릿 쓰기를 검사한다. 원문 모음·기존 템플릿 읽기·삭제·이미 생성한 결과 복사·저장·내보내기는 제한하지 않는다.
- 중복 작업자·응답 유실·환불 후 늦은 이벤트·일반 갱신과 수동 구매의 경합을 처리한다.
- 공개 결제 URL과 웹훅의 상태를 믿지 않고 서버 승인 응답 또는 PG 거래 조회로 대사한다. 월말은 KST의 최초 결제 기준일을 유지한다.

## 실제 코드 구성

| 위치 | 역할 |
|---|---|
| `shared/billing.ts` | 가격·상품·정책 상수, 표시 타입, KST 월 계산 |
| `server/billing/service.ts` | 체험·기기·청구·대사·해지·환불 도메인 |
| `server/billing/adapters.ts` | Supabase REST 저장소, Toss API, 빌링키 AES-GCM 암호화 |
| `server/billing/http.ts` | 인증된 API와 브라우저 결제·콜백·운영 작업 경로 |
| `server/billing/server.ts` | 환경설정 검증과 Node HTTP 실행 진입점 |
| `server/billing/migrations/001_billing.sql` | CAS·주문 유일성·감사·요청 제한과 DB 권한 |
| `electron/billing/billing-client.ts` | main 전용 인증 세션·계정 통신·권한 캐시 |
| `electron/billing/receipts.ts` | Ed25519 JWT 서명과 검증. 앱에는 공개키만 포함 |
| `src/app/AccountSettings.tsx` | 계정·체험·월 구독·결제 내역·해지·기기 화면 |

설계의 관리형 인증·DB는 유지하되, 초기 API는 저장소의 Node/TypeScript 도구로 실행 가능한 **Node 22 서버**로 구현했다. Edge Functions 전용 배포물은 아니다. HTTPS 역방향 프록시와 외부 예약 작업이 필요하다.

초기 단일 상품의 계정·체험·기기·구독·회차 상태는 Postgres 계정 행의 JSONB 집합으로 보관하고 revision CAS 함수로 원자적으로 갱신한다. 주문·PG 결제 키의 유일성과 변경 감사는 별도 테이블로 관리한다. 각 변경은 CAS 재시도 안에서 외부 통신을 하지 않고, 외부 승인 전 attempt와 lease를 먼저 기록한다. 설계의 모든 논리 개념을 각각 독립 테이블로 구현한 것은 아니다.

## 1. 키 준비

```sh
npm run setup:billing
```

다음 파일을 새로 만든다. 기존 파일은 덮어쓰지 않는다.

- `Secrets/billing/signing.pem`: 서버 전용 Ed25519 개인키.
- `Secrets/billing/public-keys.json`: 앱에 포함할 검증 공개키.
- `.env.billing`: 암호화·예약 작업 비밀값과 외부 연결 설정 템플릿.

개인키와 `.env.billing`은 0600으로 저장하며 Git에서 제외한다. 실제 값을 대화나 커밋에 넣지 않는다. 암호화 키를 분실하면 저장된 빌링키를 복구할 수 없으므로 서버 비밀 관리 시스템에서 백업·접근을 관리한다. 서명키 교체 시 새 `kid`와 공개키를 먼저 앱에 배포하고, 기존 증명 만료까지 이전 공개키를 유지한다.

## 2. Supabase 연결

1. 테스트용 Supabase 프로젝트를 준비한다.
2. SQL Editor 또는 migration 도구로 `server/billing/migrations/001_billing.sql`을 적용한다. 한 번만 적용하는 초기 migration이다.
3. 이메일 OTP 템플릿에 `{{ .Token }}`을 넣고 SMTP·발신 도메인·만료·재발송 정책을 설정한다. 실제 이메일 계정으로 발송과 잘못된 코드·만료를 검증한다.
4. `.env.billing`의 `SUPABASE_URL`, 공개 anon key, 서버 전용 service role key를 설정한다. service role key는 앱에 넣지 않는다.

DB의 anon/authenticated 역할은 결제 테이블과 변경 함수를 직접 읽거나 실행할 수 없다. 서버는 Supabase Auth의 `/user`로 요청자의 이메일 인증과 subject를 확인한 뒤 해당 사용자 행만 다룬다. OTP 요청과 검증은 이메일·IP·계정 제한을 적용한다.

공식 계약: [Supabase 이메일 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).

## 3. 토스페이먼츠 테스트 연결

`.env.billing`에 아래 값을 채운다.

- `BILLING_PUBLIC_URL`: 공개 HTTPS 서버 origin. 경로·쿼리를 포함하지 않는다.
- `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`: 같은 테스트 빌링 상점의 키.
- `BILLING_TERMS_URL`, `BILLING_PRIVACY_URL`: 실제 이용·환불 조건과 개인정보 안내 HTTPS URL.
- `MORI_BILLING_URL`: 앱이 사용할 같은 서버 origin.

첫 연결은 `BILLING_ALLOW_LIVE=0`을 유지한다. 서버는 테스트 키와 운영 키가 섞이면 시작을 거부한다. 운영 키는 계약·판매 정책·지원 체계를 확정한 뒤 `BILLING_ALLOW_LIVE=1`과 함께 명시적으로 설정해야 한다.

빌링키 발급과 승인·거래 조회는 서버에서만 수행한다. 카드 등록 성공은 결제 성공이 아니며, 승인 금액·KRW·주문 ID·PG payment key가 일치한 경우에만 이용 기간을 부여한다. 카드 교체 자체로 추가 승인하지 않는다. [토스페이먼츠 V2 빌링 가이드](https://docs.tosspayments.com/guides/v2/billing/integration), [서버 API](https://docs.tosspayments.com/reference)를 기준으로 구현했다.

## 4. 서버 실행과 예약 작업

```sh
npm run build:billing
npm run start:billing
```

Node 22 이상에서 실행한다. 기본 bind는 `127.0.0.1:4180`이다. 외부에는 HTTPS 프록시를 통해 노출하고, `.env.billing`을 서버 비밀 설정으로 주입한다. 서버는 request URL과 Host/forwarded 헤더를 인증 근거로 쓰지 않으며 토큰·카드 인증 쿼리를 로그에 출력하지 않는다.

외부 스케줄러에 **5분마다 POST `/jobs/billing`** 을 등록하고 `Authorization: Bearer <BILLING_CRON_SECRET>` 헤더를 비밀 설정으로 전달한다. 앱이 켜져 있어야 실행되는 타이머를 사용하지 않는다. 동시에 여러 작업자가 호출돼도 CAS·영속 attempt·멱등키로 같은 회차를 중복 승인하지 않는다.

토스 웹훅 대상은 `POST /webhooks/toss`다. 수신값은 해당 주문을 조회하라는 신호이며, 서버에 등록된 주문을 PG에서 다시 조회한다. 여러 번 또는 순서가 뒤바뀌어 도착해도 이미 환불된 결제를 다시 활성화하지 않는다.

요청 제한은 DB에 기록한다. 현재 IP는 연결 소켓을 사용하며 임의 `X-Forwarded-For`는 믿지 않는다. HTTP 역방향 프록시 뒤에서는 같은 프록시 IP의 제한을 공유하므로 실제 배포 시 신뢰 프록시의 IP 전달·제한 구성을 별도로 검증한다.

운영 점검:

- 예약 작업 응답의 `ok:false`를 알림으로 연결한다. 응답이 모두 성공이어도 예약 작업 자체가 중단되지 않았는지 모니터링한다.
- 결과 불명 거래는 기존 주문부터 대사한다. 오래된 `unknown`을 새 주문으로 강제 재결제하지 않는다.
- 같은 통신 재시도는 같은 멱등키를 쓴다. 확정 거절만 별도 attempt로 기록해 24시간·72시간에 재시도한다. 72시간 예약이 약간 늦어진 경우 96시간 이내 실행할 수 있게 허용한다.
- 14일 넘은 불명 거래는 자동 재승인을 하지 않고 조회만 한다. PG 기록을 확인한 운영 판단이 필요하다.
- 카드 등록 중 서버가 중단되면 lease 만료 후 확인한다. 저장된 빌링키가 있으면 최초 주문을 이어가고, 없으면 새 카드 등록을 요청한다. 존재를 모르는 빌링키를 만들어 결제하지 않는다.
- 승인 전 동의한 새 수동 구매는 이전 자동 갱신과 경합하지 않게 중단시킨다. 새 승인이 성공해야 새 기간으로 활성화한다.
- 환불 요청은 계정 상태에 기록된다. 운영자는 정책 검토 후 인증된 POST `/jobs/refund`에 `{"userId":"대상 UUID"}`를 전달한다. 실제 PG 취소가 확인돼야 환불 완료다. 요청을 받았다는 이유로 즉시 환불했다고 표시하지 않는다.

## 5. 앱 빌드

```sh
# 현재 배포 정책 유지: 계정 없이 무료 베타
npm run build

# .env.billing의 HTTPS URL과 공개키를 포함하는 상용 빌드
npm run build:commercial
```

상용 빌드는 main에 서버 URL·공개키만 포함한다. 런타임에 renderer나 원격 설정으로 무료 베타를 상용 모드로 바꿀 수 없다. 패키지 앱은 실행 환경 변수로 모드를 바꾸지 않는다. 개발 실행에만 테스트 서버 환경 변수를 허용한다.

상용 빌드에서 설정의 **계정 및 Pro**를 사용한다. AI 보고서·템플릿 쓰기는 main에서 다시 검사한다. 인증 토큰과 권한 캐시는 보관함 밖 `userData/auth/session.bin`에 safeStorage로 암호화한다. renderer에는 refresh token·서명 개인키·PG 비밀키·billingKey를 보내지 않는다. 유효 권한으로 시작한 보고서의 결과 사용은 도중에 구독이 만료돼도 유지한다.

상용 배포 전에는 버전·무료 베타 전환 고지·서명·공증·실제 판매 정책을 함께 준비한다. 현재 코드 작성만으로 기존 설치본을 유료 전환하지 않는다.

## 검증과 남은 운영 확인

```sh
npm test
npm run build
npm run build:billing
node scripts/billing-db-smoke.mjs
node scripts/billing-smoke.mjs
node scripts/report-smoke.mjs
```

DB 스모크는 독립 임시 PostgreSQL을 생성·종료하며 기존 DB를 사용하지 않는다. 기본 PostgreSQL 경로가 다르면 `PG_BIN`을 지정한다. DB migration·CAS 경합·감사 기록·요청 제한·사용자 역할 접근 거부를 검사한다.

앱 스모크는 임시 보관함·로컬 계정 API·가짜 인증 및 결제 사업자를 사용한다. 실제 앱의 main 우회 방지·로그인·체험·세션 암호화·구매 복원·해지·로그아웃·기존 템플릿 보존을 검사한다. **실제 카드 승인이나 이메일을 검증한 결과가 아니다.**

실서비스 공개 전 남은 항목은 Supabase SMTP·서비스 키 연결, 토스 테스트 상점의 실제 등록·승인·갱신·취소, HTTPS 배포와 예약 작업·웹훅 설정, PG 운영 계약, 판매·환불·데이터 보존 정책 확정이다. 부분 환불과 계정 완전 삭제의 자동화는 아직 제공하지 않는다. 삭제 요청은 청구 중단·진행 중 거래 확인·보존 정책 적용 후 운영자가 처리해야 한다.
