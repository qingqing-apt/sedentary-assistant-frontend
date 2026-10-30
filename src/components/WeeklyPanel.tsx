import type { Weekly } from "../types";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

function weekdayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return `周${WEEKDAY[parsed.getDay()]}`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function WeeklyPanel({ data }: { data: Weekly | null }) {
  if (!data) {
    return null;
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>本周完成情况</h2>
          <p className="sub">
            {data.week_start} 至 {data.week_end}
          </p>
        </div>
      </div>

      <div className="stats">
        <Stat label="计划" value={data.total} />
        <Stat label="完成" value={data.completed} tone="ok" />
        <Stat label="推迟" value={data.postponed} tone="amber" />
        <Stat label="跳过" value={data.skipped} tone="muted" />
      </div>

      <ul className="daily">
        {data.daily.map((day) => {
          const ratio = day.total === 0 ? 0 : Math.round((day.completed / day.total) * 100);
          return (
            <li key={day.date}>
              <span className="daily-label">{weekdayOf(day.date)}</span>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${ratio}%` }} />
              </div>
              <span className="daily-num">
                {day.completed}/{day.total}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
