# JLPT Kanji Cards

Android-portable Japanese vocabulary card trainer for JLPT N5-N1 frequent kanji words.

## Run As Web App

Open `web/index.html` in a browser.

For local server testing without dependencies:

```powershell
cd C:\tmp\jlpt-kanji-cards
node server.js
```

Then open `http://localhost:4173`.

## Publish and Build on Windows

Publish changed files to GitHub with tests, Firestore seed generation, credential scanning, and the required commit trailers:

```powershell
.\publish.bat "Describe why this change was made"
```

Build the Android debug APK independently without committing or pushing anything:

```powershell
.\build-android.bat
```

Use `.\build-android.bat --clean` when a clean Gradle build is needed. Both batch files can also be started by double-clicking. The Android APK is copied to `dist\KanjiCard-debug.apk`.

## Android Port

The `android/` folder is a native Android WebView wrapper. It packages the same files from `web/` as Android assets, so there is no separate Android copy of the vocabulary or UI.

Android sources, tests, maintenance tools, extended design documents, and Firebase deployment configuration are local-only and intentionally excluded from the public Git repository.

At runtime the app serves those packaged assets through the local WebView origin `https://jlptcards.local/index.html`. This keeps browser storage behavior close to the web app while preventing external navigation.

Build from Android Studio by opening `android/`, or from a terminal with JDK 17 and Android SDK 35 configured:

```powershell
cd C:\tmp\jlpt-kanji-cards\android
.\gradlew.bat assembleDebug
```

If Android Studio offers to upgrade the Android Gradle Plugin or compile SDK, accept the upgrade and keep the app module namespace/application id as `dev.jlptcards`.

## Learning Behavior

- Cards initially show only kanji.
- Press `모름` to reveal furigana and Korean meaning.
- Press `알고 있음` to mark the card as known.
- Each session uses the configured daily card count and new-word ratio. If there are not enough learned words to fill the review share, the remainder is filled with new words.
- Wrong answers are requeued within the same session until answered correctly; session progress advances only on correct answers.
- A word's global seen, correct, and wrong totals are updated at most once per session after a wrong answer; later correct recall only completes the session card.
- Review frequency is adjusted by prior wrong count, average thinking time, and recency.
- Progress is stored locally in `localStorage` on web and in WebView storage on Android.

## Web Auth Deployment

The production web target is GitHub Pages plus Firebase Authentication and Cloud Firestore.

### Local mode

By default `web/firebase-config.js` leaves Firebase disabled, so local development still works with local storage:

```powershell
npm test
npm start
```

Open `http://localhost:4173`.

### Firebase setup

1. Create a Firebase project.
2. Enable Authentication -> Google provider.
3. Create a Firestore database.
4. Add these authorized domains in Firebase Authentication:
   - `localhost`
   - your GitHub Pages host, for example `<owner>.github.io`
   - your custom domain, if used
5. Deploy `firestore.rules` and `firestore.indexes.json`.
6. Seed `vocab/{wordId}` before deploying the production app:

```powershell
npm run seed:vocab
```

To upload directly through the Firestore REST API, provide:

```powershell
$env:FIREBASE_PROJECT_ID="your-project-id"
$env:GOOGLE_OAUTH_ACCESS_TOKEN="token-from-gcloud-auth-print-access-token"
npm run seed:vocab
```

The seed also writes `system/vocabVersion` so deployed clients can be checked against the server vocab version.

### GitHub Pages setup

Set these repository variables before enabling `.github/workflows/pages.yml`:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_SDK_BASE` optional, defaults to the pinned gstatic SDK base in the workflow

The workflow runs `npm test`, generates the vocab seed artifact, writes a production `web/firebase-config.js`, and publishes `web/` to GitHub Pages.

### Auth behavior

When Firebase config is present and `JLPT_REQUIRE_GOOGLE_SIGN_IN` is true:

- signed-out users see a Google sign-in gate instead of study cards;
- progress is loaded from `users/{uid}/wordStats/{wordId}`;
- answers are saved as single-card Firestore updates;
- reset deletes only the signed-in user's progress/history;
- existing localStorage progress is not imported in v1.
