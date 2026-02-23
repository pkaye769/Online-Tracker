@echo off
setlocal
set "WEB_DIR=%~dp0web-ui"

:loop
cd /d "%WEB_DIR%"
echo [%date% %time%] starting web ui...
npm.cmd run dev
echo [%date% %time%] web ui exited with code %errorlevel%, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
