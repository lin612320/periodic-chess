@echo off
chcp 65001 >nul
title 元素周期表飞行棋 · 部署到 Cloudflare Pages

set ACCOUNT=704f16b6b88f306e6745a0e4c528bc4a
set ZIP=C:\Users\86180\Desktop\元素周期表飞行棋-Pages.zip

echo.
echo   元素周期表飞行棋 · 部署到 Cloudflare Pages
echo   ==========================================
echo.

if not exist "%ZIP%" (
  echo   [!] 找不到部署包：
  echo       %ZIP%
  echo.
  echo   先跑一次打包：
  echo       powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-deploy.ps1"
  echo.
  pause
  exit /b 1
)

echo   正在打开 Cloudflare 控制台和部署包所在文件夹...
start "" "https://dash.cloudflare.com/%ACCOUNT%/workers-and-pages"
timeout /t 2 >nul
explorer /select,"%ZIP%"

echo.
echo   ==========================================
echo   接下来 6 步，大概 40 秒：
echo.
echo     1. 浏览器里点   Create
echo     2. 选            Pages
echo     3. 选            Upload assets
echo     4. 项目名填      periodic-chess
echo                      （被占用就换 yuansu-chess）
echo     5. 把桌面刚弹出的 zip 拖进上传区
echo     6. 点            Deploy site
echo.
echo   ==========================================
echo   完成后地址：https://periodic-chess.pages.dev
echo.
echo   提醒：Pages 只能跑静态页，联机功能不可用。
echo         要联机请用本地服务 + 隧道。
echo.
pause
