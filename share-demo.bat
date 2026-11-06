@echo off
setlocal
chcp 65001 >nul
title Intent AI - share demo link (keep this window open)
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
echo Creating a public link for phones and other computers...
echo Feedback from visitors is saved on THIS computer. The link works while this window is open.
echo.
node scripts\share.js
pause
