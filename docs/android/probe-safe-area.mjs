// 通过 CDP 读 WebView 里的真实计算值：安全区变量、topbar 的实际 padding、视口尺寸。
// 用来判断「状态栏是否压住标题」到底是真问题还是猜测。

const endpoint = "http://127.0.0.1:9222/json";

const targets = await (await fetch(endpoint)).json();
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.error("no page target");
  process.exit(1);
}

const expression = `(() => {
  const root = getComputedStyle(document.documentElement);
  const bar = document.querySelector('.topbar');
  const barStyle = bar ? getComputedStyle(bar) : null;
  return JSON.stringify({
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    vars: {
      insetTop: root.getPropertyValue('--inset-top').trim(),
      saTop: root.getPropertyValue('--safe-area-inset-top').trim(),
      envTop: (() => {
        const d = document.createElement('div');
        d.style.paddingTop = 'env(safe-area-inset-top, 0px)';
        document.body.appendChild(d);
        const v = getComputedStyle(d).paddingTop;
        d.remove();
        return v;
      })(),
    },
    topbar: barStyle ? { paddingTop: barStyle.paddingTop, height: bar.getBoundingClientRect().height, top: bar.getBoundingClientRect().top } : null,
    innerY: window.visualViewport ? window.visualViewport.offsetTop : null,
  });
})()`;

const ws = new WebSocket(page.webSocketDebuggerUrl);
const timeout = setTimeout(() => {
  console.error("timeout");
  process.exit(2);
}, 8000);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== 1) return;
  clearTimeout(timeout);
  const raw = msg.result?.result?.value;
  console.log(raw ? JSON.stringify(JSON.parse(raw), null, 2) : JSON.stringify(msg, null, 2));
  ws.close();
  process.exit(0);
});
