@echo off
setlocal

for %%I in ("%~dp0.") do set "ROOT_DIR=%%~fI"
set "WEB_DIR=%ROOT_DIR%\web-ui"

if not exist "%WEB_DIR%\package.json" (
  echo ERROR: Missing web-ui\package.json
  exit /b 1
)

if not exist "%WEB_DIR%\node_modules" (
  echo Installing web-ui dependencies...
  pushd "%WEB_DIR%"
  npm.cmd install
  if errorlevel 1 (
    popd
    echo ERROR: npm install failed.
    exit /b 1
  )
  popd
)

start "online-tracker-web-ui" cmd.exe /k "pushd \"%WEB_DIR%\" && npm.cmd run dev"
start "online-tracker-discord-bot" cmd.exe /k "pushd \"%WEB_DIR%\" && npm.cmd run bot"

echo Started web UI and Discord bot.
echo Web UI: http://localhost:3000
endlocal
