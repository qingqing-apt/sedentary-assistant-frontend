/**
 * 每日总结面板。
 *
 * 这里最要紧的一条：**没生成过就不能显示总结内容**。
 * 用例里专门断言了 not_generated 状态下拿不到 headline，
 * 防止以后有人图省事用 stats 拼一段话填上。
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DailySummaryPanel, formatDay, shiftDay } from "../components/DailySummaryPanel";
import type { DailySummary } from "../types";

const baseStats = {
  date: "2026-10-29",
  total: 4,
  completed: 2,
  postponed: 1,
  skipped: 1,
  pending: 0,
  completion_rate: 50,
};

const notGenerated: DailySummary = {
  date: "2026-10-29",
  state: "not_generated",
  stats: baseStats,
  summary: null,
};

const generated: DailySummary = {
  date: "2026-10-29",
  state: "generated",
  stats: baseStats,
  summary: {
    headline: "完成过半，整体节奏还在",
    points: ["计划 4 条，完成 2 条，完成率 50%。", "1 条被推迟。"],
    source: "rule",
    generated_at: "2026-10-30T09:12:00+08:00",
  },
};

function renderPanel(overrides: Partial<Parameters<typeof DailySummaryPanel>[0]> = {}) {
  const props = {
    data: notGenerated,
    loading: false,
    error: null,
    busy: false,
    canGoNext: true,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onGenerate: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<DailySummaryPanel {...props} />);
  return props;
}

describe("DailySummaryPanel", () => {
  it("未生成时显示未生成状态，且不出现任何总结文案", () => {
    renderPanel();

    expect(screen.getByTestId("summary-empty")).toBeInTheDocument();
    expect(screen.getByText("这天还没有生成总结")).toBeInTheDocument();
    expect(screen.queryByTestId("summary-body")).not.toBeInTheDocument();
    expect(screen.queryByText("完成过半，整体节奏还在")).not.toBeInTheDocument();
  });

  it("未生成时仍然展示真实统计，数字来自服务端而不是编的", () => {
    renderPanel();

    expect(screen.getByText("计划").previousSibling).toHaveTextContent("4");
    expect(screen.getByText("完成").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("推迟").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("跳过").previousSibling).toHaveTextContent("1");
  });

  it("点生成按钮会回调，且生成中不可重复点", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: "生成这天的总结" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);

    renderPanel({ busy: true });
    expect(screen.getAllByRole("button", { name: "生成中…" })[0]).toBeDisabled();
  });

  it("已生成时显示标题和要点，并标注生成方式", () => {
    renderPanel({ data: generated });

    expect(screen.getByTestId("summary-body")).toBeInTheDocument();
    expect(screen.getByText("完成过半，整体节奏还在")).toBeInTheDocument();
    expect(screen.getByText("计划 4 条，完成 2 条，完成率 50%。")).toBeInTheDocument();
    expect(screen.getByText(/规则生成/)).toBeInTheDocument();
    expect(screen.queryByTestId("summary-empty")).not.toBeInTheDocument();
  });

  it("state 说没生成但后端给了内容时，以 state 为准，不渲染内容", () => {
    renderPanel({ data: { ...generated, state: "not_generated" } });

    expect(screen.getByTestId("summary-empty")).toBeInTheDocument();
    expect(screen.queryByText("完成过半，整体节奏还在")).not.toBeInTheDocument();
  });

  it("读取失败时给出错误和重试入口", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ data: null, error: "Failed to fetch" });

    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("已经到昨天时「后一天」禁用，不能翻到未来", () => {
    renderPanel({ canGoNext: false });
    expect(screen.getByRole("button", { name: "后一天" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "前一天" })).not.toBeDisabled();
  });
});

describe("日期换算", () => {
  it("跨月减一天", () => {
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("昨日语义只跟日期有关，不受时区解析影响", () => {
    // 用 new Date("2026-10-29") 会被当成 UTC 零点，东八区下变成 10-29 08:00，
    // 西半球就直接退到 10-28 了。这里断言渲染出来的就是输入的日期。
    expect(formatDay("2026-10-29")).toBe("10 月 29 日 · 周四");
  });
});
