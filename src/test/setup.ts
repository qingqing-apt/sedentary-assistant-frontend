import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

/**
 * jsdom 缺的浏览器 API。
 *
 * 组件里用了 matchMedia（移动端/桌面端布局切换）和 ResizeObserver（CopilotKit 面板），
 * 不补这两个，挂载直接抛错，测的就不是业务逻辑而是 jsdom 的缺口了。
 */

// 默认按「桌面」返回 false。要测移动端布局的用例自己覆盖这个 mock。
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// localStorage 在 jsdom 里有，但每个用例之间会串数据，统一清干净
beforeEach(() => {
  window.localStorage.clear();
});
