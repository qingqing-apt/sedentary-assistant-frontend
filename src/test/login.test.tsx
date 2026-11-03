/**
 * 登录表单：空值校验、错误提示、成功后写入本地登录态。
 *
 * 手机端这一屏问题最多（软键盘遮挡、按钮被顶出视口），
 * 逻辑层先在这里钉住，剩下的交给实机验证。
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Login } from "../components/Login";

const login = vi.fn();

vi.mock("../api", () => ({
  api: {
    login: (name: string) => login(name),
  },
  saveSession: vi.fn(),
}));

describe("Login", () => {
  it("用户名为空时给出提示，不发请求", async () => {
    const user = userEvent.setup();
    render(<Login onDone={() => {}} />);

    await user.click(screen.getByRole("button", { name: "进入" }));

    expect(await screen.findByText("请输入用户名")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("只有空格也算空，不会发一个空用户名的请求", async () => {
    const user = userEvent.setup();
    render(<Login onDone={() => {}} />);

    await user.type(screen.getByRole("textbox"), "   ");
    await user.click(screen.getByRole("button", { name: "进入" }));

    expect(await screen.findByText("请输入用户名")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("成功后回调 onDone，交给上层切换到主界面", async () => {
    login.mockResolvedValueOnce({ token: "demo.intern", user_id: "intern" });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<Login onDone={onDone} />);
    await user.type(screen.getByRole("textbox"), "intern");
    await user.click(screen.getByRole("button", { name: "进入" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("后端报错时把服务端文案显示出来，不是一句「登录失败」", async () => {
    login.mockRejectedValueOnce(new Error("用户名不合法"));
    const user = userEvent.setup();

    render(<Login onDone={() => {}} />);
    await user.type(screen.getByRole("textbox"), "intern");
    await user.click(screen.getByRole("button", { name: "进入" }));

    expect(await screen.findByText("用户名不合法")).toBeInTheDocument();
  });

  it("请求进行中按钮变成「登录中…」且禁用，避免重复提交", async () => {
    let release: (value: { token: string; user_id: string }) => void = () => {};
    login.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();

    render(<Login onDone={() => {}} />);
    await user.type(screen.getByRole("textbox"), "intern");
    await user.click(screen.getByRole("button", { name: "进入" }));

    const pending = await screen.findByRole("button", { name: "登录中…" });
    expect(pending).toBeDisabled();

    release({ token: "t", user_id: "intern" });
    await waitFor(() => expect(pending).not.toBeDisabled());
  });
});
