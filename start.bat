@echo off
REM Starts the Library Entry & Exit Register on this machine.
cd /d "%~dp0"

if not exist "node_modules" (
  echo Packages missing - run setup.bat first.
  pause
  exit /b 1
)

start "" http://localhost:4000/admin
node src/server.js
pause
