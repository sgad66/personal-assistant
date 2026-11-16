@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
pushd "%~dp0"
echo 1. 创建桌面快捷方式
echo 2. 删除桌面快捷方式
echo 3. 查看快捷方式状态
set "CHOICE="
set /p "CHOICE=请输入 1、2 或 3 后回车："
set "SUBCMD="
if "!CHOICE!"=="1" set "SUBCMD=create"
if "!CHOICE!"=="2" set "SUBCMD=delete"
if "!CHOICE!"=="3" set "SUBCMD=status"
if not defined SUBCMD (
  echo 输入无效，已取消操作。
  set "EXIT_CODE=2"
) else (
  call node "scripts\launcher\shortcut.cjs" !SUBCMD! --wait-if-tty
  set "EXIT_CODE=!ERRORLEVEL!"
)
pause
popd
exit /b !EXIT_CODE!