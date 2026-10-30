import type {
  Activity,
  GenerateResult,
  Proposal,
  ProposalItem,
  Settings,
  SuggestResult,
  Suggestion,
  Weekly,
} from "./types";

const TOKEN_KEY = "sedentary.token";
const USER_KEY = "sedentary.user";

export class ApiError extends Error {
  code: string;
  status: number;
  field?: string;

  constructor(code: string, message: string, status: number, field?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function getUser(): string {
  return localStorage.getItem(USER_KEY) ?? "";
}

export function saveSession(token: string, userId: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, userId);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * API 根地址。
 *
 * - Web（vite dev / 部署同域）：留空，走相对路径 `/api`，由 Vite 代理或同域反代转发。
 * - Android APK（Capacitor）：WebView 里没有代理，必须指向真实后端地址，
 *   构建时用 `VITE_API_BASE=http://10.0.2.2:8000`（模拟器）或局域网 IP（真机）。
 */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let payload: { code?: string; message?: string; field?: string } = {};
    try {
      payload = await response.json();
    } catch {
      // 后端异常时可能不是 JSON，兜底成状态码
    }
    if (response.status === 401) {
      clearSession();
    }
    throw new ApiError(
      payload.code ?? "UNKNOWN",
      payload.message ?? `请求失败（${response.status}）`,
      response.status,
      payload.field,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  login: (username: string) =>
    request<{ token: string; user_id: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),

  getSettings: () => request<Settings>("/settings"),
  saveSettings: (payload: Settings) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(payload) }),

  today: () => request<Activity[]>("/activities/today"),
  generate: (force = false) =>
    request<GenerateResult>(`/activities/generate?force=${force}`, { method: "POST" }),
  complete: (id: string) =>
    request<Activity>(`/activities/${id}/complete`, { method: "PATCH" }),
  postpone: (id: string) =>
    request<{ previous_id: string; activity: Activity }>(`/activities/${id}/postpone`, {
      method: "PATCH",
    }),
  skip: (id: string) => request<Activity>(`/activities/${id}/skip`, { method: "PATCH" }),

  weekly: () => request<Weekly>("/stats/weekly"),

  /** 当前待确认的 Agent 建议；没有时后端返回 null。 */
  pendingProposal: () => request<Proposal | null>("/proposals/pending"),
  confirmProposal: (id: string, items: ProposalItem[]) =>
    request<{ proposal: Proposal; activities: Activity[] }>(`/proposals/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        items: items.map((item) => ({
          activity_type: item.activity_type,
          scheduled_at: item.scheduled_at,
        })),
      }),
    }),
  discardProposal: (id: string) =>
    request<Proposal>(`/proposals/${id}/discard`, { method: "POST" }),

  suggest: (message: string) =>
    request<SuggestResult>("/agent/suggest", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  confirm: (items: Suggestion[]) =>
    request<Activity[]>("/activities/confirm", {
      method: "POST",
      body: JSON.stringify({
        items: items.map((item) => ({
          activity_type: item.activity_type,
          scheduled_at: item.scheduled_at,
        })),
      }),
    }),
};

export function clock(iso: string): string {
  return iso.slice(11, 16);
}
