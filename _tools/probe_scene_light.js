/* =========================================================
   验浅色主题下的场景（这是「未测分支」—— 我给它加了
   mix-blend-mode:multiply 但没验证过）。

   要回答两件事：
     ① 浅色主题下场景是否还在（不是完全没了）
     ② 文字是否仍可读（浅色主题字是深色，压在场景上容易糊）

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools\probe_scene_light.js
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
const PORT = 9447;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const W = 1280, H = 800;
const OUT = "D:\\QX_t1me_plan\\02-universe\\_shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PARTS = ["night", "dawn", "morning", "noon", "afternoon", "dusk", "evening"];

function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
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

const results = [];
const ok = (c, label, extra) => results.push({ pass: !!c, label, extra: extra === undefined ? "" : String(extra) });

(async () => {
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "uv-lt-")),
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

  /* 切浅色主题 */
  await ev(`document.documentElement.setAttribute('data-theme','light'); 1`);
  await sleep(900);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "scene_light.png"), Buffer.from(shot.data, "base64"));

  const bodyBg = await ev(`getComputedStyle(document.body).backgroundColor`);
  ok(parseRgb(bodyBg)[0] > 200, "浅色主题下 body 仍是浅底（没被场景改掉）", bodyBg);

  for (const part of PARTS) {
    await ev(`(() => { const s = document.querySelector('#scene');
      s.setAttribute('data-daypart','${part}');
      s.setAttribute('data-weather','clear');
      s.style.setProperty('--glow-x','4%');
      s.style.setProperty('--glow-y','96%');
      return 1; })()`);
    await sleep(800);

    const els = await ev(`(() => {
      const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
        const r = e.getBoundingClientRect();
        return { sel, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
                 color: getComputedStyle(e).color, fs: getComputedStyle(e).fontSize }; };
      return [pick('#clockTime'), pick('#clockDate'), pick('.foot-name'), pick('.foot-note')].filter(Boolean);
    })()`);

    /* 只留场景，采背景色 */
    await ev(`(() => { const st = document.createElement('style'); st.id='__bg__';
      st.textContent = 'body > *:not(.scene) { visibility: hidden !important; }';
      document.head.appendChild(st); return 1; })()`);
    await sleep(200);
    const bgShot = await send("Page.captureScreenshot", { format: "png" });
    const img = decodePng(Buffer.from(bgShot.data, "base64"));
    await ev(`(() => { const s = document.getElementById('__bg__'); if (s) s.remove(); return 1; })()`);

    for (const el of els) {
      /* ⚠️ 浅色主题下场景被 multiply 混过，采样要取「场景叠在页底之上」的合成色。
         隐藏 UI 后截到的就是那个合成结果。 */
      const bg = px(img, Math.min(img.width - 1, el.x), Math.min(img.height - 1, el.y));
      const c = contrast(parseRgb(el.color), bg);
      const need = parseFloat(el.fs) >= 24 ? 3.0 : 4.5;
      results.push({ pass: c >= need, label: `浅色 ${part} ${el.sel}`,
                     extra: `对比度 ${c.toFixed(2)} (需 ≥${need}) 底色 rgb(${bg.join(",")})` });
    }
  }

  /* 顺便看看场景在浅色下有没有存在感（不能完全看不见） */
  const sceneOpacity = await ev(`getComputedStyle(document.querySelector('#scene')).opacity`);
  ok(parseFloat(sceneOpacity) > 0.05, "浅色主题下场景仍在（不是完全透明）", sceneOpacity);

  try { child.kill(); } catch (e) {}
  const failed = results.filter((r) => !r.pass);
  console.log("\n============ 浅色主题下的场景 ============");
  for (const r of results) console.log(`  ${r.pass ? "OK  " : "XX  "} ${r.label}${r.extra ? "   [" + r.extra + "]" : ""}`);
  console.log("------------------------------------------");
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  console.log("截图：" + path.join(OUT, "scene_light.png"));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("[出错] " + (e.stack || e)); process.exit(2); });
