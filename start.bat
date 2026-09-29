@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -q -r engine\requirements.txt
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m pip install -q --upgrade yt-dlp
if not exist dashboard\node_modules call npm --prefix dashboard ci
if not exist extension\node_modules call npm --prefix extension ci
call npm --prefix extension run build
start "ShortForge Engine (close this window to stop engine)" .venv\Scripts\python.exe -m engine
echo Open http://127.0.0.1:5173
call npm --prefix dashboard run dev
