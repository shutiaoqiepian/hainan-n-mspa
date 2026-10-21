@echo off
setlocal enabledelayedexpansion
title 18N-MSPA - Copy Images

if "%~1"=="" goto HELP
if not exist "%~1" goto NOTFOUND

set "SRC=%~1"
set "DST=%~dp0images"

echo.
echo   Source : %SRC%
echo   Target : %DST%
echo.
echo   Copying images, please wait...
echo.

if not exist "%DST%" mkdir "%DST%"

robocopy "%SRC%" "%DST%" *.jpg *.jpeg *.png *.webp *.gif /XC /XN /XO /NFL /NDL /NJH /NJS /NP /R:1 /W:1 >nul

if %ERRORLEVEL% GEQ 8 goto FAILED

set /a NJPG=0
set /a NPNG=0
for /f %%c in ('dir /b "%DST%\*.jpg" 2^>nul ^| find /c /v ""') do set /a NJPG=%%c
for /f %%c in ('dir /b "%DST%\*.png" 2^>nul ^| find /c /v ""') do set /a NPNG=%%c

echo   --------------------------------------------------
echo    DONE
echo    images folder now contains:
echo      %NJPG% jpg   ^+   %NPNG% png
echo   --------------------------------------------------
echo.
echo    Note: only NEW files are copied. Existing (already compressed)
echo          files are kept. To replace a photo, delete it from
echo          images\ first, then drag again.
echo.
echo    Next step: double-click index.html to preview.
echo.
pause
exit /b 0

:HELP
echo.
echo   HOW TO USE
echo   ----------
echo   Drag a folder and drop it ONTO this file.
echo.
echo   Do it twice:
echo     1^) the "YASUO" (compressed) folder with photos
echo     2^) the "YEQING" folder with logo and QR code
echo.
echo   Both go into the images folder automatically.
echo.
pause
exit /b 0

:NOTFOUND
echo.
echo   [ERROR] Folder not found:
echo   %~1
echo.
pause
exit /b 1

:FAILED
echo.
echo   [ERROR] Copy failed. Check the folder and try again.
echo.
pause
exit /b 1
