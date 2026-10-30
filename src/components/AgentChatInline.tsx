import { CopilotChat } from "@copilotkit/react-core/v2";

interface Props {
  /** 面板高度。移动端给固定值，避免和页面滚动打架 */
  height?: number | string;
}

/**
 * 内嵌式对话面板（移动端 / APK 专用）。
 *
 * 桌面端用的是右下角 `CopilotPopup` 浮层，但浮层在手机上会盖住底部 Tab 栏，
 * 而且 `defaultOpen={false}` 对这个组件不生效，所以移动端改成「助手」Tab 里内嵌。
 *
 * 两种形态共用同一个 CopilotKit Provider、同一个 Runtime、同一个后端 Agent，
 * 因此工具、鉴权、线程隔离全部一致——这里只是换了个渲染位置。
 */
export function AgentChatInline({ height = 460 }: Props) {
  return (
    <div className="chat-inline" style={{ height }}>
      <CopilotChat
        labels={{
          modalHeaderTitle: "活动安排助手",
          welcomeMessageText:
            "想怎么安排？可以问我「今天有什么安排」「下午三点以后还有空吗」，或者让我排两次。",
          chatInputPlaceholder: "比如「下午三点以后给我排两次」",
          chatDisclaimerText: "回答基于你自己真实的安排生成；身体不适请咨询医生。",
        }}
      />
    </div>
  );
}
