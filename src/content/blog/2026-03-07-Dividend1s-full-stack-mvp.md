---
title: "법원 경매 배당분석 서비스 '배당1초' - V1 전체 아키텍처 구현기"
description: "복잡한 배당 계산 로직부터 결제 연동까지, 법원 경매 분석 서비스의 핵심 기능을 한 번에 구현한 과정을 소개합니다."
pubDate: 2026-03-07
repo: Dividend1s
repoDisplayName: 배당1초
tags: ["Dividend1s", "feature", "python", "react"]
commits: ["7104be2eaa4eaa55b68e382fee7508a04f5cbfe0"]
---
## 5순위 배당 알고리즘, 한 번에 구현하다

법원 경매에서 배당 순위를 계산하는 것은 생각보다 복잡한 문제입니다. 국세, 지방세, 근저당권, 임차보증금까지 다양한 권리관계가 얽혀있죠. 이번에 '배당1초' 서비스의 V1을 구현하면서 이 모든 복잡성을 **DividendRuleEngine**으로 해결했습니다.

가장 까다로운 부분은 소액임차인 우선변제 규칙이었습니다. 지역별로 다른 기준 금액, 최우선변제금과의 관계, 그리고 **BigDecimal**을 활용한 정확한 금액 계산까지 고려해야 했거든요.

```java
public class DividendRuleEngine {
    public DividendCalculationResult calculate(CalculationParams params) {
        // 5순위 배당 알고리즘
        // 1순위: 국세/지방세
        // 2순위: 소액임차인 최우선변제
        // 3순위: 근저당권
        // 4순위: 소액임차인 우선변제 (잔액)
        // 5순위: 일반채권
        
        BigDecimal remainingAmount = params.getExpectedWinningBid();
        List<DistributionItemResult> results = new ArrayList<>();
        
        // 각 순위별 계산 로직...
        return new DividendCalculationResult(results, calculationDetails);
    }
}
```

## 비동기 처리와 실시간 상태 추적

PDF 파싱부터 배당 계산까지의 전체 프로세스는 시간이 오래 걸리는 작업입니다. 사용자 경험을 위해 **@Async** 기반의 백그라운드 처리와 **Redis + SSE**를 활용한 실시간 상태 추적을 구현했습니다.

**AnalysisOrchestrator**가 전체 워크플로우를 관장합니다. Python 파싱 서비스 호출, 데이터 정규화, 배당 계산을 순차적으로 처리하면서 각 단계의 진행 상황을 Redis에 저장하죠.

```java
@Async
public void processAnalysisAsync(UUID analysisId, UUID userId, 
                               String documentUrl, CalculationParams params) {
    try {
        updateStatus(analysisId, "PARSING", "PDF 문서를 분석하고 있습니다...");
        
        // Python 파싱 서비스 호출
        ParsedRegistryDto parsedData = parsingServiceClient.parsePdf(documentUrl);
        
        updateStatus(analysisId, "CALCULATING", "배당 금액을 계산하고 있습니다...");
        
        // 배당 계산 실행
        DividendCalculationResult result = dividendRuleEngine.calculate(params);
        
        updateStatus(analysisId, "COMPLETED", "분석이 완료되었습니다.");
        
    } catch (Exception e) {
        updateStatus(analysisId, "FAILED", "분석 중 오류가 발생했습니다.");
    }
}
```

프론트엔드에서는 **Server-Sent Events**로 실시간 상태를 받아와 사용자에게 진행 상황을 보여줍니다. 단순한 polling보다 효율적이고, WebSocket보다 구현이 간단해서 선택했습니다.

## Next.js 14와 결제 연동까지

백엔드만으로는 완성이 아니죠. **Next.js 14**로 전체 프론트엔드를 구축하고, 파일 업로드부터 결제, 리포트 조회까지 전체 사용자 플로우를 완성했습니다.

특히 **Toss Payments API** 연동이 핵심이었습니다. 분석은 무료로 제공하지만, 상세 리포트는 유료로 판매하는 모델이거든요.

```typescript
// 결제 처리 훅
export const usePayment = () => {
  const processPayment = async (analysisId: string) => {
    const response = await fetch(`/api/payment/${analysisId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    const { paymentUrl } = await response.json();
    window.location.href = paymentUrl;
  };
  
  return { processPayment };
};
```

인증은 JWT 기반으로 구현했고, Zustand로 클라이언트 상태를 관리합니다. 미들웨어에서 보호된 라우트를 처리해서 로그인하지 않은 사용자는 자동으로 로그인 페이지로 리디렉션됩니다.

## 로컬 개발환경과 테스트 전략

복잡한 시스템일수록 개발환경 구축이 중요합니다. **docker-compose.dev.yml**로 PostgreSQL과 Redis를 한 번에 띄우고, **Flyway**로 데이터베이스 마이그레이션을 관리합니다.

특히 배당 계산 로직의 정확성이 핵심이라 **DividendRuleEngineTest**에서 6가지 시나리오를 철저히 검증했습니다. 실제 경매 사례를 바탕으로 한 테스트 케이스들이죠.

## 한 번의 커밋으로 V1 완성

이번 구현의 특별한 점은 모든 핵심 기능을 한 번의 커밋으로 완성했다는 것입니다. 백엔드 Rule Engine, 프론트엔드 UI, 결제 연동, 개발환경까지 전체 스택을 동시에 구축했죠.

물론 이런 접근은 리스크가 있습니다. 하지만 개념 검증(POC) 단계에서는 빠른 피드백이 더 중요하다고 판단했습니다. 실제로 작동하는 전체 시스템을 만들어서 사용자 반응을 확인하는 것이 우선이었거든요.

다음 단계에서는 각 모듈별 최적화와 에러 핸들링 강화에 집중할 예정입니다. 특히 대용량 PDF 처리 성능과 결제 실패 시나리오에 대한 보완이 필요하죠.

법원 경매라는 전문 도메인을 기술로 해결하는 과정은 정말 흥미진진했습니다. 복잡한 법적 규칙을 코드로 구현하고, 사용자 친화적인 서비스로 포장하는 전 과정을 경험할 수 있었거든요.