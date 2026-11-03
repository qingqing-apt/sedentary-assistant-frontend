# Android 本地联调记录

> 记录日期：2026-11-03　｜　分支：`feature/capacitor`　｜　Capacitor 8.6.0
> 结论：Debug 包可在两种尺寸的模拟器上安装运行，连本地 FastAPI 后端完成登录、活动操作、日报查看；
> 修复了 4 个真实问题，另有 1 项复测未复现、2 项属环境阻塞。

---

## 一、设备与构建信息

| 项 | 值 |
|---|---|
| 设备 A（小屏） | 模拟器 `Small_4_7`，Nexus 4 profile，**4.7″ / 768×1280 / 320dpi** |
| 设备 A 系统 | Android 15（API 35），`google_apis` x86_64 |
| 设备 B（大屏） | 模拟器 `Pixel7_Test`，**6.1″ / 1080×2400 / 420dpi** |
| 设备 B 系统 | Android 15（API 35），`google_apis` x86_64 |
| App | `com.qingqing.sedentary` Debug，minSdk 24 / targetSdk 36 |
| 构建 | AGP 8.13.0 + Gradle 8.14.3 + JDK 21.0.13（Temurin） |
| SDK | platform-36 + build-tools 35.0.1（AGP 自动补齐 platform 36） |
| 后端地址 | `VITE_API_BASE=http://10.0.2.2:8000`（模拟器 → 宿主机） |
| 无 Android Studio | 全程 `gradlew.bat assembleDebug` + `adb`，无 IDE |

> 只用了模拟器，没有实体设备。两个 AVD 的分辨率与 dpi 都不同，能覆盖「4.7″ 窄屏」与「6.1″ 常规屏」的差异，但**触屏手感、真实软键盘高度、厂商 ROM 的 WebView 版本差异**测不到，这是本次验收的已知盲区。

---

## 二、端到端场景（截图都在本目录）

| # | 场景 | 结果 | 截图 |
|---|---|---|---|
| 1 | 冷启动 → 登录页 → 输入校验 / 键盘 | ✅ 卡片随键盘上移，按钮未被遮挡 | `01-login-small.png`、`02-login-keyboard-small.png`、`20-big-login.png`、`21-big-login-keyboard.png` |
| 2 | 登录 → 读取活动 → 完成一项 → 状态刷新 | ✅ 完成后按钮变「已完成」角标，待处理数 3→2 | `05-generated-small.png`、`06-completed-small.png`、`14-recovered-small.png` |
| 3 | 查看每日总结；未生成时显示未生成 | ✅ `state=not_generated` → 点生成 → 出真实结论（3 计划 / 1 完成 / 33%） | `07-summary-not-generated-small.png`、`08-summary-generated-small.png`、`09-today-summary-small.png`、`10-summary-with-data-small.png`、`23-big-summary.png` |
| 4 | 受保护的写操作（生成日报） | ✅ 需 Bearer token；`OPTIONS` 预检 200 → `POST` 200；失败时保持旧状态不假成功 | 同上，请求见后端日志 |
| 5 | 后端不可达 → 明确错误 + 恢复 | ✅ 12 秒后提示「请求超时（12 秒没有响应）…」+「重试」；后端恢复后点重试正常加载 | `13-backend-down-error-small.png`、`14-recovered-small.png` |
| 6 | 关掉重开 → 登录态与数据 | ✅ token 存在 localStorage，冷启动直接进主界面，活动/日报仍从服务端读 | `12-relaunch-persisted-small.png` |
| 7 | 断开 Live Reload 后仍能启动 | ✅ 全程未使用 `server.url`，所有截图都是打包资源版本 | 全部截图 |

横竖屏：`15-landscape-small.png` 记录横屏 1080×768，无横向溢出，卡片与 Tab 栏正常。

---

## 三、修复记录

### 1. 状态栏安全区：**未复现**，只做了防御性写法

先说结论：**这台机器上「状态栏压住标题」根本没有发生**。曾经按「Android 15 强制 edge-to-edge」的常见说法改过 `.topbar` 的 padding，后来实测推翻了，所以这条按「未复现」记录，改动保留但降级为前置防护。

- **实测数据**（`Small_4_7` / `Pixel7_Test`，均 API 35，PowerShell 连不上就改走 CDP 读 WebView）：

  ```
  viewport: 412 × 839 CSS px, dpr 2.625
  --safe-area-inset-top : 0px
  env(safe-area-inset-top) : 0px
  .topbar 的 padding-top : 10px（加了 var 也是 10px，因为变量是 0）
  WebView 的 screenY : 136 设备像素 ≈ 51.8 CSS px
  ```

- **原因**：这代 WebView（Chromium < 140）下，Capacitor 8 的 SystemBars 插件已经把 WebView **原生内缩**了状态栏高度（那 136px），页面本身不是 edge-to-edge，所以 CSS 侧再补是重复计算；同时它也把 insets 报成 0，两边自洽。
- **为什么还是留了 `--inset-top` / `--inset-bottom`**：WebView ≥ 140 的机型上原生不再内缩，`env()` 才会变成真实数值，那时顶部必须补。写法按 `--safe-area-inset-*` → `env(...)` → `0px` 三级兜底，两种机型都不用改代码。
- **对照证据**：`00-before-safe-area.png` 是拿掉 padding 后重新打的包，`22-big-today.png` 是带 padding 的版本——两者 header 位置一致，正好印证「变量为 0，所以没有差别」。测完已把临时改动撤掉，仓库里只有最终版本。
- **要重新确认的场景**：真机、Android 16+、或厂商 ROM 自带更新版 WebView。

### 2. 后端不可达时永久转圈，等不到错误

- **设备**：`Small_4_7`
- **复现**：停掉 uvicorn → 冷启动 App（已登录）→ 界面停在「正在加载今天的安排…」，**无限等待**，既无错误也无重试入口
- **原因**：`fetch` 没有超时。后端进程没起、端口被明确拒绝时 fetch 会立刻失败，但中间只要有一层把包吃掉却不回 RST（模拟器端口转发、网关、手机切网瞬间都会这样），`fetch` 就一直挂着
- **修改**：`src/api.ts`
  - 加 `AbortController` + 12 秒超时
  - 区分两种失败：`TIMEOUT` → 「请求超时（12 秒没有响应），请检查后端是否已启动、手机能否访问到这台电脑」；`NETWORK` → 「连不上后端。请确认后端已启动，且手机与电脑在同一网络、防火墙放行该端口」
  - 原来这里只有浏览器给的 `Failed to fetch`，用户完全无法判断该查什么
- **验证**：`13-backend-down-error-small.png`（12 秒后出错误 + 重试）、`14-recovered-small.png`（后端恢复后点重试正常）
- **单测**：`src/test/api.test.ts` 的 `请求挂住不会一直转圈…`（假定时器推进 12.1 秒断言 `code === "TIMEOUT"`）与 `连不上后端时给出可操作的提示…`

### 3. 「每日总结」的未生成状态无法表达

- **设备**：两台都验
- **问题**：今天验收要求「查看前一天的每日总结；若尚未生成，正确显示尚未生成状态，不伪造数据」。原实现只有 `GET /api/stats/weekly`（本周聚合），既没有按天的日报接口，也没有任何「这天有没有生成过」的记录，前端只能拿周统计凑
- **修改**：
  - 后端新增 `daily_summaries` 表（**只存生成过的**）+ `GET/POST /api/summary/daily?date=`，返回 `state` / `stats` / `summary`
  - `stats` 每次从 `activities` 现算，不落库——用户生成总结后仍可能补记活动，抄下来的数字会立刻过期
  - 前端 `DailySummaryPanel` 严格按 `state` 分支：`not_generated` 时只显示空状态与统计，**不拼文案**
- **验证**：`07`（未生成）、`08`/`10`（生成后）、`23`（大屏）
- **单测**：后端 `tests/test_summary.py` 9 条；前端 `src/test/daily-summary.test.tsx` 9 条（含「state 说没生成但后端给了内容时以 state 为准」）

### 4. 移动端空状态文案指向不存在的「右侧」

- **设备**：`Small_4_7`
- **复现**：今日页无安排时提示「先确认**右侧**的工作时段和可活动时段」——手机上根本没有右侧栏，设置是底部 Tab 里的独立页
- **原因**：这段文案是桌面双栏布局时期写的，移动端改成 Tab 后没同步
- **修改**：`src/components/TodayList.tsx` → 「先确认**「设置」里**的工作时段和可活动时段」
- **验证**：`04-today-small.png`

### 5. 明文 HTTP 配置会跟着进 release 包

- **问题**：`usesCleartextTraffic="true"` 原来写在 `src/main/AndroidManifest.xml`，会同时合并进 release，等于正式包也允许明文 HTTP
- **修改**：
  - 主清单删掉该项
  - 新增 `android/app/src/debug/AndroidManifest.xml` 单独放行，只在 debug 变体生效
- **验证**（无需真机）：
  ```
  app/build/intermediates/merged_manifest/debug/.../AndroidManifest.xml   → usesCleartextTraffic="true"
  app/build/intermediates/merged_manifest/release/.../AndroidManifest.xml → 无该属性
  ```
- **副作用**：移除后 `tools:replace` 变成多余声明（AGP 会告警 `no other declaration present`），已一并去掉

### 6. Capacitor 7 → 8 的机械升级

不是 bug，但改动面大，单独记：

| 文件 | 改动 |
|---|---|
| `package.json` | `@capacitor/core` / `android` / `cli` → `^8.6.0` |
| `android/variables.gradle` | minSdk 23→24、compileSdk/targetSdk 35→36、androidx 一整套版本按官方 8.0 迁移表更新 |
| `android/build.gradle` | AGP 8.7.2→8.13.0、google-services 4.4.2→4.4.4 |
| `android/gradle/wrapper/gradle-wrapper.properties` | Gradle 8.11.1→8.14.3 |
| `android/app/build.gradle` | Gradle 属性名语法改 `=`（`namespace =` / `compileSdk =` / `ignoreAssetsPattern =`） |
| `android/app/src/main/AndroidManifest.xml` | `configChanges` 增加 `density`（否则窗口尺寸变化会重载 WebView） |

未受影响：`capacitor.config.ts` 不用改；`bridge_layout_main.xml` 未引用；`android.adjustMarginsForEdgeToEdge` 本项目没用过。

---

## 四、复测未复现的两项

**1. 软键盘遮挡登录按钮**：在两台模拟器上都试了（`02`、`21`），键盘弹出时登录卡片整体上移，`进入` 按钮完整可见，未复现遮挡。
原因是 Capacitor 默认 `windowSoftInputMode=adjustResize`，WebView 视口跟着缩，居中布局自然上移。
**结论**：不改代码。但如果以后把登录页改成 `position: fixed` 底部对齐，就会重新踩这个坑。

**2. 状态栏压住吸顶标题**：见修复记录第 1 条。按「Android 15 强制 edge-to-edge」的说法先改了，实测 insets 都是 0、WebView 已被原生内缩，属于误判。改动降级为防御性写法保留，文档和注释都改成实测事实。

> 这两条是今天唯一两处「先改代码、后验证」的地方，代价是白改了一版。记下来是因为：手机上看起来对，不代表改动起了作用——`getComputedStyle` 读出来的 0px 才是证据。

---

## 五、环境阻塞（不是代码问题，但会卡住别人）

| 现象 | 原因 | 处理 |
|---|---|---|
| `./gradlew` 卡在 "Starting a Gradle Daemon" 不动 | Git Bash（MSYS）下这个 shell 脚本报 `xargs: assertion "bc_ctl.arg_max >= LINE_MAX" failed` 后无声挂住 | 用 `cmd //c gradlew.bat`，或 PowerShell |
| Gradle 发行版下载 36 KB/s，214MB 要几小时 | `services.gradle.org` 国内不可用 | 从 `mirrors.cloud.tencent.com/gradle/` 下载后直接放进 `~/.gradle/wrapper/dists/gradle-8.14.3-all/<hash>/`，不改仓库配置 |
| 新 AVD 启动后 `10.0.2.2` 不可达（App 报 `Failed to fetch`） | 首启 wifi 未自动连，`ip route` 为空 | `adb shell cmd wifi connect-network AndroidWifi open` |
| 后端重启后 App 请求超时，但 `ping 10.0.2.2` 通 | QEMU NAT 对该连接的状态未回收，不回 RST | `adb shell svc wifi disable && svc wifi enable` |
| `sdkmanager` / `avdmanager` 不存在 | 本机 SDK 没装 cmdline-tools | 解压 `commandlinetools-win-*.zip` 到 `$ANDROID_HOME/cmdline-tools/latest` |

---

## 六、Live Reload 与生产配置差异

- **本次全程没有用 Live Reload**。没有配 `server.url`，没有开 `cleartextTraffic` 之外的临时开关，所有截图都是「打包进 APK 的 `assets/public`」跑出来的。任务里说的「断开 Live Reload 再验证」等价于「从没连过也能跑」，证据是 `adb shell dumpsys package` 里没有 dev server 依赖、且断网后重装仍能出登录页。
- **Debug 与 Release 的唯一配置差异**就是明文 HTTP：debug 放行，release 不放行（见修复记录 5）。
- **后端地址不落仓库**：`VITE_API_BASE` 是构建时环境变量，`dist/` 与 `android/app/src/main/assets/public/` 都不进 Git。换地址只改命令，不改文件。
- **没有硬编码**：仓库里搜不到 `10.0.2.2`、局域网 IP、token、模型密钥（`10.0.2.2` 只出现在 README 的示例命令里）。

---

## 七、已知问题与后续

1. **没在实体手机上验过**：真实软键盘高度、厂商 ROM 的 WebView 版本（部分国产 ROM 停在 Chromium 100 上下）、刘海/挖孔的实际安全区数值，都要真机才能确认。当前的安全区实现依赖 Capacitor 注入的 `--safe-area-inset-*`，在真机上应再核一遍。
2. **对话式 Agent 没在 APK 里跑通**：它还需要 `npm run runtime`（:3000）这一层，本次联调只起了后端 :8000，所以「助手」页签没做端到端验收。Web 端这条链路原本是通的（第五天验过）。
3. **日报生成是规则版**，不是模型生成。`source` 字段已预留 `agent`，接模型不用改接口和前端。
4. **没有 Android 仪器测试**（Espresso）。当前的设备行为靠截图 + `adb` 手测覆盖，这在本周时间盒内可接受，但不可回归。
5. **APK 9.5MB**，其中大部分是 CopilotKit + mermaid 的 JS。没做分包优化，`vite build` 会提示 chunk > 500kB。
