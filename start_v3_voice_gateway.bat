@echo off
cd /d "%~dp0frontend"

if not exist ".env.local" (
  echo Missing frontend\.env.local. Please add DASHSCOPE_API_KEY before starting realtime voice.
  pause
  exit /b 1
)

if exist ".\node_modules\ws" (
  echo Starting OldCheat realtime voice gateway at ws://127.0.0.1:8787/voice
  echo Keep this window open while using V3 voice call mode.
  node .\voice-gateway\server.mjs
) else (
  echo Missing frontend dependencies: ws package not found.
  echo Please run:
  echo   cd /d "%~dp0frontend"
  echo   pnpm.cmd install
)
pause
