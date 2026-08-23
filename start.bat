@echo off
REM Starts the Library Entry & Exit Register on this machine.
REM The app is kept in a loop so "Restart application" in the owner console
REM (which exits with code 42) brings the new version straight back up.
cd /d "%~dp0"

if not exist "node_modules" (
  echo Packages missing - run setup.bat first.
  pause
  exit /b 1
)

start "" http://localhost:4000/admin

:run
node src/server.js
if %errorlevel%==42 (
  echo Restarting application...
  timeout /t 2 /nobreak >nul
  goto run
)
pause
