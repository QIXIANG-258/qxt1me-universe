/* 把 og_card.html 渲染成 1200×630 的分享卡片。
   跑法（需先起 universe/src 的静态服务，默认 8802）：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools/make_og_image.js
   产物：src/og-cover.png（1200×630） */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execSync } = require("child_process");

const EDGE = process.env.EDGE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = Number(process.env.CDP_PORT || 9494);
const BASE = process.env.CARD_URL || "http://127.0.0.1:8802/_og_card_preview.html";
const OUT = path.join(__dirname, "..", "src", "og-cover.png");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-universe-"));
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
    "--window-size=1200,630", "--force-device-scale-factor=1",
    "--no-proxy-server", "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const body = await new Promise((res, rej) => {
        http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, (r) => {
          let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d));
        }).on("error", rej);
      });
      target = JSON.parse(body).find((t) => t.type === "page" && t.webSocketDebuggerUrl) || null;
    } catch (e) {}
  }
  if (!target) { console.error("no target"); process.exit(2); }

  const WebSocket = require("ws");
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let id = 0; const waiting = new Map();
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  });
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; waiting.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200, height: 630, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: BASE });

  // 等字体真正就绪 —— 衬线标题没加载完就截图会拿到系统字体，卡片就"变味"了
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await ev("document.readyState === 'complete' && document.fonts.status === 'loaded'") === true) break;
  }
  await sleep(700);

  const info = await ev(`(function(){
    var b = document.body;
    return { w: b.scrollWidth, h: b.scrollHeight,
             fonts: document.fonts.size, loaded: document.fonts.status,
             h1: (document.querySelector('h1')||{}).textContent,
             sites: document.querySelectorAll('.site').length };
  })()`);
  console.log("页面 " + info.w + "x" + info.h + "，字体 " + info.fonts +
              " 状态=" + info.loaded + "，标题=" + JSON.stringify(info.h1) +
              "，子站块=" + info.sites);

  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
  });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
  console.log("saved " + OUT);

  try {
    const py = execSync(
      'python -c "from PIL import Image;i=Image.open(r\'' + OUT + '\');print(i.size[0],i.size[1])"',
      { encoding: "utf8" }
    ).trim();
    console.log("回读尺寸：" + py + (py === "1200 630" ? "  ✓" : "  ✗ 尺寸不对！"));
  } catch (e) { console.log("回读尺寸失败：" + e.message); }

  try { ws.close(); } catch (e) {}
  try { child.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(2); });
