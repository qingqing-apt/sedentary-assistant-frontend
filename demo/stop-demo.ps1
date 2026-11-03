# 关掉演示环境

param([switch]$KeepEmulator)

$ErrorActionPreference = "SilentlyContinue"
$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$adb = Join-Path $sdk "platform-tools\adb.exe"

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Skip($text) { Write-Host "    --  $text" -ForegroundColor DarkGray }

# 后端 :8000
Step 1 "停止后端（:8000）"
$conns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        Ok "已停止进程 $_"
    }
} else { Skip "没有在监听" }

# Runtime :3000
Step 2 "停止 Runtime（:3000）"
$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        Ok "已停止进程 $_"
    }
} else { Skip "没有在监听" }

# 模拟器
Step 3 "关闭模拟器"
if ($KeepEmulator) {
    Skip "按 -KeepEmulator 保留"
} else {
    $devices = (& $adb devices) -join "`n"
    if ($devices -match "emulator-\d+\s+device") {
        & $adb emu kill 2>&1 | Out-Null
        Ok "已发送关闭指令（模拟器窗口会自己消失）"
    } else { Skip "没有运行中的模拟器" }
}

Write-Host "`n全部清理完成。`n" -ForegroundColor Green
