import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // 默认 500kB 的告警对我们没意义：这是个会打进 APK 的应用，
    // 真正要盯的是「首屏要下多少」和「缓存能不能复用」，见下面 manualChunks。
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * 手动分包。目的有三个：
         *
         * 1. 首屏只拉真正需要的。改动业务代码时 React / CopilotKit 这些
         *    几乎不变的大块指纹不变，Web 端缓存能复用，不用整包重下。
         * 2. 把 mermaid 单独切出去。对话里带 mermaid 图表时才走到它，
         *    不画图的人不该为它付首屏代价。
         * 3. 避免 Rollup 把 365 个动态 chunk 全塞进两个 2MB 的大文件里——
         *    那样任何一处微调都会让整包指纹失效。
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("mermaid") || id.includes("@mermaid-js")) return "mermaid";
          if (id.includes("@copilotkit") || id.includes("@ag-ui")) return "copilotkit";
          if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype")) {
            return "markdown";
          }
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // CopilotKit Runtime（Node Express，端口 3000）必须放在 /api 之前，
      // 否则会被下面的 /api 规则先匹配走，对话请求直接打到 Python 后端。
      "/api/copilotkit": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // 其余 /api 请求转发到 Python 后端，避免 CORS 和写死地址
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // 组件里的 matchMedia / ResizeObserver 在 jsdom 里不存在，统一在 setup 里补
    restoreMocks: true,
  },
});
