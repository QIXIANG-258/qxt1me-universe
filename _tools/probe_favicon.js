/* =========================================================
   验 favicon 真的被浏览器请求并用了（声明了 ≠ 被使用）。

   要回答：
     ① 浏览器是否请求了 favicon（还是它自己在猜 /favicon.ico）
     ② 请求的是 index.html 里声明的那个 URL（带缓存刷新参数时尤其重要）
     ③ 拿到的响应是 200 且 Content-Type 对
     ④ 根目录图标是否被 _headers 规则覆盖（不该每次回源）

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools\probe_favicon.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9455;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (c, label, extra) =>
  results.push({ pass: !!c, label, extra: extra === undefined ? "" : String(extra) });

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-fav-")),
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
  const reqs = {};        /* url -> {status, mime} */
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      /* ⚠️ 别只匹配图标 —— manifest 也要抓。第一版只写了 favicon|icon-\d+\.png，
         后来加了 manifest.webmanifest 就漏掉了「浏览器有没有真的请求它」。 */
      if (/favicon|icon-\d+(-maskable)?\.png|manifest\.webmanifest/.test(r.url)) {
        reqs[r.url] = { status: r.status, mime: r.mimeType,
                        fromCache: !!r.fromDiskCache };
      }
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.navigate", { url: URL_ });
  for (let i = 0; i < 60; i++) {
    const st = await ev(`({r: document.readyState, s: !!document.querySelector('#scene.is-ready')})`);
    if (st.r === "complete" && st.s) break;
    await sleep(250);
  }
  await sleep(2000);   /* favicon 请求可能晚于 load */

  /* ① HTML 里确实声明了 */
  const links = await ev(`[...document.querySelectorAll('link[rel*="icon"]')]
    .map(l => l.getAttribute('rel') + ' -> ' + l.getAttribute('href'))`);
  ok(links.length >= 2, "HTML 里有 icon 声明", JSON.stringify(links));

  /* ② 浏览器真的请求了 */
  const urls = Object.keys(reqs);
  ok(urls.length >= 1, "浏览器请求了图标文件", JSON.stringify(urls));

  const fav = urls.find((u) => /favicon\.ico$/.test(u));
  ok(!!fav, "其中有 favicon.ico", fav || "无");
  if (fav) {
    ok(reqs[fav].status === 200, "favicon.ico 返回 200", reqs[fav].status);
  }

  /* ③ 直接 GET 各图标 + manifest，确认可访问 + 拿缓存头 */
  console.log("\n  ── 各资源响应 ──");
  for (const f of ["favicon.ico", "icon-180.png", "icon-192.png", "icon-512.png",
                   "icon-192-maskable.png", "icon-512-maskable.png",
                   "manifest.webmanifest"]) {
    const r = await ev(`(async () => {
      const res = await fetch('${f}', { method: 'GET' });
      return { status: res.status,
               cc: res.headers.get('cache-control') || '',
               ct: res.headers.get('content-type') || '',
               len: (await res.blob()).size }; })()`);
    // ⚠️ Node 的 console.log 不支持 %-16s 这种 C 风格左对齐（会原样打印）——
    //    第一版就踩了这个，输出成了 "%-16s favicon.ico"。
    //    另外 padding 要够宽：线上 favicon.ico 的 Content-Type 是
    //    "image/vnd.microsoft.icon"（24 字符），用 18 会让它和缓存头粘在一起。
    console.log("    " + f.padEnd(24) + String(r.status).padEnd(6) +
                (r.ct || "-").padEnd(26) + (r.cc || "(无 cache-control)").padEnd(30) +
                " " + r.len + " B");
    ok(r.status === 200, f + " 可访问", r.status);
    ok(r.len > 200, f + " 有内容", r.len + " B");
    if (f === "favicon.ico") {
      ok(/image\//.test(r.ct), "favicon.ico 的 Content-Type 是图片", r.ct);
    }
    if (f === "manifest.webmanifest") {
      /* manifest 的 MIME 必须正确 —— 缺失或错的 MIME 会让部分浏览器
         **直接忽略整个 manifest**（图标与独立窗口都不生效）。 */
      ok(/application\/manifest\+json/.test(r.ct),
         "manifest 的 Content-Type 正确", r.ct);
    }
  }

  /* ③b manifest 内容自检：里面声明的每个图标都要真实存在 */
  const man = await ev(`fetch('manifest.webmanifest').then(r => r.json())`);
  ok(!!man && Array.isArray(man.icons) && man.icons.length >= 2,
     "manifest 里声明了图标", man && man.icons ? man.icons.length + " 个" : "无");
  ok(man && man.display === "standalone",
     "manifest 的 display 是 standalone（添加到主屏幕后像 App）", man && man.display);
  const maskable = (man.icons || []).filter((i) => i.purpose === "maskable");
  ok(maskable.length >= 1, "manifest 含 maskable 图标", maskable.length + " 个");
  /* 逐个访问 manifest 里声明的图标，确认不是死链 */
  for (const ic of (man.icons || [])) {
    const st = await ev(`fetch('${ic.src}').then(r => r.status).catch(() => 0)`);
    ok(st === 200, "manifest 声明的图标可访问：" + ic.src, st);
  }

  /* ④ is-ready 之后场景仍正常（图标不该影响页面） */
  const stillOk = await ev(`(() => {
    const s = document.querySelector('#scene');
    return { ready: s ? s.classList.contains('is-ready') : false,
             bodyBg: getComputedStyle(document.body).backgroundColor }; })()`);
  ok(stillOk.ready, "加了图标后场景仍正常就绪");
  ok(/rgb\(15,\s*15,\s*15\)/.test(stillOk.bodyBg), "body 背景仍未被改动", stillOk.bodyBg);

  /* ⑤ 浏览器是否真的请求了 manifest（声明了 ≠ 被用） */
  const manReq = Object.keys(reqs).find((u) => /manifest\.webmanifest/.test(u));
  ok(!!manReq, "浏览器真的请求了 manifest", manReq || "未请求（可能被浏览器缓存或未触发）");

  try { child.kill(); } catch (e) {}
  const failed = results.filter((r) => !r.pass);
  console.log("\n============ favicon 验收 ============");
  for (const r of results) {
    console.log(`  ${r.pass ? "OK  " : "XX  "} ${r.label}${r.extra ? "   [" + r.extra + "]" : ""}`);
  }
  console.log("--------------------------------------");
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
