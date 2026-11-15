@echo off
rem Double-click to set up the ApplyMate Word helper (current user only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
