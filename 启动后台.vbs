' The Memory 后台静默启动脚本
' 双击后以隐藏窗口方式启动 server.js，不占用任务栏，不显示黑框
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

siteDir = "D:\华为云相册下载\个人照片视频\site-preview"
nodeExe = "C:\Users\m1333\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
logFile = siteDir & "\server.log"

' 如果已有 8787 端口的进程，先杀掉，避免端口占用
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :8787') do taskkill /F /PID %a 2>nul", 0, True

' 清理旧日志
On Error Resume Next
FSO.DeleteFile logFile, True
On Error GoTo 0

' 在隐藏窗口中启动 Node，并把日志写入 server.log
cmd = """""" & nodeExe & """""" """""" & siteDir & "\server.js"""""" > """""" & logFile & """""" 2>&1"""
WshShell.Run cmd, 0, False

WScript.Sleep 1000

' 检查是否真的启动了
Set WMIService = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
Set colItems = WMIService.ExecQuery("Select * From Win32_Process Where Name='node.exe'")
Dim found
found = False
For Each objItem In colItems
    If InStr(objItem.CommandLine, "server.js") > 0 Then
        found = True
        Exit For
    End If
Next

If found Then
    WshShell.Popup "The Memory 后台已启动" & vbCrLf & "访问：http://127.0.0.1:8787/admin.html" & vbCrLf & "日志：site-preview\server.log", 2, "后台启动", 64
Else
    WshShell.Popup "后台启动失败，请查看 server.log", 0, "后台启动失败", 16
End If
