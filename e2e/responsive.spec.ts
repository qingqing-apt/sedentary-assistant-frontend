import { expect, test, type Page } from "@playwright/test";

/**
 * 响应式布局回归测试。
 *
 * 这里刻意不测「像素长得对不对」——那种断言一改样式就红，维护成本高于价值。
 * 只断言四类会真出问题的事：
 *   1. 分叉点对不对（≤1040 走移动端、>1040 走桌面）
 *   2. 有没有横向溢出
 *   3. 底部 Tab 栏有没有压住内容
 *   4. 关键交互（登录 → 生成安排 → 完成）在两个尺寸下都能走通
 */

const ACTIVITIES = [
  {
    id: "a1",
    activity_type: "stretch",
    title: "起身拉伸",
    description: "站起来活动肩颈，2 分钟就够",
    scheduled_at: "2026-11-03T10:30:00+08:00",
    status: "planned",
    source: "user",
    postponed_from: null,
    is_overdue: false,
  },
  {
    id: "a2",
    activity_type: "walk",
    title: "走廊走一圈",
    description: "绕着楼层走 3 分钟",
    scheduled_at: "2026-11-03T14:30:00+08:00",
    status: "planned",
    source: "user",
    postponed_from: null,
    is_overdue: false,
  },
];

const SETTINGS = {
  work_start: "09:00",
  work_end: "18:00",
  morning_start: "09:00",
  morning_end: "12:00",
  afternoon_start: "13:30",
  afternoon_end: "18:00",
  quiet_hours: [],
  daily_count: 3,
  reminders_enabled: true,
  allow_during_work: false,
  postpone_strategy: "next_slot",
};

const WEEKLY = {
  week_start: "2026-11-02",
  week_end: "2026-11-08",
  total: 2,
  completed: 0,
  postponed: 0,
  skipped: 0,
  pending: 2,
  daily: [
    { date: "2026-11-02", total: 0, completed: 0 },
    { date: "2026-11-03", total: 2, completed: 0 },
  ],
};

function dailySummary(date: string) {
  return {
    date,
    state: "not_generated",
    stats: { date, total: 2, completed: 0, postponed: 0, skipped: 0, pending: 2, completion_rate: 0 },
    summary: null,
  };
}

/**
 * 把所有后端请求拦掉，返回固定数据 —— 这个测试不需要真后端。
 *
 * `emptyAtStart` 用来走「空状态 → 生成 → 有卡片」这条真实动线：
 * 有活动时按钮文案是「重新生成」，一开始就塞数据会点不到「生成安排」。
 */
async function mockApi(
  page: Page,
  options: { completed?: boolean; emptyAtStart?: boolean } = {},
) {
  let activities = options.completed
    ? ACTIVITIES.map((a, i) => (i === 0 ? { ...a, status: "completed" } : a))
    : options.emptyAtStart
      ? []
      : ACTIVITIES;

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // CopilotKit 的接口单独放行成 404，别落到下面的兜底 {}。
    // 给它一个 200 的空对象，CopilotKit 会在 entries(undefined) 上抛错，
    // 错误边界把整棵树吞掉 → 页面全白（这个坑踩过一次）。
    // 真实环境里 Runtime 没起就是这个样子：404，聊天区显示提示，其余功能正常。
    if (url.includes("/api/copilotkit")) {
      return route.fulfill({ status: 404, json: { error: 'runtime not running' } });
    }
    if (url.includes("/api/auth/login")) {
      return route.fulfill({ json: { token: "demo.tester", user_id: "tester" } });
    }
    if (url.includes("/api/activities/today")) {
      return route.fulfill({ json: activities });
    }
    if (url.includes("/api/activities/generate")) {
      // 生成之后 state 才变成有数据，模拟真实后端
      activities = ACTIVITIES;
      return route.fulfill({
        json: { created: 2, adjusted: false, message: null, activities },
      });
    }
    if (url.includes("/api/activities/") && method === "PATCH") {
      const id = url.match(/activities\/([^/]+)/)?.[1] ?? "a1";
      const idx = activities.findIndex((a) => a.id === id);
      const target = idx >= 0 ? { ...activities[idx], status: "completed" as const } : ACTIVITIES[0];
      // 改完要落到内存里，否则前端紧接着的刷新会把状态冲回 planned
      if (idx >= 0) activities = activities.map((a, i) => (i === idx ? target : a));
      return route.fulfill({ json: target });
    }
    if (url.includes("/api/settings")) return route.fulfill({ json: SETTINGS });
    if (url.includes("/api/stats/weekly")) return route.fulfill({ json: WEEKLY });
    // 空提议单要返回 null，不是 []——[] 是 truthy，会让前端当成「有一个空单子」
    if (url.includes("/api/proposals/pending")) return route.fulfill({ json: null });
    if (url.includes("/api/summary/daily")) {
      return route.fulfill({ json: dailySummary("2026-11-02") });
    }
    if (url.includes("/api/agent/suggest")) {
      return route.fulfill({
        json: { mode: "rule", note: "规则建议", suggestions: [], rejected: [] },
      });
    }
    return route.fulfill({ json: {} });
  });
}

/** 预置登录态，跳过登录页（除非用例本身要测登录）。 */
async function loginAs(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("sedentary.token", "demo.tester");
    window.localStorage.setItem("sedentary.user", "tester");
  });
}

/** 页面有没有横向滚动 —— 窄屏最容易出这个，出了就是真的布局坏了。 */
async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
}

const VIEWPORTS = {
  narrow: { width: 375, height: 667 }, // iPhone SE / 小屏安卓
  tablet: { width: 768, height: 1024 }, // iPad 竖屏
  desktop: { width: 1280, height: 800 },
};

test.describe("分叉点", () => {
  for (const [name, size] of [
    ["375 窄屏", VIEWPORTS.narrow],
    ["768 平板", VIEWPORTS.tablet],
  ] as const) {
    test(`${name} 走移动端布局：有底部 Tab 栏，没有桌面双栏`, async ({ page }) => {
      await page.setViewportSize(size);
      await loginAs(page);
      await mockApi(page);
      await page.goto("/");

      await expect(page.locator("nav.tabbar")).toBeVisible();
      await expect(page.locator("main.mobile-app")).toBeVisible();
      // 桌面专属的双栏容器不该出现
      await expect(page.locator("main.layout")).toHaveCount(0);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  }

  test("1280 桌面走双栏布局：没有底部 Tab 栏", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAs(page);
    await mockApi(page);
    await page.goto("/");

    await expect(page.locator("main.layout")).toBeVisible();
    await expect(page.locator("nav.tabbar")).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe("底部 Tab 栏不遮挡内容", () => {
  test("滚到底时，最后一张卡片能完整露在 Tab 栏之上", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.narrow);
    await loginAs(page);
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("nav.tabbar")).toBeVisible();

    // 滚到底
    await page.evaluate(() => {
      const pane = document.querySelector(".mobile-panes");
      if (pane) pane.scrollTop = pane.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(150);

    const { lastBottom, barTop } = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".pane:not([hidden]) .card"));
      const last = cards[cards.length - 1];
      const bar = document.querySelector("nav.tabbar");
      return {
        lastBottom: last ? last.getBoundingClientRect().bottom : 0,
        barTop: bar ? bar.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      };
    });

    // 卡片底边不该越过 Tab 栏顶边（留 1px 容差给小数像素）
    expect(lastBottom).toBeLessThanOrEqual(barTop + 1);
  });
});

test.describe("关键交互", () => {
  test("窄屏：登录 → 生成安排 → 完成一条", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.narrow);
    await mockApi(page, { emptyAtStart: true });
    await page.goto("/");

    // 登录页
    await expect(page.locator(".login-card")).toBeVisible();
    await page.getByPlaceholder("例如 intern").fill("tester");
    await page.getByRole("button", { name: /进入/ }).click();

    // 今日页
    await expect(page.locator("nav.tabbar")).toBeVisible();
    await page.getByRole("button", { name: "生成安排" }).click();
    await expect(page.getByText("起身拉伸")).toBeVisible();

    // 完成一条
    await page.getByRole("button", { name: "完成" }).first().click();
    await expect(page.getByText("已完成").first()).toBeVisible();
  });

  test("窄屏：已完成的条目不再显示操作按钮", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.narrow);
    await loginAs(page);
    await mockApi(page, { completed: true });
    await page.goto("/");

    await expect(page.getByText("已完成").first()).toBeVisible();
    // 已完成的卡片不该再有「完成」按钮可点
    const buttons = page.getByRole("button", { name: "完成", exact: true });
    expect(await buttons.count()).toBeLessThanOrEqual(1);
  });
});
