/* =========================================================
   验「访客授权定位」这条分支（线上 HTTPS）。
   CDP 的 Emulation.setGeolocationOverride 伪造坐标 + grantPermissions 授权，
   看天气是否用了伪造坐标而不是兜底城市。

   跑：node _tools/probe_geo.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9421;
const URL_ = process.env.PROBE_URL || "https://universe.qxt1me.dpdns.org/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 伪造坐标：广州（与兜底的成都相距很远，便于区分） */
const FAKE = { latitude: 23.1291, longitude: 113.2644 };

const results = [];
const ok = (c, label, extra) =>
  results.push({ pass: !!c, label, extra: extra === undefined ? "" : String(extra) });

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-geo-")),
    "--window-size=1440,1000", "about:blank",
  ], { stdio: "ignore" });

  const wsUrl = await (async () => {
    for (let i = 0; i < 80; i++) {
      try {
        const list = await new Promise((res, rej) => {
          const req = http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, (r) => {
            let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d)));
          });
          req.on("error", rej); req.setTimeout(1000, () => req.destroy(new Error("t")));
        });
        const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (p) return p.webSocketDebuggerUrl;
      } catch (e) {}
      await sleep(250);
    }
    throw new Error("no target");
  })();

  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("页面异常：" + JSON.stringify(r.exceptionDetails).slice(0, 160));
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  const origin = new URL(URL_).origin;

  console.log("[" + URL_ + "]");
  console.log("  授予定位权限 + 伪造坐标 →", FAKE.latitude + "," + FAKE.longitude);

  await send("Browser.grantPermissions", {
    permissions: ["geolocation"], origin: origin,
  });
  await send("Emulation.setGeolocationOverride", {
    latitude: FAKE.latitude, longitude: FAKE.longitude, accuracy: 20,
  });

  await send("Page.navigate", { url: URL_ });

  /* 等天气出来（授权分支应很快，不用等 7 秒超时） */
  let wx = null, elapsed = 0;
  for (let i = 0; i < 40; i++) {
    wx = await ev(`(() => { const b = document.querySelector('#weather');
      if (!b || b.hidden) return null;
      return { city: (document.querySelector('#weatherCity')||{}).textContent || '',
               temp: (document.querySelector('#weatherTemp')||{}).textContent || '' }; })()`);
    if (wx && wx.city) break;
    await sleep(250); elapsed += 250;
  }

  ok(!!wx, "天气已显示", wx ? wx.city : "null");
  if (wx) {
    /* 关键判据：城市名应当是「当前位置」而不是兜底的「成都」 */
    ok(/当前位置|Current location/.test(wx.city),
       "用了访客定位（城市=「当前位置」，不是兜底成都）", wx.city);
    ok(!/成都/.test(wx.city), "没有错误地落到兜底城市", wx.city);
    ok(elapsed < 7000, "定位分支比超时快（说明授权生效了）", elapsed + "ms");
  }

  try { child.kill(); } catch (e) {}
  const failed = results.filter((r) => !r.pass);
  console.log("\n============ 定位分支验收 ============");
  for (const r of results) {
    console.log(`${r.pass ? "  OK  " : "  XX  "} ${r.label}${r.extra ? "   [" + r.extra + "]" : ""}`);
  }
  console.log("--------------------------------------");
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("[探针出错] " + (e.stack || e));
  process.exit(2);
});
