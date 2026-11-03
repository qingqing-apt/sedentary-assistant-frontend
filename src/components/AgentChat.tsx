import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CopilotChatConfigurationProvider, CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

type AgentErrorInfo = { message: string; hint: string } | null;

interface Props {
  token: string;
  children: ReactNode;
}

const THREAD_KEY_PREFIX = "sedentary.thread";

/** 用 token 派生一个稳定 key，避免把凭证明文写进 localStorage。 */
function ownerKeyOf(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * 让对话线程跨页面刷新存活。
 *
 * CopilotKit 默认每次挂载都生成一个新的 threadId，历史又只存在 Runtime 内存里
 * （按 threadId 索引），所以刷新一次就等于开了个新会话——用户会看到"刚说的话它就不记得了"。
 * 这里把 threadId 按登录用户落到 localStorage，并显式传给 CopilotKit；
 * 一旦是外部传入的 threadId，内部就不会再自己生成新的。
 */
function usePersistentThreadId(token: string): string {
  return useMemo(() => {
    if (typeof window === "undefined") return `thread-${Date.now()}`;

    const key = `${THREAD_KEY_PREFIX}.${ownerKeyOf(token)}`;
    const saved = window.localStorage.getItem(key);
    if (saved) return saved;

    const created = `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(key, created);
    return created;
  }, [token]);
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

  const threadId = usePersistentThreadId(token);

  const [agentError, setAgentError] = useState<AgentErrorInfo>(null);
  const isMobile = useIsMobile();

  /**
   * 打包时漏注入 VITE_RUNTIME_URL 的兜底。
   *
   * Web 版退化到 `/api/copilotkit` 有 Vite 代理兜着，看不出来；但 APK 里 WebView
   * 的 origin 是 `http://localhost`，这个相对路径会打到 Capacitor 自带的本地服务，
   * 换来一张 **200 的 index.html**——不报错、不抛异常，消息就这么没了。
   * 2026-11-03 的验收就是栽在这里。
   *
   * 所以进「助手」页时先自查一次：在原生容器里却没配绝对地址，直接告诉用户，
   * 不要等点了发送才让消息静默消失。
   */
  useEffect(() => {
    const isNative =
      typeof window !== "undefined" &&
      Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (isNative && !import.meta.env.VITE_RUNTIME_URL) {
      setAgentError({
        message: "这个安装包没有配置助手服务地址，对话发不出去。",
        hint: "构建时缺了 VITE_RUNTIME_URL。用 demo 脚本的 -Build 重新打包，或按 README 同时注入两个地址。",
      });
    }
  }, []);

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
          // 200 不代表成功。APK 里 WebView 的本地服务对未知路径会回 200 + index.html，
          // 如果 runtimeUrl 指错地方（比如漏了 VITE_RUNTIME_URL，退化成相对路径），
          // 拿到的就是一张网页：状态码漂亮，消息却丢了，界面上一点痕迹都没有。
          // 按 Content-Type 判真伪，别信状态码。
          const ctype = response.headers.get("content-type") ?? "";
          const isAgentPayload =
            ctype.includes("json") || ctype.includes("event-stream");
          if (isAgentPayload) {
            setAgentError(null);
          } else {
            setAgentError({
              message: "助手服务地址不对，消息没有发出去。",
              hint: `这个地址返回的是网页而不是接口数据（${runtimeUrl}）。构建时要用 VITE_RUNTIME_URL 指向 CopilotKit Runtime。`,
            });
          }
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
        {/* 把 threadId 显式钉住：刷新页面不再换线程，历史才能接上 */}
        <CopilotChatConfigurationProvider threadId={threadId}>
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
        </CopilotChatConfigurationProvider>
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
