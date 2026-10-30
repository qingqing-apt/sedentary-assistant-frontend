export type Status = "planned" | "completed" | "postponed" | "skipped";

export interface Activity {
  id: string;
  activity_type: string;
  title: string;
  description: string;
  scheduled_at: string;
  status: Status;
  source: "user" | "agent";
  postponed_from: string | null;
  is_overdue: boolean;
}

export interface QuietHour {
  start: string;
  end: string;
}

export interface Settings {
  work_start: string;
  work_end: string;
  morning_start: string;
  morning_end: string;
  afternoon_start: string;
  afternoon_end: string;
  quiet_hours: QuietHour[];
  daily_count: number;
  reminders_enabled: boolean;
  allow_during_work: boolean;
  postpone_strategy: string;
}

export interface DayStat {
  date: string;
  total: number;
  completed: number;
}

export interface Weekly {
  week_start: string;
  week_end: string;
  total: number;
  completed: number;
  postponed: number;
  skipped: number;
  pending: number;
  daily: DayStat[];
}

export interface Suggestion {
  activity_type: string;
  title: string;
  description: string;
  scheduled_at: string;
}

export interface Rejected {
  scheduled_at: string;
  reason: string;
  message: string;
}

export interface SuggestResult {
  mode: "llm" | "rule";
  note: string;
  suggestions: Suggestion[];
  rejected: Rejected[];
}

export interface GenerateResult {
  created: number;
  adjusted: boolean;
  message: string | null;
  activities: Activity[];
}

/** Agent 提议单里的一条建议（还没成为活动）。 */
export interface ProposalItem {
  activity_type: string;
  title: string;
  scheduled_at: string;
}

/**
 * Agent 提议单。
 * 只要它还挂在 pending，活动列表里就不该出现这些时间点——这是「没确认就不落库」的可见证据。
 */
export interface Proposal {
  id: string;
  day: string;
  items: ProposalItem[];
  note: string;
  capacity_note: string;
  status: "pending" | "confirmed" | "discarded" | "superseded";
  created_at: string;
}
