/* =========================================================
   量「场景是否压低了文字可读性」——逐个时段测真实对比度。

   为什么必须测而不是看：
     时钟是 6rem 的浅色大字，肉眼「好像还能看清」；
     但日期那行同一颜色、字号小得多，可能已经在 3:1 以下。
     截图看整体 vs 逐元素算对比度，结论经常相反。

   算法：把 body 背景（在实际渲染里被场景覆盖）替换成
        **场景层的实际合成色** —— 用一个探针 div 采样场景像素？
        更稳的做法：直接读 .scene-sky 的 background-image 是渐变，
        无法直接取色。所以这里用 CDP 截图后读像素。

   做法：
     1. 对每个时段，在**文字所在位置**截一个 1x1 像素，
        用 Page.captureScreenshot 的 clip 拿该点的合成色
     2. 同时取文字自身颜色（getComputedStyle）
     3. 算 WCAG 对比度

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools\probe_scene_contrast.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9443;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PARTS = ["night", "dawn", "morning", "noon", "afternoon", "dusk", "evening"];

/* 最小 PNG 解码：只处理 8 位 RGB/RGBA、无隔行 —— CDP 截图就是这种 */
function decodePng(buf) {
  let pos = 8; // 跳过 signature
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("只支持 8 位 PNG，实际 " + bitDepth);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error("不支持的颜色类型 " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, ch, data: out };
}

function px(img, x, y) {
  const i = (y * img.width + x) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function lum(rgb) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(s) {
  const m = String(s).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-sc-")),
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
  let id = 0; const pend = new Map(); const errs = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") errs.push(m);
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL_ });
  for (let i = 0; i < 60; i++) {
    const st = await ev(`({rs: document.readyState, s: !!document.querySelector('#scene.is-ready')})`);
    if (st.rs === "complete" && st.s) break;
    await sleep(250);
  }
  await sleep(1500);

  const results = [];
  for (const part of PARTS) {
    /* 切时段 + 把日辉挪开（避免正好在文字后面，那会高估对比度） */
    await ev(`(() => { const s = document.querySelector('#scene');
      s.setAttribute('data-daypart','${part}');
      s.setAttribute('data-weather','clear');
      s.style.setProperty('--glow-x','4%');
      s.style.setProperty('--glow-y','96%');
      return 1; })()`);
    await sleep(900);

    /* 取文字元素的位置与颜色 */
    const els = await ev(`(() => {
      const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
        const r = e.getBoundingClientRect();
        return { sel, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
                 color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize }; };
      return [pick('#clockTime'), pick('#clockDate'), pick('.foot-name'), pick('.foot-note')].filter(Boolean);
    })()`);

    /* ⚠️ 关键：要测的是「文字**背后**的底色」。
       第一版直接取「文字上方 40px」的像素 —— 结果对 #clockDate 取到了
       时钟那个 80px 大白字的笔画，报出「底色 rgb(241,240,236)」这种
       明显不对的值（那是文字自己，不是背景）。
       正确做法：把 UI 全部临时隐藏，只留场景，在同一坐标采样。 */
    await ev(`(() => {
      const st = document.createElement('style');
      st.id = '__bg_only__';
      st.textContent = 'body > *:not(.scene) { visibility: hidden !important; }';
      document.head.appendChild(st);
      return 1; })()`);
    await sleep(250);

    const shot = await send("Page.captureScreenshot", { format: "png" });
    const img = decodePng(Buffer.from(shot.data, "base64"));

    /* 还原 UI */
    await ev(`(() => { const s = document.getElementById('__bg_only__'); if (s) s.remove(); return 1; })()`);

    for (const el of els) {
      const bx = Math.max(0, Math.min(img.width - 1, el.x));
      const by = Math.max(0, Math.min(img.height - 1, el.y));
      const bg = px(img, bx, by);
      const fg = parseRgb(el.color);
      const c = contrast(fg, bg);
      results.push({ part, sel: el.sel, fs: el.fs, bg, fg, c });
    }
  }

  console.log("\n============ 场景对文字可读性的影响 ============");
  console.log("（对比度按 WCAG：正文需 ≥4.5，大字 ≥3.0）\n");
  let bad = 0;
  for (const r of results) {
    const need = parseFloat(r.fs) >= 24 ? 3.0 : 4.5;
    const okf = r.c >= need;
    if (!okf) bad++;
    console.log(`  ${okf ? "OK  " : "XX  "} ${r.part.padEnd(10)} ${r.sel.padEnd(14)} ${r.fs.padStart(6)}  对比度 ${r.c.toFixed(2)}  (需 ≥${need})  字色 rgb(${r.fg.join(",")})  底色 rgb(${r.bg.join(",")})`);
  }
  console.log("\n  ── 结论 ──");
  console.log(`    不达标 ${bad} / ${results.length} 项`);
  const exc = errs.length;
  console.log(`    页面异常 ${exc} 条`);
  try { child.kill(); } catch (e) {}
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
