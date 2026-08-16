@echo off
REM One-time setup: installs packages, creates the MySQL database and the owner login.
cd /d "%~dp0"

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example - open it and set DB_PASSWORD, OWNER_EMAIL and OWNER_PASSWORD.
  echo Then run setup.bat again.
  pause
  exit /b 0
)

echo Installing packages...
call npm install || goto :fail

echo Creating database and owner account...
call npm run setup || goto :fail

echo.
echo Setup complete. Run start.bat to launch the app.
pause
exit /b 0

:fail
echo.
echo Setup failed. Check that MySQL is running and the DB_ values in .env are correct.
pause
exit /b 1
