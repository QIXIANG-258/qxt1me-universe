/* =========================================================
   核实评测报告里的几条事实性说法（universe 为主）。

   要验：
     ① 报告称外部域只有「自身 + Cloudflare Insights」——
        但源码里有 api.open-meteo.com（天气）。实际请求了哪些域？
     ② 报告称「两个子站入口点击区域偏小」—— 实测热区尺寸
     ③ 报告称「无 H1、无 skip link」—— 已在源码确认，这里再确认 DOM
     ④ 报告称搜索是「命令式启动器」—— 验 ph: / gear: 前缀真的能跳

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools/verify_report_claims.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9461;
const URL_ = process.env.PROBE_URL || "https://universe.qxt1me.dpdns.org/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-rep-")),
    "--window-size=1440,900", "about:blank",
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
  const domains = new Set(); const reqDetail = [];
  /* 最近一条 **Document 类型**的请求 URL（= 一次真导航的意图）。
     用于 ④：回车后即使目标站因代理没加载成功，这条请求也已经发出去了。 */
  let lastDocReq = null;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === "Network.requestWillBeSent") {
      try {
        const u = new URL(m.params.request.url);
        if (u.protocol === "http:" || u.protocol === "https:") {
          domains.add(u.hostname);
          reqDetail.push(u.hostname + u.pathname);
          if (m.params.type === "Document") lastDocReq = m.params.request.url;
        }
      } catch (e) {}
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

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.navigate", { url: URL_ });
  for (let i = 0; i < 60; i++) {
    const st = await ev(`({r: document.readyState, s: !!document.querySelector('#scene.is-ready')})`);
    if (st.r === "complete" && st.s) break;
    await sleep(250);
  }
  await sleep(4000);   /* 等天气请求（含定位超时 8s 内的兜底） */

  console.log("============ 核实报告的说法 ============\n");

  /* ① 外部域 */
  const self = new URL(URL_).hostname;
  const others = [...domains].filter((d) => d !== self);
  console.log("① 实际请求的域（报告称只有「自身 + Cloudflare Insights」）：");
  console.log("   自身:", self);
  for (const d of others) console.log("   外部:", d);
  const hasWeatherApi = others.some((d) => /open-meteo/.test(d));
  console.log("   → 报告遗漏了天气 API:", hasWeatherApi ? "是（api.open-meteo.com）" : "否");

  /* ② 入口热区 */
  const hit = await ev(`(() => {
    const out = [];
    document.querySelectorAll('.social-container a').forEach(a => {
      const r = a.getBoundingClientRect();
      out.push({ text: (a.textContent||'').trim().split('\\n')[0].slice(0,12),
                 w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out; })()`);
  console.log("\n② 子站入口热区（报告称「点击区域偏小」）：");
  for (const h of hit) {
    /* WCAG 2.5.8 最小目标 24×24；Apple 建议 44×44 */
    const ok24 = h.w >= 24 && h.h >= 24;
    const ok44 = h.w >= 44 && h.h >= 44;
    console.log(`   ${h.text.padEnd(14)} ${h.w}×${h.h}px  ≥24:${ok24?"是":"否"}  ≥44:${ok44?"是":"否"}`);
  }

  /* ③ 语义结构 */
  const sem = await ev(`(() => ({
    h1: document.querySelectorAll('h1').length,
    h2: document.querySelectorAll('h2').length,
    h3: document.querySelectorAll('h3').length,
    skip: !!document.querySelector('a[href^="#"][class*=skip], .skip-link, [class*=skip]'),
    main: document.querySelectorAll('main').length,
    landmarks: { header: document.querySelectorAll('header').length,
                 nav: document.querySelectorAll('nav').length,
                 main: document.querySelectorAll('main').length,
                 footer: document.querySelectorAll('footer').length }
  }))()`);
  console.log("\n③ 语义结构（报告称「无 H1、无 skip link」）：");
  console.log("   ⚠️ 这一节量的是**我跑的这一刻**的状态。2026-10-08 修复前实测：");
  console.log("      H1=0 / skip link=无 / canonical=无 / OG=无 / robots+sitemap=404");
  console.log("      （修复前的那组数是拿线上旧构建量的 —— 修复尚未部署时跑本脚本即得）。");
  console.log("   H1:", sem.h1, " H2:", sem.h2, " H3:", sem.h3,
              " skip link:", sem.skip ? "有" : "无");
  console.log("   地标:", JSON.stringify(sem.landmarks));

  /* ④ 命令式前缀：真输入 + 真回车，看是否真发出跳转。
     ⚠️ 三个坑（第一版全踩了）：
       ① 不能在同一个 Runtime.evaluate 里「设值→回车→读 location.href」——
          回车触发的是真导航，evaluate 的执行上下文当场被销毁，报
          「Inspected target navigated or closed」；
       ② 不能只读 app.js 的 SITES 映射 —— 那只能证明前缀表里有这个键，
          证明不了「键入后回车真的会走」；
       ③ 不能要求目标站真的加载成功 —— 这台机器打外部域要过代理，
          加载失败不等于前缀没生效。
     正确做法：回车后**看 Network 有没有发出 Document 请求**（跳转意图的证据），
     用 lastDocReq 记录，与目标 origin 比对。 */
  console.log("\n④ 命令式搜索前缀（报告称 ph: / gear: / b: / ddg: 可用）：");
  const expect = {
    "ph:": "https://blog.qxt1me.dpdns.org/",
    "gear:": "https://gear-search.qxt1me.dpdns.org/",
    "2048:": "https://2048.qxt1me.dpdns.org/",
  };
  for (const key of Object.keys(expect)) {
    lastDocReq = null;
    await ev(`(() => { const i = document.querySelector('#searchInput');
      i.focus(); i.value = ${JSON.stringify(key)};
      i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    /* 真实按键（不是合成 KeyboardEvent）：app.js 挂的是 keydown 监听 */
    const k = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown" }, k));
    await send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, k));
    let hit = null;
    for (let i = 0; i < 24; i++) {
      await sleep(200);
      if (lastDocReq) { hit = lastDocReq; break; }
    }
    const good = !!hit && hit.indexOf(expect[key]) === 0;
    console.log("   " + key.padEnd(7) + (good ? "✓ 发出跳转 → " : "✗ 没跳 → ") + (hit || "（无 Document 请求）"));
    /* 若真的跳走了，回到 universe 再测下一个 */
    if (hit) {
      await send("Page.navigate", { url: URL_ });
      await sleep(1500);
    }
  }

  try { child.kill(); } catch (e) {}
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
