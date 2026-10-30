import { useEffect, useState } from "react";
import type { Settings } from "../types";

interface Props {
  value: Settings | null;
  busy: boolean;
  onSave: (payload: Settings) => void;
}

export function SettingsPanel({ value, busy, onSave }: Props) {
  const [draft, setDraft] = useState<Settings | null>(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!draft) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>时段与偏好</h2>
        </div>
        <p className="sub">加载中…</p>
      </section>
    );
  }

  const set = <K extends keyof Settings>(key: K, next: Settings[K]) => {
    setDraft({ ...draft, [key]: next });
  };

  const setQuiet = (index: number, key: "start" | "end", next: string) => {
    const list = draft.quiet_hours.map((item, i) => (i === index ? { ...item, [key]: next } : item));
    set("quiet_hours", list);
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>时段与偏好</h2>
          <p className="sub">时间按本机时区计算</p>
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>上班</span>
          <input
            type="time"
            value={draft.work_start}
            onChange={(event) => set("work_start", event.target.value)}
          />
        </label>
        <label className="field">
          <span>下班</span>
          <input
            type="time"
            value={draft.work_end}
            onChange={(event) => set("work_end", event.target.value)}
          />
        </label>
      </div>

      <p className="group-label">上午可活动</p>
      <div className="field-row">
        <label className="field">
          <span>从</span>
          <input
            type="time"
            value={draft.morning_start}
            onChange={(event) => set("morning_start", event.target.value)}
          />
        </label>
        <label className="field">
          <span>到</span>
          <input
            type="time"
            value={draft.morning_end}
            onChange={(event) => set("morning_end", event.target.value)}
          />
        </label>
      </div>

      <p className="group-label">下午可活动</p>
      <div className="field-row">
        <label className="field">
          <span>从</span>
          <input
            type="time"
            value={draft.afternoon_start}
            onChange={(event) => set("afternoon_start", event.target.value)}
          />
        </label>
        <label className="field">
          <span>到</span>
          <input
            type="time"
            value={draft.afternoon_end}
            onChange={(event) => set("afternoon_end", event.target.value)}
          />
        </label>
      </div>

      <p className="group-label">
        免打扰时段
        <button
          className="link-btn"
          type="button"
          onClick={() => set("quiet_hours", [...draft.quiet_hours, { start: "12:00", end: "13:30" }])}
        >
          + 添加
        </button>
      </p>

      {draft.quiet_hours.length === 0 ? (
        <p className="sub">暂时没有，全天按可活动时段安排。</p>
      ) : (
        draft.quiet_hours.map((item, index) => (
          <div className="field-row quiet-row" key={index}>
            <input
              type="time"
              value={item.start}
              onChange={(event) => setQuiet(index, "start", event.target.value)}
            />
            <span className="dash">—</span>
            <input
              type="time"
              value={item.end}
              onChange={(event) => setQuiet(index, "end", event.target.value)}
            />
            <button
              className="link-btn danger"
              type="button"
              onClick={() =>
                set(
                  "quiet_hours",
                  draft.quiet_hours.filter((_, i) => i !== index),
                )
              }
            >
              删除
            </button>
          </div>
        ))
      )}

      <p className="group-label">每天安排次数</p>
      <div className="field-row">
        <input
          className="count-input"
          type="number"
          min={1}
          max={10}
          value={draft.daily_count}
          onChange={(event) => set("daily_count", Number(event.target.value))}
        />
        <span className="sub">次（1–10）</span>
      </div>

      <div className="toggles">
        <label className="toggle">
          <input
            type="checkbox"
            checked={draft.reminders_enabled}
            onChange={(event) => set("reminders_enabled", event.target.checked)}
          />
          <span>开启提醒（关闭后页面不再主动提示）</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={draft.allow_during_work}
            onChange={(event) => set("allow_during_work", event.target.checked)}
          />
          <span>允许在工作时段内提醒</span>
        </label>
      </div>

      <button className="btn primary block" disabled={busy} onClick={() => onSave(draft)}>
        {busy ? "保存中…" : "保存设置"}
      </button>
    </section>
  );
}
