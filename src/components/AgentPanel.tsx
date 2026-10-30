import { useState } from "react";
import { api, clock } from "../api";
import type { SuggestResult } from "../types";
import type { ToastKind } from "./Toast";

interface Props {
  notify: (kind: ToastKind, text: string) => void;
  onApplied: () => Promise<void>;
}

export function AgentPanel({ notify, onApplied }: Props) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);

  const run = async () => {
    setBusy(true);
    try {
      const data = await api.suggest(message.trim());
      setResult(data);
      setDropped([]);
      if (data.suggestions.length === 0) {
        notify("info", data.note);
      }
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "生成建议失败");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!result) {
      return;
    }
    const items = result.suggestions.filter((item) => !dropped.includes(item.scheduled_at));
    if (items.length === 0) {
      notify("info", "没有选中任何建议");
      return;
    }
    setConfirming(true);
    try {
      const created = await api.confirm(items);
      notify("ok", `已保存 ${created.length} 条建议`);
      setResult(null);
      setDropped([]);
      await onApplied();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "保存失败");
    } finally {
      setConfirming(false);
    }
  };

  const kept = result ? result.suggestions.filter((item) => !dropped.includes(item.scheduled_at)) : [];

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>让助手排一下</h2>
          <p className="sub">
            {result?.mode === "llm" ? "模型建议" : result ? "规则建议" : "说句话，我来挑空档"}
          </p>
        </div>
      </div>

      <div className="agent-input">
        <textarea
          rows={2}
          value={message}
          placeholder="例如：下午开会比较多，今天只安排两次"
          onChange={(event) => setMessage(event.target.value)}
        />
        <button className="btn primary sm" onClick={run} disabled={busy}>
          {busy ? "思考中…" : "生成建议"}
        </button>
      </div>

      {result ? (
        <div className="suggest">
          <p className="note">{result.note}</p>

          {result.suggestions.length > 0 ? (
            <>
              <ul className="suggest-list">
                {result.suggestions.map((item) => {
                  const removed = dropped.includes(item.scheduled_at);
                  return (
                    <li key={item.scheduled_at} className={removed ? "removed" : ""}>
                      <span className="clock">{clock(item.scheduled_at)}</span>
                      <span className="title">{item.title}</span>
                      <button
                        className="link-btn"
                        onClick={() =>
                          setDropped(
                            removed
                              ? dropped.filter((value) => value !== item.scheduled_at)
                              : [...dropped, item.scheduled_at],
                          )
                        }
                      >
                        {removed ? "恢复" : "去掉"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button className="btn primary block" onClick={confirm} disabled={confirming || kept.length === 0}>
                {confirming ? "保存中…" : `确认保存这 ${kept.length} 条`}
              </button>
            </>
          ) : null}

          {result.rejected.length > 0 ? (
            <div className="rejected">
              <p className="rejected-title">有 {result.rejected.length} 条建议被后端拒绝</p>
              <ul>
                {result.rejected.map((item) => (
                  <li key={`${item.scheduled_at}-${item.reason}`}>
                    {item.scheduled_at.slice(11, 16)} · {item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
