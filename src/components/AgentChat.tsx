import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

type AgentErrorInfo = { message: string; hint: string } | null;

interface Props {
  token: string;
  children: ReactNode;
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

  const [agentError, setAgentError] = useState<AgentErrorInfo>(null);

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
            hint: "可能是 Runtime（:3000）或后端（:8000）没启动，请稍后重试。",
          });
        } else if (response.ok) {
          setAgentError(null);
        }
        return response;
      } catch (error) {
        setAgentError({
          message: "连不上助手服务，消息没有发出去。",
          hint: "请确认 Runtime（:3000）与后端（:8000）都在运行，然后重试。",
        });
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="sedentary_agent"
        headers={headers}
        useSingleEndpoint={false}
        showDevConsole={false}
      >
        {children}
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
