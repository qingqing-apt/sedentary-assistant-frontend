import { useEffect, useMemo, useState } from "react";
import { clock } from "../api";
import type { Proposal, ProposalItem } from "../types";

interface Props {
  proposal: Proposal;
  busy: boolean;
  onConfirm: (items: ProposalItem[]) => void;
  onDiscard: () => void;
}

/**
 * 待确认的 Agent 建议。
 *
 * 这张卡是「用户确认后才保存」的可见证据：只要它还挂在这里，活动列表里就不会出现
 * 这些时间点。用户勾选一部分再保存也行，没勾的随整张单子一起作废。
 */
export function ProposalCard({ proposal, busy, onConfirm, onDiscard }: Props) {
  const [picked, setPicked] = useState<string[]>(() =>
    proposal.items.map((item) => item.scheduled_at),
  );

  // 换了一张单子就重置勾选，否则会把上一张的选择带过来
  useEffect(() => {
    setPicked(proposal.items.map((item) => item.scheduled_at));
  }, [proposal.id]);

  const selected = useMemo(
    () => proposal.items.filter((item) => picked.includes(item.scheduled_at)),
    [proposal.items, picked],
  );

  const toggle = (stamp: string) => {
    setPicked((prev) =>
      prev.includes(stamp) ? prev.filter((one) => one !== stamp) : [...prev, stamp],
    );
  };

  return (
    <section className="card proposal" aria-label="待确认的 Agent 建议">
      <header className="card-head">
        <div>
          <h2>
            Agent 建议 <span className="tag tag-agent">待确认</span>
          </h2>
          <p className="sub">{proposal.note || "从你的可活动时段里挑的时间点，还没保存。"}</p>
        </div>
        <span className="proposal-hint">勾选要保留的，保存后才进列表</span>
      </header>

      <ul className="proposal-list">
        {proposal.items.map((item) => {
          const on = picked.includes(item.scheduled_at);
          return (
            <li key={item.scheduled_at}>
              <label className={on ? "proposal-item is-on" : "proposal-item"}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={() => toggle(item.scheduled_at)}
                />
                <span className="proposal-time">{clock(item.scheduled_at)}</span>
                <span className="proposal-title">{item.title}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {proposal.capacity_note ? (
        <p className="proposal-note">{proposal.capacity_note}</p>
      ) : null}

      <div className="proposal-actions">
        <button
          className="btn primary"
          disabled={busy || selected.length === 0}
          onClick={() => onConfirm(selected)}
        >
          {busy ? "保存中…" : `保存这 ${selected.length} 条`}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onDiscard}>
          全部放弃
        </button>
      </div>
    </section>
  );
}
