import type { DailySummary } from "../types";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** YYYY-MM-DD → 本地时间的 Date。不直接用 new Date("2026-10-29")，那会被当成 UTC。 */
function parseDay(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDay(iso: string): string {
  const parsed = parseDay(iso);
  return `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日 · 周${WEEKDAY[parsed.getDay()]}`;
}

export function shiftDay(iso: string, delta: number): string {
  const parsed = parseDay(iso);
  parsed.setDate(parsed.getDate() + delta);
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

export function todayDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

interface Props {
  data: DailySummary | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGenerate: () => void;
  onRetry: () => void;
}

export function DailySummaryPanel({
  data,
  loading,
  error,
  busy,
  canGoNext,
  onPrev,
  onNext,
  onGenerate,
  onRetry,
}: Props) {
  return (
    <section className="card" aria-labelledby="daily-summary-title">
      <div className="card-head">
        <div>
          <h2 id="daily-summary-title">每日总结</h2>
          <p className="sub">{data ? formatDay(data.date) : "按天回看"}</p>
        </div>

        <div className="daynav">
          <button className="btn ghost sm" onClick={onPrev} aria-label="前一天">
            前一天
          </button>
          <button
            className="btn ghost sm"
            onClick={onNext}
            disabled={!canGoNext}
            aria-label="后一天"
          >
            后一天
          </button>
        </div>
      </div>

      {loading ? (
        <p className="sub">正在读取这天的记录…</p>
      ) : error ? (
        <div>
          <p className="form-error">{error}</p>
          <button className="btn" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : !data ? (
        <p className="sub">还没有可显示的数据。</p>
      ) : (
        <>
          {/* 统计永远是服务端现算的真实值，和「有没有生成总结」无关 */}
          <div className="stats">
            <Stat label="计划" value={data.stats.total} />
            <Stat label="完成" value={data.stats.completed} tone="ok" />
            <Stat label="推迟" value={data.stats.postponed} tone="amber" />
            <Stat label="跳过" value={data.stats.skipped} tone="muted" />
          </div>

          {data.state === "not_generated" || !data.summary ? (
            <div className="empty" data-testid="summary-empty">
              <p className="empty-title">这天还没有生成总结</p>
              <p className="empty-hint">
                上面的数字是服务端的真实统计。总结需要单独生成，没有生成过就显示这个状态，不会拿统计拼一段话顶上。
              </p>
              <button className="btn primary" onClick={onGenerate} disabled={busy}>
                {busy ? "生成中…" : "生成这天的总结"}
              </button>
            </div>
          ) : (
            <div className="summary" data-testid="summary-body">
              <p className="summary-headline">{data.summary.headline}</p>
              <ul className="summary-points">
                {data.summary.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className="summary-foot">
                <span className="summary-meta">
                  生成于 {data.summary.generated_at.slice(0, 16).replace("T", " ")} ·{" "}
                  {data.summary.source === "rule" ? "规则生成" : "模型生成"}
                </span>
                <button className="btn ghost sm" onClick={onGenerate} disabled={busy}>
                  {busy ? "生成中…" : "重新生成"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
