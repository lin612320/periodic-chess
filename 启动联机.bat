@echo off
chcp 65001 >nul
title 元素周期表飞行棋 · 局域网联机
cd /d "%~dp0"

echo.
echo   元素周期表飞行棋 · 局域网联机
echo   ========================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] 没找到 Node.js
  echo       去 https://nodejs.org 装一个 LTS 版本，
  echo       装完重新双击这个文件就行。
  echo.
  echo   ^(只想自己玩，不需要联机的话，直接双击 index.html 即可^)
  echo.
  pause
  exit /b 1
)

echo   正在启动服务...
echo.

node server.js 18080

echo.
echo   服务已停止。
pause
