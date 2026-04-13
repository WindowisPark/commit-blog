---
title: "KBO 예측 시스템의 안정성 확보하기: LLM Provider Fallback 구현기"
description: "멀티 LLM 환경에서 발생하는 API 장애와 트래픽 급증에 대응하기 위해 자동 fallback 시스템을 구축한 과정을 소개합니다."
pubDate: 2026-04-09
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python"]
commits: ["ed799eab6d664bc706940bafa48e0fe796cb04f0"]
---
## 문제의 발견: 예측 시스템의 치명적 약점

**KBO 예측 시스템**을 운영하면서 가장 골치 아픈 문제 중 하나는 LLM API의 불안정성이었습니다. 경기 시작 직전 예측을 요청하는 사용자들이 몰리면 Gemini API가 503 에러를 뱉어내고, GPT-4는 429 Rate Limit에 걸리기 일쑤였죠. 

특히 야구 시즌 중 주말 경기가 시작되기 전에는 트래픽이 집중되면서 단일 provider에 의존하는 구조의 한계가 명확하게 드러났습니다. 사용자는 "서비스 일시 중단" 메시지를 보고 떠나갔고, 이는 곧 비즈니스 크리티컬한 문제가 되었습니다.

## 멀티 LLM 아키텍처의 설계 철학

우리 시스템은 각 에이전트별로 최적화된 LLM을 사용하는 구조입니다:

- **Analyst**: Gemini 2.5 Pro (수학적 추론 능력)
- **Scout**: GPT-4o (한국어 처리와 KBO 도메인 지식)
- **Critic**: Claude Sonnet (편향성 없는 비판적 분석)
- **Synthesizer**: Gemini 2.5 Flash (안정적인 JSON 파싱)

하지만 각 에이전트가 특정 provider에만 의존한다면, 해당 API가 다운되는 순간 전체 예측 파이프라인이 멈춰버리는 단일 장애점이 됩니다. ReConcile 논문에서 제시한 "서로 다른 모델 3개가 같은 모델 5개보다 낫다"는 원칙을 지키면서도, 가용성을 확보할 방법이 필요했습니다.

## Transient Error Detection: 똑똑한 재시도 로직

먼저 해결해야 할 것은 "언제 재시도하고, 언제 포기할 것인가"의 문제였습니다. 모든 에러에 대해 무작정 재시도하는 것은 비효율적이고, 영구적인 설정 오류까지 재시도하면 시간만 낭비합니다.

```python
# 503/429 등 일시적 에러 판별
_TRANSIENT_KEYWORDS = ("503", "429", "UNAVAILABLE", "overloaded", "rate limit", "quota")

def _is_transient(exc: Exception) -> bool:
    msg = str(exc)
    return any(kw in msg for kw in _TRANSIENT_KEYWORDS)
```

이제 시스템은 503 Service Unavailable이나 429 Too Many Requests 같은 **일시적 에러**만 재시도하고, API 키 오류 같은 영구적 문제는 즉시 실패 처리합니다. 재시도 횟수도 3회에서 5회로 늘렸고, exponential backoff with cap을 적용해 32초를 넘지 않도록 제한했습니다.

## Fallback Chain: 자동 우회 경로 구축

재시도로도 해결되지 않는 상황을 위해 **자동 fallback 시스템**을 구현했습니다. 핵심 아이디어는 각 provider가 실패할 때 다른 provider로 자동 전환하는 것입니다:

```python
# Provider fallback 매핑: primary 실패 시 대체 provider
_FALLBACK_MAP = {
    "gemini": lambda temp: ClaudeClient("claude-sonnet-4-20250514", temp),
    "claude": lambda temp: GPTClient("gpt-4o", temp),
    "openai": lambda temp: ClaudeClient("claude-sonnet-4-20250514", temp),
}
```

fallback 체인의 설계에는 특별한 고려사항이 있었습니다. Gemini가 실패하면 Claude로, Claude가 실패하면 GPT로, GPT가 실패하면 다시 Claude로 전환됩니다. 순환 참조를 피하면서도 가장 안정적인 대안을 제공하려는 전략입니다.

## 실제 구현: 투명한 fallback 래퍼

기존 코드 변경을 최소화하면서 fallback 기능을 추가하기 위해 `chat_with_fallback` 함수를 만들었습니다:

```python
def chat_with_fallback(client, system: str, user_msg: str, max_tokens: int = 1024) -> str:
    """Primary client로 호출 시도, 실패 시 다른 provider로 fallback."""
    try:
        return client.chat(system, user_msg, max_tokens)
    except Exception as e:
        provider_key = client.provider.split("/")[0]  # "gemini", "openai", "anthropic"
        if provider_key == "anthropic":
            provider_key = "claude"
        fallback_factory = _FALLBACK_MAP.get(provider_key)
        if fallback_factory is None:
            raise
        logger.warning(f"{client.provider} failed after retries: {e}. Falling back to alternative provider.")
        fallback_client = fallback_factory(client.temperature)
        return fallback_client.chat(system, user_msg, max_tokens)
```

이 함수는 기존의 `client.chat()` 호출을 감싸는 형태로 동작하므로, debate.py에서는 단 세 줄만 변경하면 됐습니다.

## 운영 관점에서의 개선사항

이번 개선으로 얻은 것은 단순한 안정성 향상 이상입니다:

**가용성 향상**: 단일 provider 장애 시에도 서비스 지속 가능
**사용자 경험**: 투명한 fallback으로 사용자는 장애를 인지하지 못함
**운영 효율성**: 수동 개입 없이 자동 복구되는 시스템
**비용 최적화**: 트래픽을 여러 provider에 분산하여 rate limit 회피

또한 pandas DtypeWarning도 함께 해결했습니다. `low_memory=False` 옵션을 추가하여 대용량 feature CSV 파일을 읽을 때 발생하는 데이터 타입 추론 경고를 제거했습니다.

## 마무리: 견고한 시스템을 위한 선택

**LLM API의 불안정성**은 이제 AI 서비스에서 피할 수 없는 현실입니다. 중요한 것은 이런 상황을 예상하고 미리 대비책을 마련하는 것입니다. 

이번 fallback 시스템 구축을 통해 KBO 예측 서비스는 단일 장애점을 제거하고, 사용자에게 더욱 안정적인 경험을 제공할 수 있게 되었습니다. 무엇보다 각 에이전트의 고유한 특성을 유지하면서도 가용성을 확보했다는 점에서 의미가 있습니다.

다음 스텝으로는 fallback 발생 패턴을 분석해서 provider별 신뢰도 점수를 매기고, 동적으로 우선순위를 조정하는 시스템을 고려하고 있습니다.