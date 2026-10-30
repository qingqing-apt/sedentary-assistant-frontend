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
- 对话历史存在 Runtime 的内存里（`InMemoryAgentRunner`），刷新页面会丢。

## 移动端（Web 响应式）

宽度 ≤1040px 时自动切到移动端布局：单栏、吸顶顶栏、底部四页签（今日 / 统计 / 设置 / 助手）。桌面双栏布局不受影响，两套树由 `useMediaQuery` 分叉渲染。

移动端会隐藏右下角的 CopilotKit 浮层对话（它会盖住 Tab 栏），改用「助手」页签里的按钮式建议。对话式 Agent 后续可做成 Tab 内嵌组件。

## Android APK（Capacitor）

用 Capacitor 把同一套 React 前端包成安卓 App，后端 API 原样复用。

### 构建步骤

```bash
# 0) 前置：JDK 21 + Android SDK（platform 35 / build-tools 35）
#    本机已验证：JDK 21.0.13 + SDK 35

# 1) 构建 Web，并把后端地址注入进去
#    模拟器用 10.0.2.2（映射到宿主机 localhost）；真机改成电脑的局域网 IP
VITE_API_BASE=http://10.0.2.2:8000 npm run build

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

### 两个必须注意的点

1. **后端地址是构建时烧进去的**（`VITE_API_BASE`，见 `src/api.ts`）。换后端地址要重新 `npm run build` + `npx cap sync`。
2. **后端要放行 APK 的 origin**。`androidScheme: "http"` 让 WebView 的 origin 变成 `http://localhost`，后端 CORS 已加白名单；同时 `AndroidManifest` 需要允许明文 HTTP（局域网调试用 `http://`）。

### 目录说明

```
capacitor.config.ts        Capacitor 配置（appId / webDir / androidScheme）
android/                   生成的安卓工程（可直接用 Android Studio 打开）
release/                   本地打包产物（已 gitignore）
```

APK 的包名是 `com.qingqing.sedentary`，应用名「久坐活动助手」，minSdk 23 / targetSdk 35。
