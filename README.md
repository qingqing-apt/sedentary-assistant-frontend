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
    WeeklyPanel.tsx   本周统计 + 每日完成条
    SettingsPanel.tsx 工作时段、可活动时段、免打扰、提醒偏好
    AgentPanel.tsx    按钮式建议：输入 → 建议 → 逐条取舍 → 确认保存
    Toast.tsx         轻提示
runtime/
  server.ts           CopilotKit Runtime（Express），转发到后端 /api/agent/chat
```

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
| 换个用户登录 | 互不可见（threadId 按用户隔离） |
| 重启 Runtime（`npm run runtime`） | **丢失** |

最后一行是当前架构的边界，不是 bug：`@copilotkit/runtime` 只提供 `InMemoryAgentRunner`，历史实体在进程内存里。要彻底解决有两条路——自己实现 `AgentRunner` 接口把 thread 落 SQLite/文件，或者改成前端每次带全量 messages 给后端。

这也意味着：**改完 `runtime/server.ts` 重启 Runtime 后，历史会清空**，这是预期行为。后端重启不影响（历史不在后端）。

## 移动端（Web 响应式）

宽度 ≤1040px 时自动切到移动端布局：单栏、吸顶顶栏、底部四页签（今日 / 统计 / 设置 / 助手）。桌面双栏布局不受影响，两套树由 `useMediaQuery` 分叉渲染。

移动端不渲染右下角浮层（它会盖住 Tab 栏），对话式 Agent 改成「助手」页签里内嵌的 `CopilotChat` 面板，和按钮式建议放在同一页。两种入口共用同一个 Provider 与后端 Agent。

## Android APK（Capacitor）

用 Capacitor 把同一套 React 前端包成安卓 App，后端 API 与对话式 Agent 原样复用。

### 构建步骤

```bash
# 0) 前置：JDK 21 + Android SDK（platform 35 / build-tools 35）
#    本机已验证：JDK 21.0.13 + SDK 35

# 1) 构建 Web，把「后端」和「Agent Runtime」两个地址都注入进去
#    模拟器用 10.0.2.2（映射到宿主机 localhost）；真机改成电脑的局域网 IP
VITE_API_BASE=http://10.0.2.2:8000 \
VITE_RUNTIME_URL=http://10.0.2.2:3000/api/copilotkit \
npm run build

# 2) 同步到 Android 工程
npx cap sync android

# 3) 打 debug 包
cd android
export JAVA_HOME="/path/to/jdk-21"
export ANDROID_HOME="/path/to/Android/Sdk"
./gradlew assembleDebug

# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

装到手机：`adb install -r app-debug.apk`，或直接把 APK 拷进手机点击安装。

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

### 三个必须注意的点

1. **两个地址都是构建时烧进去的**：`VITE_API_BASE`（后端）和 `VITE_RUNTIME_URL`（Agent 中转到 `src/components/AgentChat.tsx`）。换地址必须重新 `npm run build` + 覆盖 `android/app/src/main/assets/public/`。
2. **Runtime 和 后端都要放行 APK 的 origin**。`androidScheme: "http"` 让 WebView 的 origin 变成 `http://localhost`：后端 CORS 已加白名单，Runtime 侧用 `cors({ origin: true })` 反射放行；同时 `AndroidManifest` 需要 `usesCleartextTraffic="true"`（局域网调试用 `http://`）。
3. **Android WebView 不支持 `oklch()`**（需要 Chrome 111+，Android 15 自带的是 110）。CopilotKit v2 的主题变量全是 oklch，会让对话面板背景整条失效变成透明。`src/styles.css` 末尾已用 sRGB 覆盖成同一套色板兜底，**不要删掉那段**。

### 目录说明

```
capacitor.config.ts        Capacitor 配置（appId / webDir / androidScheme）
android/                   生成的安卓工程（可直接用 Android Studio 打开）
runtime/server.ts          CopilotKit Runtime（Express + CORS，转发到后端 AG-UI）
release/                   本地打包产物（已 gitignore）
```

APK 的包名是 `com.qingqing.sedentary`，应用名「久坐活动助手」，minSdk 23 / targetSdk 35。
