@echo off
setlocal
chcp 65001 >nul
title Intent AI - local demo (real sites)
cd /d "%~dp0simulation"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page - install it, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing components - first run only...
  call npm install --no-fund --no-audit
  if errorlevel 1 ( pause & exit /b 1 )
)
if not exist "public\sites\shufersal.png" (
  echo Capturing screenshots of the real sites - first run only, takes a few minutes...
  call npm run capture
)

echo.
echo Starting the demo: http://localhost:4000   (close this window to stop)
echo To share with others instead, use share-demo.bat
echo.
set OPEN_BROWSER=1
node server.js
if errorlevel 1 echo The server stopped. If port 4000 is busy, close the other demo window and try again.
pause
