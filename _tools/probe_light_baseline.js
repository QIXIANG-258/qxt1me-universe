/* =========================================================
   量「浅色主题」下，**有场景 vs 无场景**的对比度差异。

   为什么要量这一对：
     上一轮探针报浅色主题 14/30 不达标，但其中一部分可能是
     **原有配色**就达不到（--fg-3 是「弱化文字」档，设计上不追求 AA），
     不全是场景造成的。不分开量就分不清「我改坏了什么」和「本来就如此」。

   做法：同一个页面，先隐藏 #scene 量一遍，再显示量一遍，逐项对比。

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools\probe_light_baseline.js
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
const PORT = 9449;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PARTS = ["night", "dawn", "morning", "noon", "afternoon", "dusk", "evening"];

function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
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
      if (ft === 1) v += a; else if (ft === 2) v += b;
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
const px = (img, x, y) => { const i = (y * img.width + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
const parseRgb = (s) => { const m = String(s).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; };

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-lb-")),
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
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 160));
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
  await sleep(1200);
  await ev(`document.documentElement.setAttribute('data-theme','light'); 1`);
  await sleep(800);

  const measure = async (withScene) => {
    const out = [];
    for (const part of PARTS) {
      await ev(`(() => { const s = document.querySelector('#scene');
        s.setAttribute('data-daypart','${part}');
        s.setAttribute('data-weather','clear');
        s.style.display = ${withScene ? "'block'" : "'none'"};
        return 1; })()`);
      await sleep(450);
      const els = await ev(`(() => {
        const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
          const r = e.getBoundingClientRect();
          return { sel, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
                   color: getComputedStyle(e).color, fs: parseFloat(getComputedStyle(e).fontSize) }; };
        return [pick('#clockTime'), pick('#clockDate'), pick('.foot-name'), pick('.foot-note')].filter(Boolean);
      })()`);
      /* 隐藏 UI，只留底色 */
      await ev(`(() => { const s = document.createElement('style'); s.id='__b__';
        s.textContent = 'body > *:not(.scene) { visibility: hidden !important; }';
        document.head.appendChild(s); return 1; })()`);
      await sleep(180);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const img = decodePng(Buffer.from(shot.data, "base64"));
      await ev(`(() => { const s = document.getElementById('__b__'); if (s) s.remove(); return 1; })()`);
      for (const el of els) {
        const bg = px(img, Math.min(img.width - 1, el.x), Math.min(img.height - 1, el.y));
        out.push({ part, sel: el.sel, fs: el.fs, bg, c: contrast(parseRgb(el.color), bg), color: el.color });
      }
    }
    await ev(`(() => { const s = document.querySelector('#scene'); s.style.display='block'; return 1; })()`);
    return out;
  };

  const noScene = await measure(false);
  const withScene = await measure(true);

  console.log("\n============ 浅色主题：无场景 vs 有场景 ============");
  console.log("（WCAG：正文 ≥4.5，大字 ≥3.0）\n");
  console.log("  " + "位置".padEnd(22) + "无场景    有场景    变化");
  console.log("  " + "-".repeat(62));
  let regress = 0, preExisting = 0;
  for (let i = 0; i < noScene.length; i++) {
    const a = noScene[i], b = withScene[i];
    const need = b.fs >= 24 ? 3.0 : 4.5;
    const aOk = a.c >= need, bOk = b.c >= need;
    if (aOk && !bOk) regress++;
    if (!aOk && !bOk) preExisting++;
    const mark = aOk && !bOk ? "❌ 我改坏了" : (!aOk && !bOk ? "⚠ 原有" : "✓");
    console.log("  " + `${b.part}/${b.sel.replace("#", "")}`.padEnd(22) +
      a.c.toFixed(2).padStart(8) + b.c.toFixed(2).padStart(10) +
      ("  " + (b.c - a.c).toFixed(2)).padStart(10) + "   " + mark);
  }
  console.log("\n  ── 汇总 ──");
  console.log(`    因场景而**新增**的不达标：${regress} 项`);
  console.log(`    原本就不达标（非场景造成）：${preExisting} 项`);
  console.log(`    合计 ${noScene.length} 项`);

  try { child.kill(); } catch (e) {}
  process.exit(regress ? 1 : 0);
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
