import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Activity, Proposal, ProposalItem, Settings, Weekly } from "../types";
import { AgentChatInline } from "./AgentChatInline";
import { AgentPanel } from "./AgentPanel";
import { ProposalCard } from "./ProposalCard";
import { SettingsPanel } from "./SettingsPanel";
import { Toast, type ToastKind, type ToastState } from "./Toast";
import { TodayList, type ActionKind } from "./TodayList";
import { WeeklyPanel } from "./WeeklyPanel";

interface Props {
  user: string;
  onLogout: () => void;
}

/** 监听媒体查询，用来在桌面 / 移动布局间切换。 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

type TabKey = "today" | "stats" | "settings" | "assistant";

const TABS: { key: TabKey; label: string; icon: JSX.Element }[] = [
  {
    key: "today",
    label: "今日",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    key: "stats",
    label: "统计",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M5 20V10" />
        <path d="M12 20V4" />
        <path d="M19 20v-7" />
      </svg>
    ),
  },
  {
    key: "settings",
    label: "设置",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" fill="var(--bg)" />
        <circle cx="15" cy="12" r="2" fill="var(--bg)" />
        <circle cx="7" cy="18" r="2" fill="var(--bg)" />
      </svg>
    ),
  },
  {
    key: "assistant",
    label: "助手",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
      </svg>
    ),
  },
];

export function Assistant({ user, onLogout }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("today");

  const isMobile = useMediaQuery("(max-width: 1040px)");

  const notify = useCallback((kind: ToastKind, text: string) => {
    setToast({ kind, text });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextSettings, nextActivities, nextWeekly, nextProposal] = await Promise.all([
        api.getSettings(),
        api.today(),
        api.weekly(),
        api.pendingProposal(),
      ]);
      setSettings(nextSettings);
      setActivities(nextActivities);
      setWeekly(nextWeekly);
      setProposal(nextProposal);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshToday = useCallback(async () => {
    const [nextActivities, nextWeekly, nextProposal] = await Promise.all([
      api.today(),
      api.weekly(),
      api.pendingProposal(),
    ]);
    setActivities(nextActivities);
    setWeekly(nextWeekly);
    setProposal(nextProposal);
  }, []);

  // Agent 在对话面板里保存安排时，前端拿不到任何通知（工具是后端执行的），
  // 列表会一直停在旧数据上。这里用轻量轮询兜住：本地 SQLite 查询开销可忽略，
  // 页面切到后台时自动停，避免无谓请求。
  useEffect(() => {
    if (loading || loadError) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      void refreshToday();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loading, loadError, refreshToday]);

  const runAction = async (id: string, action: ActionKind) => {
    setBusy(`${id}:${action}`);
    try {
      let text = "已标记完成";
      if (action === "skip") {
        await api.skip(id);
        text = "这条活动今天不再出现";
      } else if (action === "postpone") {
        const result = await api.postpone(id);
        text = `已推迟到 ${result.activity.scheduled_at.slice(11, 16)}`;
      } else {
        await api.complete(id);
      }
      notify("ok", text);
      await refreshToday();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const generate = async (force: boolean) => {
    setBusy("generate");
    try {
      const result = await api.generate(force);
      notify(result.adjusted ? "info" : "ok", result.message ?? `已生成 ${result.created} 条安排`);
      await refreshToday();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(null);
    }
  };

  // 确认保存 Agent 建议。注意这里是「用户点了按钮」，后端还会再校验一遍，
  // 校验不过（比如中途改了免打扰）卡片会留在原地，把原因弹出来。
  const confirmProposal = async (items: ProposalItem[]) => {
    if (!proposal) {
      return;
    }
    setBusy("proposal");
    try {
      const result = await api.confirmProposal(proposal.id, items);
      notify("ok", `已保存 ${result.activities.length} 条安排`);
      await refreshToday();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const discardProposal = async () => {
    if (!proposal) {
      return;
    }
    setBusy("proposal");
    try {
      await api.discardProposal(proposal.id);
      notify("info", "已放弃这组建议");
      await refreshToday();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (payload: Settings) => {
    setBusy("settings");
    try {
      const saved = await api.saveSettings(payload);
      setSettings(saved);
      notify("ok", "设置已保存");
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const overdue = useMemo(
    () => activities.filter((item) => item.status === "planned" && item.is_overdue),
    [activities],
  );
  const remindersOn = settings?.reminders_enabled ?? true;

  const proposalCard = proposal ? (
    <ProposalCard
      proposal={proposal}
      busy={busy === "proposal"}
      onConfirm={(items) => void confirmProposal(items)}
      onDiscard={() => void discardProposal()}
    />
  ) : null;

  const reminderBanner =
    remindersOn && overdue.length > 0 ? (
      <div className="reminder">
        <span className="reminder-dot" aria-hidden />
        有 {overdue.length} 条活动已经到点了，挑一个现在做也可以。
      </div>
    ) : null;

  const todayPanel = (
    <TodayList
      activities={activities}
      busy={busy}
      showReminders={remindersOn}
      onAction={(id, action) => void runAction(id, action)}
      onGenerate={(force) => void generate(force)}
    />
  );

  const weeklyPanel = <WeeklyPanel data={weekly} />;

  const settingsPanel = (
    <SettingsPanel value={settings} busy={busy === "settings"} onSave={(payload) => void saveSettings(payload)} />
  );

  const agentPanel = <AgentPanel notify={notify} onApplied={refreshToday} />;

  /**
   * 移动端 / APK 的对话式 Agent。桌面端用右下角浮层，手机改成 Tab 内嵌。
   * 两个入口共用同一个 Provider 与后端 Agent，只是渲染位置不同。
   */
  const chatPanel = (
    <section className="card chat-card">
      <div className="card-head">
        <div>
          <h2>和助手聊聊</h2>
          <p className="sub">它会读你的时段和已有安排，再给建议</p>
        </div>
      </div>
      <AgentChatInline height="min(56vh, 480px)" />
    </section>
  );

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" aria-hidden />
          <div>
            <h1>久坐活动助手</h1>
            <p>在工作间隙安排几次短暂活动</p>
          </div>
        </div>
        <div className="who">
          <span>{user}</span>
          <button className="btn ghost sm" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      {loading ? (
        <main className="layout">
          <section className="card">
            <p className="sub">正在加载今天的安排…</p>
          </section>
        </main>
      ) : loadError ? (
        <main className="layout">
          <section className="card">
            <p className="form-error">{loadError}</p>
            <button className="btn primary" onClick={() => void load()}>
              重试
            </button>
          </section>
        </main>
      ) : isMobile ? (
        <main className="mobile-app">
          <div className="mobile-panes">
            <div className="pane" hidden={tab !== "today"}>
              {proposalCard}
              {reminderBanner}
              {todayPanel}
            </div>
            <div className="pane" hidden={tab !== "stats"}>
              {weeklyPanel}
            </div>
            <div className="pane" hidden={tab !== "settings"}>
              {settingsPanel}
            </div>
            <div className="pane" hidden={tab !== "assistant"}>
              {chatPanel}
              {agentPanel}
            </div>
          </div>

          <nav className="tabbar" aria-label="主导航">
            {TABS.map((item) => (
              <button
                key={item.key}
                className={tab === item.key ? "tab on" : "tab"}
                onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? "page" : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </main>
      ) : (
        <main className="layout">
          <div className="col-main">
            {proposalCard}
            {reminderBanner}
            {todayPanel}
            {weeklyPanel}
          </div>

          <aside className="col-side">
            {agentPanel}
            {settingsPanel}
          </aside>
        </main>
      )}

      <Toast toast={toast} />
    </div>
  );
}
