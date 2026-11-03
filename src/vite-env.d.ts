/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 根地址。Web 留空走同域；APK 里填真实后端地址，如 http://10.0.2.2:8000 */
  readonly VITE_API_BASE?: string;
  /**
   * CopilotKit Runtime 地址。Web 留空走 Vite 代理的 /api/copilotkit；
   * APK 里必须填绝对地址，如 http://10.0.2.2:3000/api/copilotkit
   * （WebView 的 origin 是 http://localhost，相对路径会打到 WebView 自己身上）。
   */
  readonly VITE_RUNTIME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
