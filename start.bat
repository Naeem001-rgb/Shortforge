@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -q "pip>=26.2,<27"
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m pip install -q -r engine\requirements.txt
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m pip install -q --upgrade yt-dlp
node scripts\setup-node.mjs
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe scripts\setup-concat.py
if errorlevel 1 echo Concat setup needs attention; Library and Scout will still start. Restart ShortForge to retry.
call npm --prefix extension run build -- --if-needed
if errorlevel 1 exit /b 1
start "ShortForge Engine (close this window to stop engine)" .venv\Scripts\python.exe -m engine
echo Open http://127.0.0.1:5173
call npm --prefix dashboard run dev
