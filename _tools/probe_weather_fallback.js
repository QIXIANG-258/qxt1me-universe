/* =========================================================
   验「识别不到天气时默认按晴天」这条逻辑（作者 2026-10-07 要求）。

   要覆盖的分支：
     ① 天气 API 请求失败（断网/被墙/限流）→ 场景 clear + 天气块显示晴天
     ② API 返回成功但字段缺失 → 同上
     ③ 正常返回晴天 → clear
     ④ 正常返回阴天 → overcast（确认没把所有情况都当晴天）

   做法：用 CDP 的 Fetch.enable 拦截 api.open-meteo.com
         · 分支①②：让请求失败 / 返回残缺 JSON
         · 分支③④：返回伪造的正常 JSON
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9445;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (c, label, extra) =>
  results.push({ pass: !!c, label, extra: extra === undefined ? "" : String(extra) });

/* 场景场景：mode = fail | badjson | clear | overcast */
async function runCase(mode) {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-wx-")),
    "--window-size=1200,800", "about:blank",
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
  /* send 必须在引用它的 message 处理器**之前**定义 ——
     否则拦截回调里用到它会撞上 const 的暂时性死区（TDZ）。 */
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  ws.on("message", async (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    /* 拦截天气 API */
    if (m.method === "Fetch.requestPaused") {
      const rid = m.params.requestId;
      const u = m.params.request.url;
      if (u.indexOf("open-meteo.com") >= 0) {
        if (mode === "fail") {
          await send("Fetch.failRequest", { requestId: rid, errorReason: "ConnectionFailed" });
        } else if (mode === "badjson") {
          await send("Fetch.fulfillRequest", {
            requestId: rid, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from('{"ok":true}').toString("base64"),
          });
        } else {
          const temp = mode === "overcast" ? 18 : 26;
          const code = mode === "overcast" ? 3 : 0;
          await send("Fetch.fulfillRequest", {
            requestId: rid, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" },
                              { name: "Access-Control-Allow-Origin", value: "*" }],
            body: Buffer.from(JSON.stringify({
              current_weather: { temperature: temp, weathercode: code },
            })).toString("base64"),
          });
        }
      } else {
        await send("Fetch.continueRequest", { requestId: rid });
      }
    }
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 160));
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*open-meteo*" }] });

  /* 关掉定位 → 走兜底分支，避免等 7 秒授权超时 */
  await send("Emulation.setGeolocationOverride", {}).catch(() => {});
  await send("Browser.setPermission", {
    permission: { name: "geolocation" }, setting: "denied", origin: new URL(URL_).origin,
  }).catch(() => {});

  await send("Page.navigate", { url: URL_ });

  /* 等天气块出现（或超时） */
  let wx = null;
  for (let i = 0; i < 60; i++) {
    wx = await ev(`(() => {
      const b = document.querySelector('#weather');
      const s = document.querySelector('#scene');
      return {
        wxShown: b ? !b.hidden : false,
        tmp: (document.querySelector('#weatherTemp')||{}).textContent || '',
        city: (document.querySelector('#weatherCity')||{}).textContent || '',
        sceneWx: s ? s.getAttribute('data-weather') : null,
        scenePart: s ? s.getAttribute('data-daypart') : null,
        ready: s ? s.classList.contains('is-ready') : false
      }; })()`);
    if (wx.wxShown && wx.sceneWx) break;
    await sleep(300);
  }

  try { child.kill(); } catch (e) {}
  await sleep(300);
  return wx;
}

(async () => {
  console.log("============ 天气识别失败 → 默认晴天 ============\n");

  const c1 = await runCase("fail");
  console.log("  [API 请求失败]", JSON.stringify(c1));
  ok(c1.wxShown, "① 请求失败时天气块**仍然显示**（不再整块隐藏）");
  ok(c1.sceneWx === "clear", "① 场景落到 clear（晴）", c1.sceneWx);
  ok(/晴|Clear/.test(c1.city), "① 天气文字显示晴天", c1.city);
  ok(c1.tmp === "" || c1.tmp === null, "① 温度留空（不编造数字）", JSON.stringify(c1.tmp));

  const c2 = await runCase("badjson");
  console.log("  [返回残缺 JSON]", JSON.stringify(c2));
  ok(c2.wxShown, "② 残缺数据时天气块仍显示");
  ok(c2.sceneWx === "clear", "② 场景落到 clear（晴）", c2.sceneWx);

  const c3 = await runCase("clear");
  console.log("  [正常·晴]", JSON.stringify(c3));
  ok(c3.sceneWx === "clear", "③ 晴天 → clear", c3.sceneWx);
  ok(/26/.test(c3.tmp), "③ 温度正常显示", c3.tmp);

  const c4 = await runCase("overcast");
  console.log("  [正常·阴]", JSON.stringify(c4));
  ok(c4.sceneWx === "overcast", "④ 阴天 → overcast（没把所有情况都当晴天）", c4.sceneWx);

  ok(c1.scenePart && c1.ready, "场景在天气失败时也已就绪", c1.scenePart);

  const failed = results.filter((r) => !r.pass);
  console.log("\n================================================");
  for (const r of results) {
    console.log(`  ${r.pass ? "OK  " : "XX  "} ${r.label}${r.extra ? "   [" + r.extra + "]" : ""}`);
  }
  console.log("------------------------------------------------");
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
