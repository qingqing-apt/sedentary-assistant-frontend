import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});
