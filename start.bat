@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
.venv\Scripts\python.exe scripts\setup-python.py
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe scripts\setup-media.py
if errorlevel 1 exit /b 1
node scripts\setup-node.mjs
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe scripts\setup-concat.py
if errorlevel 1 echo Concat setup needs attention; Library and Scout will still start. Restart ShortForge to retry.
call npm --prefix extension run build -- --if-needed
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m engine.scout_host --install
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m engine --open
