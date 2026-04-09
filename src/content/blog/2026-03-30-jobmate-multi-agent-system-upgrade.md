---
title: "멀티에이전트 시스템에서 정적 라우팅을 넘어 동적 플래너로"
description: "JobMate 프로젝트에서 LLM 기반 플래너 도입과 의존성 체이닝으로 복잡한 워크플로우를 처리하는 방법을 소개합니다."
pubDate: 2026-03-30
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python", "react"]
commits: ["b917351338c30a6decdcfabd4a7dc6c679444e89"]
---
## 정적 라우팅의 한계를 만나다

취업 지원 멀티에이전트 시스템 **JobMate**를 운영하면서 흥미로운 문제에 부딪혔다. "채용공고 찾아주고 면접 준비도 도와줘"라는 사용자 요청이 들어왔을 때, 기존 정적 라우팅 방식으로는 적절한 처리가 어려웠다. 단순히 의도를 분류해서 하나의 에이전트에게 보내는 것이 아니라, **순서가 있는 멀티스텝 워크플로우**가 필요한 상황이었다.

이번 업그레이드에서는 정적 `INTENT_ROUTING`을 완전히 걷어내고, **LangGraph 기반의 동적 태스크 플래너**를 도입했다. 동시에 채용공고 스크래핑 성능을 개선하고, 멘탈케어 UX와 에이전트 모션 시스템도 대폭 강화했다.

## LLM 기반 플래너로 워크플로우 오케스트레이션

새로운 플래너는 사용자 의도를 분석해 **TaskStep** 배열을 생성한다. 각 스텝은 실행할 에이전트, 역할(primary/assist), 의존성 정보를 포함한다.

```python
class TaskStep(TypedDict):
    step_id: int
    agent_id: str
    role: Literal["primary", "assist"]
    action_hint: str
    depends_on: list[int]  # 선행 스텝 의존성
    tool_hint: str | None
```

흥미로운 점은 **Fast-path 최적화**를 적용한 것이다. 전체 요청의 80% 정도를 차지하는 단순 의도(`job_search`, `mental_care` 등)는 LLM 호출 없이 미리 정의된 계획을 사용한다. 복잡한 요청이나 높은 감정 강도 상황에서만 LLM 플래너를 호출하여 **응답 속도와 비용을 동시에 최적화**했다.

## 의존성 체이닝으로 컨텍스트 전달

LangGraph의 조건부 루프 구조를 활용해 `execute_step` ↔ `should_continue` 패턴을 구현했다. 각 스텝 실행 후 결과를 `step_results`에 저장하고, 후행 스텝에서 `depends_on`으로 참조할 수 있다.

```python
# 선행 결과를 컨텍스트에 주입
dep_context = ""
for dep_id in step.get("depends_on", []):
    dep_result = step_results.get(dep_id)
    if dep_result:
        dep_agent = get_agent_name(dep_id)
        dep_context += f"\n[{dep_agent}의 이전 응답]: {dep_result[:500]}\n"

enriched_state["user_message"] = (
    state["user_message"] + "\n\n--- 이전 단계 참고 정보 ---" + dep_context
)
```

이를 통해 "공고를 찾은 후 그 결과를 바탕으로 면접 준비"와 같은 **멀티스텝 워크플로우**를 자연스럽게 처리할 수 있게 되었다.

## 실시간 채용공고 스크래핑 시스템

기존 워크넷 API의 한계를 극복하기 위해 **원티드 JSON API + 사람인 HTML 스크래핑** 조합으로 전환했다. User-Agent 로테이션과 6시간 TTL 캐시를 적용해 차단 방지 및 성능을 개선했다.

사용자가 대화 중 언급하는 직무 선호도를 자동으로 감지해 `save_job_preferences` 도구로 저장하는 기능도 추가했다. "백엔드 개발자, 서울 지역"이라고 말하면 다음 검색부터는 이 선호도가 자동으로 적용된다.

```python
# 프리퍼런스 컨텍스트를 에이전트에 주입
if prefs:
    pref_lines = []
    if prefs.get("job_field"):
        pref_lines.append(f"관심 직무: {prefs['job_field']}")
    if prefs.get("location"):
        pref_lines.append(f"희망 근무지: {prefs['location']}")
    context += "사용자의 저장된 직무 선호도:\n" + "\n".join(pref_lines)
```

## 감정 인식 멘탈케어 시스템

**emotion_service**를 새로 도입해 사용자 감정 이력을 추적하고 패턴을 감지한다. "3회 연속 불안" 같은 요약을 생성해 하은 에이전트의 시스템 프롬프트에 주입하여 **맥락을 고려한 멘탈케어**가 가능해졌다.

프론트엔드에는 **BreathingExercise** 컴포넌트를 추가했다. 확대/축소하는 원과 타이머로 인터랙티브한 호흡 운동을 제공하며, WebSocket `tool_result` 이벤트를 통해 도구 실행 결과를 실시간으로 전달받는다.

## 에이전트 모션과 환경 반응성

오피스 뷰의 **에이전트 모션 시스템**을 완전히 리디자인했다. 10개 행동 타입(`searching`, `analyzing`, `breathing` 등)을 정의하고, 각각을 적절한 오피스 위치와 매핑했다. 검색할 때는 책상으로, 분석할 때는 화이트보드로, 호흡 운동 시에는 소파로 이동한다.

감정에 따른 **환경 오버레이**도 추가했다. 사용자가 불안할 때는 빨간 틴트, 희망적일 때는 황금빛 효과가 캔버스 전체에 적용되어 **감정적 몰입감**을 높였다.

## 아키텍처 진화의 의미

이번 업그레이드의 핵심은 **정적에서 동적으로의 전환**이다. 미리 정해진 규칙 기반 라우팅에서 벗어나 LLM이 상황에 맞는 최적의 실행 계획을 수립하도록 했다. 하지만 무작정 LLM에만 의존하는 것이 아니라 Fast-path를 통해 **성능과 지능성의 균형**을 맞췄다.

또한 단순한 요청-응답 패턴을 넘어 **의존성 있는 멀티스텝 워크플로우**를 지원함으로써, 실제 취업 준비 과정의 복잡성을 시스템이 이해하고 처리할 수 있게 되었다. 앞으로는 더 복잡한 장기 목표 설정과 진행 상황 추적 기능도 이 플래너 위에서 구현할 계획이다.