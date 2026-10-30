import express from "express";
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import { HttpAgent } from "@ag-ui/client";

// Python 后端的 AG-UI 端点（Agent Framework + DeepSeek）
const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000/api/agent/chat";
const PORT = Number(process.env.COPILOT_RUNTIME_PORT || 3000);

/**
 * 取 header。CopilotKit 在不同版本里传进来的可能是 Fetch Request 或 Express Request，
 * 前者的 headers 有 .get()，后者是普通对象，两种都要能读。
 */
function headerOf(request: unknown, name: string): string {
  const headers = (request as { headers?: unknown } | undefined)?.headers;
  if (!headers) return "";
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) || "";
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  const value = bag[name] ?? bag[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/**
 * 从 Authorization 提取用户标识，仅用于线程隔离。
 *
 * 这里**不做签名校验**——真正的鉴权由 Python 后端 /api/agent/chat 完成，
 * 它会在跑模型之前用 401 拦掉无效凭证。这边解码错了也不要紧，
 * 最坏结果是线程名不对，不会造成越权。
 */
function getUserId(request: unknown): string | null {
  const token = headerOf(request, "authorization").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  // 练习环境 token 形如 demo.<用户名>
  if (token.startsWith("demo.")) return token.slice("demo.".length) || null;

  // 真实 JWT：只取 payload 里的 sub，不验签
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.sub === "string" ? decoded.sub : token;
  } catch {
    return token;
  }
}

const runtime = new CopilotRuntime({
  agents: {
    // 前端 <CopilotKit agent="sedentary_agent"> 通过这个标识找到后端 Agent
    sedentary_agent: new HttpAgent({ url: AGENT_URL }),
  },
  runner: new InMemoryAgentRunner(),
  // 按登录用户隔离线程：不同账号的对话历史互不可见
  identifyUser: (request) => {
    const id = getUserId(request);
    if (!id) return null;
    return { id, name: id };
  },
});

const app = express();
app.use(createCopilotExpressHandler({ runtime, basePath: "/api/copilotkit" }));

app.listen(PORT, () => {
  console.log(`CopilotKit Runtime: http://localhost:${PORT}/api/copilotkit`);
  console.log(`  -> forwards to agent: ${AGENT_URL}`);
});
