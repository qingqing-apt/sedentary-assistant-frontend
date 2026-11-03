/**
 * 验证「重启 Runtime 后会话历史还在」。
 *
 * 这东西不能用 pytest/vitest 那种单元测试覆盖——它要的是真的重启一个进程，
 * 所以做成脚本：起一次对话 → 杀掉 Runtime → 重新拉起 → 查同一 threadId 的消息。
 *
 * 前置：后端 :8000、Runtime :3000、前端 dev :5173 都在跑，且 Runtime 用的是
 * DurableAgentRunner（默认就是）。
 *
 *   npm run verify:threads
 */
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const RUNTIME = process.env.VERIFY_RUNTIME || "http://127.0.0.1:3000";
const THREADS_DIR = process.env.THREADS_DIR || ".runtime-data/threads";
const USER = `persist-${Date.now().toString(36)}`;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function listThreads() {
  try {
    return readdirSync(THREADS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function messagesOf(threadId) {
  const res = await fetch(`${RUNTIME}/api/copilotkit/threads/${threadId}/messages`, {
    headers: { Authorization: `Bearer demo.${USER}` },
  });
  if (!res.ok) fail(`线程接口返回 ${res.status}`);
  return (await res.json()).messages ?? [];
}

// ---------- 1. 真实聊两句 ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 900 } });

await page.goto(BASE + "/");
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + "/");
await page.getByPlaceholder("例如 intern").fill(USER);
await page.getByRole("button", { name: /进入/ }).click();
await page.locator("nav.tabbar").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "助手" }).click();
await page.locator(".chat-inline").waitFor({ timeout: 20000 });

async function say(text) {
  const input = page.locator(".chat-inline textarea, .chat-inline input[type=text]").first();
  await input.click();
  await input.fill(text);
  await input.press("Enter");
  await page.waitForTimeout(12000);
}

await say("记住：我叫小林");
await say("我叫什么？");

const threadId = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("sedentary.thread"));
  return key ? localStorage.getItem(key) : null;
});
if (!threadId) fail("前端没有把 threadId 落到 localStorage");
await browser.close();

const files = listThreads();
if (files.length === 0) fail(`对话结束了，但 ${THREADS_DIR} 里没有落盘文件`);

const before = await messagesOf(threadId);
console.log(`✓ 对话完成，落盘 ${files.length} 个线程，消息 ${before.length} 条`);
if (before.length < 4) fail(`消息条数不对（期望 4 条：两问两答，实际 ${before.length}）`);

// ---------- 2. 杀掉 Runtime ----------
const port = new URL(RUNTIME).port || "3000";
try {
  const line = execSync(`netstat -ano | findstr ":${port} " | findstr LISTENING`, {
    encoding: "utf8",
    shell: "cmd.exe",
  })
    .split("\n")[0]
    .trim();
  const pid = line.split(/\s+/).pop();
  execSync(`taskkill /PID ${pid} /F`, { shell: "cmd.exe", stdio: "ignore" });
  console.log(`✓ 已停止 Runtime（pid ${pid}）`);
} catch (error) {
  fail(`停 Runtime 失败，手动停一下再重跑：${error.message}`);
}

await new Promise((r) => setTimeout(r, 2000));

// ---------- 3. 重新拉起 ----------
console.log("→ 请手动重启 Runtime（npm run runtime），重启后按回车继续");
await new Promise((resolve) => process.stdin.once("data", resolve));

// ---------- 4. 同一个 threadId 还认得吗 ----------
const after = await messagesOf(threadId);
if (after.length < before.length) {
  fail(`重启后历史少了：之前 ${before.length} 条，现在 ${after.length} 条`);
}

const remembered = after.some(
  (m) => m.role === "assistant" && String(m.content).includes("小林"),
);
if (!remembered) fail("历史条数对上了，但助手没有回答「小林」——上下文没真正恢复");

console.log(`✓ 重启后仍是 ${after.length} 条消息，且助手还记得「小林」`);
console.log("\n全部通过：会话历史跨 Runtime 重启持久化生效。");
