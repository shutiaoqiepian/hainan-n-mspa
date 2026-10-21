@echo off
setlocal
title 18N-MSPA - Make Favicon

echo.
echo   Making site icon from your logo...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-favicon.ps1" -Root "%~dp0"

if errorlevel 1 (
  echo.
  echo   [FAILED] See the message above.
) else (
  echo.
  echo   ============================================
  echo    DONE.  images\favicon.png is ready.
  echo   ============================================
  echo.
  echo   Next: re-upload the folder to Netlify.
)

echo.
pause
