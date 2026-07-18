@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "INTERACTIVE="
if "%~1"=="" set "INTERACTIVE=1"
set "ROOT=%~dp0"
set "GRADLE_TASKS=assembleDebug"
if /I "%~1"=="--clean" set "GRADLE_TASKS=clean assembleDebug"
set "APK_SOURCE=%ROOT%android\app\build\outputs\apk\debug\app-debug.apk"
set "APK_OUTPUT=%ROOT%dist\KanjiCard-debug.apk"

pushd "%ROOT%" >nul || (
  echo ERROR: Could not open the repository directory.
  exit /b 1
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

if not exist "android\gradlew.bat" (
  set "ERROR_MESSAGE=android\gradlew.bat is missing."
  goto :fail
)

echo [1/2] Running web regression tests...
call npm.cmd test
if errorlevel 1 (
  set "ERROR_MESSAGE=Web regression tests failed."
  goto :fail
)

echo [2/2] Building the Android debug APK...
pushd "android" >nul
call gradlew.bat --no-daemon %GRADLE_TASKS%
set "GRADLE_EXIT=%ERRORLEVEL%"
popd >nul
if not "%GRADLE_EXIT%"=="0" (
  set "ERROR_MESSAGE=Android build failed."
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

echo.
echo Android build complete.
echo APK: %APK_OUTPUT%
goto :success

:fail
echo.
echo ERROR: %ERROR_MESSAGE%
popd >nul
if defined INTERACTIVE pause
exit /b 1

:success
popd >nul
if defined INTERACTIVE pause
exit /b 0
