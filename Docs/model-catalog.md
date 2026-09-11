# 모델 목록 · MORI 0.5.1

설정 진입과 ‘모델 목록 새로고침’에서 목록을 다시 읽는다. 현재 선택은 새로고침으로 변경하지 않으며, 목록에 없는 기존 선택도 유지한다. 실제 모델 적용에는 설정 저장이 필요하다.

- Codex: CODEX_HOME 또는 ~/.codex의 models_cache.json에서 visibility=list인 모델을 읽는다. 숨겨진 모델과 중복·잘못된 항목은 제외한다. 캐시가 없거나 손상되면 Astra, Sol, Terra, Luna, GPT-5.5 기본 목록을 제공한다. 원격 모델 목록을 직접 조회하는 기능은 아니다. 새로운 목록은 Codex CLI 실행 후 다시 불러온다.
- Claude: 기본 모델과 haiku, sonnet, opus, fable 공식 별칭을 제공한다. 별칭이 실제 가리키는 버전은 설치된 CLI·제공자·설정에 따라 달라진다. CLI 실행 프로그램 업데이트는 수행하지 않는다. Fable은 추가 크레딧을 사용할 수 있어 선택지와 설명에 표시한다.
- OpenAI API: 기존 모델 선택지를 유지한다.

계정별 이용 권한은 목록 표시만으로 보장되지 않는다. 캐시 조회와 목록 새로고침은 메모를 전송하거나 AI를 실행하지 않는다.

확인 출처 (2026-09-11): [Codex 모델](https://learn.chatgpt.com/docs/models), [Claude 모델 설정](https://code.claude.com/docs/en/model-config). 이 기기의 Codex CLI 0.144.1 캐시와 Claude Code 2.1.263을 확인했다.
