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
  "%ComSpec%" /c "cd /d ""%WEB_DIR%"" && npm.cmd install"
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

start "online-tracker-web-ui" /d "%WEB_DIR%" "%ComSpec%" /k "npm.cmd run dev"
start "online-tracker-discord-bot" /d "%WEB_DIR%" "%ComSpec%" /k "npm.cmd run bot"

echo Started web UI and Discord bot.
echo Web UI: http://localhost:3000

endlocal
