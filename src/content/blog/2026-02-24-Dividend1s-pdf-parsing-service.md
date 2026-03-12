---
title: "등기부등본 PDF를 JSON으로 변환하는 파싱 서비스 구축기"
description: "복잡한 등기부등본 문서를 구조화된 데이터로 변환하는 FastAPI 마이크로서비스를 만들면서 마주한 OCR 폴백과 정규표현식 파싱의 기술적 도전"
pubDate: 2026-02-24
repo: Dividend1s
repoDisplayName: 배당1초
tags: ["Dividend1s", "feature", "python"]
commits: ["a1ae23f03ab75c542ccddf5637d6e19083b31f1c"]
---
## 왜 등기부등본 파싱 서비스를 만들었나

배당1초 프로젝트에서 가장 까다로운 기술적 도전 중 하나는 등기부등본 PDF 파일을 읽어서 의미있는 데이터로 변환하는 것이었다. 부동산 투자 분석을 위해서는 근저당권, 전세권, 가압류 같은 권리 관계 정보가 필요한데, 이런 정보들이 모두 PDF 형태의 등기부등본에 담겨 있기 때문이다.

문제는 등기부등본이 표준화된 형태가 아니라는 점이었다. 지역마다, 시대마다 조금씩 다른 형식을 가지고 있고, 때로는 스캔된 이미지 PDF로 되어 있어서 일반적인 텍스트 추출로는 내용을 읽을 수 없는 경우도 있다.

## 텍스트 추출의 이중 폴백 전략

가장 먼저 해결해야 할 문제는 PDF에서 텍스트를 추출하는 것이었다. **pdfplumber**를 1차 도구로 선택했지만, 이미지 PDF에서는 텍스트를 읽을 수 없다는 한계가 있었다.

```python
async def extract_text(pdf_bytes: bytes) -> str:
    """PDF 바이트에서 텍스트 추출. 텍스트가 부족하면 OCR 폴백 실행."""
    text = _extract_with_pdfplumber(pdf_bytes)
    
    if len(text.strip()) < OCR_FALLBACK_THRESHOLD:
        logger.info(
            "추출 텍스트 %d자 — OCR 폴백 실행 (임계값: %d자)",
            len(text.strip()),
            OCR_FALLBACK_THRESHOLD,
        )
        from .ocr_service import extract_with_ocr
        text = await extract_with_ocr(pdf_bytes)
    
    return text
```

500자라는 임계값을 두고, 추출된 텍스트가 부족하면 자동으로 **OCR 폴백**을 실행하도록 설계했다. OCR도 이중 구조로 만들어서 **Tesseract**를 먼저 시도하고, 실패하면 Google Vision API로 넘어가는 방식이다.

## 갑구와 을구, 그리고 정규표현식의 마법

등기부등본은 크게 갑구(소유권 관계)와 을구(소유권 외 권리 관계)로 나뉘어 있다. 이 섹션들을 자동으로 분리하고, 각 권리 항목을 개별 데이터로 파싱하는 것이 핵심이었다.

```python
def _split_sections(text: str) -> tuple[str, str]:
    """갑구/을구 섹션 분리."""
    section_a_pat = re.compile(r"[【\[（(]\s*갑\s*구\s*[】\]）)]", re.IGNORECASE)
    section_b_pat = re.compile(r"[【\[（(]\s*을\s*구\s*[】\]）)]", re.IGNORECASE)
```

다양한 괄호 형태와 띄어쓰기 패턴을 모두 고려한 정규표현식을 만들어야 했다. 등기소마다 다른 형식을 사용하기 때문이다.

가장 복잡했던 부분은 각 권리 항목을 파싱하는 로직이었다. 접수번호, 접수일자, 등기원인 및 기타사항을 추출하면서 동시에 말소 여부까지 판단해야 했다.

```python
def _row_to_right_item(row: str, section_type: str, sort_order: int) -> Optional[RightItem]:
    """등기부 행 텍스트 → RightItem 변환."""
    reg_num_m = re.search(r"접수\s*번호\s*[:\s]*([0-9\-]+)", row)
    date_m = re.search(r"접수\s*일자\s*[:\s]*([0-9]{4}[./\-]?[0-9]{1,2}[./\-]?[0-9]{1,2})", row)
    cause_m = re.search(r"등기원인\s*및\s*기타사항\s*[:\s]*(.+)", row, re.DOTALL)
    
    # ... 파싱 로직
```

## 권리 유형 정규화의 필요성

등기부등본에는 '근저당권설정', '전세권이전', '가압류' 같은 다양한 권리 유형이 나타난다. 하지만 실제로는 이들을 몇 개의 표준 카테고리로 분류해야 데이터베이스에서 효율적으로 처리할 수 있다.

**rights_normalizer**를 만들어서 원문 표현을 표준 코드로 매핑하는 로직을 구현했다. 예를 들어 '근저당권설정', '근저당권이전', '근저당권말소'는 모두 'mortgage'라는 표준 코드로 변환된다.

이런 정규화 테이블을 미리 만들어둔 덕분에 프론트엔드에서는 일관된 형태의 데이터를 받을 수 있게 되었다.

## 마이크로서비스 아키텍처와 내부 인증

파싱 서비스는 **FastAPI**로 구축했고, 메인 Core API와 분리된 독립적인 마이크로서비스로 설계했다. 이렇게 분리한 이유는 PDF 파싱이 CPU 집약적인 작업이고, OCR 처리 시간도 상당히 오래 걸리기 때문이다.

내부 서비스 간 통신을 위해 **X-Internal-Token** 헤더 기반의 간단한 인증 시스템을 구현했다. 외부에서는 직접 접근할 수 없고, 오직 Core API를 통해서만 파싱 요청을 보낼 수 있도록 했다.

## Docker와 시스템 의존성 관리

OCR 기능을 위해서는 **Tesseract**와 한국어 언어팩이 필요하고, PDF를 이미지로 변환하기 위해서는 **poppler-utils**가 필요했다. 이런 시스템 레벨 의존성들을 깔끔하게 관리하기 위해 Docker를 활용했다.

```dockerfile
# 시스템 의존성: tesseract(OCR), poppler(pdf2image), 한국어 언어팩
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-kor \
    tesseract-ocr-eng \
    poppler-utils \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
```

**Poetry**를 사용해서 Python 의존성을 관리하고, 멀티 스테이지 빌드로 이미지 크기를 최적화했다.

## 테스트와 신뢰성 확보

등기부등본 파싱은 정확성이 생명이다. 잘못 파싱된 권리 관계 정보는 투자 결정에 치명적인 영향을 줄 수 있기 때문이다.

**pytest**를 활용해서 파서와 정규화 로직에 대한 단위 테스트를 작성했다. 특히 다양한 형식의 등기부등본 샘플을 fixtures로 준비해서 실제 데이터에 대한 파싱 결과를 검증할 수 있도록 했다.

## 앞으로의 과제

현재 구현된 파서는 기본적인 권리 관계 파싱에 집중되어 있다. 앞으로는 더 복잡한 케이스들 - 예를 들어 공동담보나 복잡한 권리 승계 관계 등을 처리할 수 있도록 개선해야 한다.

Google Vision API 연동도 아직 TODO 상태로 남아있다. 비용은 들지만 Tesseract보다 훨씬 정확한 한국어 OCR 결과를 얻을 수 있을 것으로 기대한다.

등기부등본 파싱 서비스를 구축하면서 문서 파싱의 복잡성과 마이크로서비스 아키텍처의 장점을 동시에 경험할 수 있었다. 특히 정규표현식과 텍스트 파싱 노하우가 많이 쌓인 프로젝트였다.