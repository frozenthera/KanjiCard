# JLPT Kanji Cards 웹 배포 계획

작성일: 2026-06-29
상태: v1 구현 골격 반영됨

## 현재 구현 상태

완료:

- Firebase 설정 파일 자리(`web/firebase-config.js`, `web/firebase-config.example.js`)
- 로그인 게이트 UI와 앱 초기화 흐름
- Firebase Auth Google popup 로그인 연결
- Firestore 기반 사용자별 progress/settings 저장 어댑터
- Firestore rules 초안
- vocab allowlist seed 스크립트
- GitHub Pages Actions 배포 workflow
- README 배포 절차
- 로컬 회귀 테스트

아직 사용자가 직접 해야 하는 작업:

- Firebase 프로젝트 생성
- Google provider 활성화
- Firestore 생성
- Firebase authorized domains 설정
- `web/firebase-config.js` 또는 GitHub repository variables에 Firebase web config 입력
- `vocab/{wordId}` seed 업로드
- Firestore rules 배포
- GitHub Pages 활성화 및 첫 production smoke test

## 결론

v1 배포는 다음 구성이 가장 적합하다.

- 정적 웹 호스팅: GitHub Pages
- 로그인: Firebase Authentication Google provider
- 사용자별 진행 저장: Cloud Firestore
- 개발/검증: localhost + Firebase Emulator
- EC2: v1 기본 배포처가 아니라, 나중에 자체 API나 서버 검증이 필요할 때의 fallback

이 프로젝트는 현재 `web/` 아래의 정적 HTML/CSS/JavaScript 앱이다. 따라서 단순 배포만 보면 GitHub Pages가 가장 운영 부담이 낮다. 다만 GitHub Pages는 서버 코드와 데이터베이스를 제공하지 않으므로, Google 로그인과 사용자별 진행 저장은 Firebase Auth와 Firestore가 담당한다.

## 현재 상태

- `web/index.html`, `web/app.js`, `web/styles.css` 중심의 정적 웹 앱이다.
- Android 앱은 같은 `web/` 파일을 WebView asset으로 패키징한다.
- 현재 진행 정보는 `localStorage`의 `jlpt-kanji-cards.progress`에 저장된다.
- 현재 앱은 로그인 없이 바로 세션을 시작한다.
- 요구사항상 앞으로는 Google 로그인 사용자인 경우에만 단어 카드가 제시되어야 한다.

## 배포 옵션 판단

### GitHub Pages

추천 기본안.

장점:
- 정적 앱 배포에 적합하다.
- 서버 운영, OS 패치, TLS 인증서 관리 부담이 거의 없다.
- GitHub Actions로 테스트 후 자동 배포하기 쉽다.

주의:
- 서버 코드나 DB를 실행할 수 없다.
- Firebase Auth authorized domain에 GitHub Pages 도메인을 등록해야 한다.
- 첫 버전은 Firebase `signInWithPopup()` 방식이 단순하다.

### AWS EC2

가능하지만 v1 기본안으로는 비추천.

쓸 만한 경우:
- 이미 EC2를 반드시 써야 하는 비용/계정 사유가 있다.
- 나중에 Node/Express API, 관리자 기능, 서버 검증, 별도 DB를 운영할 계획이 있다.
- reverse proxy, 서버 로그, private network 같은 서버 제어가 필요하다.

추가 책임:
- security group 설정
- HTTPS 인증서와 자동 갱신
- OS 패치
- 서버 모니터링
- 장애 대응
- 배포 자동화

### localhost

운영 배포가 아니라 개발/테스트 용도다.

용도:
- `node server.js`로 로컬 실행
- Firebase Emulator로 Auth/Firestore rules 테스트
- Google 로그인 개발 도메인 검증

## 최종 아키텍처

```text
사용자 브라우저
  -> GitHub Pages 정적 파일
  -> Firebase Auth로 Google 로그인
  -> Firestore에 사용자별 진행 저장
```

Firestore 구조:

```text
vocab/{wordId}
  - 서버 소유 단어 allowlist
  - 클라이언트 쓰기 금지

system/vocabVersion
  - vocab seed checksum/version
  - 배포 후 stale cache 검증용

users/{uid}
  - 최소 사용자 메타데이터
  - email/displayName은 v1에서 저장하지 않음

users/{uid}/settings/current
  - levels
  - newWordRatio
  - sessionSize
  - updatedAt

users/{uid}/wordStats/{wordId}
  - seenCount
  - correctCount
  - wrongCount
  - correctStreak
  - totalThinkMs
  - avgThinkMs
  - lastThinkMs
  - lastSeenAt
  - lastResult
  - updatedAt

users/{uid}/history/{eventId}
  - 최근 풀이 이벤트
```

## 보안 원칙

1. 로그인 전에는 단어 카드를 보여주지 않는다.
2. 모든 진행 데이터 경로는 `users/{uid}` 아래로 제한한다.
3. Firestore rules에서 `request.auth.uid == uid`를 강제한다.
4. `wordStats/{wordId}` 쓰기는 `vocab/{wordId}`가 존재할 때만 허용한다.
5. 단어 진행 쓰기는 한 번의 카드 결과 단위로만 허용한다.
6. 큰 counter jump, unknown wordId, schemaVersion 변조, 예상 밖 field를 거부한다.
7. `avgThinkMs`는 표시용 derived 값으로 취급한다.
8. v1에서는 기존 `localStorage` 진행 정보 자동 import를 지원하지 않는다.

## 구현 단계

### 1. 상태 저장 로직 분리

목표:
- 현재 `localStorage` 직접 읽기/쓰기를 storage adapter로 분리한다.

작업:
- `LocalProgressStore` 작성
- progress mutation 로직을 테스트 가능한 함수로 분리
- 기존 `npm test`가 계속 통과하도록 유지

완료 기준:
- 기존 학습 동작이 바뀌지 않는다.
- `npm test` 통과

### 2. Firebase 설정 추가

목표:
- Auth/Firestore를 사용할 준비를 한다.

작업:
- Firebase 프로젝트 생성
- Authentication에서 Google provider 활성화
- Firestore 생성
- Firebase config 추가
- Firebase Emulator 설정
- Firestore rules 파일 작성

완료 기준:
- localhost에서 Firebase 초기화 가능
- emulator rules 테스트 가능

### 3. 로그인 게이트 구현

목표:
- 로그인하지 않은 사용자는 단어를 받을 수 없게 한다.

작업:
- topbar에 로그인/로그아웃 UI 추가
- auth loading, signed out, signed in, error 상태 추가
- `startSession()`을 auth + remote progress load 이후에만 실행
- signed out 상태에서는 study card를 표시하지 않음

완료 기준:
- 로그아웃 상태에서 실제 단어가 보이지 않는다.
- Google 로그인 후에만 첫 세션이 시작된다.
- 로그아웃하면 in-memory progress가 초기화되고 로그인 화면으로 돌아간다.

### 4. Firestore 진행 저장 구현

목표:
- 사용자별 진행을 원격 저장한다.

작업:
- `RemoteProgressStore` 작성
- `loadUserState(uid)`
- `saveSettings(uid, settings)`
- `recordAnswer(uid, answerDelta)`
- `resetProgress(uid)`
- `vocab/{wordId}` seed 스크립트 작성
- `system/vocabVersion` checksum/version seed

쓰기 계약:
- known 결과:
  - `seenCount +1`
  - `correctCount +1`
  - `wrongCount +0`
  - `correctStreak +1`
  - `lastResult = "known"`
- unknown 결과:
  - `seenCount +1`
  - `wrongCount +1`
  - `correctCount +0`
  - `correctStreak = 0`
  - `lastResult = "unknown"`
- 같은 세션에서 틀린 뒤 나중에 맞힌 카드는 현재 로컬 동작처럼 전역 correct count를 한 번 더 올리지 않는다.

완료 기준:
- 새로고침 후에도 같은 Google 계정의 진행이 남아 있다.
- 다른 Google 계정은 서로의 진행을 볼 수 없다.
- reset은 본인 progress/history만 삭제한다.

### 5. Firestore rules와 테스트

목표:
- UI가 아니라 rules로 데이터 격리를 보장한다.

테스트해야 할 항목:
- 비로그인 read/write 거부
- 본인 progress read/write 허용
- 타인 progress read/write 거부
- unknown 또는 malformed `wordId` 거부
- client의 `vocab` write 거부
- 큰 counter jump 거부
- 예상 밖 field 거부
- schemaVersion/client metadata 변조 거부
- invalid timestamp 거부
- reset이 본인 progress/history에만 동작

완료 기준:
- Firestore emulator rules 테스트 통과
- production rules에 임시 전체 허용 규칙이 없다.

### 6. GitHub Pages 배포

목표:
- GitHub Pages에서 HTTPS production URL을 만든다.

작업:
- GitHub Actions workflow 작성
- 테스트 실행
- `web/` 또는 bundler 사용 시 `dist/` artifact 배포
- artifact에 `.nojekyll` 포함
- Firebase Auth authorized domains에 production domain 추가
- `vocab` seed -> Firestore rules 배포 -> web asset 배포 순서로 release

완료 기준:
- production URL이 HTTPS로 열린다.
- Google 로그인 popup이 동작한다.
- `data/vocab.js`, manifest, service worker가 정상 로드된다.
- 로그아웃 상태에서는 단어가 보이지 않는다.
- 로그인 후 답변 기록이 Firestore에 저장된다.
- 새로고침 후 진행이 유지된다.

### 7. EC2 fallback 체크리스트

EC2를 선택해야 할 경우에만 수행한다.

필수 작업:
- custom domain 연결
- HTTPS 설정 및 자동 갱신
- Nginx/Caddy/Apache 설정
- security group은 80/443만 public 허용
- SSH는 admin IP 또는 SSM Session Manager로 제한
- GitHub Actions 또는 별도 스크립트로 배포 자동화
- 서버 로그 rotation
- CloudWatch 등 모니터링
- OS patching 정책
- rollback 방법

## v1에서 하지 않는 것

- 기존 `localStorage` 진행 자동 import
- Android WebView Google 로그인 동기화
- 자체 Node/Express 백엔드
- EC2 기반 custom API
- 관리자 대시보드
- 결제/상용 SaaS 수준의 progress integrity 검증

## 검증 순서

1. `npm test`
2. Firebase Emulator rules test
3. localhost에서 Google 로그인 테스트
4. localhost에서 진행 저장/새로고침 복구 테스트
5. GitHub Pages preview/production 배포
6. production에서 로그인/저장/격리 smoke test
7. service worker cache update 확인

## 최종 수용 기준

- Google 로그인하지 않은 사용자는 단어 카드를 받을 수 없다.
- Google 로그인 사용자는 단어 학습을 진행할 수 있다.
- 진행 정보는 사용자별로 Firestore에 저장된다.
- 같은 계정으로 다시 접속하면 진행 정보가 유지된다.
- 다른 계정은 서로의 진행 정보를 볼 수 없다.
- Firestore rules 테스트가 통과한다.
- GitHub Pages production URL에서 정상 동작한다.
- EC2는 fallback으로 문서화되어 있고 v1 기본 배포 경로가 아니다.
