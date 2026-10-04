@echo off
REM Start Bacterial Beacon (Windows)
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12+ is required. Install it from https://nodejs.org and re-run.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||major===22&&minor>=12?0:1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Update it at https://nodejs.org and re-run.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. Reinstall Node.js from https://nodejs.org and re-run.
  pause
  exit /b 1
)
node scripts/ensure-dependencies.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo Open http://localhost:8080 in your browser (Ctrl+C to stop).
call npm start
pause
