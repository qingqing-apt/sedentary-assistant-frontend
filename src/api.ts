import type {
  Activity,
  DailySummary,
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

/**
 * 请求超时（毫秒）。
 *
 * 为什么必须有：网络不可达有两种表现。后端进程没起、端口明确拒绝时，
 * fetch 立刻失败，前端能马上显示错误；但如果中间有一层把包吃掉却不回 RST
 * （模拟器的端口转发、公司网关、手机切网瞬间都会这样），fetch 会一直挂着，
 * 界面就永远停在「正在读取」，用户既看不到错误也没有重试入口。
 *
 * 12 秒是个取舍：够慢网络下的正常请求跑完，又不至于让人以为 App 卡死。
 */
const TIMEOUT_MS = 12_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // 主动 abort 和「连接被拒」要分开说，否则用户分不清是网断了还是后端没起
    if (controller.signal.aborted) {
      throw new ApiError(
        "TIMEOUT",
        `请求超时（${TIMEOUT_MS / 1000} 秒没有响应），请检查后端是否已启动、手机能否访问到这台电脑`,
        0,
      );
    }
    throw new ApiError(
      "NETWORK",
      "连不上后端。请确认后端已启动，且手机与电脑在同一网络、防火墙放行该端口",
      0,
    );
  } finally {
    window.clearTimeout(timer);
  }

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

  /**
   * 每日总结。不传 date 时后端默认取「昨天」。
   * 没生成过时 `state=not_generated`、`summary=null`——这是正常返回，不是错误，
   * 所以不要在这里抛异常，交给界面显示「尚未生成」。
   */
  dailySummary: (date?: string) =>
    request<DailySummary>(`/summary/daily${date ? `?date=${date}` : ""}`),
  generateDailySummary: (date?: string) =>
    request<DailySummary>(`/summary/daily${date ? `?date=${date}` : ""}`, { method: "POST" }),

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
