import { clock } from "../api";
import type { Activity } from "../types";

export type ActionKind = "complete" | "postpone" | "skip";

const STATUS_LABEL: Record<Activity["status"], string> = {
  planned: "待处理",
  completed: "已完成",
  postponed: "已推迟",
  skipped: "今天不方便",
};

interface Props {
  activities: Activity[];
  busy: string | null;
  showReminders: boolean;
  onAction: (id: string, action: ActionKind) => void;
  onGenerate: (force: boolean) => void;
}

export function TodayList({ activities, busy, showReminders, onAction, onGenerate }: Props) {
  const pending = activities.filter((item) => item.status === "planned").length;
  const generating = busy === "generate";

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>今日安排</h2>
          <p className="sub">
            {activities.length === 0
              ? "还没有安排"
              : `共 ${activities.length} 条，待处理 ${pending} 条`}
          </p>
        </div>
        <button
          className="btn ghost"
          onClick={() => onGenerate(activities.length > 0)}
          disabled={generating}
        >
          {generating ? "生成中…" : activities.length > 0 ? "重新生成" : "生成安排"}
        </button>
      </div>

      {activities.length === 0 ? (
        <div className="empty">
          <p className="empty-title">今天还没有安排</p>
          <p className="empty-hint">
            先确认右侧的工作时段和可活动时段，然后点「生成安排」按你的设置排一次。
          </p>
        </div>
      ) : (
        <ul className="activity-list">
          {activities.map((item) => {
            const actionBusy = busy?.startsWith(`${item.id}:`) ? busy.split(":")[1] : null;
            return (
              <li key={item.id} className={`activity status-${item.status}`}>
                <div className="clock">{clock(item.scheduled_at)}</div>

                <div className="body">
                  <div className="line">
                    <strong>{item.title}</strong>
                    {item.source === "agent" ? <span className="tag tag-agent">Agent 建议</span> : null}
                    {item.postponed_from ? <span className="tag">推迟而来</span> : null}
                    {item.is_overdue && showReminders ? (
                      <span className="tag tag-warn">已过期</span>
                    ) : null}
                  </div>
                  <p className="desc">{item.description}</p>
                </div>

                {item.status === "planned" ? (
                  <div className="acts">
                    <button
                      className="btn primary sm"
                      disabled={actionBusy !== null}
                      onClick={() => onAction(item.id, "complete")}
                    >
                      {actionBusy === "complete" ? "…" : "完成"}
                    </button>
                    <button
                      className="btn sm"
                      disabled={actionBusy !== null}
                      onClick={() => onAction(item.id, "postpone")}
                    >
                      {actionBusy === "postpone" ? "…" : "推迟"}
                    </button>
                    <button
                      className="btn sm danger"
                      disabled={actionBusy !== null}
                      onClick={() => onAction(item.id, "skip")}
                    >
                      {actionBusy === "skip" ? "…" : "今天不方便"}
                    </button>
                  </div>
                ) : (
                  <span className={`status-chip status-${item.status}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
