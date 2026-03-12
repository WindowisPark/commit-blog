---
title: "FitIn 프로젝트: 피트니스 플랫폼의 전면 리뉴얼 여정"
description: "Spring Boot 기반 피트니스 플랫폼 FitIn의 MVP에서 완전한 서비스로의 진화 과정을 담은 개발 스토리"
pubDate: 2024-11-07
repo: fitin
repoDisplayName: FitIn
tags: ["fitin"]
commits: ["96be5ef1453fa12b9ab1aa27ba0d24e7284c8315", "34ad0db1392e7575c3220036a2a7015bc99980f7", "f2583d404b3219ac471c2e7492560f1d90c1e690", "fe417e58616452155df039115bb43d67be8cdb7f", "00fcedff57f7cce0ec944d972b1b60d317430baa"]
---
## 프로젝트의 시작: 단순한 인증과 쇼핑몰에서

2024년 10월, **FitIn** 프로젝트는 가장 기본적인 형태로 세상에 첫발을 내딛었다. 초기 커밋에서 확인할 수 있듯이, 프로젝트는 회원 인증과 간단한 쇼핑몰 기능만을 갖춘 MVP 수준이었다.

```java
@Entity
public class Member {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false, unique = true)
    private String email;
    
    @Column(nullable = false)
    private String password;
}
```

당시의 Member 엔티티는 정말 기본적인 정보만을 담고 있었다. 하지만 이것이 큰 변화의 시작점이었다.

## 첫 번째 전환점: 보안과 확장성을 위한 기반 구축

10월 15일, 프로젝트는 첫 번째 큰 변화를 맞았다. **JWT 기반 인증 시스템**의 도입과 함께 아키텍처의 근본적인 개선이 이루어졌다.

가장 주목할 만한 변화는 데이터베이스 전환이었다. H2 인메모리 데이터베이스에서 **MySQL**로의 이전은 프로덕션 환경을 고려한 현실적인 선택이었다.

```java
@Entity
public class Member implements UserDetails {
    // 기존 필드들...
    
    @Column(nullable = false)
    private Double height; // 키 (cm)
    
    @Column(nullable = false)
    private Double weight; // 체중 (kg)
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MemberRole role;
    
    // UserDetails 구현
    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return Collections.singletonList(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }
}
```

회원 엔티티가 **Spring Security의 UserDetails**를 구현하게 되면서, 보안 체계가 한층 견고해졌다. 또한 피트니스 서비스답게 키와 체중 정보가 추가되어 서비스의 정체성이 명확해졌다.

## 운동과 소통: 핵심 기능의 등장

이 시기에 가장 흥미로운 추가는 **운동 관련 모듈**들이었다. ExerciseRecord, ExerciseSelection, VideoService 등이 도입되면서 단순한 쇼핑몰에서 진짜 피트니스 플랫폼으로 변모하기 시작했다.

특히 **WebSocket을 활용한 실시간 통신** 기능은 스마트 미러나 실시간 운동 지도 서비스를 염두에 둔 것으로 보였다. 이는 단순한 웹 서비스를 넘어 IoT와 연동된 피트니스 생태계를 구축하려는 야심찬 시도였다.

```java
@RestController
@RequestMapping("/api/video")
public class VideoController {
    @PostMapping("/upload")
    public ResponseEntity<String> uploadVideo(
            @RequestParam("file") MultipartFile file) {
        // 영상 업로드 처리
        return ResponseEntity.ok("Upload successful");
    }
}
```

## 리뉴얼의 완성: 종합 피트니스 플랫폼으로

11월 7일의 "리뉴얼 전 파일 업로드" 커밋은 프로젝트의 **결정적 전환점**이었다. 이때 추가된 기능들의 규모와 완성도는 놀라웠다.

### 커뮤니티 생태계의 구축

가장 인상적인 변화는 **커뮤니티 기능의 대폭 확장**이었다. 단순한 게시판을 넘어 Challenge 시스템, Diary 기능, Routine 공유, 그리고 **Gamification** 요소까지 도입되었다.

```java
@Entity
public class Challenge {
    @Column(nullable = false)
    private String name;
    
    @Column(length = 1000)
    private String description;
    
    @Column(nullable = false)
    private LocalDateTime startDate;
    
    @Column(nullable = false)
    private LocalDateTime endDate;
    
    @OneToMany(mappedBy = "challenge", cascade = CascadeType.ALL)
    private List<ChallengeParticipation> participations = new ArrayList<>();
}
```

챌린지 시스템은 사용자들이 함께 목표를 설정하고 달성해 나가는 **소셜 피트니스**의 핵심이었다. 여기에 포인트와 배지 시스템이 더해져 사용자의 지속적인 참여를 유도하는 구조가 완성되었다.

### 개인화된 경험의 제공

**Profile 시스템의 도입**으로 사용자는 자신만의 피트니스 공간을 가질 수 있게 되었다. Follow 시스템과 함께 SNS적 요소가 강화되어, 운동이 혼자만의 활동이 아닌 **커뮤니티 활동**으로 확장되었다.

## 기술적 성취와 도전

### 아키텍처의 진화

프로젝트의 패키지 구조 변화를 보면 개발팀의 성장을 엿볼 수 있다. 초기의 단순한 auth, shopping 패키지에서 시작해 community, profile, gamification 등으로 세분화된 구조는 **도메인 주도 설계(DDD)**의 영향을 받은 것으로 보인다.

```java
@EntityScan(basePackages = {
    "com.fitin.auth.entity", 
    "com.fitin.shopping.entity", 
    "com.fitin.exercise.selection.model",
    "com.fitin.exercise.record.model",
    "com.fitin.exercise.video",
    "com.fitin.profile.entity",
    "com.fitin.community.common.model",
    "com.fitin.community.diary.model",
    "com.fitin.community.routine.model",
    "com.fitin.community.challenge.model",
    "com.fitin.community.gamification.model"
})
```

### 보안과 안정성의 강화

**JWT 토큰 관리의 개선**과 함께 로깅 시스템이 강화되었다. 특히 인증 과정에서의 상세한 로그 기록은 보안 이벤트 추적과 디버깅에 큰 도움이 될 것이다.

## 미래를 향한 발걸음

**FitIn** 프로젝트의 여정은 현재진행형이다. 단순한 회원가입과 상품 구매에서 시작해 종합적인 피트니스 생태계로 발전한 이 과정은 많은 시사점을 제공한다.

특히 **점진적 개선**의 중요성을 보여준다. MVP로 시작해서 사용자 피드백과 기술적 요구사항을 반영하며 단계적으로 발전시킨 접근법은 현실적이면서도 효과적이었다.

앞으로 **AI 기반 운동 추천**, **실시간 폼 체크**, **영양 관리** 등의 기능이 추가된다면, FitIn은 정말로 혁신적인 피트니스 플랫폼이 될 수 있을 것이다. 개발팀의 다음 행보가 기대된다.