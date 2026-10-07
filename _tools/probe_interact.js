/* =========================================================
   universe 交互验收（弹窗 / 复制 / 磁贴）
   起服务：cd src && python -m http.server 8802 --bind 127.0.0.1
   跑：node _tools/probe_interact.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9417;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (c, label, extra) =>
  results.push({ pass: !!c, label, extra: extra === undefined ? "" : String(extra) });

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run",
    "--hide-scrollbars", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-int-")),
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
  let id = 0; const pending = new Map(); const events = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method) events.push(m);
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("页面异常：" + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");
  // 剪贴板权限（读回验证需要）
  await send("Browser.grantPermissions", {
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    origin: new URL(URL_).origin,
  }).catch(() => {});
  await send("Page.navigate", { url: URL_ });

  for (let i = 0; i < 60; i++) {
    const st = await ev(`({rs: document.readyState, t: (document.querySelector('#clockTime')||{}).textContent||''})`);
    if (st.rs === "complete" && /\d\d:\d\d/.test(st.t)) break;
    await sleep(200);
  }
  await sleep(400);

  /* ---------- A. 关键区块 ---------- */
  const dom = await ev(`({
    clock: !!document.querySelector('#clockTime'),
    search: !!document.querySelector('#searchInput'),
    aboutBtn: !!document.querySelector('#aboutBtn'),
    modal: !!document.querySelector('#aboutModal'),
    modalHidden: document.querySelector('#aboutModal') ? document.querySelector('#aboutModal').hidden : null,
    contactCount: document.querySelectorAll('.foot-contact .contact-btn, .foot-contact .contact-a').length,
    qq: !!document.querySelector('.foot-contact [data-copy]'),
    mail: !!document.querySelector('.foot-contact a[href^="mailto:"]'),
    githubInBody: document.body.textContent.indexOf('QIXIANG-258') !== -1,
    pexelsGone: document.body.textContent.indexOf('Pexels') === -1
  })`);
  ok(dom.clock, "时钟在");
  ok(dom.search, "搜索框在");
  ok(dom.aboutBtn, "左上角有关按钮");
  ok(dom.modal, "弹窗存在");
  ok(dom.modalHidden === true, "弹窗初始是隐藏的");
  ok(dom.contactCount === 2, "页脚联系方式有 2 项", dom.contactCount);
  ok(dom.qq, "QQ 项在（点击复制）");
  ok(dom.mail, "Gmail 项在（mailto）");
  /* Github 图标是 SVG（没有文字），所以正文文本里不该出现用户名 ——
     它作为图标 + aria-label 存在。 */
  ok(!dom.githubInBody, "Github 不以文字形式出现在正文（是图标）");
  ok(dom.pexelsGone, "Pexels 已移除");

  /* ---------- A2. 第二轮改动的守卫 ---------- */
  const v2 = await ev(`(() => {
    const tr = document.querySelector('.tools-right');
    const gh = tr ? tr.querySelector('a[href*="github.com"]') : null;
    const btns = tr ? tr.querySelectorAll('.tool-btn').length : 0;
    const fc = document.querySelector('.foot-contact');
    const cs = fc ? getComputedStyle(fc) : null;
    const hints = document.querySelectorAll('.foot-contact .hint').length;
    const wx = document.querySelector('#weather');
    return {
      ghInToolbar: !!gh,
      toolbarBtns: btns,
      footHasCopyText: document.body.textContent.indexOf('点击复制') !== -1,
      footHints: hints,
      footContactBorder: cs ? cs.borderTopWidth : null,
      weatherExists: !!wx
    }; })()`);
  ok(v2.ghInToolbar, "Github 图标在右上角工具条里");
  ok(v2.toolbarBtns >= 3, "工具条有三个控件（Github/EN/主题）", v2.toolbarBtns);
  ok(!v2.footHasCopyText, "页脚没有「点击复制」文字");
  ok(v2.footHints === 0, "页脚联系方式没有 hint 说明", v2.footHints);
  ok(v2.footContactBorder === "0px", "页脚联系方式无上边框（与页脚一体）",
     v2.footContactBorder);
  ok(v2.weatherExists, "天气容器存在");

  /* ---------- B. 弹窗交互（真实鼠标事件） ---------- */
  const box = await ev(`(() => { const e = document.querySelector('#aboutBtn');
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(300);
  let m = await ev(`(() => { const e = document.querySelector('#aboutModal');
    return { hidden: e.hidden, visible: !!(e.offsetWidth || e.offsetHeight),
             text: (e.querySelector('.modal-text')||{}).textContent || '' }; })()`);
  ok(!m.hidden && m.visible, "点「关于」后弹窗打开");
  ok(m.text.trim().length > 20, "弹窗里有文案", m.text.trim().slice(0, 30));

  /* Esc 关闭 */
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(250);
  m = await ev(`document.querySelector('#aboutModal').hidden`);
  ok(m === true, "Esc 能关闭弹窗");

  /* 再开一次，用遮罩关 */
  await ev(`document.querySelector('#aboutBtn').click()`);
  await sleep(250);
  const open2 = await ev(`!document.querySelector('#aboutModal').hidden`);
  ok(open2, "再点能重新打开");
  await ev(`document.querySelector('#aboutModal .modal-scrim').click()`);
  await sleep(250);
  m = await ev(`document.querySelector('#aboutModal').hidden`);
  ok(m === true, "点遮罩能关闭");

  /* ---------- C. QQ 点击复制 ---------- */
  await ev(`document.querySelector('.foot-contact [data-copy]').click()`);
  await sleep(400);
  const clip = await send("Runtime.evaluate", {
    expression: "navigator.clipboard.readText()", awaitPromise: true, returnByValue: true,
  }).then((r) => r.result.value).catch(() => null);
  ok(clip === "2088801789", "点 QQ 后剪贴板是号码", JSON.stringify(clip));
  /* 反馈是「把号码本身换成『已复制』」—— 因为页脚已不放 .hint 说明文字 */
  const fbTxt = await ev(`document.querySelector('.foot-contact [data-copy] .c-val').textContent`);
  ok(/已复制|复制失败/.test(fbTxt), "复制后就地反馈（号码变「已复制」）", fbTxt);
  /* 1.6 秒后应还原成号码 */
  await sleep(1700);
  const restored = await ev(`document.querySelector('.foot-contact [data-copy] .c-val').textContent`);
  ok(restored === "2088801789", "反馈过后号码还原", restored);

  /* ---------- D. 天气（Open-Meteo；本地走兜底城市） ---------- */
  /* 等天气出数（fetch 是异步的，且本地无 geolocation 会直接走兜底） */
  let wx = null;
  for (let i = 0; i < 40; i++) {
    wx = await ev(`(() => { const b = document.querySelector('#weather');
      if (!b || b.hidden) return null;
      return { temp: (document.querySelector('#weatherTemp')||{}).textContent || '',
               city: (document.querySelector('#weatherCity')||{}).textContent || '',
               hasIcon: !!document.querySelector('#weatherIco svg') }; })()`);
    if (wx && wx.temp) break;
    await sleep(300);
  }
  ok(!!wx, "天气块已显示（取到数据）", wx ? wx.temp : "未显示");
  if (wx) {
    ok(/^-?\d+°$/.test(wx.temp), "温度格式对（数字 + 度）", wx.temp);
    ok(wx.hasIcon, "天气有图标");
    ok(wx.city.length > 0, "显示了城市与天气词", wx.city);
  }

  /* 语言切换后城市名应跟着变（成都 → Chengdu） */
  if (wx && /成都/.test(wx.city)) {
    await ev(`document.querySelector('#langBtn').click()`);
    await sleep(400);
    const wxEn = await ev(`(document.querySelector('#weatherCity')||{}).textContent || ''`);
    ok(/Chengdu/.test(wxEn), "切英文后城市名变英文", wxEn);
    await ev(`document.querySelector('#langBtn').click()`);
    await sleep(300);
  }

  /* ---------- E. 磁贴效果（hover / active 的 transform 与颜色） ---------- */
  const tb = await ev(`(() => { const e = document.querySelector('#aboutBtn');
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);

  /* ⚠️ 取「静止态」前必须先把鼠标移开 —— 上一步刚点过这个按钮，
     鼠标还悬在上面，直接取会拿到 hover 值，于是「悬停有位移」这条
     变成 -2 → -2 而假红（探针自己踩过）。 */
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(300);
  const base = await ev(`(() => { const s = getComputedStyle(document.querySelector('#aboutBtn'));
    return { tf: s.transform, bg: s.backgroundColor, color: s.color, sh: s.boxShadow }; })()`);

  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tb.x, y: tb.y });
  await sleep(250);
  const hov = await ev(`(() => { const s = getComputedStyle(document.querySelector('#aboutBtn'));
    return { tf: s.transform, bg: s.backgroundColor, color: s.color, sh: s.boxShadow }; })()`);
  ok(hov.tf !== base.tf, "悬停有位移（transform 变了）", `${base.tf} → ${hov.tf}`);

  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: tb.x, y: tb.y, button: "left", clickCount: 1 });
  await sleep(200);
  const act = await ev(`(() => { const s = getComputedStyle(document.querySelector('#aboutBtn'));
    return { tf: s.transform, bg: s.backgroundColor, color: s.color, sh: s.boxShadow }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tb.x, y: tb.y, button: "left", clickCount: 1 });
  ok(act.tf !== hov.tf, "按下位移与悬停不同（沉下去）", `${hov.tf} → ${act.tf}`);
  ok(act.bg !== base.bg, "按下同时变色（背景）", `${base.bg} → ${act.bg}`);
  ok(act.color !== base.color, "按下同时变色（文字）", `${base.color} → ${act.color}`);

  /* ---------- E. 无异常 ---------- */
  const exc = events.filter((e) => e.method === "Runtime.exceptionThrown");
  ok(exc.length === 0, "无未捕获 JS 异常", exc.length + " 条");

  /* ---------- 汇总 ---------- */
  try { child.kill(); } catch (e) {}
  const failed = results.filter((r) => !r.pass);
  console.log("\n============ universe 交互验收 ============");
  for (const r of results) {
    console.log(`${r.pass ? "  OK  " : "  XX  "} ${r.label}${r.extra ? "   [" + r.extra + "]" : ""}`);
  }
  console.log("-------------------------------------------");
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("[探针出错] " + (e.stack || e));
  process.exit(2);
});
