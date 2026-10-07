/* =========================================================
   背景场景「时段对照图」：7 个时段 + 若干天气组合，逐个截图。

   为什么用 CDP 强制切时段（而不是等到那个点）：
     一天只有一次黄昏，等不起；而且实测要能**复现**。
     这里直接写 data-daypart / data-weather 覆盖，截完再还原。

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools\shoot_scene.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9441;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const OUT = "D:\\QX_t1me_plan\\02-universe\\_shots";
const W = 900, H = 560;
const THEME = process.env.THEME || "dark";   // THEME=light 拍浅色主题
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 要拍的组合：时段（天气固定 clear，先看时间轴）*/
const TIMELINE = [
  ["night", "clear"], ["dawn", "clear"], ["morning", "clear"],
  ["noon", "clear"], ["afternoon", "clear"], ["dusk", "clear"], ["evening", "clear"],
];
/* 再拍天气对照（时段固定 noon，最能看出区别）*/
const WEATHERS = [
  ["noon", "clear"], ["noon", "partly"], ["noon", "overcast"],
  ["noon", "fog"], ["noon", "rain"], ["noon", "snow"],
];

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-scene-")),
    "--window-size=" + W + "," + H, "about:blank",
  ], { stdio: "ignore" });

  const wsUrl = await (async () => {
    for (let i = 0; i < 80; i++) {
      try {
        const list = await new Promise((res, rej) => {
          const r = http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, (x) => {
            let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => res(JSON.parse(d)));
          });
          r.on("error", rej); r.setTimeout(1000, () => r.destroy(new Error("t")));
        });
        const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (p) return p.webSocketDebuggerUrl;
      } catch (e) {}
      await sleep(250);
    }
    throw new Error("no target");
  })();

  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 160));
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: URL_ });

  /* 等场景就绪 */
  for (let i = 0; i < 60; i++) {
    const st = await ev(`({rs: document.readyState, scene: !!document.querySelector('#scene.is-ready')})`);
    if (st.rs === "complete" && st.scene) break;
    await sleep(250);
  }
  /* 等淡入跑完 */
  await sleep(1600);

  /* 主题：THEME=light 时切浅色（并等过渡跑完） */
  if (THEME === "light") {
    await ev(`document.documentElement.setAttribute('data-theme','light'); 1`);
    await sleep(1000);
  }

  const shoot = async (tag) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    const f = path.join(OUT, "scene_" + THEME + "_" + tag + ".png");
    fs.writeFileSync(f, Buffer.from(s.data, "base64"));
    return f;
  };

  const made = [];
  for (const [part, wx] of TIMELINE) {
    await ev(`(() => { const s = document.querySelector('#scene');
      s.setAttribute('data-daypart', '${part}');
      s.setAttribute('data-weather', '${wx}');
      s.style.setProperty('--glow-x', '50%');
      s.style.setProperty('--glow-y', '${part === "noon" ? "4" : part === "dusk" ? "82" : part === "dawn" ? "78" : "40"}%');
      return 1; })()`);
    await sleep(900);
    made.push(await shoot("t_" + part));
  }
  if (THEME === "dark") for (const [part, wx] of WEATHERS) {
    await ev(`(() => { const s = document.querySelector('#scene');
      s.setAttribute('data-daypart', '${part}');
      s.setAttribute('data-weather', '${wx}');
      return 1; })()`);
    await sleep(900);
    made.push(await shoot("w_" + wx));
  }

  console.log("拍了 " + made.length + " 张：");
  made.forEach((f) => console.log("  " + f));

  try { child.kill(); } catch (e) {}
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
