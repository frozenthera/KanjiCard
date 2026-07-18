@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "INTERACTIVE="
if "%~1"=="" set "INTERACTIVE=1"
set "COMMIT_INTENT=%~1"
set "ROOT=%~dp0"
set "APK_SOURCE=%ROOT%android\app\build\outputs\apk\debug\app-debug.apk"
set "APK_OUTPUT=%ROOT%dist\KanjiCard-debug.apk"
set "SCAN_OUTPUT=%TEMP%\kanjicard-secret-scan-%RANDOM%.txt"
set "STATUS_OUTPUT=%TEMP%\kanjicard-status-%RANDOM%.txt"

pushd "%ROOT%" >nul || (
  echo ERROR: Could not open the repository directory.
  exit /b 1
)

where git.exe >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=Git is not installed or is not available on PATH."
  goto :fail
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=Node.js and npm are not installed or are not available on PATH."
  goto :fail
)

where java.exe >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=Java 17 is not installed or is not available on PATH."
  goto :fail
)

if not exist ".git" (
  set "ERROR_MESSAGE=This directory is not the KanjiCard Git repository."
  goto :fail
)

if not exist "android\gradlew.bat" (
  set "ERROR_MESSAGE=android\gradlew.bat is missing."
  goto :fail
)

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH (
  set "ERROR_MESSAGE=Detached HEAD is not supported. Check out a branch first."
  goto :fail
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=The origin Git remote is not configured."
  goto :fail
)

echo [1/7] Fetching origin/%BRANCH%...
git fetch origin "%BRANCH%"
if errorlevel 1 (
  set "ERROR_MESSAGE=Could not fetch origin/%BRANCH%."
  goto :fail
)

for /f "tokens=1,2" %%A in ('git rev-list --left-right --count "HEAD...origin/%BRANCH%"') do (
  set "AHEAD_COUNT=%%A"
  set "BEHIND_COUNT=%%B"
)
if not "%BEHIND_COUNT%"=="0" (
  set "ERROR_MESSAGE=The local branch is behind origin/%BRANCH%. Run git pull --ff-only before publishing."
  goto :fail
)

echo [2/7] Running web regression tests...
call npm.cmd test
if errorlevel 1 (
  set "ERROR_MESSAGE=Web regression tests failed. Nothing was published."
  goto :fail
)

echo [3/7] Building the Firestore vocab seed artifact...
call npm.cmd run seed:vocab
if errorlevel 1 (
  set "ERROR_MESSAGE=Firestore vocab seed generation failed. Nothing was published."
  goto :fail
)

echo [4/7] Building the Android debug APK...
pushd "android" >nul
call gradlew.bat --no-daemon assembleDebug
set "GRADLE_EXIT=%ERRORLEVEL%"
popd >nul
if not "%GRADLE_EXIT%"=="0" (
  set "ERROR_MESSAGE=Android build failed. Nothing was published."
  goto :fail
)

if not exist "%APK_SOURCE%" (
  set "ERROR_MESSAGE=Gradle completed but the debug APK was not found."
  goto :fail
)
if not exist "dist" mkdir "dist"
copy /Y "%APK_SOURCE%" "%APK_OUTPUT%" >nul
if errorlevel 1 (
  set "ERROR_MESSAGE=Could not copy the APK to dist\KanjiCard-debug.apk."
  goto :fail
)

git status --porcelain > "%STATUS_OUTPUT%"
set "HAS_CHANGES="
for /f "usebackq delims=" %%L in ("%STATUS_OUTPUT%") do set "HAS_CHANGES=1"
del "%STATUS_OUTPUT%" >nul 2>&1

if not defined HAS_CHANGES goto :push

if not defined COMMIT_INTENT (
  echo.
  set /p "COMMIT_INTENT=Commit intent ^(why this change was made^): "
)
if not defined COMMIT_INTENT (
  set "ERROR_MESSAGE=A commit intent is required when files have changed."
  goto :fail
)

echo [5/7] Staging and checking changed files...
git add -A
if errorlevel 1 (
  set "ERROR_MESSAGE=Could not stage the changed files."
  goto :fail
)

git diff --cached --check
if errorlevel 1 (
  set "ERROR_MESSAGE=Whitespace or conflict-marker validation failed."
  goto :fail
)

git grep --cached -I -n -E -e "BEGIN [A-Z ]*PRIVATE KEY" -e "github_pat_[0-9A-Za-z_]{20,}" -e "gh[pousr]_[0-9A-Za-z]{20,}" -e "AKIA[0-9A-Z]{16}" -- . ":(exclude)publish-and-build.bat" > "%SCAN_OUTPUT%"
set "SCAN_EXIT=%ERRORLEVEL%"
if "%SCAN_EXIT%"=="0" (
  echo.
  echo Possible credential content was found:
  type "%SCAN_OUTPUT%"
  del "%SCAN_OUTPUT%" >nul 2>&1
  git restore --staged . >nul 2>&1
  set "ERROR_MESSAGE=Credential scan failed. Review the listed files before publishing."
  goto :fail
)
del "%SCAN_OUTPUT%" >nul 2>&1
if not "%SCAN_EXIT%"=="1" (
  git restore --staged . >nul 2>&1
  set "ERROR_MESSAGE=Credential scan could not complete."
  goto :fail
)

git status --short
git commit -m "%COMMIT_INTENT%" ^
  -m "Constraint: Publishing and Android builds use the repository batch workflow" ^
  -m "Confidence: high" ^
  -m "Scope-risk: moderate" ^
  -m "Directive: Keep the scripted test, credential scan, push, and build gates intact" ^
  -m "Tested: npm test; npm run seed:vocab; android assembleDebug" ^
  -m "Not-tested: GitHub Actions completion after push"
if errorlevel 1 (
  set "ERROR_MESSAGE=Git commit failed."
  goto :fail
)

:push
echo [6/7] Pushing %BRANCH% to GitHub...
git push origin "%BRANCH%"
if errorlevel 1 (
  set "ERROR_MESSAGE=Git push failed. The local commit and APK were preserved."
  goto :fail
)

echo [7/7] Complete.
echo GitHub: https://github.com/frozenthera/KanjiCard
echo APK: %APK_OUTPUT%
echo GitHub Actions will deploy the pushed commit automatically.
goto :success

:fail
echo.
echo ERROR: %ERROR_MESSAGE%
if exist "%SCAN_OUTPUT%" del "%SCAN_OUTPUT%" >nul 2>&1
if exist "%STATUS_OUTPUT%" del "%STATUS_OUTPUT%" >nul 2>&1
popd >nul
if defined INTERACTIVE pause
exit /b 1

:success
popd >nul
if defined INTERACTIVE pause
exit /b 0
