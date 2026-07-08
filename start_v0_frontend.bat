@echo off
cd /d "%~dp0frontend"

if exist ".\node_modules\.bin\next.CMD" (
  echo Starting OldCheat v0 frontend at http://127.0.0.1:3000/
  call ".\node_modules\.bin\next.CMD" dev -p 3000
) else (
  echo Missing frontend dependencies: frontend\node_modules\.bin\next.CMD not found.
  echo Please install dependencies first, then run this script again.
  echo If npm is available, you can run:
  echo   cd /d "%~dp0frontend"
  echo   npm install
)
pause
