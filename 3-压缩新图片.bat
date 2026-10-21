@echo off
setlocal
title 18N-MSPA - Compress New Photos
chcp 65001 >nul

echo.
echo   Compressing photos in images\ (only new/large ones matter)
echo.
echo   Tip: test with ONE photo first. If anything looks wrong,
echo        the backup folder still has the originals.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\optimize-images.ps1" -Root "%~dp0"

echo.
echo   ============================================
echo    DONE.  Now upload the folder to Netlify.
echo   ============================================
echo.
pause
