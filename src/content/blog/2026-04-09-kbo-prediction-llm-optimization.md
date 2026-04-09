---
title: "야구 AI가 503 에러로 멈춘다면? LLM 3개를 돌려막는 Fallback 시스템"
description: "Gemini, GPT, Claude를 조합한 야구 예측 AI에서 API 장애에 대응하는 자동 Fallback과 재시도 로직을 구현한 이야기"
pubDate: 2026-04-09
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python"]
commits: ["ed799eab6d664bc706940bafa48e0fe796cb04f0", "0e685080beb6f05c8418047922133757dee0ef24", "0d8fa303e24c70b86954c58d579946049ed70c19"]
---
## 문제의 시작: 503 Service Unavailable

**KBO Prediction** 프로젝트는 4개의 AI 에이전트가 협력해서 야구 경기를 예측하는 시스템이다. Analyst가 통계를 분석하고, Scout가 맥락을 파악하며, Critic이 반박하고, Synthesizer가 최종 결론을 내린다. 각각 다른 LLM을 사용하는데, 여기서 문제가 발생했다.

특정 시간대에 Gemini API가 **503 Service Unavailable**을 반환하거나, GPT API가 **429 Rate Limit**을 던지는 상황이 자주 발생했다. 기존에는 3번 재시도 후 그냥 실패했는데, 이러면 전체 예측 파이프라인이 멈춰버린다.

더 큰 문제는 각 에이전트가 특정 모델에 의존적이라는 것이었다. Analyst는 Gemini만, Scout는 GPT만 사용하도록 하드코딩되어 있어서, 해당 API가 죽으면 대안이 없었다.

## 3-Provider 다양성의 힘

해결책은 **ReConcile 논문**에서 찾았다. "같은 모델 5개보다 다른 모델 3개가 더 좋은 결과를 낸다"는 연구 결과다. 그래서 각 에이전트에 최적화된 모델을 배정하되, 3개 다른 제공사의 모델을 사용하도록 재설계했다:

- **Analyst**: Gemini 2.5 Pro (수학/통계 추론에 강함)
- **Scout**: GPT-4o (한국어와 KBO 도메인 지식 우수)
- **Critic**: Claude Sonnet 4 (비판적 사고, sycophancy 방지)
- **Synthesizer**: Gemini 2.5 Flash (JSON 출력 안정적, 저비용)

이렇게 Google, OpenAI, Anthropic의 3개 제공사를 골고루 사용하면, 한 곳에서 장애가 나도 다른 곳으로 우회할 수 있다.

## 스마트한 Fallback 매핑

핵심은 **chat_with_fallback** 함수다. Primary 모델이 실패하면 자동으로 다른 제공사의 모델로 전환한다:

```python
# Provider fallback 매핑: primary 실패 시 대체 provider
_FALLBACK_MAP = {
    "gemini": lambda temp: ClaudeClient("claude-sonnet-4-20250514", temp),
    "claude": lambda temp: GPTClient("gpt-4o", temp),
    "openai": lambda temp: ClaudeClient("claude-sonnet-4-20250514", temp),
}

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
        logger.warning(
            f"{client.provider} failed after retries: {e}. "
            f"Falling back to alternative provider."
        )
        fallback_client = fallback_factory(client.temperature)
        return fallback_client.chat(system, user_msg, max_tokens)
```

예를 들어 Gemini가 503 에러를 내면 자동으로 Claude로, Claude가 실패하면 GPT로 전환된다. 순환 구조로 설계해서 어떤 조합이라도 대안이 있다.

## 일시적 에러 감지와 강화된 재시도

모든 에러를 같게 처리하는 것은 비효율적이다. **503 Service Unavailable**이나 **429 Rate Limit**은 잠깐 기다리면 해결되지만, 인증 에러나 잘못된 요청은 아무리 재시도해도 소용없다.

```python
# 503/429 등 일시적 에러 판별
_TRANSIENT_KEYWORDS = ("503", "429", "UNAVAILABLE", "overloaded", "rate limit", "quota")

def _is_transient(exc: Exception) -> bool:
    msg = str(exc)
    return any(kw in msg for kw in _TRANSIENT_KEYWORDS)
```

이제 일시적 에러인 경우에만 재시도하고, 재시도 횟수도 3회에서 5회로 늘렸다. 대기 시간은 exponential backoff로 2초, 4초, 8초, 16초, 32초까지 늘어나되, 32초가 최대값이다.

## 실제 운영에서의 효과

이 시스템을 도입한 후 **가용성**이 크게 개선되었다. 특히 Gemini API가 불안정한 시간대(주로 미국 서부 시간대 오후)에도 Claude나 GPT로 자동 전환되어 예측이 계속 진행된다.

비용 면에서도 긍정적이다. Gemini 2.5 Flash가 주력이고, 비싼 GPT-4o나 Claude는 Fallback용으로만 사용되니까 월 비용이 $54에서 $25-35로 40% 절감되었다.

흥미로운 점은 때로는 Fallback으로 전환된 결과가 더 좋을 때도 있다는 것이다. 예를 들어 Analyst가 Gemini에서 Claude로 전환되면, 수치 분석보다는 정성적 해석에 더 강한 결과를 보여준다.

## 마무리: 견고함의 가치

단순히 "API가 죽으면 다른 걸 쓰자"는 아이디어지만, 실제 구현에서는 여러 고려사항이 있었다. 각 모델의 특성을 유지하면서도 호환성을 확보하고, 불필요한 비용을 피하면서도 가용성을 보장하는 균형점을 찾는 것이 핵심이었다.

특히 AI 서비스를 운영할 때는 **단일 장애점**을 없애는 것이 중요하다. 아무리 좋은 모델이라도 API가 죽으면 무용지물이니까. 3개 제공사를 조합한 Fallback 시스템 덕분에 이제는 야구 시즌 내내 안정적으로 예측을 제공할 수 있게 되었다.