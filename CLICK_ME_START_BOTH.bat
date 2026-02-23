@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%web-ui"

if not exist "%WEB_DIR%\package.json" (
  echo ERROR: Missing "%WEB_DIR%\package.json"
  pause
  exit /b 1
)

if not exist "%WEB_DIR%\node_modules" (
  echo Installing dependencies...
  pushd "%WEB_DIR%"
  npm.cmd install
  if errorlevel 1 (
    popd
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
  popd
)

start "online-tracker-web-ui" cmd.exe /k "cd /d \"%WEB_DIR%\" && node src/server.js"
timeout /t 2 /nobreak >nul
start "online-tracker-discord-bot" cmd.exe /k "cd /d \"%WEB_DIR%\" && node bot/discord-bot.js"

echo Started web UI and Discord bot.
echo Web UI: http://localhost:3000
endlocal
