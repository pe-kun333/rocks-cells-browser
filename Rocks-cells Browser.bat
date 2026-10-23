@echo off
rem Double-click to start Rocks-cells Browser.
rem Runs the built exe (Release first, then Debug). If neither exists yet, builds it first.
setlocal
set "EXE=%~dp0RocksCellsBrowser.exe"
if not exist "%EXE%" set "EXE=%~dp0build\Release\RocksCellsBrowser.exe"
if not exist "%EXE%" set "EXE=%~dp0build\Debug\RocksCellsBrowser.exe"
if exist "%EXE%" (
    start "" "%EXE%"
    exit /b 0
)
echo RocksCellsBrowser.exe was not found. Building it now (the first build takes a few minutes)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -Release
if errorlevel 1 (
    echo.
    echo The build failed. See the messages above.
    pause
    exit /b 1
)