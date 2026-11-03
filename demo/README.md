# 展示用快速启动

> 这套脚本放在 `frontend/demo/`，跟着前端仓库一起走，clone 下来就有。

## 一句话

在**任意目录**开个 cmd，输入：

```
demo          # 启动
demo-stop     # 关闭
```

也可以双击 `demo\start.cmd`，或开 PowerShell 跑 `.\demo\start-demo.ps1`（能带参数）。

| 文件 | 用途 |
|---|---|
| `bin\demo.cmd` / `bin\demo-stop.cmd` | 走 PATH 的命令入口（`demo\bin` 已加入用户 PATH） |
| `start.cmd` / `stop.cmd` | 双击用的壳，只负责转码和留窗口 |
| `start-demo.ps1` / `stop-demo.ps1` | 真正的逻辑，支持参数 |

### 为什么命令叫 `demo` 不叫 `start`

`start` 是 **cmd 的内置命令**（用来开新窗口），内置命令的优先级高于 PATH，放一个同名脚本也永远轮不到它。实测过：把 `start.cmd` 放进 PATH 后执行 `start /?`，出来的仍然是内置命令的帮助。

想换名字就改 `demo\bin\` 下的文件名，PATH 不用动。

> 别在跑完后立刻关掉那个黑窗口：它自身跑完就结束了，但后端和模拟器是独立进程，
> 会继续活着。要收工用 `demo-stop`，别直接杀窗口（容易留下孤儿 python 进程占着 8000）。


---

## 脚本做了什么

按依赖顺序拉起四样东西，任何一步失败都会明确告诉你卡在哪：

| 步骤 | 动作 | 常见卡点 |
|---|---|---|
| 0 | 找 JDK 21（`~/.jdks/jdk-21*`）、SDK 路径 | 没装 JDK 21 |
| 1 | 起后端 `uvicorn --host 0.0.0.0 --port 8000` | 绑成 `127.0.0.1` 模拟器就连不进来 |
| 2 | 起 Agent Runtime `:3000`（默认，`-NoAgent` 可跳过），并等到端口就绪才开始下一步 | 「助手」页签靠它；不起或没等它编译完，发消息就会没反应 |
| 3 | 起模拟器并等开机（冷启动约 50 秒） | 3 分钟没起来会提示手动开 |
| 4 | 确认模拟器拿到 `10.0.2.x`，必要时自动连 `AndroidWifi` | **新 AVD 首次启动 wifi 不自动连**，不处理就报「连不上后端」 |
| 5 | 安装 APK（覆盖安装） | 包不存在时提示加 `-Build` |
| 6 | 启动 App | — |

## 常用参数

```powershell
.\demo\start-demo.ps1                    # 默认 Pixel 7（1080×2400）
.\demo\start-demo.ps1 -Avd Small_4_7     # 4.7 寸小屏（768×1280），演示窄屏适配
.\demo\start-demo.ps1 -NoAgent          # 只起后端，不起 Runtime
.\demo\start-demo.ps1 -Build             # 改了前端代码，重新构建 APK 再装
.\demo\start-demo.ps1 -NoEmulator        # 只起后端（用真机或只演示 Web 时）
```

---

## 三种展示形态，按场合选

### A. 模拟器展示（最稳，推荐）

就是上面那条命令。零外部依赖，不怕现场网络、防火墙、IP 变化。

适合：给导师看功能、看适配、看错误处理。

### B. 真机展示（有说服力，但要提前 5 分钟准备）

APK 里的后端地址是**构建时写死**的（模拟器用 `10.0.2.2`），真机必须用电脑的局域网 IP 重新构建：

```powershell
# 1) 查电脑局域网 IP（找 192.168.x.x 或 10.x.x.x 那个）
ipconfig

# 2) 重新构建（IP 换成你自己的）
cd frontend
$env:VITE_API_BASE = "http://192.168.1.23:8000"
npm run build
npx cap sync android
cd android
cmd /c "gradlew.bat assembleDebug --console=plain --no-daemon"

# 3) 装到手机
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

前置条件：
- 手机和电脑**同一个 wifi**
- 后端必须 `--host 0.0.0.0`（脚本已经这么做）
- **Windows 防火墙放行 8000**，第一次跑会弹窗，选「允许专用网络」
- 手机浏览器先访问 `http://<电脑IP>:8000/api/health`，能看到 `{"status":"ok"}` 再往下走

演示完记得把 `release/` 里的包换回模拟器版本，否则下次接模拟器又是旧 IP。

### C. 只演示 Web（最快，但不像 App）

```powershell
.\demo\start-demo.ps1 -NoEmulator
cd frontend; npm run dev      # http://localhost:5173
```

浏览器按 F12 切设备模拟（iPhone SE / Pixel 5）也能看窄屏效果，但没有 WebView 的真实行为。

---

## 演示动线（约 4 分钟）

1. **登录** —— 随便填个用户名。可以故意留空点「进入」，展示前端校验。
2. **今日安排** —— 点「生成安排」，出现 3 条卡片；点第一条「完成」，看角标变「已完成」、待处理数减少。
3. **每日总结** —— 切到「统计」页。默认是**昨天**，显示「这天还没有生成总结」（这是真状态，不是占位）；点「生成这天的总结」→ 出真实结论。再点「后一天」到今天，数字跟着变。
4. **故障处理**（这段最加分）—— 关掉后端那个最小化窗口 → 回 App 点「重新生成」→ **12 秒后**出现「请求超时…请检查后端是否已启动」+「重试」按钮 → 重开后端 → 点「重试」→ 正常恢复。

> 第 4 步要留够 12 秒，别急着说卡住了——那 12 秒就是超时阈值。

---

## 现场排障

| 现象 | 原因 | 处理 |
|---|---|---|
| App 里 `连不上后端` | 后端没起 / 绑了回环 / 模拟器没网 | `curl http://127.0.0.1:8000/api/health` 先验证后端；再看 `adb shell ip -4 addr` 有没有 `10.0.2.x` |
| 请求转圈 12 秒后超时 | 同上，或防火墙拦了 | 同上 |
| 模拟器没网 | 新 AVD 首启 wifi 不连 | `adb shell cmd wifi connect-network AndroidWifi open` |
| 后端明明起来了但手机上连不上 | 模拟器 NAT 状态坏了 | `adb shell svc wifi disable` 再 `enable` |
| 「助手」页签发消息没反应 | 没起 `:3000` Runtime | 重跑 `demo`（默认会起）|
| 页面是旧版本 | APK 没重装 | `-Build` 重跑 |

---

## 演示前 3 分钟自检

```powershell
# 1) 后端活着？
curl http://127.0.0.1:8000/api/health

# 2) 模拟器在线且能到宿主机？
adb devices
adb shell ip -4 addr            # 要有 inet 10.0.2.x

# 3) App 装的是最新包？
adb shell dumpsys package com.qingqing.sedentary | findstr versionName
```

三条都过，基本不会现场翻车。
