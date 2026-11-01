@echo off
rem Starts Logix Assistant and opens it in your default browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm run dev -- --open
