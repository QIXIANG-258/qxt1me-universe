/* =========================================================
   隔离「浅色 · dusk 下 .foot-note 不达标」的成因。

   假设：黄昏的日辉 --glow-y 是 82%（页脚在 89–93%），
        它的橙色 rgba(255,150,80,.46) 叠在纸色上把页脚压暗了。

   做法：同一页面下逐个隐藏场景图层，看对比度怎么变。
        只有能指出「隐藏某层后达标」，才算找到真因。

   跑法：
     set NODE_PATH=D:\dsh_blog_proj\_tmp_eval\node_modules
     node _tools\probe_layer_isolation.js
   ========================================================= */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"); const os = require("os"); const path = require("path");
const http = require("http"); const zlib = require("zlib"); const WebSocket = require("ws");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9453;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data); else if (type === "IEND") break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch; const out = Buffer.alloc(height * stride); let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++]; const line = raw.slice(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, ch, data: out };
}
const px = (img, x, y) => { const i = (y * img.width + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };

(async () => {
  const child = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--hide-scrollbars",
    "--remote-debugging-port="+PORT,
    "--user-data-dir="+fs.mkdtempSync(path.join(os.tmpdir(),"uv-iso-")),
    "--window-size="+W+","+H, "about:blank"], { stdio: "ignore" });
  const wsUrl = await (async () => {
    for (let i=0;i<80;i++){ try{
      const list = await new Promise((res,rej)=>{const r=http.get({host:"127.0.0.1",port:PORT,path:"/json/list"},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res(JSON.parse(d)))});r.on("error",rej);r.setTimeout(1000,()=>r.destroy(new Error("t")))});
      const p=list.find(t=>t.type==="page"&&t.webSocketDebuggerUrl); if(p) return p.webSocketDebuggerUrl;
    }catch(e){} await sleep(250);} throw new Error("no target");
  })();
  const ws = new WebSocket(wsUrl,{perMessageDeflate:false});
  let id=0; const pend=new Map();
  ws.on("message",raw=>{const m=JSON.parse(raw.toString()); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}});
  await new Promise((res,rej)=>{ws.on("open",res);ws.on("error",rej)});
  const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,150)); return r.result.value};

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:W,height:H,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:URL_});
  for(let i=0;i<60;i++){const st=await ev(`({r:document.readyState,s:!!document.querySelector('#scene.is-ready')})`); if(st.r==="complete"&&st.s) break; await sleep(250);}
  await sleep(1200);
  await ev(`document.documentElement.setAttribute('data-theme','light'); 1`);
  await sleep(800);

  const CASES = [
    ["全部图层",            ""],
    ["隐藏日辉 glow",       ".scene-glow{display:none!important}"],
    ["隐藏云 clouds",       ".scene-clouds{display:none!important}"],
    ["隐藏星空 stars",      ".scene-stars{display:none!important}"],
    ["隐藏 .scene::after",  ".scene::after{display:none!important}"],
    ["只留天空 sky",        ".scene-glow,.scene-clouds,.scene-stars{display:none!important}"],
  ];

  console.log("\n============ 隔离：浅色 · dusk · .foot-note ============");
  console.log("（--fg-weak 在纸色上基准 4.91，需 ≥4.5）\n");
  console.log("  " + "情形".padEnd(22) + "对比度   底色");
  console.log("  " + "-".repeat(58));

  for (const [name, cssRule] of CASES) {
    await ev(`(() => {
      const old = document.getElementById('__iso__'); if (old) old.remove();
      const s = document.createElement('style'); s.id='__iso__'; s.textContent = ${JSON.stringify(cssRule)};
      document.head.appendChild(s);
      const sc = document.querySelector('#scene');
      sc.setAttribute('data-daypart','dusk'); sc.setAttribute('data-weather','clear');
      return 1; })()`);
    await sleep(700);

    const el = await ev(`(() => { const e = document.querySelector('.foot-note'); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
               color: getComputedStyle(e).color }; })()`);
    /* 隐藏 UI 采底色 */
    await ev(`(() => { const s=document.createElement('style'); s.id='__b__';
      s.textContent='body > *:not(.scene){visibility:hidden!important}'; document.head.appendChild(s); return 1; })()`);
    await sleep(180);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const img = decodePng(Buffer.from(shot.data, "base64"));
    await ev(`(() => { const s=document.getElementById('__b__'); if(s) s.remove(); return 1; })()`);

    const bg = px(img, Math.min(img.width-1, el.x), Math.min(img.height-1, el.y));
    const m = String(el.color).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    const c = contrast(m ? [+m[1],+m[2],+m[3]] : [0,0,0], bg);
    console.log("  " + name.padEnd(22) + c.toFixed(2).padStart(6) + "   rgb(" + bg.join(",") + ")" +
      (c >= 4.5 ? "  ✓" : "  ✗"));
  }

  try { child.kill(); } catch(e){}
})().catch(e=>{console.error("[出错] "+(e.stack||e));process.exit(2)});
