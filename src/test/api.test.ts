/**
 * API 层测试：地址注入、错误透传、登录态清理。
 *
 * 这些是 Android 打包最容易出问题的地方——WebView 里没有 Vite 代理，
 * API_BASE 猜错就是一个白屏，而且错误信息通常只有一句 "Failed to fetch"。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

async function loadApi(apiBase: string) {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", apiBase);
  return import("../api");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("API_BASE", () => {
  it("Web 构建下留空，走相对路径（Vite 代理接管）", async () => {
    const { API_BASE } = await loadApi("");
    expect(API_BASE).toBe("");
  });

  it("APK 构建下用注入的绝对地址，并去掉结尾斜杠", async () => {
    const { API_BASE } = await loadApi("http://10.0.2.2:8000/");
    expect(API_BASE).toBe("http://10.0.2.2:8000");
  });

  it("请求地址拼成 <base>/api/<path>", async () => {
    const spy = mockFetch(200, []);
    const { api } = await loadApi("http://10.0.2.2:8000");

    await api.today();

    expect(spy).toHaveBeenCalledWith(
      "http://10.0.2.2:8000/api/activities/today",
      expect.anything(),
    );
  });
});

describe("每日总结请求", () => {
  it("不传日期时不带 query，由后端默认取昨天", async () => {
    const spy = mockFetch(200, {});
    const { api } = await loadApi("");

    await api.dailySummary();

    expect(spy.mock.calls[0][0]).toBe("/api/summary/daily");
  });

  it("指定日期时带上 date 参数", async () => {
    const spy = mockFetch(200, {});
    const { api } = await loadApi("");

    await api.dailySummary("2026-10-29");

    expect(spy.mock.calls[0][0]).toBe("/api/summary/daily?date=2026-10-29");
  });

  it("生成总结走 POST", async () => {
    const spy = mockFetch(200, {});
    const { api } = await loadApi("");

    await api.generateDailySummary("2026-10-29");

    expect(spy.mock.calls[0][0]).toBe("/api/summary/daily?date=2026-10-29");
    expect(spy.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });
});

describe("错误处理", () => {
  it("把后端的 code / message 原样抛出来", async () => {
    mockFetch(400, { code: "FUTURE_DATE", message: "不能查看未来日期的总结" });
    const { api, ApiError } = await loadApi("");

    await expect(api.dailySummary("2030-01-01")).rejects.toThrow(ApiError);
    await expect(api.dailySummary("2030-01-01")).rejects.toMatchObject({
      code: "FUTURE_DATE",
      status: 400,
    });
  });

  it("后端返回非 JSON（比如网关报错页）时不崩，退回状态码文案", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }) as unknown as typeof fetch;
    const { api } = await loadApi("");

    await expect(api.today()).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "请求失败（502）",
    });
  });

  it("401 时清掉本地登录态，回到登录页而不是卡在空白列表", async () => {
    mockFetch(401, { code: "UNAUTHORIZED", message: "登录已失效" });
    const { api, getToken, saveSession } = await loadApi("");

    saveSession("demo.tester", "tester");
    expect(getToken()).toBe("demo.tester");

    await expect(api.today()).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("");
  });

  it("连不上后端时给出可操作的提示，而不是一句 Failed to fetch", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    const { api } = await loadApi("http://10.0.2.2:8000");

    await expect(api.today()).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("连不上后端"),
    });
  });

  it("请求挂住不会一直转圈，超时后报 TIMEOUT", async () => {
    vi.useFakeTimers();
    // 永远不 resolve 的 fetch，模拟「包被吃掉但不返回 RST」
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;

    const { api } = await loadApi("http://10.0.2.2:8000");
    const pending = api.today();
    const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(12_100);
    await assertion;

    vi.useRealTimers();
  });
});
