# 수동 배포 준비 체크리스트

작성일: 2026-06-29

이 문서는 코드로 자동 처리할 수 없고, Firebase Console/GitHub 설정/계정 권한이 필요한 작업만 정리한다.

## 0. GitHub와 Firebase에 올라가는 것 구분

### GitHub repository에 commit/push할 것

아래 파일들은 GitHub repository에 그대로 올라가야 한다.

앱 코드:

```text
web/index.html
web/app.js
web/styles.css
web/service-worker.js
web/manifest.webmanifest
web/data/vocab.js
web/firebase-config.js
web/firebase-config.example.js
```

주의:

- `web/firebase-config.js`는 repository에서는 기본값 `JLPT_FIREBASE_CONFIG = null` 상태로 둔다.
- production용 Firebase 값은 GitHub Actions가 repository variables로부터 배포 시점에 생성한다.
- Firebase service account key, deploy token, OAuth access token은 GitHub에 올리지 않는다.

Firebase/배포 설정 코드:

```text
firebase.json
firestore.rules
firestore.indexes.json
.firebaserc.example
.github/workflows/pages.yml
```

도구/테스트/문서:

```text
tools/seed-firestore-vocab.js
tests/app-regression.test.js
package.json
README.md
WEB_DEPLOYMENT_PLAN.md
DEPLOYMENT_MANUAL_STEPS.md
```

GitHub Pages에 실제로 배포되는 artifact:

```text
web/
```

GitHub Actions가 배포 중 `web/firebase-config.js`를 production 값으로 덮어쓴 뒤 `web/` 폴더를 GitHub Pages artifact로 업로드한다.

### Firebase에 배포/업로드할 것

Firebase에는 GitHub repository 전체를 올리는 것이 아니다. 아래 리소스만 Firebase 프로젝트에 반영한다.

Firestore rules:

```text
firestore.rules
firestore.indexes.json
```

배포 명령:

```powershell
firebase deploy --only firestore:rules,firestore:indexes
```

Firestore seed data:

```text
vocab/{wordId}
system/vocabVersion
```

생성/업로드 명령:

```powershell
npm run seed:vocab
```

환경변수로 프로젝트와 access token을 넣으면 Firestore REST API로 업로드한다.

```powershell
$env:FIREBASE_PROJECT_ID="YOUR_FIREBASE_PROJECT_ID"
$env:GOOGLE_OAUTH_ACCESS_TOKEN="PASTE_ACCESS_TOKEN"
npm run seed:vocab
```

Firebase Console에서 직접 설정할 것:

```text
Authentication -> Google provider enabled
Authentication -> Authorized domains
Firestore Database created
```

### GitHub repository variables에만 넣을 것

아래 값들은 코드 파일에 직접 넣지 말고 GitHub repository variables에 넣는다.

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_SDK_BASE
```

GitHub Actions가 이 값들로 production `web/firebase-config.js`를 생성한다.

### 어디에도 올리면 안 되는 것

아래 값들은 GitHub에도 Firebase client 코드에도 넣지 않는다.

```text
Firebase service account JSON
Firebase deploy token
Google OAuth access token
gcloud credential files
private SSH key
EC2 pem key
```

필요할 때만 로컬 환경변수나 GitHub Secrets를 사용한다. 현재 Pages workflow는 service account 없이 GitHub Pages 배포만 하므로 service account secret이 필요하지 않다.

## 1. Firebase 프로젝트 생성

1. Firebase Console에 접속한다.
2. 새 프로젝트를 생성한다.
3. 프로젝트 ID를 기록한다.

기록할 값:

```text
FIREBASE_PROJECT_ID=
```

## 2. Firebase Authentication 설정

1. Firebase Console에서 Authentication으로 이동한다.
2. Sign-in method에서 Google provider를 활성화한다.
3. 지원 이메일을 선택한다.
4. Authorized domains에 아래 도메인을 추가한다.

필수:

```text
localhost
<github-owner>.github.io
```

커스텀 도메인을 사용할 경우 추가:

```text
your-domain.example
```

주의:

- GitHub Pages 기본 주소가 `https://<github-owner>.github.io/<repo-name>/` 형태여도 authorized domain에는 보통 host인 `<github-owner>.github.io`를 등록한다.
- EC2를 나중에 쓸 경우 raw IP가 아니라 custom domain을 연결하고 그 domain을 등록한다.

## 3. Firebase Web App 생성

1. Firebase Console에서 Project settings로 이동한다.
2. Your apps 섹션에서 Web app을 추가한다.
3. 앱 닉네임을 입력한다. 예: `jlpt-kanji-cards-web`
4. Firebase config 값을 복사한다.

GitHub repository variables에 넣을 값:

```text
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
```

선택:

```text
FIREBASE_SDK_BASE=https://www.gstatic.com/firebasejs/10.12.5
```

## 4. Firestore 생성

1. Firebase Console에서 Firestore Database로 이동한다.
2. 데이터베이스를 생성한다.
3. production mode로 시작한다.
4. region을 선택한다.

권장:

- 주 사용자가 한국이면 가까운 Asia region을 선택한다.
- region은 나중에 바꾸기 어렵다.

## 5. Firebase CLI 준비

로컬에 Firebase CLI가 없다면 설치한다.

```powershell
npm install -g firebase-tools
firebase login
```

프로젝트 루트에서 `.firebaserc`를 만든다.

```json
{
  "projects": {
    "default": "YOUR_FIREBASE_PROJECT_ID"
  }
}
```

참고 파일:

```text
.firebaserc.example
```

## 6. Firestore rules 배포

프로젝트 루트에서 실행한다.

```powershell
firebase deploy --only firestore:rules,firestore:indexes
```

배포 전 확인할 파일:

```text
firestore.rules
firestore.indexes.json
firebase.json
```

## 7. vocab allowlist seed 업로드

Firestore rules는 `vocab/{wordId}`가 존재하는 단어만 진행 저장을 허용한다. 따라서 웹 앱 배포 전 vocab seed가 먼저 들어가야 한다.

먼저 seed JSON을 생성한다.

```powershell
npm run seed:vocab
```

생성 파일:

```text
dist/firestore-vocab-seed.json
```

직접 업로드하려면 Google OAuth access token이 필요하다.

```powershell
gcloud auth application-default login
gcloud auth print-access-token
```

또는 gcloud CLI가 일반 로그인으로 설정되어 있다면:

```powershell
gcloud auth login
gcloud auth print-access-token
```

PowerShell에서 실행:

```powershell
$env:FIREBASE_PROJECT_ID="YOUR_FIREBASE_PROJECT_ID"
$env:GOOGLE_OAUTH_ACCESS_TOKEN="PASTE_ACCESS_TOKEN"
npm run seed:vocab
```

완료 후 Firebase Console에서 아래 문서가 있는지 확인한다.

```text
system/vocabVersion
vocab/n5-0001
vocab/n4-...
```

## 8. GitHub repository variables 설정

GitHub repository로 이동한다.

```text
Settings -> Secrets and variables -> Actions -> Variables
```

아래 repository variables를 추가한다.

필수:

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
```

선택:

```text
FIREBASE_SDK_BASE
```

주의:

- 이 값들은 Firebase web config다.
- service account key나 Firebase deploy token을 repository variable에 넣지 않는다.

## 9. GitHub Pages 활성화

GitHub repository에서:

```text
Settings -> Pages
```

Source를 GitHub Actions로 설정한다.

현재 workflow:

```text
.github/workflows/pages.yml
```

workflow는 다음을 수행한다.

1. checkout
2. Node 22 설정
3. `npm test`
4. `npm run seed:vocab`
5. Firebase repository variables 확인
6. production `web/firebase-config.js` 생성
7. `web/`를 GitHub Pages artifact로 배포

## 10. 첫 배포 실행

main branch에 push하거나 GitHub Actions에서 수동 실행한다.

```text
Actions -> Deploy GitHub Pages -> Run workflow
```

성공 후 배포 URL을 확인한다.

예:

```text
https://<github-owner>.github.io/<repo-name>/
```

## 11. Production smoke test

배포 URL에서 아래를 확인한다.

1. 로그아웃 상태에서 단어 카드가 보이지 않는다.
2. Google login 버튼이 보인다.
3. Google 로그인 popup이 정상 동작한다.
4. 로그인 후 단어 카드가 나온다.
5. 단어를 맞음/모름 처리한다.
6. Firebase Console에서 `users/{uid}/wordStats/{wordId}` 문서가 생기는지 확인한다.
7. 새로고침 후 진행 정보가 유지되는지 확인한다.
8. 다른 Google 계정으로 로그인했을 때 이전 계정의 진행이 보이지 않는지 확인한다.
9. reset 버튼이 본인 progress/history만 삭제하는지 확인한다.
10. 브라우저 개발자 도구에서 `data/vocab.js`, `firebase-config.js`, `service-worker.js`가 404 없이 로드되는지 확인한다.

## 12. Firestore rules emulator 테스트

Firebase CLI 설치 후 rules 테스트를 추가/실행해야 한다. 현재 repository에는 rules 파일은 있지만 emulator rules test suite는 아직 없다.

최소 테스트해야 할 항목:

- 비로그인 read/write 거부
- 본인 progress read/write 허용
- 타인 progress read/write 거부
- unknown `wordId` write 거부
- malformed `wordId` write 거부
- `vocab/{wordId}` client write 거부
- 큰 counter jump 거부
- 예상 밖 field 거부
- schemaVersion/client metadata 변조 거부
- invalid timestamp 거부
- reset이 본인 progress/history에만 동작

## 13. EC2를 사용할 경우

v1 기본 배포처는 GitHub Pages다. EC2는 아래 조건일 때만 사용한다.

- 자체 API가 필요하다.
- 서버에서 Firebase ID token 검증이 필요하다.
- 관리자 기능/로그/서버 검증이 필요하다.
- EC2 사용이 계정/비용상 필수다.

EC2 선택 시 추가 체크리스트:

```text
custom domain 연결
HTTPS 인증서 설정 및 자동 갱신
Nginx/Caddy/Apache 설정
security group 80/443 public 허용
SSH는 admin IP 또는 SSM으로 제한
배포 자동화
서버 로그 rotation
CloudWatch 등 모니터링
OS patching 정책
rollback 방법
```

## 14. 문제 발생 시 확인 순서

로그인이 안 될 때:

1. Firebase Authentication Google provider가 켜져 있는지 확인한다.
2. Authorized domains에 GitHub Pages host가 있는지 확인한다.
3. GitHub variables의 `FIREBASE_AUTH_DOMAIN`이 맞는지 확인한다.
4. 브라우저 console의 Firebase error code를 확인한다.

진행 저장이 안 될 때:

1. `vocab/{wordId}` seed가 되었는지 확인한다.
2. `system/vocabVersion`이 있는지 확인한다.
3. Firestore rules가 배포되었는지 확인한다.
4. `users/{uid}/wordStats` 경로에 권한 오류가 나는지 확인한다.
5. write payload가 rules의 counter delta 조건과 맞는지 확인한다.

GitHub Pages 배포가 실패할 때:

1. Actions variables가 모두 설정되어 있는지 확인한다.
2. `npm test`가 통과하는지 확인한다.
3. Pages source가 GitHub Actions인지 확인한다.
4. repository Settings -> Pages에서 배포 URL을 확인한다.

## 15. 완료 기준

배포 완료로 인정하려면 아래가 모두 충족되어야 한다.

- GitHub Pages URL이 HTTPS로 열린다.
- 로그인 전에는 단어가 제시되지 않는다.
- Google 로그인 후 단어가 제시된다.
- 진행 정보가 Firestore에 저장된다.
- 새로고침 후 같은 계정의 진행 정보가 유지된다.
- 다른 계정과 진행 정보가 분리된다.
- Firestore rules가 production에 배포되어 있다.
- `vocab/{wordId}` allowlist가 seed되어 있다.
- production smoke test가 통과한다.
