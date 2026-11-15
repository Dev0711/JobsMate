@echo off
rem Removes the ApplyMate Word helper registration (current user only).
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.applymate.word" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.applymate.word" /f >nul 2>&1
del "%~dp0com.applymate.word.json" >nul 2>&1
del "%~dp0host.bat" >nul 2>&1
echo ApplyMate Word helper removed.
pause
