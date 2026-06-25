@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NO_PROXY=127.0.0.1;localhost"
set "no_proxy=127.0.0.1;localhost"
set "GRADIO_ANALYTICS_ENABLED=False"
echo Starting OldCheat. Keep this window open.
echo Open this URL after startup:
echo http://127.0.0.1:7860/
echo.
"D:\develop\python3.12\python.exe" "%~dp0run_oldcheat.py"
echo.
echo OldCheat has exited. If there is an error above, send a screenshot to Codex.
pause
