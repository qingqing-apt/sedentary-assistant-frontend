# 一键启动演示环境（Android 模拟器 + 本地后端）
#
# 用法：
#   demo                  # 任意目录直接跑（demo/bin 已加入用户 PATH）
#   .\demo\start-demo.ps1          # 或者在 frontend/ 下直接调脚本
#   demo -Avd Small_4_7            # 换 4.7 寸小屏
#   demo -NoAgent                  # 只起后端，不起 Runtime（演示时不建议）
#   demo -Build                    # 重新构建 APK 再装（改过前端代码时用）

param(
    [string]$Avd = "Pixel7_Test",
    [switch]$Build,
    [switch]$NoAgent,
    [switch]$NoEmulator
)

# 注意：不能用 Stop。adb / gradle 会往 stderr 写正常信息，PS 5.1 下会被当成
# 终止性错误直接中断脚本。这里的错误处理靠下面显式的 if 判断。
$ErrorActionPreference = "Continue"

# Invoke-WebRequest 默认会画进度条（"正在读取 Web 响应…"），在这个脚本里纯属噪音
$ProgressPreference = "SilentlyContinue"

# 脚本现在住在 frontend/demo/ 下，所以：
#   $PSScriptRoot -> frontend/demo
#   $Frontend     -> frontend
#   $Backend      -> ../backend（和 frontend 平级）
$Frontend = Split-Path $PSScriptRoot -Parent
$Root = Split-Path $Frontend -Parent
$Backend = Join-Path $Root "backend"
$Apk = Join-Path $Frontend "release\久坐活动助手-debug.apk"
$Package = "com.qingqing.sedentary"

function Step($n, $text) { Write-Host ""; Write-Host "[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "    XX  $text" -ForegroundColor Red }

# 原生命令统一走这里：屏蔽 stderr 对 $ErrorActionPreference 的干扰，返回文本行
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $out = & $Exe @Arguments 2>&1
    return @($out | ForEach-Object { "$_" })
}

function Test-Backend {
    try {
        return (Invoke-WebRequest "http://127.0.0.1:8000/api/health" -Proxy $null -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200
    } catch { return $false }
}

# ---------------------------------------------------------------- 0. 环境变量
Step 0 "准备环境变量"

$jdk = Get-ChildItem "$env:USERPROFILE\.jdks" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "jdk-21*" } | Select-Object -First 1
if (-not $jdk) { Fail "没找到 JDK 21（$env:USERPROFILE\.jdks\jdk-21*）"; exit 1 }
$env:JAVA_HOME = $jdk.FullName
Ok "JAVA_HOME    $($jdk.Name)"

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $sdk)) { Fail "没找到 Android SDK（$sdk）"; exit 1 }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Ok "ANDROID_HOME $sdk"

$adb = Join-Path $sdk "platform-tools\adb.exe"
$emulatorExe = Join-Path $sdk "emulator\emulator.exe"

# ---------------------------------------------------------------- 1. 后端
Step 1 "启动 Python 后端（:8000）"

$py = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Fail "后端虚拟环境不存在：$py"
    Write-Host "        先建：cd backend; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt"
    exit 1
}

if (Test-Backend) {
    Ok "后端已在跑，跳过"
} else {
    Start-Process -FilePath $py `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" `
        -WorkingDirectory $Backend -WindowStyle Minimized

    $ready = $false
    foreach ($i in 1..20) {
        Start-Sleep -Milliseconds 700
        if (Test-Backend) { $ready = $true; break }
    }
    if ($ready) {
        Ok "已启动（0.0.0.0:8000 —— 必须绑 0.0.0.0，绑回环模拟器连不进来）"
    } else {
        Fail "15 秒内没起来，看那个最小化的窗口报什么错"
        exit 1
    }
}

# ---------------------------------------------------------------- 2. Runtime（默认启动）
# 「助手」页签靠它转发到后端 AG-UI。不启动的话，聊天框能打字、点发送没反应，
# 也不报错——2026-11-03 验收就是在这里被判定不合格的，所以改成默认拉起。
if (-not $NoAgent) {
    Step 2 "启动 CopilotKit Runtime（:3000）"

    function Test-Runtime {
        try {
            # 这个端点只吃 POST，GET 返回 404 也说明服务活着
            $r = Invoke-WebRequest "http://127.0.0.1:3000/api/copilotkit" -Proxy $null -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            return $true
        } catch {
            # 404 说明端口通了、只是方法不对；连接失败才是没起来
            if ($_.Exception.Response) { return $true }
            return $false
        }
    }

    if (Test-Runtime) {
        Ok "Runtime 已在跑，跳过"
    } else {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run runtime" `
            -WorkingDirectory $Frontend -WindowStyle Minimized
        Write-Host "    tsx 首次编译需要十几秒，等它就绪" -NoNewline

        $ready = $false
        foreach ($i in 1..40) {
            Start-Sleep -Seconds 1
            Write-Host "." -NoNewline
            if (Test-Runtime) { $ready = $true; break }
        }
        Write-Host ""
        if ($ready) {
            # 不用 ?? 运算符：那是 PowerShell 7+ 的语法，5.1 会直接报错
            $agentTarget = if ($env:AGENT_URL) { $env:AGENT_URL } else { "http://127.0.0.1:8000/api/agent/chat" }
            Ok "Runtime 就绪（转发到 $agentTarget）"
        } else {
            # 不 exit：主流程（今日/统计/设置）不依赖它，降级继续，但要讲明白
            Warn "40 秒内没起来。「助手」页签会发不出消息，其余功能不受影响"
            Warn "手动排查：cd frontend; npm run runtime"
        }
    }
}

# ---------------------------------------------------------------- 3. 模拟器
if (-not $NoEmulator) {
    Step 3 "启动模拟器 $Avd"

    Invoke-Native $adb @("start-server") | Out-Null

    $booted = ((Invoke-Native $adb @("shell", "getprop", "sys.boot_completed")) -join "").Trim()
    if ($booted -eq "1") {
        Ok "已有模拟器在跑，跳过启动"
    } else {
        $avds = Invoke-Native $emulatorExe @("-list-avds")
        if ($avds -notcontains $Avd) {
            Fail "没有名为 $Avd 的 AVD"
            Write-Host "        现有：$($avds -join ', ')"
            exit 1
        }

        Start-Process -FilePath $emulatorExe -ArgumentList "-avd", $Avd, "-gpu", "swiftshader_indirect" | Out-Null
        Write-Host "    等待开机（冷启动约 50 秒）" -NoNewline

        $ready = $false
        foreach ($i in 1..60) {
            Start-Sleep -Seconds 3
            Write-Host "." -NoNewline
            $booted = ((Invoke-Native $adb @("shell", "getprop", "sys.boot_completed")) -join "").Trim()
            if ($booted -eq "1") { $ready = $true; break }
        }
        Write-Host ""
        if (-not $ready) {
            Fail "3 分钟没启动完。可以手动开一次模拟器，再带 -NoEmulator 重跑本脚本"
            exit 1
        }
        Ok "开机完成"
    }

    # 新 AVD 首次启动 wifi 不自动连，10.0.2.2 就不可达。这一步不能省。
    Step 4 "确认模拟器能访问宿主机"
    $ipInfo = (Invoke-Native $adb @("shell", "ip", "-4", "addr")) -join "`n"
    if ($ipInfo -notmatch "10\.0\.2\.\d+") {
        Invoke-Native $adb @("shell", "svc", "wifi", "enable") | Out-Null
        Start-Sleep -Seconds 3
        Invoke-Native $adb @("shell", "cmd", "wifi", "connect-network", "AndroidWifi", "open") | Out-Null
        Start-Sleep -Seconds 6
        $ipInfo = (Invoke-Native $adb @("shell", "ip", "-4", "addr")) -join "`n"
    }
    if ($ipInfo -match "10\.0\.2\.\d+") {
        $ip = [regex]::Match($ipInfo, "inet (10\.0\.2\.\d+)").Groups[1].Value
        Ok "网络就绪（设备 $ip，宿主机是 10.0.2.2）"
    } else {
        Fail "模拟器没网络，App 会报「连不上后端」"
        Write-Host "        手动执行：adb shell cmd wifi connect-network AndroidWifi open"
        exit 1
    }

    # ------------------------------------------------------------ 5. 安装
    Step 5 "安装 App"

    if ($Build) {
        Write-Host "    重新构建（约 1 分钟）..."
        # 两个地址都必须注入。只设 VITE_API_BASE 会导致「助手」页签静默失灵：
        # runtimeUrl 退化成相对路径 /api/copilotkit，在 WebView 里打到本地服务，
        # 拿到一张 200 的 index.html，消息就没了。
        $env:VITE_API_BASE = "http://10.0.2.2:8000"
        $env:VITE_RUNTIME_URL = "http://10.0.2.2:3000/api/copilotkit"
        Push-Location $Frontend
        Invoke-Native "npm" @("run", "build") | Out-Null
        Invoke-Native "npx" @("cap", "sync", "android") | Out-Null
        Pop-Location

        Push-Location (Join-Path $Frontend "android")
        Invoke-Native "cmd" @("/c", "gradlew.bat assembleDebug --console=plain --no-daemon") | Out-Null
        Pop-Location

        $built = Join-Path $Frontend "android\app\build\outputs\apk\debug\app-debug.apk"
        if (-not (Test-Path $built)) { Fail "构建没产出 APK，看 android 目录的输出"; exit 1 }
        Copy-Item $built $Apk -Force
        Ok "构建完成，已更新 release 里的包"
    }

    if (-not (Test-Path $Apk)) {
        Fail "APK 不存在：$Apk"
        Write-Host "        加 -Build 参数重新构建"
        exit 1
    }

    $installOut = (Invoke-Native $adb @("install", "-r", $Apk)) -join " "
    if ($installOut -match "Success") { Ok "安装完成" } else { Warn "安装输出：$installOut" }

    Step 6 "启动 App"
    Invoke-Native $adb @("shell", "am", "force-stop", $Package) | Out-Null
    Invoke-Native $adb @("shell", "am", "start", "-n", "$Package/.MainActivity") | Out-Null
    Start-Sleep -Seconds 4
    Ok "已启动"
}

# ---------------------------------------------------------------- 收尾
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 演示环境就绪" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if (Test-Backend) {
    try {
        $h = (Invoke-WebRequest "http://127.0.0.1:8000/api/health" -Proxy $null -TimeoutSec 3 -UseBasicParsing).Content
        Write-Host " 后端 :8000   $h"
    } catch { Write-Host " 后端 :8000   OK" }
} else {
    Write-Host " 后端 :8000   未响应" -ForegroundColor Yellow
}
Write-Host " 接口文档     http://127.0.0.1:8000/docs"
if (-not $NoAgent) { Write-Host " Agent Runtime :3000（「助手」页签）" }
if (-not $NoEmulator) { Write-Host " 设备         $Avd" }

Write-Host ""
Write-Host " 演示动线：" -ForegroundColor Cyan
Write-Host "   1. 登录页    随便填个用户名 → 进入"
Write-Host "   2. 今日页    点「生成安排」→ 完成一项 → 看状态和计数变化"
Write-Host "   3. 统计页    「每日总结」先显示未生成 → 点生成 → 出真实结论"
Write-Host "   4. 故障演示  关掉后端窗口 → 生成 → 12 秒后出错误提示 → 重开后端点重试"
Write-Host ""
Write-Host " 关掉：demo-stop" -ForegroundColor DarkGray
Write-Host ""
