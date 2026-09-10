# MORI 연결 스킬 0.1.0

MORI 앱과 별도로 배포하는 Codex·Claude 공용 스킬이다. 현재 저장소와 요청을 바탕으로 MORI 문서를 검색하고, 필요한 원문을 읽은 뒤 코드·기획·글쓰기에 적용한다. 저장소를 사전에 등록하거나 특정 폴더 구조를 만들 필요가 없다.

## 설치와 사용

Python 3.9 이상이 필요하다. MORI의 기본 메모 기능에는 Python이 필요 없으며, 이 스킬의 CLI 실행에만 필요하다. 저장소 루트에서 아래 명령을 실행한다. 기존 mori-context 설치가 있다면 먼저 비교하고 백업하며 무조건 덮어쓰지 않는다.

```sh
mkdir -p ~/.agents/skills ~/.claude/skills
cp -R skills/mori-context ~/.agents/skills/mori-context
cp -R skills/mori-context ~/.claude/skills/mori-context
```

배포 ZIP을 받았다면 압축을 푼 뒤 `mori-context` 폴더를 같은 위치에 복사한다. 기존 폴더가 있으면 먼저 diff로 변경 사항을 확인한다. Codex는 저장소의 `.agents/skills` 또는 사용자 `~/.agents/skills`, Claude Code는 프로젝트 `.claude/skills` 또는 사용자 `~/.claude/skills`에서 스킬을 읽는다. 이 저장소는 공용 원본을 `skills/mori-context`에 둔다.

Codex에서는 `$mori-context`, Claude Code에서는 `/mori-context`로 요청한다. 새 세션에서 스킬 목록을 확인한다. 예:

```text
$mori-context 모리의 컨벤션과 시스템 문서를 먼저 읽고 이 API를 구현해줘.
/mori-context 주문 서비스 변경이 결제 서비스에 미치는 영향을 모리 문서와 코드로 확인해줘.
$mori-context 관련 개발 문서가 없으면 현재 코드로 초안을 작성해서 보여줘.
```

자연어 요청에 자동 선택될 수 있지만 매번 실행되는 강제 훅은 아니다. 항상 적용하고 싶은 저장소에는 사용자가 관리하는 AGENTS.md 또는 CLAUDE.md에 ‘관련 작업 전에 mori-context로 MORI 지식을 조회한다’는 한 줄을 선택적으로 추가한다. 스킬이 이 파일들을 자동 수정하지 않는다.

설치 형식 근거: [Codex 스킬 문서](https://developers.openai.com/codex/skills/), [Claude Code 스킬 문서](https://code.claude.com/docs/en/skills). 양쪽에 같은 패키지를 설치하므로 검색·권한·출처 규약이 동일하다. 모델 선택과 CLI 인증을 변경하지 않는다.

## 로컬 연결 계약

```sh
python3 skills/mori-context/scripts/mori.py status
python3 skills/mori-context/scripts/mori.py search --query '공통 규칙 주문' --limit 6
python3 skills/mori-context/scripts/mori.py read --id DOCUMENT_ID --length 6000
python3 skills/mori-context/scripts/mori.py --vault '/path/to/Vault' search --query '컨벤션'
```

`--vault`는 하위 명령 앞에 둔다. 우선순위는 명시 경로 → MORI_VAULT_PATH → WIKI_DATA_DIR/Vault → macOS 기본 후보다. 기본 후보는 `~/Library/Application Support/personal-wiki/Vault`와 `~/Library/Application Support/MORI/Vault`다. 후보가 복수이면 임의로 고르지 않는다. status로 연결을 확인하고 다른 위치라면 명시 경로를 사용한다.

Notes의 JSON frontmatter Markdown만 읽는다. 앱을 실행하지 않아도 되고 별도 서버·토큰·API 키가 없다. MORI 설정의 **Codex·Claude 스킬 설치** 버튼으로도 현재 DMG에 포함된 스킬을 두 개인 폴더에 설치할 수 있다. 출력은 JSON이며 실패 시 종료 코드 1, 인자 오류는 2다. 손상된 문서는 검색에서 건너뛰고 skippedDocuments 개수를 표시한다. 휴지통·첨부·Secrets·설정은 검색하지 않는다.

- 검색: 제목 5, 폴더 2, 본문 1의 키워드 가중치. 결과 제한 1~20, 정확한 폴더 필터 `--scope` 지원.
- 원문: ID로 읽으며 기본 6,000자, 최대 20,000자. nextOffset으로 이어 읽는다.
- 신선도: 항상 unknown으로 시작하고 AI가 실제 코드와 비교한다. 날짜만으로 current라고 주장하지 않는다.
- RAG의 검색→문맥 제공 흐름이며 현재는 키워드 검색이다. 임베딩과 모델 학습은 제공하지 않는다.
- CLI는 네트워크 통신을 하지 않는다. 반환 문서를 AI가 읽으면 해당 Codex·Claude 서비스 문맥에 들어갈 수 있다.

## 승인한 새 문서만 저장

`propose --file draft.json`으로 대상·최종 본문·출처·approvalHash를 검토한다. 사용자가 그 내용을 승인한 뒤 `create --file draft.json --approve HASH`로 새 메모를 만든다. 자세한 JSON 형식은 [스킬 워크플로](../skills/mori-context/references/workflow.md)를 따른다.

해시는 승인받은 내용과 저장 대상을 연결하는 변경 검출 수단이며 사람 인증을 대신하지 않는다. 에이전트의 실제 승인 준수는 SKILL.md 규칙에 의존한다. CLI 권한은 실행 사용자의 파일 권한 범위다.

현재 등록된 폴더에만 생성한다. 완성 파일을 원자적으로 게시하고 기존 메모는 덮어쓰지 않는다. 동일 초안 재시도는 중복 생성하지 않으며, 그 메모가 수정됐거나 휴지통에 있으면 차단한다. 완전 삭제된 동일 초안의 영구 중복 방지 기록은 제공하지 않는다.

앱의 기존 쓰기 큐를 다른 프로세스에서 재사용하지 않는다. 새 ID의 파일만 만들고 폴더 레지스트리·기존 본문·히스토리를 변경하지 않는다. 앱과 동시에 폴더를 삭제하는 작업은 피하고 저장 직전에 대상 폴더를 확인한다. 외부 파일 자동 감시가 없어 앱에서 작성 중인 내용을 저장한 뒤 재시작해야 새 메모가 목록에 반영된다.

## 개념을 구현에 반영한 내용

| 사용자 개념 | 구현 |
|---|---|
| MORI가 시스템 지식의 원본 | 저장소 등록 없이 보관함 조회 |
| 코드 컨벤션부터 읽기 | 요청/서비스 기반 검색 후 원문 단계적 읽기 |
| 개발 가이드 폴더 강제하지 않기 | 폴더와 무관한 제목·본문 검색 |
| MSA도 자동으로 맥락 파악 | 공통→관계→서비스 선택 지침 |
| 문서 없으면 코드에서 작성 제안 | 재검색 후 코드 근거가 있는 초안 제안 |
| 결과를 무조건 다시 저장하지 않기 | 기본 조회, 검토·승인한 새 문서만 생성 |
| 토큰 절약 | 짧은 검색 후보, 필요한 원문만 페이지 단위 조회 |

## 검증과 남은 범위

`npm test -- Tests/mori-skill.test.ts`는 실제 Vault 구현으로 만든 임시 보관함에 CLI를 호출한다. 한국어 검색, 범위 필터, 페이지 읽기, 경로 우회와 심볼릭 링크 차단, 승인 내용/대상 변경, MORI 앱에서 새 문서 읽기·수정, 재시도·휴지통 보호를 확인한다.

자동 테스트는 에이전트의 의미 판단을 보장하지 않는다. 실제 Codex·Claude 세션에서 MSA 선택 품질과 승인 대화를 확인하는 사용 검증은 별도다. MCP, 의미 검색, 기존 메모 갱신, 실시간 앱 새로고침은 후속 범위다. 스킬 배포 버전은 0.1.0이며 앱 0.4.0 및 이전 DMG에 포함된 기능과 구분한다.
