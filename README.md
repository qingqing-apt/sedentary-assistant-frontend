# 久坐活动助手 · 前端

Vite + React + TypeScript + CopilotKit。没有引入 UI 库、状态管理库和图表库，请求统一走 `src/api.ts` 一层封装。

## 本地启动

**需要两个进程**：Vite 提供页面，CopilotKit Runtime 负责把对话请求转成 AG-UI 发给后端。

```bash
npm install
npm run runtime    # 终端 1 · CopilotKit Runtime，:3000
npm run dev        # 终端 2 · 页面，:5173
npm run build      # 类型检查 + 生产构建
```

代理关系（见 `vite.config.ts`，顺序不能反）：

```
/api/copilotkit  → http://localhost:3000    CopilotKit Runtime
/api             → http://127.0.0.1:8000    Python 后端
```

`/api/copilotkit` 必须写在 `/api` 前面，否则对话请求会被后面那条规则先匹配走，直接打到 Python 后端。

## 页面结构

```
src/
  api.ts              请求封装 + 错误映射（ApiError 带 code）
  types.ts            与后端约定的类型
  components/
    Login.tsx         练习版登录
    AgentChat.tsx     CopilotKit Provider + 对话面板 + 连接失败兜底
    Assistant.tsx     页面容器：加载 / 失败 / 正常三态
    TodayList.tsx     今日安排 + 完成/推迟/今天不方便
    DailySummaryPanel.tsx 每日总结（未生成 / 已生成两态 + 前后一天切换）
    WeeklyPanel.tsx   本周统计 + 每日完成条
    SettingsPanel.tsx 工作时段、可活动时段、免打扰、提醒偏好
    AgentPanel.tsx    按钮式建议：输入 → 建议 → 逐条取舍 → 确认保存
    Toast.tsx         轻提示
runtime/
  server.ts           CopilotKit Runtime（Express），转发到后端 /api/agent/chat
test/
  setup.ts            jsdom 缺失的 matchMedia / ResizeObserver 兜底
  api.test.ts         地址注入、错误透传、401 清理、超时
  login.test.tsx      表单校验、错误提示、重复提交
  daily-summary.test.tsx 未生成态不许伪造内容、日期换算
```

## 每日总结（按天回看）

「统计」页签顶部是 `DailySummaryPanel`，默认看**昨天**（今天还没过完，完成率没有意义），可前后翻一天。

后端 `GET /api/summary/daily?date=YYYY-MM-DD` 返回 `state` 与 `stats` 两块，语义严格分开：

- `stats`（计划/完成/推迟/跳过/完成率）**每次从 activities 现算**，和有没有生成过总结无关。
- `state` 只有 `generated` / `not_generated`。没生成过时 `summary` 必为 `null`，界面显示「这天还没有生成总结」+ 生成按钮，**不会拿 stats 拼一段话顶上**。

`POST` 同一个地址才会真正生成并落库（`daily_summaries` 表，只存「生成过的」）。当前生成器是规则版（`source: "rule"`，按完成率分档给结论），不调模型——理由是总结要能被测试断言，也要在没配 API Key 的机器上照常工作；`source` 字段留给以后接模型生成。

## 前端测试

```bash
npm run test          # 25 个用例，串行跑
npm run test:parallel # 并行（本机沙箱里 worker 写临时目录会被拒，只会跑掉第一个文件）
```

`test` 默认带 `--no-file-parallelism`：沙箱/部分 CI 环境下并行 worker 写
`Temp/vitest/...` 会报 `EPERM`，表现是「只跑了一个测试文件却不报错」——这种假绿比慢几秒危险得多。
3 个文件串行也就 2 秒。

覆盖的是「手机端最容易坏、又最难在真机上定位」的那部分：API 地址注入、错误文案、超时、登录表单校验、日报的未生成/已生成分支。

## 两条 Agent 入口的界面落点

- **按钮式**：右侧栏「让助手排一下」，走 `POST /api/agent/suggest`，一次性给建议列表，用户勾选后确认。
- **对话式**：右下角悬浮面板，走 CopilotKit → AG-UI，能多轮追问、能自己查数据。

保留两条是因为按钮式在模型不可用时能降级成规则版，而对话式做不到——它依赖模型理解自然语言。

## 四个刻意的做法

**不做乐观更新。**
推迟请求可能被后端 409 拒绝（今天没有更晚的空位了），前端先改状态会造成「界面显示推迟了、刷新又变回来」。三个按钮都是等响应回来再刷新，按钮上有独立 loading，不会整页转圈。

**状态只从后端来。**
活动状态不写 `localStorage`。刷新后一切以 `GET /api/activities/today` 为准，这也是验收里「刷新后状态仍在」那条唯一靠得住的实现方式。

**每 4 秒轮询今日列表。**
Agent 在对话里保存安排时，前端拿不到任何通知（工具是后端执行的），列表会停在旧数据上。CopilotKit v2 没有暴露会话级的运行状态回调，所以用轮询兜底：本地 SQLite 查询开销可忽略，页面切到后台自动停。

**对话面板自己做失败兜底。**
CopilotKit 没有公开的会话级错误回调，Runtime 或后端挂掉时界面会「只有用户消息、没有回应」，用户分不清是卡住还是出错。`AgentChat.tsx` 拦截发往 `/api/copilotkit` 的请求，把 401 / 5xx / 网络错误翻译成可读提示。

## 提醒开关的作用

`reminders_enabled` 关掉后，页面不再出现「有 N 条活动到点了」的条幅，列表里的「已过期」标记也不显示。活动本身仍然可以操作，只是不再主动提示。

## 已知取舍

- CopilotKit 打包后首屏 chunk 约 2.4 MB，因为它自带 mermaid、代码高亮等。演示项目不拆包；要优化可以配 `build.rollupOptions.output.manualChunks`。
- 对话面板首次加载会自动展开，点右下角按钮可收起。
- 对话历史存在 Runtime 的内存里（`InMemoryAgentRunner`），**重启 Runtime 会丢**；刷新页面不会，详见下一节。

## 会话与上下文

对话历史按 thread 隔离。threadId 由前端生成一次后存进 `localStorage`（key 用 token 哈希派生，不写明文凭证），并显式传给 CopilotKit —— threadId 一旦是外部传入的，内部就不会再自己生成新的。

| 操作 | 历史 |
|---|---|
| 页面内继续对话 | 保留 |
| 刷新 / 关标签页再开 | **保留**（threadId 从 localStorage 恢复） |
| **杀掉 App 进程再打开（APK）** | **保留**（已实测，见 `docs/screenshots/06-apk-context-memory.png`） |
| 换个用户登录 | 互不可见（threadId 按用户隔离） |
| 重启 Runtime（`npm run runtime`） | **保留**（`DurableAgentRunner` 落盘，已实测） |

### 历史怎么落盘的（`runtime/durable-runner.ts`）

CopilotKit 官方只给了 `InMemoryAgentRunner`，历史在进程内存里，重启就没。两条官方路线是接它的 Intelligence 托管后端，或自己实现 `AgentRunner`（4 个抽象方法 + 线程所有权 + 运行上限 + 事件 compact，约 500 行）。

这里走的是第三条：**包一层**。`InMemoryAgentRunner` 的所有实例共享一个模块级 store，包作者把它以 `ɵGLOBAL_STORE` 导出了（注释原话：so tests can inspect the exact store the runner writes to）。于是：

- **写**：重写 `run()`，用 rxjs 的 `finalize` 在每轮结束（完成 / 出错 / 被打断都会走）把该线程的 `messagesSnapshot` + `historicRuns` 整体写盘，原子 rename 避免半截文件。
- **读**：启动时读 `.runtime-data/threads/*.json`，塞回 `ɵGLOBAL_STORE`。
- **清**：重写 `clearThreads()`，同步删盘，否则下次启动历史又回来。

`ɵ` 前缀是内部 API，所以做了三层兜底：字段不存在就跳过该线程、读写的任何异常只 warn 不抛（落盘失败是降级，回复出不来才是故障）、一个线程文件坏了不影响其它线程。**升级 CopilotKit 后必须跑一次 `npm run verify:threads`**——它真的会杀掉 Runtime 再拉起来验证。

历史目录默认 `.runtime-data/threads`（已 gitignore），可用 `THREADS_DIR` 环境变量改。这个目录会随聊天增长，目前没有自动清理，演示前想清空直接删掉即可。

## 移动端（Web 响应式）

宽度 ≤1040px 时自动切到移动端布局：单栏、吸顶顶栏、底部四页签（今日 / 统计 / 设置 / 助手）。桌面双栏布局不受影响，两套树由 `useMediaQuery` 分叉渲染。

移动端不渲染右下角浮层（它会盖住 Tab 栏），对话式 Agent 改成「助手」页签里内嵌的 `CopilotChat` 面板，和按钮式建议放在同一页。两种入口共用同一个 Provider 与后端 Agent。

## Android APK（Capacitor 8）

用 Capacitor 8 把同一套 React 前端包成安卓 App，后端 API 与对话式 Agent 原样复用。

### 环境要求（Capacitor 8 抬高了门槛）

| 项 | Capacitor 7（旧） | **Capacitor 8（当前）** |
|---|---|---|
| Node | 18+ | **22+** |
| JDK | 21 | 21（不变） |
| Android Studio | 2024.2.1+ | **Otter 2025.2.1+**（本机已装 2026.2.2.8，构建仍走 CLI） |
| compileSdk / targetSdk | 35 | **36** |
| minSdk | 23 | **24** |
| AGP | 8.7.2 | **8.13.0** |
| Gradle | 8.11.1 | **8.14.3** |

本机实际验证环境：Node 22.22.2 + JDK 21.0.13（`~/.jdks/jdk-21.0.13+9`）+ SDK platform 36 / build-tools 35.0.1。
**Android Studio 2026.2.2.8 已装**（`C://Program Files\Android\Android Studio`），但构建仍走命令行 Gradle——CI 和脚本都不依赖 IDE。SDK 组件由 AGP 自动下载补齐（`platforms/android-36` 就是这么来的）。

### 构建步骤

```bash
# 0) 环境变量（每次开新终端都要设；Windows 上路径用反斜杠）
export JAVA_HOME="C:\Users\<you>\.jdks\jdk-21.0.13+9"
export ANDROID_HOME="C:\Users\<you>\AppData\Local\Android\Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# 1) 构建 Web，把两个地址烧进去
#    模拟器用 10.0.2.2（映射到宿主机）；真机改成电脑的局域网 IP
VITE_API_BASE=http://10.0.2.2:8000 \
VITE_RUNTIME_URL=http://10.0.2.2:3000/api/copilotkit \
npm run build

# 2) 同步到 Android 工程
npx cap sync android

# 3) 打 debug 包
cd android
./gradlew.bat assembleDebug          # Windows 用 .bat，见「六个坑」第 1 条
# macOS / Linux: ./gradlew assembleDebug

# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

装到设备：`adb install -r app-debug.apk`。

> **两个地址都要注入，少一个就是两个不同的故障。**
>
> - 只漏 `VITE_API_BASE` → 登录、列表、日报全部连不上，**12 秒后**会明确报错（看得见）。
> - 只漏 `VITE_RUNTIME_URL` → 前面都正常，**只有「助手」页签发消息会静默消失**：`runtimeUrl` 退化成相对路径 `/api/copilotkit`，在 WebView 里打到 Capacitor 自带本地服务，拿到一张 **200 的 index.html**，不报错、不超时。
>
> 第二种是 2026-11-03 验收被打回的直接原因。`AgentChat` 现在有两道兜底（按 Content-Type 判真伪 + 原生环境启动自查），但它只能提示，不能替你把地址配对。

### 三个服务，一个都不能少

APK 里的对话式 Agent 走的是和 Web 完全相同的三层链路，**只是地址从 Vite 代理换成绝对地址**：

```
APK 的 WebView (http://localhost)
   │  POST http://10.0.2.2:3000/api/copilotkit        ← VITE_RUNTIME_URL
   ▼
CopilotKit Runtime :3000  (npm run runtime，必须监听 0.0.0.0)
   │  POST http://127.0.0.1:8000/api/agent/chat
   ▼
FastAPI 后端 :8000  (uvicorn --host 0.0.0.0)
   │
   ▼
DeepSeek + 7 个业务工具
```

所以跑 APK 时要同时起三个进程：

```bash
cd backend   && uvicorn app.main:app --host 0.0.0.0 --port 8000   # 终端 1
cd frontend  && npm run runtime                                   # 终端 2（:3000）
# 终端 3 可选：只在还要用浏览器调试时才需要
cd frontend  && npm run dev                                       # :5173
```

**Runtime 必须监听 `0.0.0.0`**。默认的 `localhost` 只绑回环，模拟器和真机都连不进来，
表现就是对话一直转圈或者提示「连不上助手服务」。

### 正式签名（release 包）

debug 包用的是 Android 自动生成的调试密钥，换台机器就变，装不了覆盖升级。要分发得有自己的 key。

**密钥不进仓库**：`android/keystore.properties` 和 `*.keystore` 都在 `.gitignore` 里。`build.gradle` 读不到这个文件时会**跳过签名配置**——没配密钥的机器照样能 `assembleDebug`，只是打出来的 release 没签名。这是故意的：不要为了让 CI 绿起来把密钥塞进仓库。

首次生成（一次就够，之后备份好）：

```bash
cd android
"$JAVA_HOME/bin/keytool" -genkeypair -v \
  -keystore app/release.keystore -alias sedentary \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "<你的密码>" -keypass "<同一个密码>" \
  -dname "CN=久坐活动助手, OU=Demo, O=Personal, L=Beijing, ST=Beijing, C=CN"
```

写 `android/keystore.properties`（相对 `android/app/` 解析）：

```properties
storeFile=release.keystore
storePassword=<你的密码>
keyAlias=sedentary
keyPassword=<同一个密码>
```

出包与验证：

```bash
cd android
./gradlew.bat assembleRelease
$ANDROID_HOME/build-tools/35.0.1/apksigner.bat verify -v app/build/outputs/apk/release/app-release.apk
# → Verified using v2 scheme (APK Signature Scheme v2): true
ls -lh app/build/outputs/apk/release/app-release.apk
```

本机实测：签名后 **7.9 MB**，比 debug 的 10.0 MB 小（debug 带符号信息）。用的是 v2 方案（v1/v3 均为 false，minSdk 24 只要求 v2 即可）。

**丢了密钥的后果**：已经装过的用户无法覆盖升级，只能卸载重装（数据丢失）。所以 `release.keystore` + 密码要单独备份，别只留在这台机器上。

### 明文 HTTP 只存在于 debug 包

`usesCleartextTraffic="true"` **不在** `src/main/AndroidManifest.xml` 里，而是在
`src/debug/AndroidManifest.xml`。原因：主清单里的这项配置会同时进入 release 包，
把「只允许 HTTPS」的生产约束一起放开了。

验证方式（不需要真机）：

```bash
cd android
./gradlew.bat processDebugMainManifest processReleaseMainManifest
grep -o 'usesCleartextTraffic="[a-z]*"' app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml
# → usesCleartextTraffic="true"
grep -o 'usesCleartextTraffic="[a-z]*"' app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml
# → 无输出：release 不允许明文
```

### 安全区：先测，再决定要不要补

Capacitor 8 / targetSdk 36 在 Android 15+ 上按文档是强制 edge-to-edge，但**本机实测不是**：
在 API 35 模拟器上，Capacitor 的 SystemBars 插件已经把 WebView 原生内缩了状态栏高度，
`--safe-area-inset-top` 和 `env(safe-area-inset-top)` 读出来都是 `0px`。

所以 `src/styles.css` 里的 `--inset-top` / `--inset-bottom` 在这台机器上不产生任何视觉差异，
它是留给 **WebView ≥ 140**（原生不再内缩、`env` 才会给真实值）机型的前置防护：

```css
--inset-top:    var(--safe-area-inset-top,    env(safe-area-inset-top, 0px));
--inset-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
```

不要在 `.topbar` 里写死像素补丁——换机型必错。改之前先用 CDP 读一次真实值：

```bash
PID=$(adb shell pidof com.qingqing.sedentary)
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s --noproxy '*' http://127.0.0.1:9222/json   # 拿到 webSocketDebuggerUrl
# 再用 CDP 的 Runtime.evaluate 读
# getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')
```

### 六个坑（都是本机实测踩到的）

1. **Git Bash 里 `./gradlew` 会卡在 "Starting a Gradle Daemon"**：MSYS 下这个 shell 脚本会报
   `xargs: assertion "bc_ctl.arg_max >= LINE_MAX" failed` 然后无声挂住。改用 `cmd //c gradlew.bat`。
2. **`services.gradle.org` 在国内几乎不可用**（实测 36 KB/s，214MB 要几小时）：换腾讯云镜像
   `https://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-all.zip`，把 zip 直接放进
   `~/.gradle/wrapper/dists/gradle-8.14.3-all/<hash>/` 即可，**不用改仓库里的 `distributionUrl`**。
3. **新建的 AVD 首次启动 wifi 不自动连**：`ip route` 是空的，`10.0.2.2` 自然不可达，
   表现是 App 里 `Failed to fetch`。`adb shell cmd wifi connect-network AndroidWifi open` 解决。
4. **模拟器里 `10.0.2.2` 走 QEMU NAT，后端重启后可能挂住不回 RST**：ping 通但 HTTP 超时，
   重启一下 wifi（`svc wifi disable/enable`）就恢复。这也是 API 层加 12 秒超时的原因。
5. **本机 SDK 里没有 `cmdline-tools`** 时 `sdkmanager` / `avdmanager` 都不可用，
   建 AVD 只能手搓配置。装一份即可：解压后放到 `$ANDROID_HOME/cmdline-tools/latest`。
6. **并行跑测试时可能只跑第一个文件，还不报错**：沙箱/部分 CI 环境下 vitest 的 worker
   写临时目录会被拒（`EPERM ... Temp/.../web/...`），剩下的文件直接不加载。`test` 脚本
   已经默认加 `--no-file-parallelism`，要并行用 `npm run test:parallel`。

### 目录说明

```
capacitor.config.ts        Capacitor 配置（appId / webDir / androidScheme）
android/                   生成的安卓工程（可直接用 Android Studio 打开）
android/app/src/debug/     仅 debug 生效的清单（明文 HTTP 放行）
runtime/server.ts          CopilotKit Runtime（Express + CORS，转发到后端 AG-UI）
docs/android/              联调截图与问题记录
release/                   本地打包产物（已 gitignore，只保留 .apk）
```

APK 的包名是 `com.qingqing.sedentary`，应用名「久坐活动助手」，minSdk 24 / targetSdk 36。

