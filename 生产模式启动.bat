@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
pushd "%~dp0"
call node "scripts\launcher\launch.cjs" --mode prod %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "!EXIT_CODE!"=="0" pause
popd
exit /b !EXIT_CODE!