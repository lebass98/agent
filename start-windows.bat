@echo off
chcp 65001 >nul
rem Agent Office 로컬 서버 실행 (Windows) - 더블클릭으로 실행
setlocal EnableExtensions
cd /d "%~dp0"
title WordNCode Agent Office
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set "VENV=.venv-win"
set "VPY=%VENV%\Scripts\python.exe"

echo ==================================
echo    WordNCode Agent Office 로컬 서버
echo ==================================

if exist "%VPY%" goto :deps

call :find_python
if not defined PY goto :nopython
echo ^> 가상환경을 만드는 중... (%PY%)
%PY% -m venv "%VENV%"
if errorlevel 1 goto :fail

:deps
fc /b requirements.txt "%VENV%\.requirements.installed" >nul 2>&1
if not errorlevel 1 goto :run
echo ^> 패키지 설치 중... (처음 한 번은 1~2분 걸립니다)
"%VPY%" -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :fail
copy /y requirements.txt "%VENV%\.requirements.installed" >nul

:run
"%VPY%" scripts\launch.py %*
if errorlevel 1 goto :fail
exit /b 0

:find_python
set "PY="
for %%c in ("py -3" "python" "python3") do (
  if not defined PY (
    %%~c -c "import sys; sys.exit(sys.version_info < (3, 11))" >nul 2>&1 && set "PY=%%~c"
  )
)
exit /b 0

:nopython
echo Python 3.11 이상이 필요합니다.
echo https://www.python.org/downloads/ 에서 설치하세요.
echo 설치 첫 화면에서 "Add python.exe to PATH" 를 꼭 체크하세요.
pause
exit /b 1

:fail
echo.
echo 실행 중 오류가 발생했습니다. 위 메시지를 확인하세요.
pause
exit /b 1
