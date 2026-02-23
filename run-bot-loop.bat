@echo off
setlocal
set "WEB_DIR=%~dp0web-ui"

:loop
cd /d "%WEB_DIR%"
echo [%date% %time%] starting discord bot...
npm.cmd run bot
echo [%date% %time%] bot exited with code %errorlevel%, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
