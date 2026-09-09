@echo off
echo Stopping old server on port 8787...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8787') do taskkill /F /PID %%a 2>nul
cd /d "D:\华为云相册下载\个人照片视频\site-preview"
echo Starting The Memory admin server...
echo Open: http://127.0.0.1:8787/admin.html
node server.js
pause
