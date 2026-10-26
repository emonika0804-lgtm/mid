@echo off
setlocal
title PIL Cargo Claim and Survey Management Platform Launcher
cd /d "%~dp0"

echo ======================================================================
echo    PACIFIC INTERNATIONAL LINES (PIL)
echo    Cargo Claim and Survey Management System Launcher
echo ======================================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found in your system PATH.
    echo Please install Node.js version 20 or higher from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Check for .env file
if not exist "%~dp0.env" (
    echo [WARNING] No .env file found in the project root!
    echo Please ensure your .env file is present with PostgreSQL credentials.
    echo.
)

:: 3. Launch unified application manager
node "%~dp0scripts\start_all.js"

:: Always pause if the node process exits or fails so the window doesn't disappear
echo.
echo Application launcher has stopped.
pause
