import { defineConfig, devices } from "@playwright/test";

/**
 * 响应式布局的浏览器级回归测试。
 *
 * 为什么不用 jsdom：jsdom 没有真实布局引擎，`getBoundingClientRect()` 全返回 0，
 * 媒体查询也不生效。而移动端最容易坏的地方恰恰是「有没有真的按宽度分叉」和
 * 「底部 Tab 栏有没有压住内容」——这两件事只能在真实浏览器里量。
 *
 * 不依赖后端：所有 /api 请求在用例里用 page.route 拦掉，返回固定数据。
 * 所以它能在 CI 里跑，不需要起 FastAPI。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // 用 dev server 而不是 preview：API 地址留空，请求走相对路径 /api，
    // 正好被 route 拦截捕获，不用为了测试改构建配置。
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
