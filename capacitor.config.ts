import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor 配置：把已有的 React 前端包成 Android APK。
 *
 * 关键点：
 * - `webDir: "dist"`：先把 `npm run build` 的产物同步进 Android 工程。
 * - `androidScheme: "http"`：WebView 的 origin 变成 `http://localhost`，
 *   后端 CORS 已经放行这个来源，省得再处理 https 自签证书的坑。
 * - 后端地址不写在这里，走构建时注入的 `VITE_API_BASE`（见 src/api.ts）。
 */
const config: CapacitorConfig = {
  appId: "com.qingqing.sedentary",
  appName: "久坐活动助手",
  webDir: "dist",
  server: {
    androidScheme: "http",
  },
};

export default config;
