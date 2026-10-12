/* 故障注入：模拟「国外网络」——让探测端点可达，验证路由会切到 Google。
 *
 * ⚠️ 为什么必须做这一步：
 *   本机是成都网络，google 直连 000（实测），所以上面那次跑只验到了
 *   **bing 这一条分支**。只验一条分支的探针等于没验 —— 必须证明
 *   「google 可达时真的会切过去」，否则代码里写成恒返回 bing 也能全绿。
 *
 * ⚠️ 注入应答必须是「HTTP 200 + 真实 PNG 实体」，**204 + 空体不行**。
 *   实测三种形态（_diag_inject_shape.js）：
 *     200 + 真实 PNG 实体 → Image.onload（naturalWidth=1）  ← 用这个
 *     200 + 空体          → Image.onerror
 *     204 + 空体          → Image.onerror
 *   即 `<img>` 的 onload 要求真的解码出一张图；空体不是「成功的空图片」，
 *   是不合法的图片，照样走 onerror。所以注入要喂一张 1×1 PNG。 */
"use strict";
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* 1×1 透明 PNG（base64）。用真实图片字节，见上文注释。 */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const PORT = 9550 + Math.floor(Math.random() * 40);

function findBrowser() {
  const c = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const x of c) if (fs.existsSync(x)) return x;
  throw new Error("no browser");
}
const targets = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: p, path: "/json/list" }, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b)));
  }).on("error", rej);
});
function wsConnect(url) {
  return new Promise((res, rej) => {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    const req = http.request({ host: m[1], port: +m[2], path: m[3],
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from(String(Math.random())).toString("base64") } });
    req.on("upgrade", (r, sock) => {
      let buf = Buffer.alloc(0); const waiters = new Map(); let id = 0;
      const handlers = [];
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.slice(off, off + len); buf = buf.slice(off + len);
          if (op === 0x8) return;
          if (op === 0x1) {
            let msg; try { msg = JSON.parse(payload.toString("utf8")); } catch (e) { continue; }
            if (msg.id != null && waiters.has(msg.id)) { const w = waiters.get(msg.id); waiters.delete(msg.id); w(msg); }
            else if (msg.method) handlers.forEach((h) => h(msg));
          }
        }
      });
      const send = (o) => {
        const s = Buffer.from(JSON.stringify(o), "utf8");
        const mask = Buffer.from([1, 2, 3, 4]); let head;
        if (s.length < 126) head = Buffer.from([0x81, 0x80 | s.length]);
        else if (s.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0xFE; head.writeUInt16BE(s.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0xFF; head.writeBigUInt64BE(BigInt(s.length), 2); }
        const mk = Buffer.alloc(s.length); for (let i = 0; i < s.length; i++) mk[i] = s[i] ^ mask[i & 3];
        sock.write(Buffer.concat([head, mask, mk]));
      };
      const call = (method, params) => new Promise((rs) => { const i = ++id; waiters.set(i, rs); send({ id: i, method, params: params || {} }); });
      const on = (h) => handlers.push(h);
      res({ call, on, close: () => sock.destroy() });
    });
    req.on("error", rej); req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let PASS = 0, FAIL = 0; const fails = [];
  const ok = (n, c, d) => { if (c) { PASS++; console.log("  \u2713 " + n + (d ? "  [" + d + "]" : "")); } else { FAIL++; fails.push(n + " " + (d || "")); console.log("  \u2717 " + n + "  [" + d + "]"); } };

  const udd = path.join(os.tmpdir(), "probe_engine_forge_" + Date.now());
  const p = spawn(findBrowser(), ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + udd, "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1440,900", "about:blank"], { stdio: "ignore" });

  let ws;
  try {
    let list = null;
    for (let i = 0; i < 80 && !list; i++) { try { list = await targets(PORT); } catch (e) { await sleep(250); } }
    /* ⚠️ 必须挑 http 的 page 目标：无头 Edge 会带一个扩展的 background page，
       它的 type 也是 "page"。取 list[0] 可能挂到它上面，页面里全是 undefined，
       看起来像「代码没生效」，实则挂错了目标。 */
    const page = list.find((t) => t.type === "page" && /^https?:/.test(t.url))
              || list.find((t) => t.type === "page");
    ws = await wsConnect(page.webSocketDebuggerUrl);
    const { call, on } = ws;

    await call("Page.enable"); await call("Runtime.enable");
    await call("Fetch.enable", { patterns: [{ urlPattern: "*generate_204*", requestStage: "Request" }] });

    let intercepted = 0;
    on((m) => {
      if (m.method === "Fetch.requestPaused") {
        const u = m.params.request.url;
        if (/generate_204/.test(u)) {
          intercepted++;
          /* 伪造「Google 通了」：必须 200 + 真实 PNG 实体，见文件头注释 */
          call("Fetch.fulfillRequest", {
            requestId: m.params.requestId, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "image/png" }],
            body: PNG_1X1
          });
        } else {
          call("Fetch.continueRequest", { requestId: m.params.requestId });
        }
      }
    });

    await call("Page.navigate", { url: process.env.PROBE_URL || "http://127.0.0.1:8802/" });
    for (let i = 0; i < 60; i++) {
      const r = await call("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (r.result.result.value === "complete") break; await sleep(250);
    }
    const ev = async (e) => (await call("Runtime.evaluate", { expression: e, returnByValue: true })).result.result.value;

    /* 等探测落地 */
    for (let i = 0; i < 40; i++) {
      if (await ev("window.uvGoogleReachable && window.uvGoogleReachable() === true")) break;
      await sleep(250);
    }

    console.log("=== 故障注入：伪造 google 可达 ===");
    ok("探测请求确实被拦截了（注入生效，不是没拦到就自说自话）", intercepted > 0, "捕获 " + intercepted + " 次");
    const reach = await ev("window.uvGoogleReachable()");
    ok("注入后 uvGoogleReachable() = true", reach === true, "得到 " + reach);
    const def = await ev("window.uvDefaultEngine()");
    ok("默认引擎切换为 google", def === "google", "得到 " + def);
    const resolved = await ev("window.uvResolve('摄影')");
    ok("无前缀搜索走 google", /google\.com\/search\?q=/.test(resolved || ""), resolved);
    /* 引擎名写在 .hint-plain 的文本节点里（不是元素，见 app.js 注释） */
    const hint = await ev("document.querySelector('.hint-plain').textContent");
    ok("提示条同步改成谷歌", /谷歌/.test(hint || ""), hint);
    /* 显式前缀仍不被改写 */
    const b = await ev("window.uvResolve('b: 摄影')");
    ok("显式 b: 仍强制必应（不被路由改写）", /bing\.com\/search\?q=/.test(b || ""), b);

  } catch (e) {
    console.log("[探针自身出错] " + (e && e.stack || e)); FAIL++;
  } finally {
    if (ws) ws.close();
    try { p.kill(); } catch (e) {}
  }
  console.log("\n=== 结果 " + PASS + "/" + (PASS + FAIL) + " ===");
  if (fails.length) { console.log("失败项：" + fails.join(" | ")); process.exitCode = 1; }
})();
