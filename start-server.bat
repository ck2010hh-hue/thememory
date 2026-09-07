@echo off
cd /d "%~dp0"
echo Starting The Memory server ...
echo Website:  http://127.0.0.1:8787/
echo Admin:    http://127.0.0.1:8787/admin.html
echo (Close this window to stop the server)
"C:\Users\m1333\.workbuddy\binaries\node\versions\22.22.2-2\node.exe" server.js
pause
