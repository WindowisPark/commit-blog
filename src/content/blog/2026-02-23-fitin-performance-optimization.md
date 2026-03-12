---
title: "JPA N+1 쿼리 해결기: FitIn 프로젝트 성능 최적화 대수술"
description: "피트니스 플랫폼 FitIn의 전체 Repository에서 N+1 쿼리를 제거하고, DTO 구조를 개선한 성능 최적화 과정을 소개합니다."
pubDate: 2026-02-23
repo: fitin
repoDisplayName: FitIn
tags: ["fitin", "feature"]
commits: ["80e8e56ae3671454a682b69d18427b1c56323d74", "a1c33c852920b2d892e4f00e158743c3b9eb1c99"]
---
## N+1 쿼리, 이제 그만 보자

FitIn 프로젝트를 개발하면서 가장 골치 아픈 문제 중 하나가 **N+1 쿼리**였습니다. 특히 커뮤니티 기능이 늘어나면서 챌린지, 루틴, 다이어리 등 연관 엔티티들이 복잡하게 얽히자 쿼리 개수가 기하급수적으로 증가했죠.

로그를 보니 단순한 챌린지 목록 조회 하나에도 수십 개의 SELECT 쿼리가 날아가고 있었습니다. 이대로는 사용자가 늘어날수록 서비스가 느려질 게 뻔했습니다.

## 체계적인 접근: 우선순위별 최적화

무작정 **JOIN FETCH**를 남발하기보다는, 비즈니스 중요도에 따라 우선순위를 나누어 작업했습니다.

**HIGH 우선순위**로 분류한 것은 사용자 경험에 직접적 영향을 주는 핵심 기능들이었습니다. 챌린지 참여 목록이나 루틴 조회처럼 자주 호출되는 API들이죠.

```java
@Query("SELECT cp FROM ChallengeParticipation cp " +
       "JOIN FETCH cp.challenge c JOIN FETCH c.creator " +
       "JOIN FETCH cp.participant WHERE cp.participant = :participant")
List<ChallengeParticipation> findByParticipant(@Param("participant") Member participant);
```

가장 까다로웠던 건 **RoutineService.copyRoutine()** 메서드였습니다. 루틴을 복사할 때 루틴의 모든 운동 정보를 가져와야 하는데, 기존 `findById()`를 사용하면 루틴당 1+N번의 쿼리가 발생했습니다.

```java
@Query("SELECT r FROM Routine r " +
       "LEFT JOIN FETCH r.routineExercises re LEFT JOIN FETCH re.exercise " +
       "WHERE r.id = :id")
Optional<Routine> findByIdWithExercises(@Param("id") Long id);
```

이제 복사할 루틴의 모든 운동 데이터를 한 방에 가져올 수 있습니다.

## 페이지네이션과 JOIN FETCH의 딜레마

JOIN FETCH의 가장 큰 함정은 **페이지네이션과 함께 사용할 수 없다**는 점입니다. OneToMany 관계에서 JOIN FETCH를 사용하면 결과 행 수가 예측불가능해지기 때문이죠.

이 문제는 **@EntityGraph**로 해결했습니다:

```java
@EntityGraph(attributePaths = {"orderItems"})
Page<Order> findByMemberIdOrderByOrderDateDesc(Long memberId, Pageable pageable);
```

OrderRepository에서는 주문 목록을 페이지네이션할 때 주문 아이템들을 배치로 함께 로드하도록 설정했습니다. 페이지네이션은 유지하면서도 N+1 문제를 해결할 수 있었죠.

## Object[] 반환의 한계점

성능 최적화와 함께 또 다른 문제를 발견했습니다. 운동 통계를 조회하는 `getMemberStats()` 메서드가 **Object[] 배열**을 반환하고 있었던 것이죠.

```java
// 기존 방식
Object[] getStatsByMemberIdAndDateRange(Long memberId, LocalDateTime start, LocalDateTime end);
```

이런 방식은 타입 안정성이 떨어지고, 배열 인덱스로 값에 접근해야 해서 가독성도 나쁩니다. 더 중요한 건 컴파일 타임에 오류를 잡을 수 없다는 점이었죠.

**JPQL 생성자 표현식**을 활용해서 전용 DTO로 교체했습니다:

```java
@Query("SELECT new com.fitin.exercise.record.dto.MemberExerciseStatsDto(" +
       "SUM(er.duration), AVG(er.score), AVG(er.memberWeight), AVG(er.memberHeight)) " +
       "FROM ExerciseRecord er " +
       "WHERE er.member.id = :memberId AND er.date BETWEEN :start AND :end")
MemberExerciseStatsDto getStatsByMemberIdAndDateRange(
    @Param("memberId") Long memberId,
    @Param("start") LocalDateTime start,
    @Param("end") LocalDateTime end
);
```

이제 반환 타입이 명확해졌고, IDE의 자동완성 지원도 받을 수 있게 되었습니다.

## 최적화 결과와 교훈

이번 최적화로 **Challenge, Follow, Routine, Order, ExerciseRecord** 등 11개 Repository의 주요 메서드들을 모두 개선했습니다. 쿼리 개수는 대폭 줄었고, 응답 시간도 눈에 띄게 빨라졌습니다.

특히 중요한 교훈은 **연관 관계별로 다른 전략이 필요하다**는 점이었습니다. ManyToOne은 JOIN FETCH가 안전하지만, OneToMany는 페이지네이션 여부에 따라 @EntityGraph나 LEFT JOIN FETCH DISTINCT를 선택해야 합니다.

앞으로도 새로운 기능을 개발할 때는 처음부터 연관 관계와 쿼리 최적화를 고려해서 설계할 예정입니다. 성능은 나중에 최적화하는 게 아니라, 처음부터 고려해야 하는 필수 요소라는 걸 다시 한번 깨달았습니다.