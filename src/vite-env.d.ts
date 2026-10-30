/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 根地址。Web 留空走同域；APK 里填真实后端地址，如 http://10.0.2.2:8000 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
