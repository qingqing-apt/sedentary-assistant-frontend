import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

type AgentErrorInfo = { message: string; hint: string } | null;

interface Props {
  token: string;
  children: ReactNode;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1040px)").matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1040px)");
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/**
 * 对话式助手入口（Microsoft Agent Framework + AG-UI + CopilotKit）。
 *
 * 除了渲染 CopilotKit 面板，还额外做一层失败兜底：CopilotKit v2 没有暴露会话级
 * 错误回调，当 Runtime 或后端不可用时，界面会只有用户消息、没有任何回应，
 * 用户分不清是卡住还是出错。这里拦截发往 Runtime 的请求，把失败翻译成可读提示。
 *
 * 注意：这里的 token 只是转发给 Runtime 做线程隔离，真正的鉴权在 Python 后端
 * /api/agent/chat，它在跑模型之前就会用 401 拦掉无效凭证。
 */
export function AgentChat({ token, children }: Props) {
  const headers = useMemo<Record<string, string>>(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  /**
   * Runtime 地址。Web 版留空时走 `/api/copilotkit`，由 Vite 代理转到 :3000；
   * APK 里 WebView 的 origin 是 `http://localhost`，相对路径会打到 WebView 自己，
   * 必须由构建时的 VITE_RUNTIME_URL 注入绝对地址（如 http://10.0.2.2:3000/api/copilotkit）。
   */
  const runtimeUrl = import.meta.env.VITE_RUNTIME_URL || "/api/copilotkit";

  const [agentError, setAgentError] = useState<AgentErrorInfo>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch.bind(window);

    const isAgentRequest = (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return url.includes("/api/copilotkit");
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isAgentRequest(input)) return originalFetch(input, init);
      try {
        const response = await originalFetch(input, init);
        if (response.status === 401) {
          setAgentError({
            message: "登录状态已失效，助手无法访问你的安排。",
            hint: "请退出后重新登录再试。",
          });
        } else if (response.status >= 500) {
          setAgentError({
            message: `助手服务暂时不可用（HTTP ${response.status}）。`,
            hint: `请确认 Runtime（${runtimeUrl}）和后端都在运行，稍后重试。`,
          });
        } else if (response.ok) {
          setAgentError(null);
        }
        return response;
      } catch (error) {
        setAgentError({
          message: "连不上助手服务，消息没有发出去。",
          hint: `Runtime 地址是 ${runtimeUrl}，请确认它已启动且允许跨域。`,
        });
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [runtimeUrl]);

  return (
    <>
      <CopilotKit
        runtimeUrl={runtimeUrl}
        agent="sedentary_agent"
        headers={headers}
        useSingleEndpoint={false}
        showDevConsole={false}
      >
        {children}
        {/* 移动端不渲染右下角浮层：它会盖住底部 Tab 栏，且 defaultOpen 不生效。
            移动端的对话入口在「助手」Tab 里内嵌（AgentChatInline）。 */}
        {!isMobile && (
          <CopilotPopup
            defaultOpen={false}
            labels={{
              modalHeaderTitle: "活动安排助手",
              welcomeMessageText:
                "想怎么安排？可以问我「今天有什么安排」「下午三点以后还有空吗」，或者让我排两次。",
              chatInputPlaceholder: "比如「下午三点以后给我排两次」",
              chatDisclaimerText: "回答基于你自己真实的安排生成；身体不适请咨询医生。",
            }}
          />
        )}
      </CopilotKit>

      {agentError && (
        <div className="agent-error" role="alert">
          <div className="agent-error__body">
            <strong>{agentError.message}</strong>
            <span>{agentError.hint}</span>
          </div>
          <button
            type="button"
            className="agent-error__close"
            aria-label="关闭提示"
            onClick={() => setAgentError(null)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
